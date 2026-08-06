import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import worker, { cleanupRetention } from "../src/index.js";
import { hashToken } from "../src/oauth.js";
import { encryptPhone } from "../src/pii.js";

const CLIENT_TOKEN = "delete-client-token";
const PROVIDER_TOKEN = "delete-provider-token";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM admin_audit_log"),
    env.DB.prepare("DELETE FROM calendar_events"),
    env.DB.prepare("DELETE FROM calendar_connections"),
    env.DB.prepare("DELETE FROM idempotency_keys"),
    env.DB.prepare("DELETE FROM email_outbox"),
    env.DB.prepare("DELETE FROM rate_limits"),
    env.DB.prepare("DELETE FROM media"),
    env.DB.prepare("DELETE FROM bookings"),
    env.DB.prepare("DELETE FROM booking_requests"),
    env.DB.prepare("DELETE FROM provider_clients"),
    env.DB.prepare("DELETE FROM provider_services"),
    env.DB.prepare("DELETE FROM provider_availability"),
    env.DB.prepare("DELETE FROM oauth_states"),
    env.DB.prepare("DELETE FROM sessions"),
    env.DB.prepare("DELETE FROM oauth_identities"),
    env.DB.prepare("DELETE FROM provider_profiles"),
    env.DB.prepare("DELETE FROM users"),
  ]);

  const expires = "2099-01-01T00:00:00.000Z";
  const clientHash = await hashToken(CLIENT_TOKEN);
  const providerHash = await hashToken(PROVIDER_TOKEN);
  const sealedPhone = await encryptPhone("+48111222333", env);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, name, phone, role_client, role_provider, email_verified)
       VALUES (?, ?, ?, ?, 1, 0, 1)`
    ).bind("user-del-client", "delete-me@example.com", "Delete Me", sealedPhone),
    env.DB.prepare(
      `INSERT INTO users (id, email, name, role_client, role_provider, email_verified)
       VALUES (?, ?, ?, 1, 1, 1)`
    ).bind("user-del-provider", "provider-del@example.com", "Provider Del"),
    env.DB.prepare(
      `INSERT INTO provider_profiles (id, user_id, slug, name, email)
       VALUES ('provider-del', 'user-del-provider', 'provider-del', 'Provider Del', 'provider-del@example.com')`
    ),
    env.DB.prepare(
      "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)"
    ).bind("sess-del-client", "user-del-client", clientHash, expires),
    env.DB.prepare(
      "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)"
    ).bind("sess-del-provider", "user-del-provider", providerHash, expires),
    env.DB.prepare(
      `INSERT INTO oauth_identities (id, user_id, provider, provider_user_id)
       VALUES ('oauth-del-client', 'user-del-client', 'google', 'google-sub-del')`
    ),
  ]);
});

function api(path, { method = "GET", token = CLIENT_TOKEN, body } = {}) {
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

describe("DELETE /me account deletion", () => {
  it("rejects demo mode deletion", async () => {
    const previous = env.ENVIRONMENT;
    env.ENVIRONMENT = "development";
    await env.DB.prepare(
      `INSERT INTO users (id, email, name, role_client, role_provider)
       VALUES ('user-demo-hubert', 'demo@example.com', 'Demo', 1, 0)`
    ).run();
    try {
      const response = await worker.fetch(
        new Request("https://api.lokalnie.app/me", {
          method: "DELETE",
          headers: { "X-Demo-User": "demo" },
        }),
        env
      );
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("demo_delete_forbidden");
    } finally {
      env.ENVIRONMENT = previous;
    }
  });

  it("anonymizes PII, purges access, clears outbox, and writes audit", async () => {
    const sealedPhone = await encryptPhone("+48111222333", env);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO bookings (
          id, provider_id, client_user_id, client_name, client_phone, client_email,
          service_ids_json, service_names_json, date_iso, time_from, time_to, status
        ) VALUES (
          'bk-del-1', 'provider-del', 'user-del-client', 'Delete Me', ?, 'delete-me@example.com',
          '[]', '["Strzyżenie"]', '2026-09-10', '10:00', '11:00', 'confirmed'
        )`
      ).bind(sealedPhone),
      env.DB.prepare(
        `INSERT INTO booking_requests (
          id, provider_id, client_user_id, client_name, client_phone, client_email,
          service_ids_json, service_names_json, days_json, proposals_json, status
        ) VALUES (
          'rq-del-1', 'provider-del', 'user-del-client', 'Delete Me', ?, 'delete-me@example.com',
          '[]', '[]', '[]', '[]', 'pending'
        )`
      ).bind(sealedPhone),
      env.DB.prepare(
        `INSERT INTO provider_clients (
          id, provider_id, client_user_id, name, phone, email, address, notes
        ) VALUES (
          'pc-del-1', 'provider-del', 'user-del-client', 'Delete Me', ?, 'delete-me@example.com',
          'ul. Test 1', 'notatka prywatna'
        )`
      ).bind(sealedPhone),
      env.DB.prepare(
        `INSERT INTO media (id, owner_user_id, kind, storage_key, content_type, byte_size, is_public)
         VALUES ('media-del-1', 'user-del-client', 'avatar', 'user-del-client/avatar/x.webp', 'image/webp', 12, 1)`
      ),
      env.DB.prepare(
        `INSERT INTO calendar_connections (
          id, user_id, provider, calendar_id, encrypted_refresh_token, status
        ) VALUES ('cal-del-1', 'user-del-client', 'google', 'primary', 'token', 'connected')`
      ),
      env.DB.prepare(
        `INSERT INTO email_outbox (id, to_email, template, payload_json, status, scheduled_at)
         VALUES ('em-del-1', 'delete-me@example.com', 'booking_confirmed', '{"clientName":"Delete Me"}', 'pending', ?)`
      ).bind(new Date().toISOString()),
      env.DB.prepare(
        `INSERT INTO email_outbox (id, to_email, template, payload_json, status, scheduled_at)
         VALUES ('em-keep-1', 'provider-del@example.com', 'request_new', '{}', 'pending', ?)`
      ).bind(new Date().toISOString()),
    ]);

    const response = await api("/me", { method: "DELETE" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, deleted: true });

    const user = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind("user-del-client").first();
    expect(user.email).toBeNull();
    expect(user.name).toBe("Usunięte konto");
    expect(user.phone).toBeNull();
    expect(user.blocked).toBe(1);
    expect(user.blocked_reason).toBe("account_deleted");

    const booking = await env.DB.prepare("SELECT * FROM bookings WHERE id='bk-del-1'").first();
    expect(booking.client_name).toBe("Usunięte konto");
    expect(booking.client_phone).toBeNull();
    expect(booking.client_email).toBeNull();
    expect(booking.client_user_id).toBeNull();

    const request = await env.DB.prepare("SELECT * FROM booking_requests WHERE id='rq-del-1'").first();
    expect(request.client_name).toBe("Usunięte konto");
    expect(request.client_email).toBeNull();
    expect(request.client_user_id).toBeNull();

    const crm = await env.DB.prepare("SELECT * FROM provider_clients WHERE id='pc-del-1'").first();
    expect(crm.name).toBe("Usunięte konto");
    expect(crm.phone).toBeNull();
    expect(crm.email).toBeNull();
    expect(crm.address).toBe("");
    expect(crm.notes).toBeNull();
    expect(crm.client_user_id).toBeNull();

    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id='user-del-client'").first()).n
    ).toBe(0);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM oauth_identities WHERE user_id='user-del-client'").first())
        .n
    ).toBe(0);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM calendar_connections WHERE user_id='user-del-client'").first())
        .n
    ).toBe(0);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM media WHERE owner_user_id='user-del-client'").first()).n
    ).toBe(0);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM email_outbox WHERE lower(to_email)='delete-me@example.com'"
        ).first()
      ).n
    ).toBe(0);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM email_outbox WHERE to_email='provider-del@example.com'"
        ).first()
      ).n
    ).toBe(1);

    const audit = await env.DB.prepare(
      "SELECT * FROM admin_audit_log WHERE action='account.deleted' AND target_id='user-del-client'"
    ).first();
    expect(audit).toBeTruthy();
    expect(audit.actor_user_id).toBe("user-del-client");
    const meta = JSON.parse(audit.meta_json || "{}");
    expect(meta.bookingsAnonymized).toBe(1);

    const meAfter = await api("/me");
    expect(meAfter.status).toBe(401);
  });
});

