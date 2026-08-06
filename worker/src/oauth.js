import { json, id, nowIso } from "./http.js";
import { GOOGLE_CALENDAR_SCOPE, encryptToken } from "./calendar.js";
import { verifyGoogleIdToken } from "./googleIdToken.js";

const SESSION_DAYS = 30;
const STATE_TTL_MS = 10 * 60 * 1000;
export const SESSION_COOKIE = "lokalnie_session";

function allowedReturnOrigins(env) {
  const list = new Set([
    "https://lokalnie.app",
    "https://www.lokalnie.app",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
  ]);
  if (env.APP_ORIGIN) list.add(String(env.APP_ORIGIN).replace(/\/+$/, ""));
  return list;
}

function sanitizeReturnTo(raw, env) {
  const fallback = String(env.APP_ORIGIN || "https://lokalnie.app").replace(/\/+$/, "");
  if (!raw) return fallback;
  try {
    const u = new URL(raw);
    const origin = u.origin;
    if (!allowedReturnOrigins(env).has(origin)) return fallback;
    return origin + (u.pathname === "/" ? "" : u.pathname) + u.search;
  } catch {
    return fallback;
  }
}

function bytesToBase64Url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function hashToken(token) {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function sessionTokenFromCookie(request) {
  const cookie = request.headers.get("Cookie") || "";
  const entry = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (!entry) return "";
  try {
    return decodeURIComponent(entry.slice(SESSION_COOKIE.length + 1));
  } catch {
    return "";
  }
}

export function sessionCookie(token, env, maxAge = SESSION_DAYS * 24 * 60 * 60) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${
    env.ENVIRONMENT === "production" ? "; Secure" : ""
  }`;
}

function randomToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomBase64Url(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return bytesToBase64Url(arr);
}

/** PKCE S256: zwraca { codeVerifier, codeChallenge }. */
export async function createPkcePair() {
  const codeVerifier = randomBase64Url(32);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  const codeChallenge = bytesToBase64Url(new Uint8Array(digest));
  return { codeVerifier, codeChallenge };
}

function apiBase(request) {
  const url = new URL(request.url);
  return url.origin;
}

function cleanSecret(value) {
  return String(value || "")
    .trim()
    .replace(/^["']+|["']+$/g, "");
}

function appFallbackOrigin(env) {
  return String(env.APP_ORIGIN || "https://lokalnie.app").replace(/\/+$/, "");
}

function redirectWithHash(returnTo, hashEntries) {
  const dest = new URL(returnTo);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(hashEntries)) {
    params.set(key, value);
  }
  dest.hash = params.toString();
  return new Response(null, { status: 302, headers: { Location: dest.toString() } });
}

function authErrorRedirect(returnTo, errorCode, env, clearCookie = false) {
  const dest = sanitizeReturnTo(returnTo, env);
  const headers = { Location: new URL(dest).toString() };
  const url = new URL(dest);
  url.hash = `auth_error=${encodeURIComponent(errorCode)}`;
  headers.Location = url.toString();
  if (clearCookie) headers["Set-Cookie"] = sessionCookie("", env, 0);
  return new Response(null, { status: 302, headers });
}

async function cleanupExpiredOAuthStates(env) {
  try {
    await env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < ? OR used_at IS NOT NULL")
      .bind(new Date(Date.now() - STATE_TTL_MS).toISOString())
      .run();
  } catch {
    /* best-effort */
  }
}

async function storeOAuthState(env, { purpose, returnTo, codeVerifier, nonce, userId = null }) {
  await cleanupExpiredOAuthStates(env);
  const stateId = randomToken(32);
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();
  await env.DB.prepare(
    `INSERT INTO oauth_states (id, purpose, return_to, code_verifier, nonce, user_id, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(stateId, purpose, returnTo, codeVerifier, nonce, userId, expiresAt)
    .run();
  return stateId;
}

/**
 * Pobiera i zużywa state. Ponowne użycie lub wygaśnięcie → null.
 * Eksportowane pod testy.
 */
export async function consumeOAuthState(env, stateId, expectedPurpose) {
  if (!stateId) return null;
  const now = nowIso();
  const row = await env.DB.prepare(
    `SELECT id, purpose, return_to, code_verifier, nonce, user_id, expires_at
     FROM oauth_states
     WHERE id = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?`
  )
    .bind(stateId, expectedPurpose, now)
    .first();
  if (!row) return null;
  const update = await env.DB.prepare(
    `UPDATE oauth_states SET used_at = ? WHERE id = ? AND used_at IS NULL`
  )
    .bind(now, stateId)
    .run();
  if (!update.meta?.changes) return null;
  return row;
}

export async function startGoogleAuth(request, env) {
  const clientId = cleanSecret(env.GOOGLE_CLIENT_ID);
  const clientSecret = cleanSecret(env.GOOGLE_CLIENT_SECRET);
  if (!clientId || !clientSecret) {
    return json(
      {
        error: "oauth_not_configured",
        message: "Brak GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET. Ustaw przez wrangler secret put.",
      },
      503
    );
  }

  const url = new URL(request.url);
  const returnTo = sanitizeReturnTo(url.searchParams.get("return_to"), env);
  const { codeVerifier, codeChallenge } = await createPkcePair();
  const nonce = randomToken(16);
  const state = await storeOAuthState(env, {
    purpose: "login",
    returnTo,
    codeVerifier,
    nonce,
  });

  const redirectUri = `${apiBase(request)}/auth/google/callback`;
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "openid email profile");
  auth.searchParams.set("access_type", "online");
  auth.searchParams.set("prompt", "select_account");
  auth.searchParams.set("state", state);
  auth.searchParams.set("nonce", nonce);
  auth.searchParams.set("code_challenge", codeChallenge);
  auth.searchParams.set("code_challenge_method", "S256");

  return new Response(null, { status: 302, headers: { Location: auth.toString() } });
}

