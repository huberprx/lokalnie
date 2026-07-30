import { CORS, json, noContent, id, nowIso, readJson } from "./http.js";
import { requireDemoUser, mapUser, mapProvider } from "./auth.js";
import { enqueueEmail, listOutbox } from "./email.js";
import { mapClient, mapBooking, mapRequest, mapMedia } from "./mappers.js";

const ALLOWED_IMAGE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_UPLOAD = 5 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return noContent();

    try {
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const parts = path.split("/").filter(Boolean);

      if (path === "/") {
        return json({
          service: "lokalnie-api",
          ok: true,
          environment: env.ENVIRONMENT || "unknown",
          appOrigin: env.APP_ORIGIN || null,
          auth: "demo: X-Demo-User: demo | Authorization: Bearer demo",
          docs: {
            health: "GET /health",
            me: "GET|PATCH /me",
            provider: "GET|PATCH /provider/me",
            clients: "GET|POST /provider/me/clients",
            bookings: "GET|POST /bookings",
            requests: "GET|POST /requests",
            media: "POST /media , GET /media/:id",
            emails: "GET /emails/outbox",
          },
          bindings: { db: !!env.DB, media: !!env.MEDIA },
        });
      }

      if (path === "/health") return health(env);
      if (path === "/debug/tables") return debugTables(env);

      if (path === "/me") {
        if (request.method === "GET") return getMe(request, env);
        if (request.method === "PATCH") return patchMe(request, env);
      }

      if (path === "/provider/me") {
        if (request.method === "GET") return getProviderMe(request, env);
        if (request.method === "PATCH") return patchProviderMe(request, env);
      }

      if (path === "/provider/me/clients") {
        if (request.method === "GET") return listClients(request, env);
        if (request.method === "POST") return createClient(request, env);
      }

      if (parts[0] === "provider" && parts[1] === "me" && parts[2] === "clients" && parts[3]) {
        const clientId = parts[3];
        if (request.method === "GET") return getClient(request, env, clientId);
        if (request.method === "PATCH") return patchClient(request, env, clientId);
        if (request.method === "DELETE") return deleteClient(request, env, clientId);
      }

      if (path === "/bookings") {
        if (request.method === "GET") return listBookings(request, env, url);
        if (request.method === "POST") return createBooking(request, env);
      }

      if (parts[0] === "bookings" && parts[1] && !parts[2]) {
        if (request.method === "GET") return getBooking(request, env, parts[1]);
        if (request.method === "PATCH") return patchBooking(request, env, parts[1]);
      }

      if (path === "/requests") {
        if (request.method === "GET") return listRequests(request, env);
        if (request.method === "POST") return createRequest(request, env);
      }

      if (parts[0] === "requests" && parts[1]) {
        const rid = parts[1];
        if (parts[2] === "propose" && request.method === "POST") return proposeRequest(request, env, rid);
        if (parts[2] === "accept" && request.method === "POST") return acceptRequest(request, env, rid);
        if (parts[2] === "decline" && request.method === "POST") return declineRequest(request, env, rid);
        if (!parts[2] && request.method === "GET") return getRequest(request, env, rid);
      }

      if (path === "/media" && request.method === "POST") return uploadMedia(request, env);
      if (parts[0] === "media" && parts[1] && request.method === "GET") return getMedia(env, parts[1]);

      if (path === "/emails/outbox" && request.method === "GET") return emailsOutbox(request, env);
      if (path === "/emails/process" && request.method === "POST") return processEmails(request, env);

      return json({ error: "not_found" }, 404);
    } catch (err) {
      console.error(JSON.stringify({ level: "error", err: String(err?.stack || err) }));
      return json({ error: "internal_error", message: String(err?.message || err) }, 500);
    }
  },
};

async function health(env) {
  let dbOk = false;
  let dbError = null;
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    dbOk = true;
  } catch (err) {
    dbError = String(err?.message || err);
  }
  return json({
    ok: dbOk,
    db: dbOk ? "up" : "down",
    media: env.MEDIA ? "bound" : "not_configured",
    error: dbError,
    time: nowIso(),
  });
}

async function debugTables(env) {
  const rows = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
  ).all();
  return json({ tables: (rows.results || []).map((r) => r.name) });
}

async function getMe(request, env) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  return json({ authenticated: true, mode: "demo", user: mapUser(auth.user), provider: mapProvider(auth.provider) });
}

