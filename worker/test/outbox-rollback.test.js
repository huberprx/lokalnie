import { beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import worker from "../src/index.js";
import { hashToken } from "../src/oauth.js";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const tokenHash = await hashToken("rollback-client-token");
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, name, role_client, role_provider)
       VALUES ('rollback-client', 'rollback@example.com', 'Rollback Client', 1, 0)`
    ),
    env.DB.prepare(
      `INSERT INTO users (id, email, name, role_client, role_provider)
       VALUES ('rollback-provider-user', 'provider@example.com', 'Provider', 1, 1)`
    ),
    env.DB.prepare(
      `INSERT INTO provider_profiles (id, user_id, slug, name, email)
       VALUES ('rollback-provider', 'rollback-provider-user', 'rollback-provider', 'Provider', 'provider@example.com')`
    ),
    env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at)
       VALUES ('rollback-session', 'rollback-client', ?, '2099-01-01T00:00:00.000Z')`
    ).bind(tokenHash),
    env.DB.prepare(
      `INSERT INTO booking_requests (
        id, provider_id, client_user_id, client_name, client_email,
        service_ids_json, service_names_json, days_json, proposals_json, status
       ) VALUES (
        'rollback-request', 'rollback-provider', 'rollback-client', 'Rollback Client',
        'rollback@example.com', '[]', '[]', '[]',
        '[{"id":"rollback-proposal","dateISO":"2026-10-01","from":"10:00","to":"11:00"}]',
        'proposed'
       )`
    ),
  ]);
  await env.DB.prepare("DROP TABLE email_outbox").run();
});

describe("transactional outbox rollback", () => {
  it("rolls back both accept business statements when outbox insert fails", async () => {
    const response = await worker.fetch(
      new Request("https://api.lokalnie.app/requests/rollback-request/accept", {
        method: "POST",
        headers: {
          Authorization: "Bearer rollback-client-token",
          "Content-Type": "application/json",
          "Idempotency-Key": "rollback-outbox",
        },
        body: JSON.stringify({ proposalId: "rollback-proposal" }),
      }),
      env
    );
    expect(response.status).toBe(500);

    const request = await env.DB.prepare(
      `SELECT status, accepted_proposal_id
       FROM booking_requests WHERE id='rollback-request'`
    ).first();
    const bookings = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM bookings WHERE request_id='rollback-request'"
    ).first();
    const idempotency = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM idempotency_keys WHERE scope LIKE 'rollback-client:%'"
    ).first();

    expect(request).toMatchObject({ status: "proposed", accepted_proposal_id: null });
    expect(bookings.count).toBe(0);
    expect(idempotency.count).toBe(0);
  });
});
