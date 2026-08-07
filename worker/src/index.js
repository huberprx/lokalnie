import { json, id, nowIso, readJson, preflight, withCors, HttpError, isAllowedOrigin } from "./http.js";
import { requireDemoUser, requireAdmin, mapUser, mapProvider, isAdminUser } from "./auth.js";
import {
  startGoogleAuth,
  handleGoogleCallback,
  handleGoogleCalendarCallback,
  logoutSession,
  startGoogleCalendarAuth,
  sessionCookie,
} from "./oauth.js";
import { disconnectCalendar, listCalendarConnections, syncBookingToGoogle } from "./calendar.js";
import { prepareEmailOutbox, listOutbox, processDueEmails } from "./email.js";
import { mapClient, mapBooking, mapRequest, mapMedia } from "./mappers.js";
import { validateSlot, normalizeText, normalizeStringArray, isValidDateISO } from "./validate.js";
import { canTransitionBooking } from "./bookings.js";
import { cleanupIdempotencyKeys, withIdempotency } from "./idempotency.js";
import { enforceRateLimit, rateLimitScope } from "./rateLimit.js";
import { decryptPhone, encryptPhone } from "./pii.js";
import {
  createProviderService,
  deleteProviderService,
  deleteProviderServices,
  listProviderServices,
  updateProviderService,
  updateProviderServicesBookingMode,
} from "./services.js";
import {
  createProviderMe,
  geocodePendingBatch,
  getProviderAvailability,
  patchProviderMe as updateProviderMeProfile,
  putProviderAvailability,
} from "./provider.js";
import { listPublicProviders, getPublicProviderBySlug } from "./catalog.js";
import { suggestPlaces } from "./geocoding.js";
import {
  adminStats,
  adminListUsers,
  adminBlockUser,
  adminUnblockUser,
  adminListProviders,
  adminPatchProvider,
  adminListBookings,
  adminListAudit,
  adminEmailsOutbox,
  adminProcessEmails,
  isAdminPath,
} from "./admin.js";

const ALLOWED_IMAGE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_UPLOAD = 5 * 1024 * 1024;

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return preflight(request, env);
    try {
      return withCors(await routeRequest(request, env, ctx), request, env);
    } catch (err) {
      console.error(JSON.stringify({ level: "error", err: String(err?.stack || err) }));
      const response =
        err instanceof HttpError
          ? json({ error: err.code }, err.status)
          : json(
              {
                error: "internal_error",
                ...(env.ENVIRONMENT === "production"
                  ? {}
                  : { message: String(err?.message || err) }),
              },
              500
            );
      return withCors(response, request, env);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      Promise.all([
        processDueEmails(env),
        cleanupIdempotencyKeys(env),
        cleanupRetention(env),
        geocodePendingBatch(env, 10),
      ])
    );
  },
};

const OUTBOX_RETENTION_DAYS = 30;

