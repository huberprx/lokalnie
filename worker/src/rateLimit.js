import { json } from "./http.js";

const WINDOW_MS = 60_000;

function clientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export async function enforceRateLimit(request, env, scope, limit, windowMs = WINDOW_MS) {
  const now = Date.now();
  const expiresAt = now + windowMs;
  const result = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO rate_limits (scope, window_started, count, expires_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(scope) DO UPDATE SET
         window_started = CASE WHEN rate_limits.expires_at <= ? THEN ? ELSE rate_limits.window_started END,
         count = CASE WHEN rate_limits.expires_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
         expires_at = CASE WHEN rate_limits.expires_at <= ? THEN ? ELSE rate_limits.expires_at END`
    ).bind(scope, now, expiresAt, now, now, now, now, expiresAt),
    env.DB.prepare("SELECT count, expires_at FROM rate_limits WHERE scope=?").bind(scope),
  ]);
  const row = result[1]?.results?.[0] || result[1]?.result;
  if (!row || Number(row.count) <= limit) return null;
  const retryAfter = Math.max(1, Math.ceil((Number(row.expires_at) - now) / 1000));
  return json({ error: "rate_limited" }, 429, { "Retry-After": String(retryAfter) });
}

export function rateLimitScope(request, route, identity = "") {
  return `${clientIp(request)}:${identity || "anonymous"}:${route}`;
}

export { clientIp };
