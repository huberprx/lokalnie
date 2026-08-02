import { json, id, nowIso } from "./http.js";

const SESSION_DAYS = 30;
const STATE_TTL_MS = 10 * 60 * 1000;

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

function base64UrlToBytes(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function textToBase64Url(text) {
  return bytesToBase64Url(new TextEncoder().encode(text));
}

function base64UrlToText(str) {
  return new TextDecoder().decode(base64UrlToBytes(str));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signPayload(payloadB64, secret) {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return bytesToBase64Url(new Uint8Array(sig));
}

async function verifyPayload(payloadB64, sigB64, secret) {
  const key = await hmacKey(secret);
  const sig = base64UrlToBytes(sigB64);
  return crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(payloadB64));
}

/** Podpisany state — bez cookie (cookie na 302 często ginie w przeglądarce). */
async function createOAuthState(returnTo, env) {
  const secret = cleanSecret(env.GOOGLE_CLIENT_SECRET);
  if (!secret) throw new Error("oauth_not_configured");
  const payload = {
    r: returnTo,
    e: Date.now() + STATE_TTL_MS,
    n: randomToken(8),
  };
  const payloadB64 = textToBase64Url(JSON.stringify(payload));
  const sig = await signPayload(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

async function parseOAuthState(state, env) {
  const secret = cleanSecret(env.GOOGLE_CLIENT_SECRET);
  if (!secret || !state || !state.includes(".")) return null;
  const i = state.lastIndexOf(".");
  const payloadB64 = state.slice(0, i);
  const sigB64 = state.slice(i + 1);
  if (!payloadB64 || !sigB64) return null;
  const ok = await verifyPayload(payloadB64, sigB64, secret);
  if (!ok) return null;
  let payload;
  try {
    payload = JSON.parse(base64UrlToText(payloadB64));
  } catch {
    return null;
  }
  if (!payload || typeof payload.e !== "number" || Date.now() > payload.e) return null;
  return payload;
}

export async function hashToken(token) {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
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

  let state;
  try {
    state = await createOAuthState(returnTo, env);
  } catch (e) {
    return json({ error: "oauth_not_configured", message: String(e?.message || e) }, 503);
  }

  const redirectUri = `${apiBase(request)}/auth/google/callback`;
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "openid email profile");
  auth.searchParams.set("access_type", "online");
  auth.searchParams.set("prompt", "select_account");
  auth.searchParams.set("state", state);

  return new Response(null, { status: 302, headers: { Location: auth.toString() } });
}

async function exchangeCode(code, redirectUri, env) {
  const body = new URLSearchParams({
    code,
    client_id: cleanSecret(env.GOOGLE_CLIENT_ID),
    client_secret: cleanSecret(env.GOOGLE_CLIENT_SECRET),
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
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

async function fetchGoogleUser(accessToken) {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || "userinfo_failed");
  }
  return data;
}

async function upsertGoogleUser(env, profile) {
  const googleSub = String(profile.sub || "");
  const email = profile.email ? String(profile.email).toLowerCase() : null;
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
    if (name && name !== user.name) {
      await env.DB.prepare(
        "UPDATE users SET name = ?, updated_at = ? WHERE id = ?"
      )
        .bind(name, nowIso(), user.id)
        .run();
      user.name = name;
    }
    return user;
  }

  let user = null;
  if (email) {
    user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  }

  if (!user) {
    const userId = id("user");
    await env.DB.prepare(
      `INSERT INTO users (id, email, name, role_client, role_provider,
        notification_booking, notification_reminder, notification_marketing)
       VALUES (?, ?, ?, 1, 0, 1, 1, 0)`
    )
      .bind(userId, email, name)
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

export async function handleGoogleCallback(request, env) {
  const clientId = cleanSecret(env.GOOGLE_CLIENT_ID);
  const clientSecret = cleanSecret(env.GOOGLE_CLIENT_SECRET);
  if (!clientId || !clientSecret) {
    return json({ error: "oauth_not_configured" }, 503);
  }

  const url = new URL(request.url);
  const err = url.searchParams.get("error");
  if (err) {
    return json({ error: "google_denied", message: err }, 400);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const parsed = await parseOAuthState(state, env);

  if (!code || !parsed) {
    return json(
      {
        error: "invalid_oauth_state",
        message: "Nieprawidłowy lub wygasły stan OAuth. Zamknij to okno i zaloguj się ponownie z Lokalnie.",
      },
      400
    );
  }

  const returnTo = sanitizeReturnTo(parsed.r, env);

  try {
    const redirectUri = `${apiBase(request)}/auth/google/callback`;
    const tokens = await exchangeCode(code, redirectUri, env);
    const profile = await fetchGoogleUser(tokens.access_token);
    const user = await upsertGoogleUser(env, profile);
    const session = await createSession(env, user.id);

    const dest = new URL(returnTo.startsWith("http") ? returnTo : `https://lokalnie.app${returnTo}`);
    dest.hash = `access_token=${encodeURIComponent(session.token)}`;

    return new Response(null, { status: 302, headers: { Location: dest.toString() } });
  } catch (e) {
    console.error(JSON.stringify({ level: "error", oauth: String(e?.stack || e), details: e?.details || null }));
    return json(
      { error: "oauth_failed", message: String(e?.message || e) },
      500
    );
  }
}

export async function logoutSession(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (bearer && bearer.toLowerCase() !== "demo") {
    const tokenHash = await hashToken(bearer);
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  }
  return json({ ok: true });
}