/** Sprząta wygasłe rate limity i stare wpisy outboxu (PII w to_email / payload). */
export async function cleanupRetention(env) {
  const now = Date.now();
  const outboxBefore = new Date(now - OUTBOX_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const cacheBefore = new Date(now).toISOString();
  const [rateResult, outboxResult, cacheResult] = await env.DB.batch([
    env.DB.prepare("DELETE FROM rate_limits WHERE expires_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM email_outbox WHERE created_at < ?").bind(outboxBefore),
    env.DB.prepare("DELETE FROM geocode_cache WHERE expires_at < ?").bind(cacheBefore),
  ]);
  return {
    rateLimits: Number(rateResult?.meta?.changes || 0),
    emailOutbox: Number(outboxResult?.meta?.changes || 0),
    geocodeCache: Number(cacheResult?.meta?.changes || 0),
  };
}

async function routeRequest(request, env, ctx) {
    const url = new URL(request.url);

    try {
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const parts = path.split("/").filter(Boolean);
      const originRejected = rejectDisallowedMutationOrigin(request, env);
      if (originRejected) return originRejected;
      const rate = rateLimitConfig(path, request.method);
      if (rate) {
        const limited = await enforceRateLimit(
          request,
          env,
          rateLimitScope(request, rate.route),
          rate.limit
        );
        if (limited) return limited;
      }

      if (path === "/") {
        const response = {
          service: "lokalnie-api",
          ok: true,
          auth:
            env.ENVIRONMENT === "production"
              ? "HttpOnly session cookie"
              : "Bearer <session> | demo: X-Demo-User: demo | Authorization: Bearer demo",
          docs: {
            health: "GET /health",
            authGoogle: "GET /auth/google",
            authCallback: "GET /auth/google/callback",
            calendarGoogleConnect: "GET /calendar/google/connect",
            calendarConnections: "GET /calendar/connections",
            authLogout: "POST /auth/logout",
            me: "GET|PATCH|DELETE /me",
            providers: "GET /providers , GET /providers/:slug",
            geoSuggest: "GET /geo/suggest?q=",
            provider: "GET|POST|PATCH /provider/me",
            availability: "GET|PUT /provider/me/availability",
            services: "GET|POST /provider/me/services, PATCH|DELETE /provider/me/services/:id",
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
        };
        if (env.ENVIRONMENT !== "production") {
          response.environment = env.ENVIRONMENT || "unknown";
          response.appOrigin = env.APP_ORIGIN || null;
          response.bindings = { db: !!env.DB, media: !!env.MEDIA };
        }
        return json(response);
      }

      if (path === "/health") return health(env);
      if (path === "/debug/tables") return debugTables(request, env);

      if (path === "/auth/google" && request.method === "GET") return startGoogleAuth(request, env);
      if (path === "/auth/google/callback" && request.method === "GET") {
        return handleGoogleCallback(request, env);
      }
      if (path === "/auth/google/calendar/callback" && request.method === "GET") {
        return handleGoogleCalendarCallback(request, env);
      }
      if (path === "/calendar/google/connect" && request.method === "GET") {
        const auth = await requireDemoUser(request, env);
        if (auth.error) return auth.error;
        return startGoogleCalendarAuth(request, env, auth.user.id);
      }
      if (path === "/calendar/connections" && request.method === "GET") {
        const auth = await requireDemoUser(request, env);
        if (auth.error) return auth.error;
        return json({ connections: await listCalendarConnections(env, auth.user.id) });
      }
      if (parts[0] === "calendar" && parts[1] === "connections" && parts[2] && request.method === "DELETE") {
        const auth = await requireDemoUser(request, env);
        if (auth.error) return auth.error;
        const deleted = await disconnectCalendar(env, auth.user.id, parts[2]);
        return deleted ? json({ ok: true }) : json({ error: "not_found" }, 404);
      }
      if (path === "/auth/logout" && request.method === "POST") return logoutSession(request, env);

      if (path === "/me") {
        if (request.method === "GET") return getMe(request, env);
        if (request.method === "PATCH") return patchMe(request, env);
        if (request.method === "DELETE") return deleteMe(request, env);
      }

      if (path === "/providers" && request.method === "GET") {
        return listPublicProviders(request, env, url);
      }
      if (parts[0] === "providers" && parts[1] && !parts[2] && request.method === "GET") {
        return getPublicProviderBySlug(request, env, parts[1]);
      }

      if (path === "/geo/suggest" && request.method === "GET") {
        const q = String(url.searchParams.get("q") || "").trim().slice(0, 200);
        if (q.length < 2) return json({ suggestions: [] });
        const suggestions = await suggestPlaces(env, q);
        return json({ suggestions });
      }

      if (path === "/provider/me") {
        if (request.method === "GET") return getProviderMe(request, env);
        if (request.method === "POST") return createProviderMe(request, env, ctx);
        if (request.method === "PATCH") return updateProviderMeProfile(request, env, ctx);
      }

      if (path === "/provider/me/availability") {
        if (request.method === "GET") return getProviderAvailability(request, env);
        if (request.method === "PUT") return putProviderAvailability(request, env);
      }

      if (path === "/provider/me/clients") {
        if (request.method === "GET") return listClients(request, env);
        if (request.method === "POST") return createClient(request, env);
      }

      if (path === "/provider/me/services") {
        if (request.method === "GET") return listProviderServices(request, env);
        if (request.method === "POST") return createProviderService(request, env);
        if (request.method === "DELETE") return deleteProviderServices(request, env);
      }

      if (path === "/provider/me/services/booking-mode" && request.method === "PATCH") {
        return updateProviderServicesBookingMode(request, env);
      }

      if (parts[0] === "provider" && parts[1] === "me" && parts[2] === "services" && parts[3]) {
        const serviceId = parts[3];
        if (request.method === "PATCH") return updateProviderService(request, env, serviceId);
        if (request.method === "DELETE") return deleteProviderService(request, env, serviceId);
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
        if (parts[2] === "request-more" && request.method === "POST") {
          return requestMore(request, env, rid);
        }
        if (!parts[2] && request.method === "GET") return getRequest(request, env, rid);
      }

      if (path === "/media" && request.method === "POST") return uploadMedia(request, env);
      if (parts[0] === "media" && parts[1] && request.method === "GET") {
        return getMedia(request, env, parts[1]);
      }

      if (path === "/emails/outbox" && request.method === "GET") return emailsOutbox(request, env);
      if (path === "/emails/process" && request.method === "POST") return processEmails(request, env);

      if (path === "/admin/stats" && request.method === "GET") return adminStats(request, env);
      if (path === "/admin/users" && request.method === "GET") return adminListUsers(request, env, url);
      if (parts[0] === "admin" && parts[1] === "users" && parts[2] && parts[3] === "block" && request.method === "POST") {
        return adminBlockUser(request, env, parts[2]);
      }
      if (parts[0] === "admin" && parts[1] === "users" && parts[2] && parts[3] === "unblock" && request.method === "POST") {
        return adminUnblockUser(request, env, parts[2]);
      }
      if (path === "/admin/providers" && request.method === "GET") {
        return adminListProviders(request, env, url);
      }
      if (parts[0] === "admin" && parts[1] === "providers" && parts[2] && !parts[3] && request.method === "PATCH") {
        return adminPatchProvider(request, env, parts[2]);
      }
      if (path === "/admin/bookings" && request.method === "GET") {
        return adminListBookings(request, env, url);
      }
      if (path === "/admin/audit" && request.method === "GET") return adminListAudit(request, env, url);
      if (path === "/admin/emails/outbox" && request.method === "GET") {
        return adminEmailsOutbox(request, env);
      }
      if (path === "/admin/emails/process" && request.method === "POST") {
        return adminProcessEmails(request, env);
      }

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

/** Defense-in-depth CSRF: jawnie zły Origin na mutacjach → 403. Brak Origin (curl) przepuszczamy. */
function rejectDisallowedMutationOrigin(request, env) {
  const method = request.method.toUpperCase();
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(method)) return null;
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  if (isAllowedOrigin(origin, env)) return null;
  return json({ error: "origin_not_allowed" }, 403);
}

function rateLimitConfig(path, method) {
  if (path === "/auth/google" || path === "/auth/google/callback") {
    return { route: "auth", limit: 10 };
  }
  if (path === "/media" && method === "POST") return { route: "media-upload", limit: 5 };
  if (path === "/auth/logout") return { route: "auth-logout", limit: 10 };
  if (path === "/providers" || path.startsWith("/providers/")) {
    return { route: "providers-public", limit: 60 };
  }
  if (path === "/geo/suggest") {
    return { route: "geo-suggest", limit: 20 };
  }
  if (isAdminPath(path) && (method === "POST" || method === "PATCH")) {
    return { route: "admin-mutate", limit: 20 };
  }
  if (isAdminPath(path) && method === "GET") {
    return { route: "admin-read", limit: 60 };
  }
  if (method === "POST" || method === "PATCH" || method === "DELETE") {
    return { route: path, limit: 30 };
  }
  return null;
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
    isAdmin: auth.authMode === "demo" ? env.ENVIRONMENT !== "production" : isAdminUser(auth.user, env),
    user: await mapUser(auth.user, env),
    provider: await mapProvider(auth.provider, env),
  });
}

async function patchMe(request, env) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  const body = await readJson(request);
  if (!body) return json({ error: "invalid_json" }, 400);

  const existingPhone = await decryptPhone(auth.user.phone, env);
  const nameResult = normalizeText(body.name ?? auth.user.name, 120, { required: true });
  const phoneResult = normalizeText(body.phone ?? existingPhone, 40);
  const emailResult = normalizeText(body.email ?? auth.user.email, 254);
  if (nameResult.error || phoneResult.error || emailResult.error) {
    return json({ error: "invalid_profile_fields" }, 400);
  }
  const name = nameResult.value;
  const phone = await encryptPhone(phoneResult.value, env);
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
  return json({ authenticated: true, mode: auth.authMode || "demo", user: await mapUser(user, env) });
}

