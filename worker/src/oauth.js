import { json, id, nowIso } from "./http.js";

const SESSION_DAYS = 30;
const STATE_COOKIE = "lokalnie_oauth_state";
const RETURN_COOKIE = "lokalnie_oauth_return";

function allowedReturnOrigins(env) {
  const list = new Set([
    "https://lokalnie.app",
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

function cookieOpts(request, maxAgeSec) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

function clearCookie(request, name) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const out = {};
  header.split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i === -1) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

export function cleanSecret(value) {
  return String(value || "")
    .trim()
    .replace(/^["']+|["']+$/g, "");
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
  return new URL(request.url).origin;
}

export async function startGoogleAuth(request, env) {
  const clientId = cleanSecret(env.GOOGLE_CLIENT_ID);
  if (!clientId) {
    return json(
      {
        error: "oauth_not_configured",
        message: "Brak GOOGLE_CLIENT_ID. Ustaw: npx wrangler secret put GOOGLE_CLIENT_ID",
      },
      503
    );
  }

  const url = new URL(request.url);
  const returnTo = sanitizeReturnTo(url.searchParams.get("return_to"), env);
  const state = randomToken(16);

  const redirectUri = `${apiBase(request)}/auth/google/callback`;
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "openid email profile");
  auth.searchParams.set("access_type", "online");
  auth.searchParams.set("prompt", "select_account");
  auth.searchParams.set("state", state);

  const res = new Response(null, { status: 302, headers: { Location: auth.toString() } });
  res.headers.append(
    "Set-Cookie",
    `${STATE_COOKIE}=${encodeURIComponent(state)}; ${cookieOpts(request, 600)}`
  );
  res.headers.append(
    "Set-Cookie",
    `${RETURN_COOKIE}=${encodeURIComponent(returnTo)}; ${cookieOpts(request, 600)}`
  );
  return res;
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
      await env.DB.prepare("UPDATE users SET name = ?, updated_at = ? WHERE id = ?")
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
  const cookies = parseCookies(request);
  const expectedState = cookies[STATE_COOKIE];
  const returnTo = sanitizeReturnTo(cookies[RETURN_COOKIE], env);

  if (!code || !state || !expectedState || state !== expectedState) {
    return json(
      { error: "invalid_oauth_state", message: "Nieprawidłowy stan OAuth. Spróbuj ponownie." },
      400
    );
  }

  try {
    const redirectUri = `${apiBase(request)}/auth/google/callback`;
    const tokens = await exchangeCode(code, redirectUri, env);
    const profile = await fetchGoogleUser(tokens.access_token);
    const user = await upsertGoogleUser(env, profile);
    const session = await createSession(env, user.id);

    const dest = new URL(returnTo.startsWith("http") ? returnTo : `https://lokalnie.app${returnTo}`);
    dest.hash = `access_token=${encodeURIComponent(session.token)}`;

    const res = new Response(null, { status: 302, headers: { Location: dest.toString() } });
    res.headers.append("Set-Cookie", clearCookie(request, STATE_COOKIE));
    res.headers.append("Set-Cookie", clearCookie(request, RETURN_COOKIE));
    return res;
  } catch (e) {
    console.error(
      JSON.stringify({ level: "error", oauth: String(e?.stack || e), details: e?.details || null })
    );
    return json({ error: "oauth_failed", message: String(e?.message || e) }, 500);
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
