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

describe("provider profile persistence", () => {
  it("creates one profile, updates role_provider, and safely returns it on retry", async () => {
    const body = {
      name: "Łukasz Mobilny",
      category: "naprawy",
      city: "Gdańsk",
      locations: [
        { id: "loc-mobile", label: "Dojazd", address: "Gdańsk", toneIndex: 2 },
      ],
    };
    const createdResponse = await api("/provider/me", {
      method: "POST",
      token: CLIENT_TOKEN,
      body,
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    expect(created.created).toBe(true);
    expect(created.provider).toMatchObject({
      name: "Łukasz Mobilny",
      category: "naprawy",
      locations: body.locations,
    });
    expect(created.provider.slug).toMatch(/^lukasz-mobilny(?:-[a-f0-9]{8})?$/);

    const retryResponse = await api("/provider/me", {
      method: "POST",
      token: CLIENT_TOKEN,
      body: { name: "Ignored retry body", slug: "different-slug" },
    });
    expect(retryResponse.status).toBe(200);
    const retry = await retryResponse.json();
    expect(retry.created).toBe(false);
    expect(retry.provider.id).toBe(created.provider.id);

    const user = await env.DB.prepare(
      "SELECT role_provider FROM users WHERE id='user-client'"
    ).first();
    const profiles = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM provider_profiles WHERE user_id='user-client'"
    ).first();
    expect(user.role_provider).toBe(1);
    expect(profiles.count).toBe(1);
  });

  it("resolves an occupied requested slug and still creates the provider", async () => {
    const response = await api("/provider/me", {
      method: "POST",
      token: OTHER_TOKEN,
      body: { name: "Other Provider", slug: "provider-one" },
    });
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created.provider.slug).toMatch(/^provider-one-[a-f0-9]{8}$/);
    const user = await env.DB.prepare(
      "SELECT role_provider FROM users WHERE id='user-other'"
    ).first();
    expect(user.role_provider).toBe(1);
  });

  it("round-trips provider settings through PATCH and GET", async () => {
    const settings = {
      category: "zdrowie",
      subcategory: "fizjoterapia",
      locations: [
        { id: "loc-clinic", label: "Gabinet", address: "ul. Zdrowa 1", toneIndex: 3 },
        { id: "loc-home", label: "Dojazd", address: "", toneIndex: 4 },
      ],
      socialLinks: [
        { id: "social-web", kind: "website", value: "https://example.com" },
        { id: "social-ig", kind: "instagram", value: "@provider" },
      ],
      bookingRules: {
        futureDays: 45,
        minLeadHours: 4,
        cancelHours: 12,
        proposeHoldHours: 6,
        policy: "Odwołaj wizytę z wyprzedzeniem.",
      },
      deactivated: true,
    };
    const patchResponse = await api("/provider/me", {
      method: "PATCH",
      token: PROVIDER_TOKEN,
      body: settings,
    });
    expect(patchResponse.status).toBe(200);
    expect((await patchResponse.json()).provider).toMatchObject(settings);

    const getResponse = await api("/provider/me", { token: PROVIDER_TOKEN });
    expect(getResponse.status).toBe(200);
    expect((await getResponse.json()).provider).toMatchObject(settings);
  });

  it("round-trips and atomically replaces availability without crossing providers", async () => {
    await api("/provider/me", {
      method: "PATCH",
      token: PROVIDER_TOKEN,
      body: {
        locations: [
          { id: "loc-main", label: "Główny gabinet", address: "Warszawa", toneIndex: 0 },
        ],
      },
    });
    const firstSchedule = [
      {
        dateISO: "2026-10-01",
        blocks: [
          {
            from: "09:00",
            to: "11:00",
            locationId: "loc-main",
            repeat: "weekly",
          },
          {
            from: "12:00",
            to: "14:00",
            locationId: "loc-main",
            repeat: "none",
          },
        ],
      },
      {
        dateISO: "2026-10-02",
        blocks: [
          {
            from: "10:00",
            to: "12:00",
            locationId: "loc-main",
            repeat: "biweekly",
          },
        ],
      },
    ];
    const putResponse = await api("/provider/me/availability", {
      method: "PUT",
      token: PROVIDER_TOKEN,
      body: { providerId: "provider-foreign", availability: firstSchedule },
    });
    expect(putResponse.status).toBe(200);
    expect((await putResponse.json()).availability).toEqual(
      firstSchedule.map((day) => ({
        ...day,
        blocks: day.blocks.map((block) => ({
          ...block,
          recurring: block.repeat !== "none",
        })),
      }))
    );

    const invalidResponse = await api("/provider/me/availability", {
      method: "PUT",
      token: PROVIDER_TOKEN,
      body: {
        availability: [
          {
            dateISO: "2026-10-04",
            blocks: [
              {
                from: "09:00",
                to: "08:00",
                locationId: "loc-foreign",
                repeat: "daily",
              },
            ],
          },
        ],
      },
    });
    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toEqual({ error: "invalid_availability" });
    const retainedResponse = await api("/provider/me/availability", {
      token: PROVIDER_TOKEN,
    });
    expect((await retainedResponse.json()).availability).toHaveLength(2);

    const createdOther = await api("/provider/me", {
      method: "POST",
      token: OTHER_TOKEN,
      body: { name: "Other Provider" },
    });
    expect(createdOther.status).toBe(201);
    const otherSchedule = await api("/provider/me/availability", { token: OTHER_TOKEN });
    expect((await otherSchedule.json()).availability).toEqual([]);

    const replacement = [
      {
        dateISO: "2026-10-03",
        blocks: [
          {
            from: "08:30",
            to: "09:30",
            locationId: "loc-main",
            repeat: "none",
          },
        ],
      },
    ];
    const replaceResponse = await api("/provider/me/availability", {
      method: "PUT",
      token: PROVIDER_TOKEN,
      body: { availability: replacement },
    });
    expect(replaceResponse.status).toBe(200);
    const getResponse = await api("/provider/me/availability", {
      token: PROVIDER_TOKEN,
    });
    expect((await getResponse.json()).availability).toEqual([
      {
        ...replacement[0],
        blocks: [{ ...replacement[0].blocks[0], recurring: false }],
      },
    ]);
    const rows = await env.DB.prepare(
      "SELECT provider_id, date_iso FROM provider_availability"
    ).all();
    expect(rows.results).toEqual([
      { provider_id: "provider-1", date_iso: "2026-10-03" },
    ]);
  });

  it("stores the maximum availability payload in chunked D1 statements", async () => {
    await api("/provider/me", {
      method: "PATCH",
      token: PROVIDER_TOKEN,
      body: {
        locations: [
          { id: "loc-max", label: "Gabinet", address: "Warszawa", toneIndex: 0 },
        ],
      },
    });
    const start = Date.UTC(2026, 0, 1);
    const availability = Array.from({ length: 366 }, (_, index) => ({
      dateISO: new Date(start + index * 86400000).toISOString().slice(0, 10),
      blocks: [
        { from: "08:00", to: "10:00", locationId: "loc-max", repeat: "none" },
        { from: "10:00", to: "12:00", locationId: "loc-max", repeat: "none" },
        { from: "12:00", to: "14:00", locationId: "loc-max", repeat: "none" },
      ],
    }));
    const response = await api("/provider/me/availability", {
      method: "PUT",
      token: PROVIDER_TOKEN,
      body: { availability },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).availability).toHaveLength(366);
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM provider_availability WHERE provider_id='provider-1'"
    ).first();
    expect(count.count).toBe(1098);
  });
});

