import { json, id, nowIso, readJson, preflight, withCors, HttpError } from "./http.js";
import { requireDemoUser, requireAdmin, mapUser, mapProvider } from "./auth.js";
import { startGoogleAuth, handleGoogleCallback, logoutSession } from "./oauth.js";
import { safeEnqueueEmail, listOutbox, processDueEmails } from "./email.js";
import { mapClient, mapBooking, mapRequest, mapMedia } from "./mappers.js";
import { validateSlot, normalizeText, normalizeStringArray, isValidDateISO } from "./validate.js";
import { canTransitionBooking } from "./bookings.js";
import { withIdempotency } from "./idempotency.js";

const ALLOWED_IMAGE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_UPLOAD = 5 * 1024 * 1024;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return preflight(request, env);
    return withCors(await routeRequest(request, env), request, env);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(processDueEmails(env));
  },
};

async function routeRequest(request, env) {
    const url = new URL(request.url);

    try {
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const parts = path.split("/").filter(Boolean);

      if (path === "/") {
        return json({
          service: "lokalnie-api",
          ok: true,
          environment: env.ENVIRONMENT || "unknown",
          appOrigin: env.APP_ORIGIN || null,
          auth:
            env.ENVIRONMENT === "production"
              ? "Bearer <session>"
              : "Bearer <session> | demo: X-Demo-User: demo | Authorization: Bearer demo",
          docs: {
            health: "GET /health",
            authGoogle: "GET /auth/google",
            authCallback: "GET /auth/google/callback",
            authLogout: "POST /auth/logout",
            me: "GET|PATCH /me",
            provider: "GET|PATCH /provider/me",
            clients: "GET|POST /provider/me/clients",
            bookings: "GET|POST /bookings",
            requests: "GET|POST /requests",
            media: "POST /media , GET /media/:id",
            ...(env.ENVIRONMENT === "production"
              ? {}
              : {
                  debugTables: "GET /debug/tables",
                  emails: "GET /emails/outbox, POST /emails/process",
                }),
          },
          bindings: { db: !!env.DB, media: !!env.MEDIA },
        });
      }

      if (path === "/health") return health(env);
      if (path === "/debug/tables") return debugTables(request, env);

      if (path === "/auth/google" && request.method === "GET") return startGoogleAuth(request, env);
      if (path === "/auth/google/callback" && request.method === "GET") {
        return handleGoogleCallback(request, env);
      }
      if (path === "/auth/logout" && request.method === "POST") return logoutSession(request, env);

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
      if (err instanceof HttpError) return json({ error: err.code }, err.status);
      return json(
        {
          error: "internal_error",
          ...(env.ENVIRONMENT === "production" ? {} : { message: String(err?.message || err) }),
        },
        500
      );
    }
}

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
    error: env.ENVIRONMENT === "production" ? (dbError ? "database_unavailable" : null) : dbError,
    time: nowIso(),
  });
}

async function debugTables(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const rows = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
  ).all();
  return json({ tables: (rows.results || []).map((r) => r.name) });
}

async function getMe(request, env) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  return json({
    authenticated: true,
    mode: auth.authMode || "demo",
    user: mapUser(auth.user),
    provider: mapProvider(auth.provider),
  });
}