async function patchMe(request, env) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  const body = await readJson(request);
  if (!body) return json({ error: "invalid_json" }, 400);

  const name = body.name != null ? String(body.name).trim() : auth.user.name;
  const phone = body.phone != null ? String(body.phone).trim() : auth.user.phone;
  const email = body.email != null ? String(body.email).trim() : auth.user.email;
  const nb = body.notifications?.booking != null ? (body.notifications.booking ? 1 : 0) : auth.user.notification_booking;
  const nr = body.notifications?.reminder != null ? (body.notifications.reminder ? 1 : 0) : auth.user.notification_reminder;
  const nm = body.notifications?.marketing != null ? (body.notifications.marketing ? 1 : 0) : auth.user.notification_marketing;

  await env.DB.prepare(
    `UPDATE users SET name=?, phone=?, email=?, notification_booking=?, notification_reminder=?, notification_marketing=?, updated_at=? WHERE id=?`
  )
    .bind(name, phone, email, nb, nr, nm, nowIso(), auth.user.id)
    .run();

  const user = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(auth.user.id).first();
  return json({ authenticated: true, mode: "demo", user: mapUser(user) });
}

async function getProviderMe(request, env) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  if (!auth.provider) return json({ error: "provider_not_found" }, 404);
  return json({ provider: mapProvider(auth.provider) });
}

async function patchProviderMe(request, env) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  if (!auth.provider) return json({ error: "provider_not_found" }, 404);
  const body = await readJson(request);
  if (!body) return json({ error: "invalid_json" }, 400);

  const p = auth.provider;
  const fields = {
    name: body.name != null ? String(body.name).trim() : p.name,
    city: body.city != null ? String(body.city).trim() : p.city,
    address: body.address != null ? String(body.address).trim() : p.address,
    about: body.about != null ? String(body.about).trim() : p.about,
    email: body.email != null ? String(body.email).trim() : p.email,
    email_visible: body.emailVisible != null ? (body.emailVisible ? 1 : 0) : p.email_visible,
    phone: body.phone != null ? String(body.phone).trim() : p.phone,
    booking_mode: body.bookingMode === "approval" || body.bookingMode === "auto" ? body.bookingMode : p.booking_mode,
    visible_in_search: body.visibleInSearch != null ? (body.visibleInSearch ? 1 : 0) : p.visible_in_search,
    multi_select: body.multiSelect != null ? (body.multiSelect ? 1 : 0) : p.multi_select,
  };

  await env.DB.prepare(
    `UPDATE provider_profiles SET name=?, city=?, address=?, about=?, email=?, email_visible=?, phone=?, booking_mode=?, visible_in_search=?, multi_select=?, updated_at=? WHERE id=?`
  )
    .bind(
      fields.name,
      fields.city,
      fields.address,
      fields.about,
      fields.email,
      fields.email_visible,
      fields.phone,
      fields.booking_mode,
      fields.visible_in_search,
      fields.multi_select,
      nowIso(),
      p.id
    )
    .run();

  const provider = await env.DB.prepare("SELECT * FROM provider_profiles WHERE id=?").bind(p.id).first();
  return json({ provider: mapProvider(provider) });
}

async function requireProvider(request, env) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth;
  if (!auth.provider) return { error: json({ error: "provider_required" }, 403) };
  return auth;
}

async function listClients(request, env) {
  const auth = await requireProvider(request, env);
  if (auth.error) return auth.error;
  const rows = await env.DB.prepare(
    "SELECT * FROM provider_clients WHERE provider_id=? ORDER BY name COLLATE NOCASE"
  )
    .bind(auth.provider.id)
    .all();
  return json({ clients: (rows.results || []).map(mapClient) });
}

async function createClient(request, env) {
  const auth = await requireProvider(request, env);
  if (auth.error) return auth.error;
  const body = await readJson(request);
  if (!body || !String(body.name || "").trim()) return json({ error: "name_required" }, 400);

  const clientId = id("pc");
  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO provider_clients (id, provider_id, client_user_id, name, phone, email, address, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      clientId,
      auth.provider.id,
      body.clientUserId || null,
      String(body.name).trim(),
      body.phone ? String(body.phone).trim() : null,
      body.email ? String(body.email).trim() : null,
      body.address ? String(body.address).trim() : null,
      body.notes ? String(body.notes).trim() : null,
      ts,
      ts
    )
    .run();

  const row = await env.DB.prepare("SELECT * FROM provider_clients WHERE id=?").bind(clientId).first();
  return json({ client: mapClient(row) }, 201);
}

