import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import worker from "../src/index.js";
import {
  assertGoogleIdTokenClaims,
  resetGoogleJwksCache,
} from "../src/googleIdToken.js";
import {
  consumeOAuthState,
  createPkcePair,
  hashToken,
  startGoogleAuth,
  upsertGoogleUser,
} from "../src/oauth.js";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  resetGoogleJwksCache();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_states"),
    env.DB.prepare("DELETE FROM sessions"),
    env.DB.prepare("DELETE FROM oauth_identities"),
    env.DB.prepare("DELETE FROM provider_locations"),
    env.DB.prepare("DELETE FROM geocode_cache"),
    env.DB.prepare("DELETE FROM provider_profiles"),
    env.DB.prepare("DELETE FROM users"),
    env.DB.prepare("DELETE FROM rate_limits"),
  ]);
});

describe("PKCE", () => {
  it("creates an S256 verifier/challenge pair", async () => {
    const pair = await createPkcePair();
    expect(pair.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pair.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pair.codeChallenge).not.toBe(pair.codeVerifier);

    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(pair.codeVerifier)
    );
    const expected = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    expect(pair.codeChallenge).toBe(expected);
  });
});

describe("oauth state (one-time)", () => {
  it("stores state on /auth/google and rejects reuse", async () => {
    const response = await startGoogleAuth(
      new Request("https://api.lokalnie.app/auth/google?return_to=https://lokalnie.app/"),
      {
        ...env,
        GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
        GOOGLE_CLIENT_SECRET: "client-secret",
        APP_ORIGIN: "https://lokalnie.app",
        ENVIRONMENT: "production",
      }
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location"));
    expect(location.hostname).toBe("accounts.google.com");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("code_challenge")).toBeTruthy();
    expect(location.searchParams.get("nonce")).toBeTruthy();
    const stateId = location.searchParams.get("state");
    expect(stateId).toBeTruthy();

    const row = await env.DB.prepare("SELECT * FROM oauth_states WHERE id = ?")
      .bind(stateId)
      .first();
    expect(row).toBeTruthy();
    expect(row.purpose).toBe("login");
    expect(row.code_verifier).toBeTruthy();
    expect(row.nonce).toBe(location.searchParams.get("nonce"));
    expect(row.used_at).toBeNull();

    const first = await consumeOAuthState(env, stateId, "login");
    expect(first).toBeTruthy();
    expect(first.code_verifier).toBe(row.code_verifier);

    const second = await consumeOAuthState(env, stateId, "login");
    expect(second).toBeNull();
  });

  it("rejects expired or wrong-purpose state", async () => {
    await env.DB.prepare(
      `INSERT INTO oauth_states (id, purpose, return_to, code_verifier, nonce, expires_at)
       VALUES ('stale', 'login', 'https://lokalnie.app/', 'v', 'n', '2000-01-01T00:00:00.000Z')`
    ).run();
    await env.DB.prepare(
      `INSERT INTO oauth_states (id, purpose, return_to, code_verifier, nonce, expires_at)
       VALUES ('cal', 'calendar', 'https://lokalnie.app/', 'v', 'n', '2099-01-01T00:00:00.000Z')`
    ).run();

    expect(await consumeOAuthState(env, "stale", "login")).toBeNull();
    expect(await consumeOAuthState(env, "cal", "login")).toBeNull();
    expect(await consumeOAuthState(env, "cal", "calendar")).toBeTruthy();
  });
});

describe("id_token claims", () => {
  it("accepts a valid Google payload", () => {
    const now = Date.now();
    const payload = assertGoogleIdTokenClaims(
      {
        iss: "https://accounts.google.com",
        aud: "client-id.apps.googleusercontent.com",
        sub: "google-sub-1",
        exp: Math.floor(now / 1000) + 3600,
        nonce: "nonce-1",
        email: "a@gmail.com",
        email_verified: true,
      },
      {
        clientId: "client-id.apps.googleusercontent.com",
        nonce: "nonce-1",
        nowMs: now,
      }
    );
    expect(payload.sub).toBe("google-sub-1");
  });

  it("rejects bad issuer, audience, expiry and nonce", () => {
    const now = Date.now();
    const base = {
      iss: "https://accounts.google.com",
      aud: "client-id.apps.googleusercontent.com",
      sub: "google-sub-1",
      exp: Math.floor(now / 1000) + 3600,
      nonce: "nonce-1",
    };
    expect(() =>
      assertGoogleIdTokenClaims(
        { ...base, iss: "https://evil.example" },
        { clientId: base.aud, nonce: "nonce-1", nowMs: now }
      )
    ).toThrow("invalid_iss");
    expect(() =>
      assertGoogleIdTokenClaims(base, {
        clientId: "other-client",
        nonce: "nonce-1",
        nowMs: now,
      })
    ).toThrow("invalid_aud");
    expect(() =>
      assertGoogleIdTokenClaims(
        { ...base, exp: Math.floor(now / 1000) - 10 },
        { clientId: base.aud, nonce: "nonce-1", nowMs: now }
      )
    ).toThrow("id_token_expired");
    expect(() =>
      assertGoogleIdTokenClaims(base, {
        clientId: base.aud,
        nonce: "wrong",
        nowMs: now,
      })
    ).toThrow("invalid_nonce");
  });
});