async function patchMe(request, env) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  const body = await readJson(request);
  if (!body) return json({ error: "invalid_json" }, 400);

  const nameResult = normalizeText(body.name ?? auth.user.name, 120, { required: true });
  const phoneResult = normalizeText(body.phone ?? auth.user.phone, 40);
  const emailResult = normalizeText(body.email ?? auth.user.email, 254);
  if (nameResult.error || phoneResult.error || emailResult.error) {
    return json({ error: "invalid_profile_fields" }, 400);
  }
  const name = nameResult.value;
  const phone = phoneResult.value;
  const email = emailResult.value;
  const nb = body.notifications?.booking != null ? (body.notifications.booking ? 1 : 0) : auth.user.notification_booking;
  const nr = body.notifications?.reminder != null ? (body.notifications.reminder ? 1 : 0) : auth.user.notification_reminder;
  const nm = body.notifications?.marketing != null ? (body.notifications.marketing ? 1 : 0) : auth.user.notification_marketing;

  await env.DB.prepare(
    `UPDATE users SET name=?, phone=?, email=?, notification_booking=?, notification_reminder=?, notification_marketing=?, updated_at=? WHERE id=?`
  )
    .bind(name, phone, email, nb, nr, nm, nowIso(), auth.user.id)
    .run();

  const user = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(auth.user.id).first();
  return json({ authenticated: true, mode: auth.authMode || "demo", user: mapUser(user) });
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
  const textFields = {
    name: normalizeText(body.name ?? p.name, 120, { required: true }),
    city: normalizeText(body.city ?? p.city, 120),
    address: normalizeText(body.address ?? p.address, 240),
    about: normalizeText(body.about ?? p.about, 2000),
    email: normalizeText(body.email ?? p.email, 254),
    phone: normalizeText(body.phone ?? p.phone, 40),
  };
  if (Object.values(textFields).some((field) => field.error)) {
    return json({ error: "invalid_provider_fields" }, 400);
  }
  const fields = {
    name: textFields.name.value,
    city: textFields.city.value,
    address: textFields.address.value,
    about: textFields.about.value,
    email: textFields.email.value,
    email_visible: body.emailVisible != null ? (body.emailVisible ? 1 : 0) : p.email_visible,
    phone: textFields.phone.value,
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
  if (!body) return json({ error: "invalid_json" }, 400);
  const fields = {
    name: normalizeText(body.name, 120, { required: true }),
    phone: normalizeText(body.phone, 40),
    email: normalizeText(body.email, 254),
    address: normalizeText(body.address, 240),
    notes: normalizeText(body.notes, 2000),
  };
  if (Object.values(fields).some((field) => field.error)) {
    return json({ error: "invalid_client_fields" }, 400);
  }

  const clientId = id("pc");
  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO provider_clients (id, provider_id, client_user_id, name, phone, email, address, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      clientId,
      auth.provider.id,
      null,
      fields.name.value,
      fields.phone.value,
      fields.email.value,
      fields.address.value,
      fields.notes.value,
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

  const fields = {
    name: normalizeText(body.name ?? row.name, 120, { required: true }),
    phone: normalizeText(body.phone ?? row.phone, 40),
    email: normalizeText(body.email ?? row.email, 254),
    address: normalizeText(body.address ?? row.address, 240),
    notes: normalizeText(body.notes ?? row.notes, 2000),
  };
  if (Object.values(fields).some((field) => field.error)) {
    return json({ error: "invalid_client_fields" }, 400);
  }

  await env.DB.prepare(
    `UPDATE provider_clients SET name=?, phone=?, email=?, address=?, notes=?, updated_at=? WHERE id=?`
  )
    .bind(
      fields.name.value,
      fields.phone.value,
      fields.email.value,
      fields.address.value,
      fields.notes.value,
      nowIso(),
      clientId
    )
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
  return withIdempotency(
    request,
    env,
    { userId: auth.user.id, endpoint: "POST:/bookings" },
    () => createBookingMutation(request, env, auth)
  );
}

async function createBookingMutation(request, env, auth) {
  const body = await readJson(request);
  if (!body) return json({ error: "invalid_json" }, 400);

  const providerId = body.providerId || auth.provider?.id;
  if (!providerId) return json({ error: "provider_id_required" }, 400);
  const provider = await env.DB.prepare("SELECT id FROM provider_profiles WHERE id=?")
    .bind(providerId)
    .first();
  if (!provider) return json({ error: "provider_not_found" }, 404);
  const ownProviderBooking = auth.provider?.id === providerId;

  const clientNameResult = normalizeText(body.clientName || auth.user.name, 120, { required: true });
  if (clientNameResult.error) return json({ error: "invalid_client_name" }, 400);
  const clientName = clientNameResult.value;
  const status = ["confirmed", "pending", "proposed", "rejected", "cancelled"].includes(body.status)
    ? body.status
    : "confirmed";
  const slotError = validateSlot({ dateISO: body.dateISO, from: body.from, to: body.to });
  if (slotError) return json({ error: slotError }, 400);

  const serviceIdsResult = normalizeStringArray(body.serviceIds, 50, 100);
  const serviceNamesResult = normalizeStringArray(body.serviceNames, 50, 120);
  if (serviceIdsResult.error || serviceNamesResult.error) {
    return json({ error: "invalid_services" }, 400);
  }
  const locationResult = normalizeText(body.locationLabel, 240);
  if (locationResult.error) return json({ error: "location_too_long" }, 400);
  const phoneResult = normalizeText(body.clientPhone || auth.user.phone, 40);
  const emailResult = normalizeText(body.clientEmail || auth.user.email, 254);
  if (phoneResult.error || emailResult.error) return json({ error: "client_details_too_long" }, 400);

  let providerClientId = null;
  let clientUserId = auth.user.id;
  if (body.providerClientId != null) {
    if (!ownProviderBooking) return json({ error: "provider_client_forbidden" }, 403);
    const providerClient = await env.DB.prepare(
      "SELECT id FROM provider_clients WHERE id=? AND provider_id=?"
    )
      .bind(String(body.providerClientId), providerId)
      .first();
    if (!providerClient) return json({ error: "provider_client_not_found" }, 404);
    providerClientId = providerClient.id;
    clientUserId = null;
  }

  const bookingId = id("bk");
  const ts = nowIso();

  const activeStatus = ["confirmed", "pending", "proposed"].includes(status) ? 1 : 0;
  const insert = await env.DB.prepare(
    `INSERT INTO bookings (
      id, provider_id, client_user_id, provider_client_id, client_name, client_phone, client_email,
      service_ids_json, service_names_json, date_iso, time_from, time_to, location_label, status, request_id, created_at, updated_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE ? = 0 OR NOT EXISTS (
      SELECT 1 FROM bookings AS occupied
      WHERE occupied.provider_id=?
        AND occupied.date_iso=?
        AND occupied.status IN ('confirmed', 'pending', 'proposed')
        AND occupied.time_from < ?
        AND occupied.time_to > ?
    )`
  )
    .bind(
      bookingId,
      providerId,
      clientUserId,
      providerClientId,
      clientName,
      phoneResult.value,
      emailResult.value,
      JSON.stringify(serviceIdsResult.value),
      JSON.stringify(serviceNamesResult.value),
      body.dateISO,
      body.from,
      body.to,
      locationResult.value,
      status,
      body.requestId || null,
      ts,
      ts,
      activeStatus,
      providerId,
      body.dateISO,
      body.to,
      body.from
    )
    .run();
  if (!insert.meta?.changes) return json({ error: "booking_overlap" }, 409);

  // Auto-upsert CRM gdy jest provider demo
  if (auth.provider && auth.provider.id === providerId) {
    await upsertClientFromBooking(env, auth.provider.id, {
      name: clientName,
      phone: phoneResult.value,
      email: emailResult.value,
    });
  }

  if (emailResult.value) {
    await safeEnqueueEmail(env, {
      toEmail: emailResult.value,
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
  return withIdempotency(
    request,
    env,
    { userId: auth.user.id, endpoint: `PATCH:/bookings/${bookingId}` },
    () => patchBookingMutation(request, env, auth, bookingId)
  );
}

async function patchBookingMutation(request, env, auth, bookingId) {
  const row = await env.DB.prepare("SELECT * FROM bookings WHERE id=?").bind(bookingId).first();
  if (!row) return json({ error: "not_found" }, 404);
  const isProvider = auth.provider?.id === row.provider_id;
  const isClient = row.client_user_id === auth.user.id;
  if (!isProvider && !isClient) {
    return json({ error: "forbidden" }, 403);
  }

  const body = await readJson(request);
  if (!body) return json({ error: "invalid_json" }, 400);

  let status = row.status;
  let dateISO = row.date_iso;
  let from = row.time_from;
  let to = row.time_to;
  let locationLabel = row.location_label;

  if (!isProvider) {
    const allowedClientFields = new Set(["status", "dateISO", "from", "to", "locationLabel"]);
    if (Object.keys(body).some((key) => !allowedClientFields.has(key))) {
      return json({ error: "client_update_forbidden" }, 403);
    }
    const changesSlot =
      (body.dateISO != null && body.dateISO !== row.date_iso) ||
      (body.from != null && body.from !== row.time_from) ||
      (body.to != null && body.to !== row.time_to) ||
      (body.locationLabel != null && body.locationLabel !== row.location_label);
    if (changesSlot || !canTransitionBooking("client", row.status, body.status)) {
      return json({ error: "client_update_forbidden" }, 403);
    }
    status = body.status;
  } else {
    if (
      body.status != null &&
      !["confirmed", "pending", "proposed", "rejected", "cancelled"].includes(body.status)
    ) {
      return json({ error: "invalid_status" }, 400);
    }
    status = body.status ?? row.status;
    if (!canTransitionBooking("provider", row.status, status)) {
      return json({ error: "invalid_status_transition" }, 409);
    }
    dateISO = body.dateISO ?? row.date_iso;
    from = body.from ?? row.time_from;
    to = body.to ?? row.time_to;
    locationLabel = body.locationLabel ?? row.location_label;
    const slotError = validateSlot({ dateISO, from, to });
    if (slotError) return json({ error: slotError }, 400);
    const locationResult = normalizeText(locationLabel, 240);
    if (locationResult.error) return json({ error: "location_too_long" }, 400);
    locationLabel = locationResult.value;
  }

  const activeStatus = ["confirmed", "pending", "proposed"].includes(status) ? 1 : 0;
  const update = await env.DB.prepare(
    `UPDATE bookings
     SET status=?, date_iso=?, time_from=?, time_to=?, location_label=?, updated_at=?
     WHERE id=?
       AND (
         ? = 0 OR NOT EXISTS (
           SELECT 1 FROM bookings AS occupied
           WHERE occupied.provider_id=?
             AND occupied.date_iso=?
             AND occupied.status IN ('confirmed', 'pending', 'proposed')
             AND occupied.time_from < ?
             AND occupied.time_to > ?
             AND occupied.id <> ?
         )
       )`
  )
    .bind(
      status,
      dateISO,
      from,
      to,
      locationLabel,
      nowIso(),
      bookingId,
      activeStatus,
      row.provider_id,
      dateISO,
      to,
      from,
      bookingId
    )
    .run();
  if (!update.meta?.changes) return json({ error: "booking_overlap" }, 409);

  if (status !== row.status && row.client_email) {
    await safeEnqueueEmail(env, {
      toEmail: row.client_email,
      template: `booking_${status}`,
      payload: { bookingId, status, dateISO, from, to },
    });
  }

  const updated = await env.DB.prepare("SELECT * FROM bookings WHERE id=?").bind(bookingId).first();
  return json({ booking: mapBooking(updated) });
}

async function listRequests(request, env) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  let rows;
  if (auth.provider) {
    rows = await env.DB.prepare(
      "SELECT * FROM booking_requests WHERE provider_id=? ORDER BY created_at DESC"
    )
      .bind(auth.provider.id)
      .all();
  } else {
    rows = await env.DB.prepare(
      "SELECT * FROM booking_requests WHERE client_user_id=? ORDER BY created_at DESC"
    )
      .bind(auth.user.id)
      .all();
  }
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
  return withIdempotency(
    request,
    env,
    { userId: auth.user.id, endpoint: "POST:/requests" },
    () => createRequestMutation(request, env, auth)
  );
}

async function createRequestMutation(request, env, auth) {
  const body = await readJson(request);
  if (!body) return json({ error: "invalid_json" }, 400);

  const providerId = body.providerId || auth.provider?.id;
  if (!providerId) return json({ error: "provider_id_required" }, 400);
  // Pusta lista = prośba bez wyboru dnia (usługodawca proponuje dowolne terminy).
  const days = Array.isArray(body.days) ? body.days : [];
  if (
    days.length > 31 ||
    days.some(
      (day) =>
        !day ||
        !isValidDateISO(day.dateISO) ||
        (day.part != null && !["am", "pm", "any"].includes(day.part))
    )
  ) {
    return json({ error: "invalid_days" }, 400);
  }
  const clientNameResult = normalizeText(body.clientName || auth.user.name, 120, { required: true });
  const phoneResult = normalizeText(body.clientPhone || auth.user.phone, 40);
  const emailResult = normalizeText(body.clientEmail || auth.user.email, 254);
  const serviceIdsResult = normalizeStringArray(body.serviceIds, 50, 100);
  const serviceNamesResult = normalizeStringArray(body.serviceNames, 50, 120);
  if (
    clientNameResult.error ||
    phoneResult.error ||
    emailResult.error ||
    serviceIdsResult.error ||
    serviceNamesResult.error
  ) {
    return json({ error: "invalid_request_fields" }, 400);
  }
  const provider = await env.DB.prepare("SELECT email, name FROM provider_profiles WHERE id=?")
    .bind(providerId)
    .first();
  if (!provider) return json({ error: "provider_not_found" }, 404);

  const requestId = id("rq");
  const ts = nowIso();
  const clientName = clientNameResult.value;

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
      phoneResult.value,
      emailResult.value,
      JSON.stringify(serviceIdsResult.value),
      JSON.stringify(serviceNamesResult.value),
      JSON.stringify(days),
      ts,
      ts
    )
    .run();

  // Mail do usługodawcy (jeśli ma e-mail)
  if (provider?.email) {
    await safeEnqueueEmail(env, {
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
  return withIdempotency(
    request,
    env,
    { userId: auth.user.id, endpoint: `POST:/requests/${requestId}/propose` },
    () => proposeRequestMutation(request, env, auth, requestId)
  );
}

async function proposeRequestMutation(request, env, auth, requestId) {
  const row = await env.DB.prepare("SELECT * FROM booking_requests WHERE id=? AND provider_id=?")
    .bind(requestId, auth.provider.id)
    .first();
  if (!row) return json({ error: "not_found" }, 404);

  const body = await readJson(request);
  const proposals = Array.isArray(body?.proposals) ? body.proposals : [];
  if (!proposals.length) return json({ error: "proposals_required" }, 400);
  if (proposals.length > 20) return json({ error: "too_many_proposals" }, 400);

  const normalized = [];
  for (let i = 0; i < proposals.length; i++) {
    const proposal = proposals[i];
    const slotError = validateSlot(proposal || {});
    if (slotError) return json({ error: slotError, proposalIndex: i }, 400);
    const location = normalizeText(proposal.locationLabel, 240);
    const proposalId = normalizeText(proposal.id, 100);
    if (proposalId.error) return json({ error: "proposal_id_too_long", proposalIndex: i }, 400);
    if (location.error) return json({ error: "location_too_long", proposalIndex: i }, 400);
    normalized.push({
      id: proposalId.value || `prop_${i + 1}_${crypto.randomUUID().slice(0, 8)}`,
      dateISO: proposal.dateISO,
      from: proposal.from,
      to: proposal.to,
      locationLabel: location.value,
    });
  }

  await env.DB.prepare(
    `UPDATE booking_requests SET proposals_json=?, status='proposed', updated_at=? WHERE id=?`
  )
    .bind(JSON.stringify(normalized), nowIso(), requestId)
    .run();

  if (row.client_email) {
    await safeEnqueueEmail(env, {
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
  return withIdempotency(
    request,
    env,
    { userId: auth.user.id, endpoint: `POST:/requests/${requestId}/accept` },
    () => acceptRequestMutation(request, env, auth, requestId)
  );
}

async function acceptRequestMutation(request, env, auth, requestId) {
  const row = await env.DB.prepare("SELECT * FROM booking_requests WHERE id=?").bind(requestId).first();
  if (!row) return json({ error: "not_found" }, 404);
  if (!row.client_user_id || row.client_user_id !== auth.user.id) {
    return json({ error: "forbidden" }, 403);
  }
  if (row.status !== "proposed") return json({ error: "request_not_proposed" }, 409);

  const body = await readJson(request);
  const proposalIdResult = normalizeText(body?.proposalId, 100, { required: true });
  if (proposalIdResult.error) return json({ error: "invalid_proposal_id" }, 400);
  const proposalId = proposalIdResult.value;

  const proposals = JSON.parse(row.proposals_json || "[]");
  const chosen = proposals.find((p) => p.id === proposalId);
  if (!chosen) return json({ error: "proposal_not_found" }, 404);
  const slotError = validateSlot(chosen);
  if (slotError) return json({ error: slotError }, 400);

  const bookingId = id("bk");
  const ts = nowIso();
  const insert = await env.DB.prepare(
    `INSERT INTO bookings (
      id, provider_id, client_user_id, client_name, client_phone, client_email,
      service_ids_json, service_names_json, date_iso, time_from, time_to, location_label,
      status, request_id, created_at, updated_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM booking_requests
      WHERE id=? AND client_user_id=? AND status='proposed'
    )
      AND NOT EXISTS (
        SELECT 1 FROM bookings AS occupied
        WHERE occupied.provider_id=?
          AND occupied.date_iso=?
          AND occupied.status IN ('confirmed', 'pending', 'proposed')
          AND occupied.time_from < ?
          AND occupied.time_to > ?
      )
      AND NOT EXISTS (
        SELECT 1 FROM bookings WHERE request_id=?
      )`
  )
    .bind(
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
      ts,
      requestId,
      auth.user.id,
      row.provider_id,
      chosen.dateISO,
      chosen.to,
      chosen.from,
      requestId
    )
    .run();
  if (!insert.meta?.changes) return json({ error: "booking_overlap" }, 409);

  const requestUpdate = await env.DB.prepare(
    `UPDATE booking_requests
     SET accepted_proposal_id=?, status='confirmed', updated_at=?
     WHERE id=? AND client_user_id=? AND status='proposed'`
  )
    .bind(proposalId, ts, requestId, auth.user.id)
    .run();
  if (!requestUpdate.meta?.changes) {
    await env.DB.prepare("DELETE FROM bookings WHERE id=?").bind(bookingId).run();
    return json({ error: "request_conflict" }, 409);
  }

  if (row.client_email) {
    await safeEnqueueEmail(env, {
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
  return withIdempotency(
    request,
    env,
    { userId: auth.user.id, endpoint: `POST:/requests/${requestId}/decline` },
    () => declineRequestMutation(env, auth, requestId)
  );
}

async function declineRequestMutation(env, auth, requestId) {
  const row = await env.DB.prepare("SELECT * FROM booking_requests WHERE id=?").bind(requestId).first();
  if (!row) return json({ error: "not_found" }, 404);
  if (row.client_user_id !== auth.user.id && auth.provider?.id !== row.provider_id) {
    return json({ error: "forbidden" }, 403);
  }

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

  const headers = new Headers();
  headers.set("Content-Type", row.content_type || obj.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=86400");
  return new Response(obj.body, { status: 200, headers });
}

async function emailsOutbox(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const items = await listOutbox(env, 100);
  return json({ items });
}

async function processEmails(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const summary = await processDueEmails(env);
  return json({ ok: true, ...summary });
}