describe("provider service catalog", () => {
  const serviceBody = {
    name: "Strzyżenie męskie",
    description: "Strzyżenie i stylizacja.",
    bookingMode: "auto",
    durationMin: 30,
    price: 50,
    photoIds: [],
    locationIds: ["salon-main"],
    variants: [
      { durationMin: 30, price: 50, label: "Standard" },
      { durationMin: 45, price: 70, label: "Włosy i broda" },
    ],
  };

  it("creates, lists, updates, and deletes an owned service", async () => {
    const createdResponse = await api("/provider/me/services", {
      method: "POST",
      token: PROVIDER_TOKEN,
      body: serviceBody,
      key: "create-service-1",
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()).service;
    expect(created.id).toMatch(/^svc_/);
    expect(created.price).toBe(50);
    expect(created.variants).toHaveLength(2);

    const listResponse = await api("/provider/me/services", { token: PROVIDER_TOKEN });
    expect(listResponse.status).toBe(200);
    expect((await listResponse.json()).services).toEqual([created]);

    const updateResponse = await api(`/provider/me/services/${created.id}`, {
      method: "PATCH",
      token: PROVIDER_TOKEN,
      body: { ...serviceBody, name: "Strzyżenie premium", bookingMode: "approval", price: null },
      key: "update-service-1",
    });
    expect(updateResponse.status).toBe(200);
    expect((await updateResponse.json()).service).toMatchObject({
      name: "Strzyżenie premium",
      bookingMode: "approval",
      price: null,
    });

    const deleteResponse = await api(`/provider/me/services/${created.id}`, {
      method: "DELETE",
      token: PROVIDER_TOKEN,
      key: "delete-service-1",
    });
    expect(deleteResponse.status).toBe(204);
    const deleteReplay = await api(`/provider/me/services/${created.id}`, {
      method: "DELETE",
      token: PROVIDER_TOKEN,
      key: "delete-service-1",
    });
    expect(deleteReplay.status).toBe(204);
    expect(
      await env.DB.prepare("SELECT id FROM provider_services WHERE id=?").bind(created.id).first()
    ).toBeNull();
  });

  it("isolates service mutations between providers", async () => {
    const createdResponse = await api("/provider/me/services", {
      method: "POST",
      token: PROVIDER_TOKEN,
      body: serviceBody,
      key: "create-service-2",
    });
    const created = (await createdResponse.json()).service;

    const updateResponse = await api(`/provider/me/services/${created.id}`, {
      method: "PATCH",
      token: OTHER_TOKEN,
      body: { ...serviceBody, name: "Przejęta usługa" },
      key: "update-service-other",
    });
    expect(updateResponse.status).toBe(403);

    const clientResponse = await api("/provider/me/services", { token: CLIENT_TOKEN });
    expect(clientResponse.status).toBe(403);
  });

  it("rejects invalid service values", async () => {
    const response = await api("/provider/me/services", {
      method: "POST",
      token: PROVIDER_TOKEN,
      body: { ...serviceBody, durationMin: 0, bookingMode: "invalid" },
      key: "create-service-invalid",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_service" });
  });

  it("updates booking modes and deletes multiple services in single operations", async () => {
    const first = await api("/provider/me/services", {
      method: "POST",
      token: PROVIDER_TOKEN,
      body: serviceBody,
      key: "create-service-bulk-1",
    });
    const second = await api("/provider/me/services", {
      method: "POST",
      token: PROVIDER_TOKEN,
      body: { ...serviceBody, name: "Broda" },
      key: "create-service-bulk-2",
    });
    const ids = [(await first.json()).service.id, (await second.json()).service.id];

    const modeResponse = await api("/provider/me/services/booking-mode", {
      method: "PATCH",
      token: PROVIDER_TOKEN,
      body: { serviceIds: ids, bookingMode: "approval" },
      key: "services-mode-bulk",
    });
    expect(modeResponse.status).toBe(200);
    expect((await modeResponse.json()).updated).toBe(2);
    const modes = await env.DB.prepare(
      "SELECT booking_mode FROM provider_services WHERE provider_id='provider-1'"
    ).all();
    expect(modes.results.map((row) => row.booking_mode)).toEqual(["approval", "approval"]);

    const deleteResponse = await api("/provider/me/services", {
      method: "DELETE",
      token: PROVIDER_TOKEN,
      body: { serviceIds: ids },
      key: "services-delete-bulk",
    });
    expect(deleteResponse.status).toBe(200);
    expect((await deleteResponse.json()).deleted).toBe(2);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM provider_services WHERE provider_id='provider-1'"
      ).first()
    ).toMatchObject({ count: 0 });
  });

  it("accepts only service photos owned by the provider", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO media (id, owner_user_id, kind, storage_key, content_type, byte_size)
         VALUES ('media-owned', 'user-provider', 'service', 'owned.webp', 'image/webp', 10)`
      ),
      env.DB.prepare(
        `INSERT INTO media (id, owner_user_id, kind, storage_key, content_type, byte_size)
         VALUES ('media-other', 'user-other', 'service', 'other.webp', 'image/webp', 10)`
      ),
    ]);
    const owned = await api("/provider/me/services", {
      method: "POST",
      token: PROVIDER_TOKEN,
      body: { ...serviceBody, photoIds: ["media-owned"] },
      key: "create-service-owned-photo",
    });
    expect(owned.status).toBe(201);
    expect((await owned.json()).service.photoIds).toEqual(["media-owned"]);

    const foreign = await api("/provider/me/services", {
      method: "POST",
      token: PROVIDER_TOKEN,
      body: { ...serviceBody, photoIds: ["media-other"] },
      key: "create-service-foreign-photo",
    });
    expect(foreign.status).toBe(400);
    expect(await foreign.json()).toEqual({ error: "invalid_service_photos" });
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
      ["/provider/me/services", "POST", PROVIDER_TOKEN],
      ["/provider/me/services", "DELETE", PROVIDER_TOKEN],
      ["/provider/me/services/booking-mode", "PATCH", PROVIDER_TOKEN],
      ["/provider/me/services/missing", "PATCH", PROVIDER_TOKEN],
      ["/provider/me/services/missing", "DELETE", PROVIDER_TOKEN],
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