async function getClient(request, env, clientId) {
  const auth = await requireProvider(request, env);
  if (auth.error) return auth.error;
  const row = await env.DB.prepare("SELECT * FROM provider_clients WHERE id=? AND provider_id=?")
    .bind(clientId, auth.provider.id)
    .first();
  if (!row) return json({ error: "not_found" }, 404);
  return json({ client: mapClient(row) });
}

async function patchClient(request, env, clientId) {
  const auth = await requireProvider(request, env);
  if (auth.error) return auth.error;
  const row = await env.DB.prepare("SELECT * FROM provider_clients WHERE id=? AND provider_id=?")
    .bind(clientId, auth.provider.id)
    .first();
  if (!row) return json({ error: "not_found" }, 404);
  const body = await readJson(request);
  if (!body) return json({ error: "invalid_json" }, 400);

  const name = body.name != null ? String(body.name).trim() : row.name;
  const phone = body.phone != null ? String(body.phone).trim() : row.phone;
  const email = body.email != null ? String(body.email).trim() : row.email;
  const address = body.address != null ? String(body.address).trim() : row.address;
  const notes = body.notes != null ? String(body.notes).trim() : row.notes;

  await env.DB.prepare(
    `UPDATE provider_clients SET name=?, phone=?, email=?, address=?, notes=?, updated_at=? WHERE id=?`
  )
    .bind(name, phone || null, email || null, address || null, notes || null, nowIso(), clientId)
    .run();

  const updated = await env.DB.prepare("SELECT * FROM provider_clients WHERE id=?").bind(clientId).first();
  return json({ client: mapClient(updated) });
}

async function deleteClient(request, env, clientId) {
  const auth = await requireProvider(request, env);
  if (auth.error) return auth.error;
  const row = await env.DB.prepare("SELECT id FROM provider_clients WHERE id=? AND provider_id=?")
    .bind(clientId, auth.provider.id)
    .first();
  if (!row) return json({ error: "not_found" }, 404);
  await env.DB.prepare("DELETE FROM provider_clients WHERE id=?").bind(clientId).run();
  return json({ ok: true, deleted: clientId });
}

async function listBookings(request, env, url) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  const status = url.searchParams.get("status");

  let sql = "SELECT * FROM bookings WHERE provider_id=?";
  const binds = [auth.provider?.id || "__none__"];
  if (!auth.provider) {
    sql = "SELECT * FROM bookings WHERE client_user_id=?";
    binds[0] = auth.user.id;
  }
  if (status) {
    sql += " AND status=?";
    binds.push(status);
  }
  sql += " ORDER BY date_iso DESC, time_from DESC";

  const rows = await env.DB.prepare(sql).bind(...binds).all();
  return json({ bookings: (rows.results || []).map(mapBooking) });
}