describe("DELETE /provider/me/clients/:id", () => {
  it("deletes CRM row and anonymizes linked bookings and matching requests", async () => {
    const sealedPhone = await encryptPhone("+48999888777", env);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO provider_clients (id, provider_id, name, phone, email)
         VALUES ('pc-crm-1', 'provider-del', 'Anna CRM', ?, 'anna-crm@example.com')`
      ).bind(sealedPhone),
      env.DB.prepare(
        `INSERT INTO bookings (
          id, provider_id, provider_client_id, client_name, client_phone, client_email,
          service_ids_json, service_names_json, date_iso, time_from, time_to, status
        ) VALUES (
          'bk-crm-1', 'provider-del', 'pc-crm-1', 'Anna CRM', ?, 'anna-crm@example.com',
          '[]', '[]', '2026-09-12', '12:00', '13:00', 'confirmed'
        )`
      ).bind(sealedPhone),
      env.DB.prepare(
        `INSERT INTO booking_requests (
          id, provider_id, client_name, client_phone, client_email,
          service_ids_json, service_names_json, days_json, proposals_json, status
        ) VALUES (
          'rq-crm-1', 'provider-del', 'Anna CRM', ?, 'anna-crm@example.com',
          '[]', '[]', '[]', '[]', 'pending'
        )`
      ).bind(sealedPhone),
    ]);

    const response = await api("/provider/me/clients/pc-crm-1", {
      method: "DELETE",
      token: PROVIDER_TOKEN,
    });
    expect(response.status).toBe(200);

    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM provider_clients WHERE id='pc-crm-1'").first()).n
    ).toBe(0);

    const booking = await env.DB.prepare("SELECT * FROM bookings WHERE id='bk-crm-1'").first();
    expect(booking.client_name).toBe("Usunięty klient");
    expect(booking.client_phone).toBeNull();
    expect(booking.client_email).toBeNull();
    expect(booking.provider_client_id).toBeNull();

    const request = await env.DB.prepare("SELECT * FROM booking_requests WHERE id='rq-crm-1'").first();
    expect(request.client_name).toBe("Usunięty klient");
    expect(request.client_email).toBeNull();
  });
});

describe("cleanupRetention", () => {
  it("removes expired rate limits and old outbox rows", async () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO rate_limits (scope, window_started, count, expires_at) VALUES (?, 1, 1, ?)"
      ).bind("1.2.3.4:anonymous:/me", Date.now() - 1000),
      env.DB.prepare(
        "INSERT INTO rate_limits (scope, window_started, count, expires_at) VALUES (?, 1, 1, ?)"
      ).bind("1.2.3.4:anonymous:/bookings", Date.now() + 60_000),
      env.DB.prepare(
        `INSERT INTO email_outbox (id, to_email, template, payload_json, status, scheduled_at, created_at)
         VALUES ('em-old', 'old@example.com', 'booking_confirmed', '{}', 'sent', ?, ?)`
      ).bind(old, old),
      env.DB.prepare(
        `INSERT INTO email_outbox (id, to_email, template, payload_json, status, scheduled_at, created_at)
         VALUES ('em-new', 'new@example.com', 'booking_confirmed', '{}', 'pending', ?, ?)`
      ).bind(recent, recent),
    ]);

    const summary = await cleanupRetention(env);
    expect(summary.rateLimits).toBe(1);
    expect(summary.emailOutbox).toBe(1);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM rate_limits").first()).n
    ).toBe(1);
    expect(
      (await env.DB.prepare("SELECT id FROM email_outbox").all()).results.map((r) => r.id)
    ).toEqual(["em-new"]);
  });
});