export async function startGoogleCalendarAuth(request, env, userId) {
  const clientId = cleanSecret(env.GOOGLE_CLIENT_ID);
  const clientSecret = cleanSecret(env.GOOGLE_CLIENT_SECRET);
  if (!clientId || !clientSecret || !cleanSecret(env.GOOGLE_CALENDAR_TOKEN_KEY)) {
    return json({ error: "calendar_oauth_not_configured" }, 503);
  }
  const url = new URL(request.url);
  const returnTo = sanitizeReturnTo(url.searchParams.get("return_to"), env);
  const { codeVerifier, codeChallenge } = await createPkcePair();
  const nonce = randomToken(16);
  const state = await storeOAuthState(env, {
    purpose: "calendar",
    returnTo,
    codeVerifier,
    nonce,
    userId: String(userId || ""),
  });
  const redirectUri = `${apiBase(request)}/auth/google/calendar/callback`;
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", GOOGLE_CALENDAR_SCOPE);
  auth.searchParams.set("access_type", "offline");
  auth.searchParams.set("prompt", "consent");
  auth.searchParams.set("state", state);
  auth.searchParams.set("code_challenge", codeChallenge);
  auth.searchParams.set("code_challenge_method", "S256");
  return new Response(null, { status: 302, headers: { Location: auth.toString() } });
}

async function exchangeCode(code, redirectUri, env, codeVerifier) {
  const body = new URLSearchParams({
    code,
    client_id: cleanSecret(env.GOOGLE_CLIENT_ID),
    client_secret: cleanSecret(env.GOOGLE_CLIENT_SECRET),
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error_description || data.error || "token_exchange_failed");
    err.details = data;
    throw err;
  }
  return data;
}

/**
 * Upsert użytkownika po Google sub.
 * Łączenie po e-mailu tylko gdy email_verified=true.
 * Eksportowane pod testy.
 */
