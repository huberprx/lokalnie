import { id, nowIso } from "./http.js";

/** Kolejka maili — faktyczna wysyłka po podpięciu Resend. */
export async function enqueueEmail(env, { toEmail, template, payload }) {
  if (!toEmail) return null;
  const emailId = id("em");
  await env.DB.prepare(
    `INSERT INTO email_outbox (id, to_email, template, payload_json, status, scheduled_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`
  )
    .bind(emailId, String(toEmail).trim(), template, JSON.stringify(payload || {}), nowIso())
    .run();
  return emailId;
}

export async function listOutbox(env, limit = 50) {
  const rows = await env.DB.prepare(
    `SELECT id, to_email, template, payload_json, status, attempts, scheduled_at, sent_at, error, created_at
     FROM email_outbox ORDER BY created_at DESC LIMIT ?`
  )
    .bind(limit)
    .all();
  return (rows.results || []).map((r) => ({
    id: r.id,
    to: r.to_email,
    template: r.template,
    payload: safeParse(r.payload_json),
    status: r.status,
    attempts: r.attempts,
    scheduledAt: r.scheduled_at,
    sentAt: r.sent_at,
    error: r.error,
    createdAt: r.created_at,
  }));
}

function safeParse(s) {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}
