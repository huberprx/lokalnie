import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import worker from "../src/index.js";
import { hashToken } from "../src/oauth.js";
import { cleanupIdempotencyKeys } from "../src/idempotency.js";
import { encryptToken, syncBookingToGoogle } from "../src/calendar.js";

const CLIENT_TOKEN = "client-token";
const PROVIDER_TOKEN = "provider-token";
const OTHER_TOKEN = "other-token";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM admin_audit_log"),
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

afterEach(() => {
  vi.restoreAllMocks();
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

it("lists only complete and published provider profiles in the public catalog", async () => {
  await env.DB.prepare(
    `UPDATE provider_profiles
     SET category=?, city=?, phone=?, visible_in_search=1, services_json=?, availability_json=?
     WHERE id=?`
  )
    .bind(
      "beauty",
      "Warszawa",
      "500100200",
      JSON.stringify([{ id: "service-1", name: "Strzyżenie", durationMin: 30 }]),
      JSON.stringify([{ dateISO: "2026-08-07", blocks: [{ from: "09:00", to: "12:00" }] }]),
      "provider-1"
    )
    .run();
  await env.DB.prepare(
    `INSERT INTO provider_profiles
     (id, user_id, slug, name, category, city, phone, visible_in_search, services_json, availability_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, '[]', '[]')`
  )
    .bind("provider-hidden", "user-other", "not-ready", "Not ready", "beauty", "Warszawa", "500100201")
    .run();

  const response = await api("/providers");
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.providers).toHaveLength(1);
  expect(body.providers[0]).toMatchObject({
    id: "provider-1",
    name: "Provider One",
    category: "beauty",
    services: [{ id: "service-1", name: "Strzyżenie", durationMin: 30 }],
  });
  expect(body.providers[0]).not.toHaveProperty("phone");
  expect(body.providers[0]).not.toHaveProperty("email");

  await env.DB.prepare(
    "UPDATE provider_profiles SET phone_visible=1, email_visible=1 WHERE id='provider-1'"
  ).run();
  const visibleContactsResponse = await api("/providers");
  const visibleContacts = await visibleContactsResponse.json();
  expect(visibleContacts.providers[0]).toMatchObject({
    phone: "500100200",
    email: "provider@example.com",
  });
});

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

  it("isolates provider clients, bookings, and requests between providers", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE users SET role_provider=1 WHERE id='user-other'`
      ),
      env.DB.prepare(
        `INSERT INTO provider_profiles (id, user_id, slug, name, email)
         VALUES ('provider-2', 'user-other', 'provider-two', 'Provider Two', 'other@example.com')`
      ),
      env.DB.prepare(
        `INSERT INTO provider_clients (id, provider_id, name, email)
         VALUES ('pc-other', 'provider-2', 'Other Client', 'other-client@example.com')`
      ),
      env.DB.prepare(
        `INSERT INTO bookings (
          id, provider_id, client_name, client_email, status
        ) VALUES ('bk-other-provider', 'provider-2', 'Other Client', 'other-client@example.com', 'confirmed')`
      ),
      env.DB.prepare(
        `INSERT INTO booking_requests (
          id, provider_id, client_name, client_email, status
        ) VALUES ('rq-other-provider', 'provider-2', 'Other Client', 'other-client@example.com', 'pending')`
      ),
    ]);

    const clients = await api("/provider/me/clients", { token: PROVIDER_TOKEN });
    expect(clients.status).toBe(200);
    expect((await clients.json()).clients).toEqual([]);

    const bookings = await api("/bookings", { token: PROVIDER_TOKEN });
    expect(bookings.status).toBe(200);
    expect((await bookings.json()).bookings).toEqual([]);

    const requests = await api("/requests", { token: PROVIDER_TOKEN });
    expect(requests.status).toBe(200);
    expect((await requests.json()).requests).toEqual([]);

    const client = await api("/provider/me/clients/pc-other", { token: PROVIDER_TOKEN });
    expect(client.status).toBe(404);

    const booking = await api("/bookings/bk-other-provider", { token: PROVIDER_TOKEN });
    expect(booking.status).toBe(403);

    const request = await api("/requests/rq-other-provider", { token: PROVIDER_TOKEN });
    expect(request.status).toBe(403);
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

describe("required idempotency keys", () => {
  it("rejects every frontend mutation without a key", async () => {
    const cases = [
      ["/bookings", "POST", CLIENT_TOKEN],
      ["/requests", "POST", CLIENT_TOKEN],
      ["/requests/missing/propose", "POST", PROVIDER_TOKEN],
      ["/requests/missing/accept", "POST", CLIENT_TOKEN],
      ["/requests/missing/decline", "POST", CLIENT_TOKEN],
      ["/requests/missing/request-more", "POST", CLIENT_TOKEN],
      ["/bookings/missing", "PATCH", CLIENT_TOKEN],
    ];
    for (const [path, method, token] of cases) {
      const response = await api(path, { method, token, body: {} });
      expect(response.status, path).toBe(400);
      expect(await response.json(), path).toEqual({ error: "idempotency_key_required" });
    }
  });

  it("removes expired idempotency records but keeps recent ones", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO idempotency_keys (
          scope, request_hash, status, response_status, response_json, created_at, updated_at
        ) VALUES ('old', 'hash', 'completed', 200, '{}', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')`
      ),
      env.DB.prepare(
        `INSERT INTO idempotency_keys (scope, request_hash, status, created_at, updated_at)
         VALUES ('recent', 'hash', 'processing', ?, ?)`
      ).bind(new Date().toISOString(), new Date().toISOString()),
    ]);
    expect(await cleanupIdempotencyKeys(env)).toBe(1);
    const recent = await env.DB.prepare(
      "SELECT scope FROM idempotency_keys WHERE scope='recent'"
    ).first();
    expect(recent.scope).toBe("recent");
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