async function createBooking(request, env) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  const body = await readJson(request);
  if (!body) return json({ error: "invalid_json" }, 400);

  const providerId = body.providerId || auth.provider?.id;
  if (!providerId) return json({ error: "provider_id_required" }, 400);

  const clientName = String(body.clientName || auth.user.name || "").trim();
  if (!clientName) return json({ error: "client_name_required" }, 400);

  const status = ["confirmed", "pending", "proposed", "rejected", "cancelled"].includes(body.status)
    ? body.status
    : "confirmed";

  const bookingId = id("bk");
  const ts = nowIso();
  const serviceIds = Array.isArray(body.serviceIds) ? body.serviceIds : [];
  const serviceNames = Array.isArray(body.serviceNames) ? body.serviceNames : [];

  await env.DB.prepare(
    `INSERT INTO bookings (
      id, provider_id, client_user_id, provider_client_id, client_name, client_phone, client_email,
      service_ids_json, service_names_json, date_iso, time_from, time_to, location_label, status, request_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      bookingId,
      providerId,
      body.clientUserId || auth.user.id,
      body.providerClientId || null,
      clientName,
      body.clientPhone || auth.user.phone || null,
      body.clientEmail || auth.user.email || null,
      JSON.stringify(serviceIds),
      JSON.stringify(serviceNames),
      body.dateISO || null,
      body.from || null,
      body.to || null,
      body.locationLabel || null,
      status,
      body.requestId || null,
      ts,
      ts
    )
    .run();

  // Auto-upsert CRM gdy jest provider demo
  if (auth.provider && auth.provider.id === providerId) {
    await upsertClientFromBooking(env, auth.provider.id, {
      name: clientName,
      phone: body.clientPhone || auth.user.phone,
      email: body.clientEmail || auth.user.email,
    });
  }

  if (body.clientEmail || auth.user.email) {
    await enqueueEmail(env, {
      toEmail: body.clientEmail || auth.user.email,
      template: status === "confirmed" ? "booking_confirmed" : "booking_created",
      payload: { bookingId, clientName, dateISO: body.dateISO, from: body.from, to: body.to, status },
    });
  }

  const row = await env.DB.prepare("SELECT * FROM bookings WHERE id=?").bind(bookingId).first();
  return json({ booking: mapBooking(row) }, 201);
}

async function upsertClientFromBooking(env, providerId, { name, phone, email }) {
  const existing = await env.DB.prepare(
    `SELECT id FROM provider_clients WHERE provider_id=? AND lower(name)=lower(?) LIMIT 1`
  )
    .bind(providerId, name)
    .first();
  if (existing) return existing.id;
  const clientId = id("pc");
  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO provider_clients (id, provider_id, name, phone, email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(clientId, providerId, name, phone || null, email || null, ts, ts)
    .run();
  return clientId;
}

async function getBooking(request, env, bookingId) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  const row = await env.DB.prepare("SELECT * FROM bookings WHERE id=?").bind(bookingId).first();
  if (!row) return json({ error: "not_found" }, 404);
  if (auth.provider?.id !== row.provider_id && row.client_user_id !== auth.user.id) {
    return json({ error: "forbidden" }, 403);
  }
  return json({ booking: mapBooking(row) });
}

async function patchBooking(request, env, bookingId) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  const row = await env.DB.prepare("SELECT * FROM bookings WHERE id=?").bind(bookingId).first();
  if (!row) return json({ error: "not_found" }, 404);
  if (auth.provider?.id !== row.provider_id && row.client_user_id !== auth.user.id) {
    return json({ error: "forbidden" }, 403);
  }

  const body = await readJson(request);
  if (!body) return json({ error: "invalid_json" }, 400);

  const status = body.status && ["confirmed", "pending", "proposed", "rejected", "cancelled"].includes(body.status)
    ? body.status
    : row.status;
  const dateISO = body.dateISO != null ? body.dateISO : row.date_iso;
  const from = body.from != null ? body.from : row.time_from;
  const to = body.to != null ? body.to : row.time_to;
  const locationLabel = body.locationLabel != null ? body.locationLabel : row.location_label;

  await env.DB.prepare(
    `UPDATE bookings SET status=?, date_iso=?, time_from=?, time_to=?, location_label=?, updated_at=? WHERE id=?`
  )
    .bind(status, dateISO, from, to, locationLabel, nowIso(), bookingId)
    .run();

  if (status !== row.status && row.client_email) {
    await enqueueEmail(env, {
      toEmail: row.client_email,
      template: `booking_${status}`,
      payload: { bookingId, status, dateISO, from, to },
    });
  }

  const updated = await env.DB.prepare("SELECT * FROM bookings WHERE id=?").bind(bookingId).first();
  return json({ booking: mapBooking(updated) });
}

async function listRequests(request, env) {
  const auth = await requireProvider(request, env);
  if (auth.error) return auth.error;
  const rows = await env.DB.prepare(
    "SELECT * FROM booking_requests WHERE provider_id=? ORDER BY created_at DESC"
  )
    .bind(auth.provider.id)
    .all();
  return json({ requests: (rows.results || []).map(mapRequest) });
}

async function getRequest(request, env, requestId) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  const row = await env.DB.prepare("SELECT * FROM booking_requests WHERE id=?").bind(requestId).first();
  if (!row) return json({ error: "not_found" }, 404);
  if (auth.provider?.id !== row.provider_id && row.client_user_id !== auth.user.id) {
    return json({ error: "forbidden" }, 403);
  }
  return json({ request: mapRequest(row) });
}

async function createRequest(request, env) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  const body = await readJson(request);
  if (!body) return json({ error: "invalid_json" }, 400);

  const providerId = body.providerId || auth.provider?.id;
  if (!providerId) return json({ error: "provider_id_required" }, 400);
  const days = Array.isArray(body.days) ? body.days : [];
  if (!days.length) return json({ error: "days_required" }, 400);

  const requestId = id("rq");
  const ts = nowIso();
  const clientName = String(body.clientName || auth.user.name || "").trim();

  await env.DB.prepare(
    `INSERT INTO booking_requests (
      id, provider_id, client_user_id, client_name, client_phone, client_email,
      service_ids_json, service_names_json, days_json, proposals_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'pending', ?, ?)`
  )
    .bind(
      requestId,
      providerId,
      auth.user.id,
      clientName,
      body.clientPhone || auth.user.phone || null,
      body.clientEmail || auth.user.email || null,
      JSON.stringify(Array.isArray(body.serviceIds) ? body.serviceIds : []),
      JSON.stringify(Array.isArray(body.serviceNames) ? body.serviceNames : []),
      JSON.stringify(days),
      ts,
      ts
    )
    .run();

  // Mail do usługodawcy (jeśli ma e-mail)
  const provider = await env.DB.prepare("SELECT email, name FROM provider_profiles WHERE id=?").bind(providerId).first();
  if (provider?.email) {
    await enqueueEmail(env, {
      toEmail: provider.email,
      template: "request_new",
      payload: { requestId, clientName, providerName: provider.name },
    });
  }

  const row = await env.DB.prepare("SELECT * FROM booking_requests WHERE id=?").bind(requestId).first();
  return json({ request: mapRequest(row) }, 201);
}

async function proposeRequest(request, env, requestId) {
  const auth = await requireProvider(request, env);
  if (auth.error) return auth.error;
  const row = await env.DB.prepare("SELECT * FROM booking_requests WHERE id=? AND provider_id=?")
    .bind(requestId, auth.provider.id)
    .first();
  if (!row) return json({ error: "not_found" }, 404);

  const body = await readJson(request);
  const proposals = Array.isArray(body?.proposals) ? body.proposals : [];
  if (!proposals.length) return json({ error: "proposals_required" }, 400);

  const normalized = proposals.map((p, i) => ({
    id: p.id || `prop_${i + 1}_${crypto.randomUUID().slice(0, 8)}`,
    dateISO: p.dateISO,
    from: p.from,
    to: p.to,
    locationLabel: p.locationLabel || null,
  }));

  await env.DB.prepare(
    `UPDATE booking_requests SET proposals_json=?, status='proposed', updated_at=? WHERE id=?`
  )
    .bind(JSON.stringify(normalized), nowIso(), requestId)
    .run();

  if (row.client_email) {
    await enqueueEmail(env, {
      toEmail: row.client_email,
      template: "request_proposed",
      payload: { requestId, proposals: normalized },
    });
  }

  const updated = await env.DB.prepare("SELECT * FROM booking_requests WHERE id=?").bind(requestId).first();
  return json({ request: mapRequest(updated) });
}

async function acceptRequest(request, env, requestId) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  const row = await env.DB.prepare("SELECT * FROM booking_requests WHERE id=?").bind(requestId).first();
  if (!row) return json({ error: "not_found" }, 404);
  if (row.client_user_id && row.client_user_id !== auth.user.id && auth.provider?.id !== row.provider_id) {
    return json({ error: "forbidden" }, 403);
  }

  const body = await readJson(request);
  const proposalId = body?.proposalId;
  if (!proposalId) return json({ error: "proposal_id_required" }, 400);

  const proposals = JSON.parse(row.proposals_json || "[]");
  const chosen = proposals.find((p) => p.id === proposalId);
  if (!chosen) return json({ error: "proposal_not_found" }, 404);

  const bookingId = id("bk");
  const ts = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE booking_requests SET accepted_proposal_id=?, status='confirmed', updated_at=? WHERE id=?`
    ).bind(proposalId, ts, requestId),
    env.DB.prepare(
      `INSERT INTO bookings (
        id, provider_id, client_user_id, client_name, client_phone, client_email,
        service_ids_json, service_names_json, date_iso, time_from, time_to, location_label, status, request_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`
    ).bind(
      bookingId,
      row.provider_id,
      row.client_user_id,
      row.client_name,
      row.client_phone,
      row.client_email,
      row.service_ids_json,
      row.service_names_json,
      chosen.dateISO,
      chosen.from,
      chosen.to,
      chosen.locationLabel || null,
      requestId,
      ts,
      ts
    ),
  ]);

  if (row.client_email) {
    await enqueueEmail(env, {
      toEmail: row.client_email,
      template: "booking_confirmed",
      payload: { bookingId, requestId, dateISO: chosen.dateISO, from: chosen.from, to: chosen.to },
    });
  }

  const booking = await env.DB.prepare("SELECT * FROM bookings WHERE id=?").bind(bookingId).first();
  const updated = await env.DB.prepare("SELECT * FROM booking_requests WHERE id=?").bind(requestId).first();
  return json({ request: mapRequest(updated), booking: mapBooking(booking) });
}