async function getProviderMe(request, env) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  if (!auth.provider) return json({ error: "provider_not_found" }, 404);
  return json({ provider: await mapProvider(auth.provider, env) });
}

/** Usunięcie konta: anonimizacja PII, odcięcie logowania, ukrycie profilu firmowego. */
async function deleteMe(request, env) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  if (auth.authMode === "demo") {
    return json({ error: "demo_delete_forbidden" }, 403);
  }

  const userId = auth.user.id;
  const userEmail = auth.user.email ? String(auth.user.email).trim() : "";
  const ts = nowIso();
  const deletedLabel = "Usunięte konto";

  const bookingRows = await env.DB.prepare("SELECT id FROM bookings WHERE client_user_id = ?")
    .bind(userId)
    .all();
  const bookingIds = (bookingRows.results || []).map((row) => row.id);

  // Media w R2 (best-effort) — przed batchem D1; awaria R2 nie blokuje usunięcia konta.
  const mediaRows = await env.DB.prepare("SELECT id, storage_key FROM media WHERE owner_user_id = ?")
    .bind(userId)
    .all();
  if (env.MEDIA && mediaRows.results) {
    for (const row of mediaRows.results) {
      try {
        await env.MEDIA.delete(row.storage_key);
      } catch (err) {
        /* ignore */
      }
    }
  }

  // Faza 1: anonimizacja historii (bez odcinania sesji — da się ponowić przy awarii).
  const anonymizeStatements = [
    env.DB.prepare(
      `UPDATE bookings SET client_name = ?, client_phone = NULL, client_email = NULL, client_user_id = NULL, updated_at = ?
       WHERE client_user_id = ?`
    ).bind(deletedLabel, ts, userId),
    env.DB.prepare(
      `UPDATE booking_requests SET client_name = ?, client_phone = NULL, client_email = NULL, client_user_id = NULL, updated_at = ?
       WHERE client_user_id = ?`
    ).bind(deletedLabel, ts, userId),
    env.DB.prepare(
      `UPDATE provider_clients SET client_user_id = NULL, name = ?, phone = NULL, email = NULL,
         address = '', notes = NULL, updated_at = ?
       WHERE client_user_id = ?`
    ).bind(deletedLabel, ts, userId),
  ];
  if (auth.provider) {
    anonymizeStatements.push(
      env.DB.prepare(
        `UPDATE provider_profiles SET name = ?, about = '', email = NULL, phone = NULL, address = '',
           email_visible = 0, visible_in_search = 0, avatar_key = NULL, updated_at = ?
         WHERE user_id = ?`
      ).bind(deletedLabel, ts, userId)
    );
  }
  await env.DB.batch(anonymizeStatements);

  // Faza 2: zaktualizuj wydarzenia Google (opis bez imienia) zanim skasujemy połączenie.
  for (const bookingId of bookingIds) {
    try {
      await syncBookingToGoogle(env, bookingId);
    } catch (err) {
      /* Google nie może blokować usunięcia konta */
    }
  }

  // Faza 3: odcięcie logowania + purge — jeden batch (atomowo w D1).
  const purgeStatements = [
    env.DB.prepare("DELETE FROM media WHERE owner_user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM calendar_connections WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM oauth_identities WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    env.DB.prepare(
      `UPDATE users SET email = NULL, name = ?, phone = NULL, avatar_key = NULL,
         notification_booking = 0, notification_reminder = 0, notification_marketing = 0,
         blocked = 1, blocked_at = ?, blocked_reason = ?, role_provider = 0, updated_at = ?
       WHERE id = ?`
    ).bind(deletedLabel, ts, "account_deleted", ts, userId),
    env.DB.prepare(
      `INSERT INTO admin_audit_log (id, actor_user_id, action, target_type, target_id, meta_json)
       VALUES (?, ?, 'account.deleted', 'user', ?, ?)`
    ).bind(
      id("audit"),
      userId,
      userId,
      JSON.stringify({
        bookingsAnonymized: bookingIds.length,
        mediaRemoved: (mediaRows.results || []).length,
        hadProvider: !!auth.provider,
      })
    ),
  ];
  if (userEmail) {
    purgeStatements.push(
      env.DB.prepare("DELETE FROM email_outbox WHERE lower(to_email) = lower(?)").bind(userEmail)
    );
  }
  await env.DB.batch(purgeStatements);

  return json({ ok: true, deleted: true }, 200, { "Set-Cookie": sessionCookie("", env, 0) });
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
  return json({
    clients: await Promise.all((rows.results || []).map((row) => mapClient(row, env))),
  });
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
  const sealedPhone = await encryptPhone(fields.phone.value, env);
  await env.DB.prepare(
    `INSERT INTO provider_clients (id, provider_id, client_user_id, name, phone, email, address, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      clientId,
      auth.provider.id,
      null,
      fields.name.value,
      sealedPhone,
      fields.email.value,
      fields.address.value,
      fields.notes.value,
      ts,
      ts
    )
    .run();

  const row = await env.DB.prepare("SELECT * FROM provider_clients WHERE id=?").bind(clientId).first();
  return json({ client: await mapClient(row, env) }, 201);
}

async function getClient(request, env, clientId) {
  const auth = await requireProvider(request, env);
  if (auth.error) return auth.error;
  const row = await env.DB.prepare("SELECT * FROM provider_clients WHERE id=? AND provider_id=?")
    .bind(clientId, auth.provider.id)
    .first();
  if (!row) return json({ error: "not_found" }, 404);
  return json({ client: await mapClient(row, env) });
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

  const existingPhone = await decryptPhone(row.phone, env);
  const fields = {
    name: normalizeText(body.name ?? row.name, 120, { required: true }),
    phone: normalizeText(body.phone ?? existingPhone, 40),
    email: normalizeText(body.email ?? row.email, 254),
    address: normalizeText(body.address ?? row.address, 240),
    notes: normalizeText(body.notes ?? row.notes, 2000),
  };
  if (Object.values(fields).some((field) => field.error)) {
    return json({ error: "invalid_client_fields" }, 400);
  }

  const sealedPhone = await encryptPhone(fields.phone.value, env);
  await env.DB.prepare(
    `UPDATE provider_clients SET name=?, phone=?, email=?, address=?, notes=?, updated_at=? WHERE id=?`
  )
    .bind(
      fields.name.value,
      sealedPhone,
      fields.email.value,
      fields.address.value,
      fields.notes.value,
      nowIso(),
      clientId
    )
    .run();

  const updated = await env.DB.prepare("SELECT * FROM provider_clients WHERE id=?").bind(clientId).first();
  return json({ client: await mapClient(updated, env) });
}

async function deleteClient(request, env, clientId) {
  const auth = await requireProvider(request, env);
  if (auth.error) return auth.error;
  const row = await env.DB.prepare("SELECT * FROM provider_clients WHERE id=? AND provider_id=?")
    .bind(clientId, auth.provider.id)
    .first();
  if (!row) return json({ error: "not_found" }, 404);

  const ts = nowIso();
  const deletedLabel = "Usunięty klient";
  const statements = [
    env.DB.prepare(
      `UPDATE bookings
       SET client_name = ?, client_phone = NULL, client_email = NULL, provider_client_id = NULL, updated_at = ?
       WHERE provider_client_id = ? AND provider_id = ?`
    ).bind(deletedLabel, ts, clientId, auth.provider.id),
    env.DB.prepare("DELETE FROM provider_clients WHERE id=? AND provider_id=?").bind(
      clientId,
      auth.provider.id
    ),
  ];
  if (row.email) {
    statements.unshift(
      env.DB.prepare(
        `UPDATE booking_requests
         SET client_name = ?, client_phone = NULL, client_email = NULL, updated_at = ?
         WHERE provider_id = ? AND lower(client_email) = lower(?)`
      ).bind(deletedLabel, ts, auth.provider.id, row.email)
    );
  }
  await env.DB.batch(statements);
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
  return json({
    bookings: await Promise.all((rows.results || []).map((row) => mapBooking(row, env))),
  });
}

async function createBooking(request, env) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  return withIdempotency(
    request,
    env,
    { userId: auth.user.id, endpoint: "/bookings" },
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
  const profilePhone = await decryptPhone(auth.user.phone, env);
  const phoneResult = normalizeText(body.clientPhone || profilePhone, 40);
  const emailResult = normalizeText(body.clientEmail || auth.user.email, 254);
  if (phoneResult.error || emailResult.error) return json({ error: "client_details_too_long" }, 400);
  const sealedPhone = await encryptPhone(phoneResult.value, env);

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
  const insertStatement = env.DB.prepare(
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
      sealedPhone,
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
    );
  const statements = [insertStatement];
  if (auth.provider?.id === providerId) {
    const crmClientId = id("pc");
    statements.push(
      env.DB.prepare(
        `INSERT INTO provider_clients (
          id, provider_id, name, phone, email, created_at, updated_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM bookings WHERE id=?)
          AND NOT EXISTS (
            SELECT 1 FROM provider_clients
            WHERE provider_id=? AND lower(name)=lower(?)
          )`
      ).bind(
        crmClientId,
        providerId,
        clientName,
        sealedPhone,
        emailResult.value,
        ts,
        ts,
        bookingId,
        providerId,
        clientName
      )
    );
  }
  if (emailResult.value) {
    statements.push(
      prepareEmailOutbox(env, {
        toEmail: emailResult.value,
        template: status === "confirmed" ? "booking_confirmed" : "booking_created",
        payload: {
          bookingId,
          clientName,
          dateISO: body.dateISO,
          from: body.from,
          to: body.to,
          status,
        },
        conditionSql: "EXISTS (SELECT 1 FROM bookings WHERE id=?)",
        conditionBinds: [bookingId],
      })
    );
  }
  const [insert] = await env.DB.batch(statements);
  if (!insert.meta?.changes) return json({ error: "booking_overlap" }, 409);

  const row = await env.DB.prepare("SELECT * FROM bookings WHERE id=?").bind(bookingId).first();
  const calendar = status === "confirmed" ? await syncBookingToGoogle(env, bookingId) : null;
  return json({ booking: await mapBooking(row, env), calendar }, 201);
}

async function getBooking(request, env, bookingId) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  const row = await env.DB.prepare("SELECT * FROM bookings WHERE id=?").bind(bookingId).first();
  if (!row) return json({ error: "not_found" }, 404);
  if (auth.provider?.id !== row.provider_id && row.client_user_id !== auth.user.id) {
    return json({ error: "forbidden" }, 403);
  }
  return json({ booking: await mapBooking(row, env) });
}

async function patchBooking(request, env, bookingId) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  return withIdempotency(
    request,
    env,
    { userId: auth.user.id, endpoint: `/bookings/${bookingId}` },
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
  const ts = nowIso();
  const updateStatement = env.DB.prepare(
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
      ts,
      bookingId,
      activeStatus,
      row.provider_id,
      dateISO,
      to,
      from,
      bookingId
    );
  const statements = [updateStatement];
  if (status !== row.status && row.client_email) {
    statements.push(
      prepareEmailOutbox(env, {
        toEmail: row.client_email,
        template: `booking_${status}`,
        payload: { bookingId, status, dateISO, from, to },
        conditionSql:
          "EXISTS (SELECT 1 FROM bookings WHERE id=? AND status=? AND updated_at=?)",
        conditionBinds: [bookingId, status, ts],
      })
    );
  }
  const [update] = await env.DB.batch(statements);
  if (!update.meta?.changes) return json({ error: "booking_overlap" }, 409);

  const updated = await env.DB.prepare("SELECT * FROM bookings WHERE id=?").bind(bookingId).first();
  const calendar = await syncBookingToGoogle(env, bookingId);
  return json({ booking: await mapBooking(updated, env), calendar });
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
  return json({
    requests: await Promise.all((rows.results || []).map((row) => mapRequest(row, env))),
  });
}

async function getRequest(request, env, requestId) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  const row = await env.DB.prepare("SELECT * FROM booking_requests WHERE id=?").bind(requestId).first();
  if (!row) return json({ error: "not_found" }, 404);
  if (auth.provider?.id !== row.provider_id && row.client_user_id !== auth.user.id) {
    return json({ error: "forbidden" }, 403);
  }
  return json({ request: await mapRequest(row, env) });
}

async function createRequest(request, env) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  return withIdempotency(
    request,
    env,
    { userId: auth.user.id, endpoint: "/requests" },
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
  const profilePhone = await decryptPhone(auth.user.phone, env);
  const clientNameResult = normalizeText(body.clientName || auth.user.name, 120, { required: true });
  const phoneResult = normalizeText(body.clientPhone || profilePhone, 40);
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
  const sealedPhone = await encryptPhone(phoneResult.value, env);
  const provider = await env.DB.prepare("SELECT email, name FROM provider_profiles WHERE id=?")
    .bind(providerId)
    .first();
  if (!provider) return json({ error: "provider_not_found" }, 404);

  const requestId = id("rq");
  const ts = nowIso();
  const clientName = clientNameResult.value;

  const insertStatement = env.DB.prepare(
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
      sealedPhone,
      emailResult.value,
      JSON.stringify(serviceIdsResult.value),
      JSON.stringify(serviceNamesResult.value),
      JSON.stringify(days),
      ts,
      ts
    );
  const statements = [insertStatement];
  if (provider?.email) {
    statements.push(
      prepareEmailOutbox(env, {
        toEmail: provider.email,
        template: "request_new",
        payload: { requestId, clientName, providerName: provider.name },
        conditionSql: "EXISTS (SELECT 1 FROM booking_requests WHERE id=?)",
        conditionBinds: [requestId],
      })
    );
  }
  await env.DB.batch(statements);

  const row = await env.DB.prepare("SELECT * FROM booking_requests WHERE id=?").bind(requestId).first();
  return json({ request: await mapRequest(row, env) }, 201);
}

async function proposeRequest(request, env, requestId) {
  const auth = await requireProvider(request, env);
  if (auth.error) return auth.error;
  return withIdempotency(
    request,
    env,
    { userId: auth.user.id, endpoint: `/requests/${requestId}/propose` },
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

  const ts = nowIso();
  const updateStatement = env.DB.prepare(
    `UPDATE booking_requests SET proposals_json=?, status='proposed', updated_at=? WHERE id=?`
  )
    .bind(JSON.stringify(normalized), ts, requestId);
  const statements = [updateStatement];
  if (row.client_email) {
    statements.push(
      prepareEmailOutbox(env, {
        toEmail: row.client_email,
        template: "request_proposed",
        payload: { requestId, proposals: normalized },
        conditionSql:
          "EXISTS (SELECT 1 FROM booking_requests WHERE id=? AND status='proposed' AND updated_at=?)",
        conditionBinds: [requestId, ts],
      })
    );
  }
  const [update] = await env.DB.batch(statements);
  if (!update.meta?.changes) return json({ error: "request_conflict" }, 409);

  const updated = await env.DB.prepare("SELECT * FROM booking_requests WHERE id=?").bind(requestId).first();
  return json({ request: await mapRequest(updated, env) });
}

async function acceptRequest(request, env, requestId) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  return withIdempotency(
    request,
    env,
    { userId: auth.user.id, endpoint: `/requests/${requestId}/accept` },
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
  const insertStatement = env.DB.prepare(
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
    );
  const updateStatement = env.DB.prepare(
    `UPDATE booking_requests
     SET accepted_proposal_id=?, status='confirmed', updated_at=?
     WHERE id=? AND client_user_id=? AND status='proposed'
       AND EXISTS (
         SELECT 1 FROM bookings
         WHERE id=? AND request_id=? AND client_user_id=?
       )`
  )
    .bind(
      proposalId,
      ts,
      requestId,
      auth.user.id,
      bookingId,
      requestId,
      auth.user.id
    );
  const statements = [insertStatement, updateStatement];
  if (row.client_email) {
    statements.push(
      prepareEmailOutbox(env, {
        toEmail: row.client_email,
        template: "booking_confirmed",
        payload: {
          bookingId,
          requestId,
          dateISO: chosen.dateISO,
          from: chosen.from,
          to: chosen.to,
        },
        conditionSql: `EXISTS (
          SELECT 1 FROM bookings AS accepted_booking
          JOIN booking_requests AS accepted_request
            ON accepted_request.id=accepted_booking.request_id
          WHERE accepted_booking.id=?
            AND accepted_request.id=?
            AND accepted_request.status='confirmed'
            AND accepted_request.accepted_proposal_id=?
        )`,
        conditionBinds: [bookingId, requestId, proposalId],
      })
    );
  }
  const [insert, requestUpdate] = await env.DB.batch(statements);
  if (!insert.meta?.changes || !requestUpdate.meta?.changes) {
    if (insert.meta?.changes) {
      await env.DB.prepare("DELETE FROM bookings WHERE id=?").bind(bookingId).run();
    }
    return json(
      { error: insert.meta?.changes ? "request_conflict" : "booking_overlap" },
      409
    );
  }

  const booking = await env.DB.prepare("SELECT * FROM bookings WHERE id=?").bind(bookingId).first();
  const updated = await env.DB.prepare("SELECT * FROM booking_requests WHERE id=?").bind(requestId).first();
  const calendar = await syncBookingToGoogle(env, bookingId);
  return json({
    request: await mapRequest(updated, env),
    booking: await mapBooking(booking, env),
    calendar,
  });
}

async function declineRequest(request, env, requestId) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  return withIdempotency(
    request,
    env,
    { userId: auth.user.id, endpoint: `/requests/${requestId}/decline` },
    () => declineRequestMutation(env, auth, requestId)
  );
}

async function declineRequestMutation(env, auth, requestId) {
  const row = await env.DB.prepare("SELECT * FROM booking_requests WHERE id=?").bind(requestId).first();
  if (!row) return json({ error: "not_found" }, 404);
  if (row.client_user_id !== auth.user.id && auth.provider?.id !== row.provider_id) {
    return json({ error: "forbidden" }, 403);
  }

  const [update] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE booking_requests SET status='rejected', updated_at=? WHERE id=?`
    ).bind(nowIso(), requestId),
  ]);
  if (!update.meta?.changes) return json({ error: "request_conflict" }, 409);

  const updated = await env.DB.prepare("SELECT * FROM booking_requests WHERE id=?").bind(requestId).first();
  return json({ request: await mapRequest(updated, env) });
}