describe("request-more flow", () => {
  it("is owner-only, proposed-only, and idempotent", async () => {
    await seedRequest({ id: "rq-more" });
    await env.DB.prepare(
      "UPDATE booking_requests SET accepted_proposal_id='old-proposal' WHERE id='rq-more'"
    ).run();

    const first = await api("/requests/rq-more/request-more", {
      method: "POST",
      key: "request-more-replay",
    });
    const replay = await api("/requests/rq-more/request-more", {
      method: "POST",
      key: "request-more-replay",
    });
    expect(first.status).toBe(200);
    expect(await replay.text()).toBe(await first.text());

    const updated = await env.DB.prepare(
      `SELECT status, proposals_json, accepted_proposal_id
       FROM booking_requests WHERE id='rq-more'`
    ).first();
    expect(updated).toMatchObject({
      status: "pending",
      proposals_json: "[]",
      accepted_proposal_id: null,
    });

    await seedRequest({ id: "rq-more-other" });
    const other = await api("/requests/rq-more-other/request-more", {
      method: "POST",
      token: OTHER_TOKEN,
      key: "request-more-other",
    });
    expect(other.status).toBe(403);

    await seedRequest({ id: "rq-more-provider" });
    const provider = await api("/requests/rq-more-provider/request-more", {
      method: "POST",
      token: PROVIDER_TOKEN,
      key: "request-more-provider",
    });
    expect(provider.status).toBe(403);

    await seedRequest({ id: "rq-more-pending", status: "pending", proposals: [] });
    const wrongStatus = await api("/requests/rq-more-pending/request-more", {
      method: "POST",
      key: "request-more-pending",
    });
    expect(wrongStatus.status).toBe(409);
  });
});

describe("phone PII at rest", () => {
  it("stores encrypted phones in D1 and returns plaintext over API", async () => {
    const create = await api("/provider/me/clients", {
      method: "POST",
      token: PROVIDER_TOKEN,
      body: { name: "Anna", phone: "+48 501 234 567" },
    });
    expect(create.status).toBe(201);
    const payload = await create.json();
    expect(payload.client.phone).toBe("+48 501 234 567");

    const row = await env.DB.prepare(
      "SELECT phone FROM provider_clients WHERE id=?"
    )
      .bind(payload.client.id)
      .first();
    expect(row.phone.startsWith("enc:v1:")).toBe(true);
    expect(row.phone).not.toContain("501");
  });
});

describe("Google Calendar synchronization", () => {
  const calendarTokenKey = "test-calendar-token-key";

  async function connectCalendar(id, userId) {
    await env.DB.prepare(
      `INSERT INTO calendar_connections (
        id, user_id, provider, calendar_id, encrypted_access_token, encrypted_refresh_token,
        token_expires_at, scopes, status
      ) VALUES (?, ?, 'google', 'primary', ?, ?, ?, ?, 'connected')`
    ).bind(
      id,
      userId,
      await encryptToken(`access-${id}`, calendarTokenKey),
      await encryptToken(`refresh-${id}`, calendarTokenKey),
      "2099-01-01T00:00:00.000Z",
      "https://www.googleapis.com/auth/calendar.events"
    ).run();
  }

  it("creates separate events for the client and provider calendars", async () => {
    await seedBooking({ id: "bk-calendar" });
    await connectCalendar("cal-client", "user-client");
    await connectCalendar("cal-provider", "user-provider");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "google-client-event" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "google-provider-event" }), { status: 200 }));

    const result = await syncBookingToGoogle(
      { ...env, GOOGLE_CALENDAR_TOKEN_KEY: calendarTokenKey },
      "bk-calendar"
    );

    expect(result.connected).toBe(true);
    expect(result.synced).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const events = await env.DB.prepare(
      "SELECT connection_id, external_event_id FROM calendar_events WHERE booking_id=? ORDER BY connection_id"
    ).bind("bk-calendar").all();
    expect(events.results).toEqual([
      { connection_id: "cal-client", external_event_id: "google-client-event" },
      { connection_id: "cal-provider", external_event_id: "google-provider-event" },
    ]);
  });

  it("keeps the successful calendar sync when the other connection fails", async () => {
    await seedBooking({ id: "bk-calendar-failure" });
    await connectCalendar("cal-client", "user-client");
    await connectCalendar("cal-provider", "user-provider");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "google-client-event" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "forbidden" } }), { status: 403 }));

    const result = await syncBookingToGoogle(
      { ...env, GOOGLE_CALENDAR_TOKEN_KEY: calendarTokenKey },
      "bk-calendar-failure"
    );

    expect(result.connected).toBe(true);
    expect(result.synced).toBe(false);
    expect(result.results.filter((item) => item.synced)).toHaveLength(1);
    const events = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM calendar_events WHERE booking_id=?"
    ).bind("bk-calendar-failure").first();
    expect(events.count).toBe(1);
  });
});