async function declineRequest(request, env, requestId) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  const row = await env.DB.prepare("SELECT * FROM booking_requests WHERE id=?").bind(requestId).first();
  if (!row) return json({ error: "not_found" }, 404);

  await env.DB.prepare(`UPDATE booking_requests SET status='rejected', updated_at=? WHERE id=?`)
    .bind(nowIso(), requestId)
    .run();

  const updated = await env.DB.prepare("SELECT * FROM booking_requests WHERE id=?").bind(requestId).first();
  return json({ request: mapRequest(updated) });
}

async function uploadMedia(request, env) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  if (!env.MEDIA) return json({ error: "r2_not_configured" }, 503);

  const form = await request.formData();
  const file = form.get("file");
  const kind = String(form.get("kind") || "avatar");
  if (!file || typeof file === "string") return json({ error: "file_required" }, 400);
  if (!["avatar", "service", "provider"].includes(kind)) return json({ error: "invalid_kind" }, 400);

  const contentType = file.type || "application/octet-stream";
  if (!ALLOWED_IMAGE.has(contentType)) return json({ error: "unsupported_type", allowed: [...ALLOWED_IMAGE] }, 415);
  if (file.size > MAX_UPLOAD) return json({ error: "too_large", maxBytes: MAX_UPLOAD }, 413);

  const mediaId = id("media");
  const ext = contentType.split("/")[1] || "bin";
  const storageKey = `${auth.user.id}/${kind}/${mediaId}.${ext}`;
  const bytes = await file.arrayBuffer();

  await env.MEDIA.put(storageKey, bytes, {
    httpMetadata: { contentType },
    customMetadata: { owner: auth.user.id, kind },
  });

  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO media (id, owner_user_id, kind, storage_key, content_type, byte_size, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(mediaId, auth.user.id, kind, storageKey, contentType, bytes.byteLength, ts)
    .run();

  if (kind === "avatar") {
    await env.DB.prepare("UPDATE users SET avatar_key=?, updated_at=? WHERE id=?")
      .bind(storageKey, ts, auth.user.id)
      .run();
  }
  if (kind === "provider" && auth.provider) {
    await env.DB.prepare("UPDATE provider_profiles SET avatar_key=?, updated_at=? WHERE id=?")
      .bind(storageKey, ts, auth.provider.id)
      .run();
  }

  const row = await env.DB.prepare("SELECT * FROM media WHERE id=?").bind(mediaId).first();
  return json({ media: mapMedia(row) }, 201);
}

async function getMedia(env, mediaId) {
  const row = await env.DB.prepare("SELECT * FROM media WHERE id=?").bind(mediaId).first();
  if (!row) return json({ error: "not_found" }, 404);
  if (!env.MEDIA) return json({ error: "r2_not_configured" }, 503);

  const obj = await env.MEDIA.get(row.storage_key);
  if (!obj) return json({ error: "object_missing" }, 404);

  const headers = new Headers(CORS);
  headers.set("Content-Type", row.content_type || obj.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=86400");
  return new Response(obj.body, { status: 200, headers });
}

async function emailsOutbox(request, env) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  const items = await listOutbox(env, 100);
  return json({
    items,
    note: "Wysyłka przez Resend — kolejny krok (potrzebne konto + domena). Teraz tylko kolejka.",
  });
}

async function processEmails(request, env) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  const pending = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM email_outbox WHERE status='pending'`
  ).first();
  return json({
    ok: true,
    pending: pending?.c || 0,
    processed: 0,
    message: "Brak RESEND_API_KEY — maile zostają w outbox. Załóż Resend i daj znać.",
  });
}