describe("upsertGoogleUser account linking", () => {
  it("links an existing account only when Google email is verified", async () => {
    await env.DB.prepare(
      `INSERT INTO users (id, email, name, role_client, role_provider, email_verified)
       VALUES ('user-existing', 'client@example.com', 'Existing', 1, 0, 1)`
    ).run();

    await expect(
      upsertGoogleUser(env, {
        sub: "sub-unverified",
        email: "client@example.com",
        email_verified: false,
        name: "Attacker",
      })
    ).rejects.toMatchObject({ code: "email_not_verified_for_link" });

    const identities = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM oauth_identities WHERE user_id = 'user-existing'"
    ).first();
    expect(Number(identities.n)).toBe(0);

    const linked = await upsertGoogleUser(env, {
      sub: "sub-verified",
      email: "client@example.com",
      email_verified: true,
      name: "Client From Google",
    });
    expect(linked.id).toBe("user-existing");
    // Nie nadpisuj istniejącej nazwy.
    expect(linked.name).toBe("Existing");

    const identity = await env.DB.prepare(
      "SELECT * FROM oauth_identities WHERE provider_user_id = 'sub-verified'"
    ).first();
    expect(identity.user_id).toBe("user-existing");
  });

  it("creates a new user for a new verified Google identity", async () => {
    const user = await upsertGoogleUser(env, {
      sub: "sub-new",
      email: "new@gmail.com",
      email_verified: true,
      name: "New User",
    });
    expect(user.email).toBe("new@gmail.com");
    expect(Number(user.email_verified)).toBe(1);
    expect(Number(user.role_client)).toBe(1);
  });

  it("reuses the same user on subsequent login by sub", async () => {
    const first = await upsertGoogleUser(env, {
      sub: "sub-repeat",
      email: "repeat@gmail.com",
      email_verified: true,
      name: "Repeat",
    });
    await env.DB.prepare("UPDATE users SET name = ? WHERE id = ?")
      .bind("Custom Name", first.id)
      .run();

    const second = await upsertGoogleUser(env, {
      sub: "sub-repeat",
      email: "repeat@gmail.com",
      email_verified: true,
      name: "Google Name",
    });
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Custom Name");
  });
});

describe("OAuth callback error redirects", () => {
  it("redirects invalid state to the app with auth_error hash", async () => {
    const response = await worker.fetch(
      new Request("https://api.lokalnie.app/auth/google/callback?code=abc&state=missing", {
        redirect: "manual",
      }),
      {
        ...env,
        GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
        GOOGLE_CLIENT_SECRET: "client-secret",
        APP_ORIGIN: "https://lokalnie.app",
        ENVIRONMENT: "production",
      }
    );
    expect(response.status).toBe(302);
    const location = response.headers.get("Location");
    expect(location).toContain("https://lokalnie.app");
    expect(location).toContain("auth_error=invalid_oauth_state");
  });
});

describe("mutation origin guard", () => {
  it("rejects mutating requests from disallowed origins", async () => {
    const token = "sess-token";
    const tokenHash = await hashToken(token);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, name, role_client, role_provider, email_verified)
         VALUES ('user-1', 'u@example.com', 'U', 1, 0, 1)`
      ),
      env.DB.prepare(
        "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)"
      ).bind("sess-1", "user-1", tokenHash, "2099-01-01T00:00:00.000Z"),
    ]);

    const response = await worker.fetch(
      new Request("https://api.lokalnie.app/auth/logout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: "https://evil.example",
        },
      }),
      {
        ...env,
        ENVIRONMENT: "production",
        APP_ORIGIN: "https://lokalnie.app",
      }
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("origin_not_allowed");
  });
});
