import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import worker from "../src/index.js";
import { hashToken } from "../src/oauth.js";

const CLIENT_TOKEN = "client-token";
const PROVIDER_TOKEN = "provider-token";
const OTHER_TOKEN = "other-token";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.batch([
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
  ]);

  const expires = "2099-01-01T00:00:00.000Z";
  const clientHash = await hashToken(CLIENT_TOKEN);
  const providerHash = await hashToken(PROVIDER_TOKEN);
  const otherHash = await hashToken(OTHER_TOKEN);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, name, role_client, role_provider) VALUES (?, ?, ?, 1, 0)"
    ).bind("user-client", "client@example.com", "Client"),
    env.DB.prepare(
      "INSERT INTO users (id, email, name, role_client, role_provider) VALUES (?, ?, ?, 1, 1)"
    ).bind("user-provider", "provider@example.com", "Provider"),
    env.DB.prepare(
      "INSERT INTO users (id, email, name, role_client, role_provider) VALUES (?, ?, ?, 1, 0)"
    ).bind("user-other", "other@example.com", "Other"),
    env.DB.prepare(
      `INSERT INTO provider_profiles (id, user_id, slug, name, email)
       VALUES ('provider-1', 'user-provider', 'provider-one', 'Provider One', 'provider@example.com')`
    ),
    env.DB.prepare(
      "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)"
    ).bind("sess-client", "user-client", clientHash, expires),
    env.DB.prepare(
      "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)"
    ).bind("sess-provider", "user-provider", providerHash, expires),
    env.DB.prepare(
      "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)"
    ).bind("sess-other", "user-other", otherHash, expires),
  ]);
});

