import { id, nowIso } from "./http.js";
import { renderEmail } from "./templates.js";

const RETRY_MINUTES = [1, 5, 30, 60];
const MAX_ATTEMPTS = 5;
const MAX_ERROR_LENGTH = 500;

/** Przygotowuje INSERT do transakcyjnego użycia w env.DB.batch(). */
export function prepareEmailOutbox(
  env,
  { toEmail, template, payload, conditionSql = null, conditionBinds = [] }
) {
  if (!toEmail) return null;
  const emailId = id("em");
  const values = [
    emailId,
    String(toEmail).trim(),
    template,
    JSON.stringify(payload || {}),
    nowIso(),
  ];
  if (!conditionSql) {
    return env.DB.prepare(
      `INSERT INTO email_outbox (id, to_email, template, payload_json, status, scheduled_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`
    ).bind(...values);
  }
  return env.DB.prepare(
    `INSERT INTO email_outbox (id, to_email, template, payload_json, status, scheduled_at)
     SELECT ?, ?, ?, ?, 'pending', ?
     WHERE ${conditionSql}`
  ).bind(...values, ...conditionBinds);
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

export async function sendViaResend(env, item) {
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  if (!apiKey) {
    if (env.ENVIRONMENT !== "production") {
      return { id: `dev_${item.id}`, simulated: true };
    }
    throw new Error("resend_not_configured");
  }

  const rendered = renderEmail(item.template, safeParse(item.payload_json));
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [item.to_email],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    }),
  });
  if (!response.ok) {
    const providerError = await response.text();
    console.error(
      JSON.stringify({
        level: "error",
        emailId: item.id,
        provider: "resend",
        status: response.status,
        error: providerError.slice(0, MAX_ERROR_LENGTH),
      })
    );
    throw new Error(`resend_http_${response.status}`);
  }
  return response.json();
}

export async function processDueEmails(env, limit = 25) {
  const rows = await env.DB.prepare(
    `SELECT * FROM email_outbox
     WHERE status='pending' AND scheduled_at <= ?
     ORDER BY scheduled_at ASC LIMIT ?`
  )
    .bind(nowIso(), Math.min(Math.max(Number(limit) || 25, 1), 100))
    .all();

  const summary = { processed: 0, sent: 0, retried: 0, failed: 0 };
  for (const item of rows.results || []) {
    const attempts = Number(item.attempts || 0) + 1;
    const leaseUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const claim = await env.DB.prepare(
      `UPDATE email_outbox SET attempts=?, scheduled_at=?
       WHERE id=? AND status='pending' AND attempts=? AND scheduled_at <= ?`
    )
      .bind(attempts, leaseUntil, item.id, Number(item.attempts || 0), nowIso())
      .run();
    if (!claim.meta?.changes) continue;
    summary.processed += 1;
    try {
      await sendViaResend(env, item);
      await env.DB.prepare(
        `UPDATE email_outbox
         SET status='sent', sent_at=?, error=NULL
         WHERE id=? AND status='pending'`
      )
        .bind(nowIso(), item.id)
        .run();
      summary.sent += 1;
    } catch (err) {
      const error = String(err?.message || "email_delivery_failed").slice(0, MAX_ERROR_LENGTH);
      if (attempts >= MAX_ATTEMPTS) {
        await env.DB.prepare(
          `UPDATE email_outbox SET status='failed', error=? WHERE id=?`
        )
          .bind(error, item.id)
          .run();
        summary.failed += 1;
      } else {
        const delayMinutes = RETRY_MINUTES[Math.min(attempts - 1, RETRY_MINUTES.length - 1)];
        const scheduledAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
        await env.DB.prepare(
          `UPDATE email_outbox
           SET error=?, scheduled_at=?
           WHERE id=? AND status='pending'`
        )
          .bind(error, scheduledAt, item.id)
          .run();
        summary.retried += 1;
      }
    }
  }
  return summary;
}

function safeParse(s) {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}
