import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import worker from "../src/index.js";
import { hashToken } from "../src/oauth.js";
import { requireAdmin, requireDemoUser } from "../src/auth.js";

const ADMIN_TOKEN = "admin-token";
const USER_TOKEN = "user-token";
const OTHER_ADMIN_TOKEN = "other-admin-token";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM admin_audit_log"),
    env.DB.prepare("DELETE FROM idempotency_keys"),
    env.DB.prepare("DELETE FROM email_outbox"),
    env.DB.prepare("DELETE FROM media"),
    env.DB.prepare("DELETE FROM bookings"),
    env.DB.prepare("DELETE FROM booking_requests"),
    env.DB.prepare("DELETE FROM provider_clients"),
    env.DB.prepare("DELETE FROM sessions"),
    env.DB.prepare("DELETE FROM oauth_identities"),
    env.DB.prepare("DELETE FROM provider_profiles"),
    env.DB.prepare("DELETE FROM users"),
    env.DB.prepare("DELETE FROM rate_limits"),
  ]);

  const expires = "2099-01-01T00:00:00.000Z";
  const adminHash = await hashToken(ADMIN_TOKEN);
  const userHash = await hashToken(USER_TOKEN);
  const otherAdminHash = await hashToken(OTHER_ADMIN_TOKEN);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, name, role_client, role_provider, email_verified)
       VALUES (?, ?, ?, 1, 0, 1)`
    ).bind("user-admin", "hubert@lokalnie.app", "Admin"),
    env.DB.prepare(
      `INSERT INTO users (id, email, name, role_client, role_provider, email_verified)
       VALUES (?, ?, ?, 1, 1, 1)`
    ).bind("user-provider", "provider@example.com", "Provider"),
    env.DB.prepare(
      `INSERT INTO users (id, email, name, role_client, role_provider, email_verified)
       VALUES (?, ?, ?, 1, 0, 1)`
    ).bind("user-other-admin", "other-admin@example.com", "Other Admin"),
    env.DB.prepare(
      `INSERT INTO provider_profiles (id, user_id, slug, name, email, visible_in_search)
       VALUES ('provider-1', 'user-provider', 'provider-one', 'Provider One', 'provider@example.com', 1)`
    ),
    env.DB.prepare(
      "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)"
    ).bind("sess-admin", "user-admin", adminHash, expires),
    env.DB.prepare(
      "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)"
    ).bind("sess-user", "user-provider", userHash, expires),
    env.DB.prepare(
      "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)"
    ).bind("sess-other-admin", "user-other-admin", otherAdminHash, expires),
  ]);
});

function api(path, { method = "GET", token = ADMIN_TOKEN, body } = {}) {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return worker.fetch(
    new Request(`https://api.lokalnie.app${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env
  );
}

describe("admin panel security", () => {
  it("conceals admin routes from non-admins in production", async () => {
    const response = await api("/admin/stats", { token: USER_TOKEN });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("not_found");
  });

  it("exposes isAdmin only for verified ADMIN_EMAILS", async () => {
    const adminMe = await (await api("/me")).json();
    expect(adminMe.isAdmin).toBe(true);

    const userMe = await (await api("/me", { token: USER_TOKEN })).json();
    expect(userMe.isAdmin).toBe(false);
  });

  it("returns platform stats for admins", async () => {
    const response = await api("/admin/stats");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stats.usersTotal).toBe(3);
    expect(body.stats.providersTotal).toBe(1);
  });

  it("blocks a user, revokes sessions, and writes audit", async () => {
    const block = await api("/admin/users/user-provider/block", {
      method: "POST",
      body: { reason: "spam" },
    });
    expect(block.status).toBe(200);
    expect((await block.json()).user.blocked).toBe(true);

    // Sesje skasowane przy blokadzie → kolejne requesty: 401.
    const revoked = await requireDemoUser(
      new Request("https://api.lokalnie.app/me", {
        headers: { Authorization: `Bearer ${USER_TOKEN}` },
      }),
      env
    );
    expect(revoked.error.status).toBe(401);

    const sessions = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM sessions WHERE user_id = 'user-provider'"
    ).first();
    expect(sessions.n).toBe(0);

    // Gdyby sesja jeszcze istniała — auth zwraca account_blocked.
    const staleHash = await hashToken("stale-blocked-token");
    await env.DB.prepare(
      "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)"
    )
      .bind("sess-stale", "user-provider", staleHash, "2099-01-01T00:00:00.000Z")
      .run();
    const blockedAuth = await requireDemoUser(
      new Request("https://api.lokalnie.app/me", {
        headers: { Authorization: "Bearer stale-blocked-token" },
      }),
      env
    );
    expect(blockedAuth.error.status).toBe(403);
    expect((await blockedAuth.error.json()).error).toBe("account_blocked");

    const audit = await api("/admin/audit");
    const items = (await audit.json()).items;
    expect(items[0].action).toBe("user.block");
    expect(items[0].targetId).toBe("user-provider");
  });

  it("prevents blocking self and other admins", async () => {
    const self = await api("/admin/users/user-admin/block", {
      method: "POST",
      body: { reason: "nope" },
    });
    expect(self.status).toBe(400);
    expect((await self.json()).error).toBe("cannot_block_self");

    // other-admin@example.com is NOT in ADMIN_EMAILS → can be blocked.
    // Real admin protection: add second admin email temporarily via env override check.
    const protectedAdmin = await requireAdmin(
      new Request("https://api.lokalnie.app/admin/users/x/block", {
        headers: { Authorization: `Bearer ${OTHER_ADMIN_TOKEN}` },
      }),
      { ...env, ADMIN_EMAILS: "hubert@lokalnie.app,other-admin@example.com" }
    );
    expect(protectedAdmin.error).toBeUndefined();

    const blockOtherAdmin = await worker.fetch(
      new Request("https://api.lokalnie.app/admin/users/user-other-admin/block", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ADMIN_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: "should fail" }),
      }),
      { ...env, ADMIN_EMAILS: "hubert@lokalnie.app,other-admin@example.com" }
    );
    expect(blockOtherAdmin.status).toBe(403);
    expect((await blockOtherAdmin.json()).error).toBe("cannot_block_admin");
  });

  it("can hide a provider from search", async () => {
    const response = await api("/admin/providers/provider-1", {
      method: "PATCH",
      body: { visibleInSearch: false },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).provider.visibleInSearch).toBe(false);

    const row = await env.DB.prepare(
      "SELECT visible_in_search FROM provider_profiles WHERE id = 'provider-1'"
    ).first();
    expect(row.visible_in_search).toBe(0);
  });

  it("unblocks a previously blocked user", async () => {
    await api("/admin/users/user-provider/block", {
      method: "POST",
      body: { reason: "temp" },
    });
    const unblock = await api("/admin/users/user-provider/unblock", {
      method: "POST",
      body: {},
    });
    expect(unblock.status).toBe(200);
    expect((await unblock.json()).user.blocked).toBe(false);
  });
});