export async function upsertGoogleUser(env, profile) {
  const googleSub = String(profile.sub || "");
  const email = profile.email ? String(profile.email).toLowerCase() : null;
  const emailVerified = profile.email_verified === true || profile.email_verified === "true" ? 1 : 0;
  const name = String(profile.name || profile.given_name || email || "Użytkownik");

  if (!googleSub) throw new Error("missing_google_sub");

  const identity = await env.DB.prepare(
    "SELECT * FROM oauth_identities WHERE provider = ? AND provider_user_id = ?"
  )
    .bind("google", googleSub)
    .first();

  if (identity) {
    const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(identity.user_id).first();
    if (!user) throw new Error("oauth_user_missing");
    // Nazwa z Google inicjalizuje konto, ale nie może nadpisywać późniejszej
    // edycji wykonanej przez użytkownika w profilu Lokalnie.
    if (name && !String(user.name || "").trim()) {
      await env.DB.prepare("UPDATE users SET name = ?, updated_at = ? WHERE id = ?")
        .bind(name, nowIso(), user.id)
        .run();
      user.name = name;
    }
    await env.DB.prepare("UPDATE users SET email_verified=? WHERE id=?").bind(emailVerified, user.id).run();
    user.email_verified = emailVerified;
    return user;
  }

  let user = null;
  if (email) {
    user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  }

  if (user) {
    // Account linking tylko dla zweryfikowanego e-maila Google.
    if (!emailVerified) {
      const err = new Error("email_not_verified_for_link");
      err.code = "email_not_verified_for_link";
      throw err;
    }
  } else {
    const userId = id("user");
    await env.DB.prepare(
      `INSERT INTO users (id, email, name, role_client, role_provider,
        notification_booking, notification_reminder, notification_marketing, email_verified)
       VALUES (?, ?, ?, 1, 0, 1, 1, 0, ?)`
    )
      .bind(userId, email, name, emailVerified)
      .run();
    user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first();
  }

  await env.DB.prepare(
    `INSERT INTO oauth_identities (id, user_id, provider, provider_user_id)
     VALUES (?, ?, 'google', ?)`
  )
    .bind(id("oauth"), user.id, googleSub)
    .run();

  return user;
}

