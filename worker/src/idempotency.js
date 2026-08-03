import { json, nowIso } from "./http.js";

const MAX_KEY_LENGTH = 128;
const PROCESSING_TTL_MS = 10 * 60 * 1000;

export async function withIdempotency(request, env, { userId, endpoint }, operation) {
  const key = request.headers.get("Idempotency-Key");
  if (!key) return operation();

  const normalizedKey = key.trim();
  if (!normalizedKey || normalizedKey.length > MAX_KEY_LENGTH) {
    return json({ error: "invalid_idempotency_key" }, 400);
  }

  const requestHash = await hashText(await request.clone().text());
  const scope = `${userId}:${endpoint}:${normalizedKey}`;
  const now = nowIso();
  const staleAt = new Date(Date.now() - PROCESSING_TTL_MS).toISOString();
  const claim = await env.DB.prepare(
    `INSERT INTO idempotency_keys (scope, request_hash, status, created_at, updated_at)
     VALUES (?, ?, 'processing', ?, ?)
     ON CONFLICT(scope) DO UPDATE SET
       request_hash=excluded.request_hash,
       status='processing',
       response_status=NULL,
       response_json=NULL,
       updated_at=excluded.updated_at
     WHERE idempotency_keys.status='processing' AND idempotency_keys.updated_at < ?`
  )
    .bind(scope, requestHash, now, now, staleAt)
    .run();

  if (!claim.meta?.changes) {
    const existing = await env.DB.prepare(
      `SELECT request_hash, status, response_status, response_json
       FROM idempotency_keys WHERE scope=?`
    )
      .bind(scope)
      .first();
    if (!existing) return json({ error: "idempotency_unavailable" }, 503);
    if (existing.request_hash !== requestHash) {
      return json({ error: "idempotency_key_reused" }, 409);
    }
    if (existing.status === "completed") {
      return new Response(existing.response_json || "", {
        status: existing.response_status || 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    return json({ error: "request_in_progress" }, 409);
  }

  try {
    const response = await operation();
    const responseBody = await response.clone().text();
    await env.DB.prepare(
      `UPDATE idempotency_keys
       SET status='completed', response_status=?, response_json=?, updated_at=?
       WHERE scope=? AND request_hash=?`
    )
      .bind(response.status, responseBody, nowIso(), scope, requestHash)
      .run();
    return response;
  } catch (err) {
    await env.DB.prepare(
      "DELETE FROM idempotency_keys WHERE scope=? AND request_hash=? AND status='processing'"
    )
      .bind(scope, requestHash)
      .run();
    throw err;
  }
}

export async function hashText(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