function api(path, { method = "GET", token = CLIENT_TOKEN, body, key } = {}) {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (key) headers.set("Idempotency-Key", key);
  return worker.fetch(
    new Request(`https://api.lokalnie.app${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env
  );
}

async function seedBooking({
  id,
  status = "confirmed",
  clientUserId = "user-client",
  dateISO = "2026-09-10",
  from = "10:00",
  to = "11:00",
}) {
  await env.DB.prepare(
    `INSERT INTO bookings (
      id, provider_id, client_user_id, client_name, client_email, service_ids_json, service_names_json,
      date_iso, time_from, time_to, status
    ) VALUES (?, 'provider-1', ?, 'Client', 'client@example.com', '[]', '[]', ?, ?, ?, ?)`
  )
    .bind(id, clientUserId, dateISO, from, to, status)
    .run();
}

async function seedRequest({
  id,
  clientUserId = "user-client",
  status = "proposed",
  proposals = [{ id: "prop-1", dateISO: "2026-09-11", from: "12:00", to: "13:00" }],
}) {
  await env.DB.prepare(
    `INSERT INTO booking_requests (
      id, provider_id, client_user_id, client_name, client_email,
      service_ids_json, service_names_json, days_json, proposals_json, status
    ) VALUES (?, 'provider-1', ?, 'Client', 'client@example.com', '[]', '[]', '[]', ?, ?)`
  )
    .bind(id, clientUserId, JSON.stringify(proposals), status)
    .run();
}

describe("production schema and authorization", () => {
  it("contains no demo fixture after clean migrations", async () => {
    const demo = await env.DB.prepare(
      "SELECT id FROM users WHERE id='user-demo-hubert'"
    ).first();
    expect(demo).toBeNull();
  });

  it("does not trust clientUserId when creating CRM clients", async () => {
    const response = await api("/provider/me/clients", {
      method: "POST",
      token: PROVIDER_TOKEN,
      body: { name: "Spoof attempt", clientUserId: "user-client" },
    });
    expect(response.status).toBe(201);
    expect((await response.json()).client.clientUserId).toBeNull();
  });

  it("allows only the request owner to accept a proposal", async () => {
    await seedRequest({ id: "rq-owner" });
    const provider = await api("/requests/rq-owner/accept", {
      method: "POST",
      token: PROVIDER_TOKEN,
      key: "provider-accept",
      body: { proposalId: "prop-1" },
    });
    expect(provider.status).toBe(403);

    await seedRequest({ id: "rq-no-owner", clientUserId: null });
    const ownerless = await api("/requests/rq-no-owner/accept", {
      method: "POST",
      key: "ownerless-accept",
      body: { proposalId: "prop-1" },
    });
    expect(ownerless.status).toBe(403);
  });
});

describe("booking transitions and atomic collisions", () => {
  it("enforces client and provider transition matrices", async () => {
    await seedBooking({ id: "bk-pending", status: "pending" });
    const clientConfirm = await api("/bookings/bk-pending", {
      method: "PATCH",
      key: "client-invalid-transition",
      body: { status: "confirmed" },
    });
    expect(clientConfirm.status).toBe(403);

    await seedBooking({
      id: "bk-proposed",
      status: "proposed",
      dateISO: "2026-09-12",
    });
    const clientAccept = await api("/bookings/bk-proposed", {
      method: "PATCH",
      key: "client-valid-transition",
      body: { status: "confirmed" },
    });
    expect(clientAccept.status).toBe(200);

    await seedBooking({
      id: "bk-rejected",
      status: "rejected",
      dateISO: "2026-09-13",
    });
    const providerRevive = await api("/bookings/bk-rejected", {
      method: "PATCH",
      token: PROVIDER_TOKEN,
      key: "provider-invalid-transition",
      body: { status: "confirmed" },
    });
    expect(providerRevive.status).toBe(409);
  });

  it("atomically rejects overlapping create and patch writes", async () => {
    await seedBooking({ id: "bk-occupied" });
    const create = await api("/bookings", {
      method: "POST",
      key: "atomic-create",
      body: {
        providerId: "provider-1",
        clientName: "Client",
        dateISO: "2026-09-10",
        from: "10:30",
        to: "11:30",
      },
    });
    expect(create.status).toBe(409);

    await seedBooking({
      id: "bk-move",
      dateISO: "2026-09-14",
      from: "12:00",
      to: "13:00",
    });
    const patch = await api("/bookings/bk-move", {
      method: "PATCH",
      token: PROVIDER_TOKEN,
      key: "atomic-patch",
      body: {
        status: "confirmed",
        dateISO: "2026-09-10",
        from: "10:15",
        to: "10:45",
      },
    });
    expect(patch.status).toBe(409);
    const unchanged = await env.DB.prepare(
      "SELECT date_iso FROM bookings WHERE id='bk-move'"
    ).first();
    expect(unchanged.date_iso).toBe("2026-09-14");
  });

  it("atomically rejects acceptance into an occupied slot", async () => {
    await seedBooking({ id: "bk-occupied" });
    await seedRequest({
      id: "rq-overlap",
      proposals: [{ id: "prop-overlap", dateISO: "2026-09-10", from: "10:30", to: "10:45" }],
    });
    const response = await api("/requests/rq-overlap/accept", {
      method: "POST",
      key: "atomic-accept",
      body: { proposalId: "prop-overlap" },
    });
    expect(response.status).toBe(409);
    const request = await env.DB.prepare(
      "SELECT status FROM booking_requests WHERE id='rq-overlap'"
    ).first();
    expect(request.status).toBe("proposed");
  });
});

describe("idempotent mutation replay", () => {
  it("replays propose, decline, accept, and patch without duplicate side effects", async () => {
    await seedRequest({ id: "rq-propose", status: "pending", proposals: [] });
    const proposalBody = {
      proposals: [{ id: "prop-new", dateISO: "2026-09-20", from: "09:00", to: "10:00" }],
    };
    const proposeOne = await api("/requests/rq-propose/propose", {
      method: "POST",
      token: PROVIDER_TOKEN,
      key: "replay-propose",
      body: proposalBody,
    });
    const proposeTwo = await api("/requests/rq-propose/propose", {
      method: "POST",
      token: PROVIDER_TOKEN,
      key: "replay-propose",
      body: proposalBody,
    });
    expect(proposeOne.status).toBe(200);
    expect(await proposeTwo.text()).toBe(await proposeOne.text());

    await seedRequest({ id: "rq-decline", status: "pending", proposals: [] });
    const declineOne = await api("/requests/rq-decline/decline", {
      method: "POST",
      token: PROVIDER_TOKEN,
      key: "replay-decline",
    });
    const declineTwo = await api("/requests/rq-decline/decline", {
      method: "POST",
      token: PROVIDER_TOKEN,
      key: "replay-decline",
    });
    expect(declineOne.status).toBe(200);
    expect(await declineTwo.text()).toBe(await declineOne.text());

    await seedRequest({ id: "rq-accept" });
    const acceptBody = { proposalId: "prop-1" };
    const acceptOne = await api("/requests/rq-accept/accept", {
      method: "POST",
      key: "replay-accept",
      body: acceptBody,
    });
    const acceptTwo = await api("/requests/rq-accept/accept", {
      method: "POST",
      key: "replay-accept",
      body: acceptBody,
    });
    expect(acceptOne.status).toBe(200);
    expect(await acceptTwo.text()).toBe(await acceptOne.text());

    await seedBooking({
      id: "bk-patch",
      status: "confirmed",
      dateISO: "2026-09-22",
    });
    const patchBody = { status: "cancelled" };
    const patchOne = await api("/bookings/bk-patch", {
      method: "PATCH",
      key: "replay-patch",
      body: patchBody,
    });
    const patchTwo = await api("/bookings/bk-patch", {
      method: "PATCH",
      key: "replay-patch",
      body: patchBody,
    });
    expect(patchOne.status).toBe(200);
    expect(await patchTwo.text()).toBe(await patchOne.text());

    const acceptedBookings = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM bookings WHERE request_id='rq-accept'"
    ).first();
    const emails = await env.DB.prepare(
      `SELECT template, COUNT(*) AS count FROM email_outbox
       WHERE template IN ('request_proposed', 'booking_confirmed', 'booking_cancelled')
       GROUP BY template`
    ).all();
    expect(acceptedBookings.count).toBe(1);
    expect(Object.fromEntries(emails.results.map((row) => [row.template, row.count]))).toEqual({
      booking_cancelled: 1,
      booking_confirmed: 1,
      request_proposed: 1,
    });
  });
});