async function createSession(env, userId) {
  const token = randomToken(32);
  const tokenHash = await hashToken(token);
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`
  )
    .bind(id("sess"), userId, tokenHash, expires)
    .run();
  return { token, expiresAt: expires };
}

function profileFromIdToken(payload) {
  return {
    sub: payload.sub,
    email: payload.email,
    email_verified: payload.email_verified,
    name: payload.name,
    given_name: payload.given_name,
  };
}

export async function handleGoogleCallback(request, env) {
  const clientId = cleanSecret(env.GOOGLE_CLIENT_ID);
  const clientSecret = cleanSecret(env.GOOGLE_CLIENT_SECRET);
  const fallback = appFallbackOrigin(env);

  if (!clientId || !clientSecret) {
    return authErrorRedirect(fallback, "oauth_not_configured", env);
  }

  const url = new URL(request.url);
  const err = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const stateId = url.searchParams.get("state");
  const state = await consumeOAuthState(env, stateId, "login");
  const returnTo = state?.return_to ? sanitizeReturnTo(state.return_to, env) : fallback;

  if (err) {
    return authErrorRedirect(returnTo, "google_denied", env);
  }
  if (!code || !state) {
    return authErrorRedirect(returnTo, "invalid_oauth_state", env);
  }

  try {
    const redirectUri = `${apiBase(request)}/auth/google/callback`;
    const tokens = await exchangeCode(code, redirectUri, env, state.code_verifier);
    if (!tokens.id_token) throw new Error("missing_id_token");

    const claims = await verifyGoogleIdToken(tokens.id_token, {
      clientId,
      nonce: state.nonce,
    });
    const profile = profileFromIdToken(claims);
    const user = await upsertGoogleUser(env, profile);
    const dest = new URL(returnTo.startsWith("http") ? returnTo : `${fallback}${returnTo}`);

    if (user.blocked) {
      return authErrorRedirect(dest.toString(), "account_blocked", env, true);
    }

    const session = await createSession(env, user.id);
    // Produkcja: wyłącznie HttpOnly cookie. Poza prod: dodatkowo #access_token
    // dla lokalnych testów cross-site (localhost → api.lokalnie.app).
    if (env.ENVIRONMENT !== "production") {
      dest.hash = `access_token=${encodeURIComponent(session.token)}`;
    }

    return new Response(null, {
      status: 302,
      headers: { Location: dest.toString(), "Set-Cookie": sessionCookie(session.token, env) },
    });
  } catch (e) {
    console.error(
      JSON.stringify({ level: "error", oauth: String(e?.stack || e), details: e?.details || null })
    );
    const codeName =
      e?.code === "email_not_verified_for_link"
        ? "email_not_verified_for_link"
        : e?.message === "invalid_nonce" ||
            e?.message === "invalid_aud" ||
            e?.message === "invalid_iss" ||
            e?.message === "id_token_expired" ||
            e?.message === "invalid_id_token_signature"
          ? "oauth_token_invalid"
          : "oauth_failed";
    return authErrorRedirect(returnTo, codeName, env);
  }
}

export async function handleGoogleCalendarCallback(request, env) {
  const clientId = cleanSecret(env.GOOGLE_CLIENT_ID);
  const clientSecret = cleanSecret(env.GOOGLE_CLIENT_SECRET);
  const tokenKey = cleanSecret(env.GOOGLE_CALENDAR_TOKEN_KEY);
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const state = await consumeOAuthState(env, url.searchParams.get("state"), "calendar");
  const destination = state?.return_to
    ? sanitizeReturnTo(state.return_to, env)
    : sanitizeReturnTo("", env);

  const redirectWith = (key, value = "1") => redirectWithHash(destination, { [key]: value });

  if (error) return redirectWith("calendar_error", "google_denied");
  if (!clientId || !clientSecret || !tokenKey || !state || !state.user_id) {
    return redirectWith("calendar_error", "invalid_oauth_state");
  }

  const code = url.searchParams.get("code");
  if (!code) return redirectWith("calendar_error", "missing_code");
  const redirectUri = `${apiBase(request)}/auth/google/calendar/callback`;

  try {
    const tokens = await exchangeCode(code, redirectUri, env, state.code_verifier);
    if (!tokens.access_token) {
      throw new Error(tokens.error_description || tokens.error || "calendar_token_exchange_failed");
    }

    const previous = await env.DB.prepare(
      "SELECT * FROM calendar_connections WHERE user_id=? AND provider='google'"
    )
      .bind(state.user_id)
      .first();
    const refreshToken = tokens.refresh_token
      ? await encryptToken(tokens.refresh_token, tokenKey)
      : previous?.encrypted_refresh_token;
    if (!refreshToken) throw new Error("calendar_refresh_token_missing");
    const accessToken = await encryptToken(tokens.access_token, tokenKey);
    const connectionId = previous?.id || id("cal");
    const expiresAt = new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString();
    await env.DB.prepare(
      `INSERT INTO calendar_connections
       (id, user_id, provider, calendar_id, encrypted_access_token, encrypted_refresh_token,
        token_expires_at, scopes, status, last_error, connected_at, updated_at)
       VALUES (?, ?, 'google', 'primary', ?, ?, ?, ?, 'connected', NULL, ?, ?)
       ON CONFLICT(user_id, provider) DO UPDATE SET
         encrypted_access_token=excluded.encrypted_access_token,
         encrypted_refresh_token=excluded.encrypted_refresh_token,
         token_expires_at=excluded.token_expires_at,
         scopes=excluded.scopes,
         status='connected',
         last_error=NULL,
         updated_at=excluded.updated_at`
    )
      .bind(
        connectionId,
        state.user_id,
        accessToken,
        refreshToken,
        expiresAt,
        GOOGLE_CALENDAR_SCOPE,
        nowIso(),
        nowIso()
      )
      .run();
    return redirectWith("calendar_connected", "1");
  } catch (err) {
    console.error(JSON.stringify({ level: "error", calendar_oauth: String(err?.stack || err) }));
    return redirectWith("calendar_error", "calendar_connection_failed");
  }
}

export async function logoutSession(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const cookieToken = sessionTokenFromCookie(request);
  const tokens = [];
  if (bearer && bearer.toLowerCase() !== "demo") tokens.push(bearer);
  if (cookieToken && cookieToken !== bearer) tokens.push(cookieToken);
  for (const token of tokens) {
    const tokenHash = await hashToken(token);
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  }
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", env, 0) });
}