async function requestMore(request, env, requestId) {
  const auth = await requireDemoUser(request, env);
  if (auth.error) return auth.error;
  return withIdempotency(
    request,
    env,
    { userId: auth.user.id, endpoint: `/requests/${requestId}/request-more` },
    () => requestMoreMutation(env, auth, requestId)
  );
}

async function requestMoreMutation(env, auth, requestId) {
  const row = await env.DB.prepare("SELECT * FROM booking_requests WHERE id=?")
    .bind(requestId)
    .first();
  if (!row) return json({ error: "not_found" }, 404);
  if (!row.client_user_id || row.client_user_id !== auth.user.id) {
    return json({ error: "forbidden" }, 403);
  }
  if (row.status !== "proposed") return json({ error: "request_not_proposed" }, 409);

  const [update] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE booking_requests
       SET status='pending', proposals_json='[]', accepted_proposal_id=NULL, updated_at=?
       WHERE id=? AND client_user_id=? AND status='proposed'`
    ).bind(nowIso(), requestId, auth.user.id),
  ]);
  if (!update.meta?.changes) return json({ error: "request_conflict" }, 409);

  const updated = await env.DB.prepare("SELECT * FROM booking_requests WHERE id=?")
    .bind(requestId)
    .first();
  return json({ request: await mapRequest(updated, env) });
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
  if ((kind === "service" || kind === "provider") && !auth.provider) {
    return json({ error: "provider_required" }, 403);
  }

  const contentType = file.type || "application/octet-stream";
  if (!ALLOWED_IMAGE.has(contentType)) return json({ error: "unsupported_type", allowed: [...ALLOWED_IMAGE] }, 415);
  if (file.size > MAX_UPLOAD) return json({ error: "too_large", maxBytes: MAX_UPLOAD }, 413);

  const mediaId = id("media");
  const ext = contentType.split("/")[1] || "bin";
  const storageKey = `${auth.user.id}/${kind}/${mediaId}.${ext}`;
  const bytes = await file.arrayBuffer();
  const detectedType = detectImageType(new Uint8Array(bytes));
  if (!detectedType || detectedType !== contentType) {
    return json({ error: "invalid_image_bytes" }, 415);
  }
  const isPublic = kind === "avatar" || kind === "provider" || kind === "service" ? 1 : 0;

  await env.MEDIA.put(storageKey, bytes, {
    httpMetadata: { contentType },
    customMetadata: { owner: auth.user.id, kind },
  });

  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO media (id, owner_user_id, kind, storage_key, content_type, byte_size, is_public, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(mediaId, auth.user.id, kind, storageKey, contentType, bytes.byteLength, isPublic, ts)
    .run();

  // avatar_key = media.id (GET /media/:id), nie storage_key R2.
  if (kind === "avatar") {
    await env.DB.prepare("UPDATE users SET avatar_key=?, updated_at=? WHERE id=?")
      .bind(mediaId, ts, auth.user.id)
      .run();
  }
  if (kind === "provider" && auth.provider) {
    await env.DB.prepare("UPDATE provider_profiles SET avatar_key=?, updated_at=? WHERE id=?")
      .bind(mediaId, ts, auth.provider.id)
      .run();
  }

  const row = await env.DB.prepare("SELECT * FROM media WHERE id=?").bind(mediaId).first();
  return json({ media: mapMedia(row) }, 201);
}

async function getMedia(request, env, mediaId) {
  const row = await env.DB.prepare("SELECT * FROM media WHERE id=?").bind(mediaId).first();
  if (!row) return json({ error: "not_found" }, 404);
  if (!row.is_public) {
    const auth = await requireDemoUser(request, env);
    if (auth.error) return auth.error;
    if (auth.user.id !== row.owner_user_id && auth.provider?.user_id !== row.owner_user_id) {
      return json({ error: "forbidden" }, 403);
    }
  }
  if (!env.MEDIA) return json({ error: "r2_not_configured" }, 503);

  const obj = await env.MEDIA.get(row.storage_key);
  if (!obj) return json({ error: "object_missing" }, 404);

  const headers = new Headers();
  headers.set("Content-Type", row.content_type || obj.httpMetadata?.contentType || "application/octet-stream");
  headers.set(
    "Cache-Control",
    row.is_public ? "public, max-age=31536000, immutable" : "no-store"
  );
  return new Response(obj.body, { status: 200, headers });
}

export function detectImageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 6 &&
    (String.fromCharCode(...bytes.slice(0, 6)) === "GIF87a" ||
      String.fromCharCode(...bytes.slice(0, 6)) === "GIF89a")
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
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
