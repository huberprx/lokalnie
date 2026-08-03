import { json, id, nowIso, readJson } from "./http.js";
import { requireAdmin, isAdminUser } from "./auth.js";
import { listOutbox, processDueEmails } from "./email.js";

const MAX_LIST = 50;
const DEFAULT_LIST = 30;

function clampLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIST;
  return Math.min(MAX_LIST, Math.floor(n));
}

function clampOffset(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(10_000, Math.floor(n));
}

function escapeLike(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

async function writeAudit(env, actorUserId, action, targetType, targetId, meta) {
  await env.DB.prepare(
    `INSERT INTO admin_audit_log (id, actor_user_id, action, target_type, target_id, meta_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id("audit"),
      actorUserId,
      action,
      targetType,
      targetId,
      meta == null ? null : JSON.stringify(meta)
    )
    .run();
}

function mapAdminUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    emailVerified: !!row.email_verified,
    blocked: !!row.blocked,
    blockedAt: row.blocked_at || null,
    blockedReason: row.blocked_reason || null,
    createdAt: row.created_at || null,
    roles: {
      client: !!row.role_client,
      provider: !!row.role_provider,
    },
  };
}

function mapAdminProvider(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    city: row.city,
    email: row.email,
    phone: row.phone,
    bookingMode: row.booking_mode,
    visibleInSearch: !!row.visible_in_search,
    createdAt: row.created_at || null,
    ownerEmail: row.owner_email || null,
    ownerBlocked: !!row.owner_blocked,
  };
}

function mapAdminBooking(row) {
  if (!row) return null;
  return {
    id: row.id,
    providerId: row.provider_id,
    providerName: row.provider_name || null,
    clientName: row.client_name || null,
    clientEmail: row.client_email || null,
    dateISO: row.date_iso,
    from: row.time_from,
    to: row.time_to,
    status: row.status,
    createdAt: row.created_at || null,
  };
}

export async function adminStats(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    usersTotal,
    usersBlocked,
    usersWeek,
    providersTotal,
    providersVisible,
    bookingsTotal,
    bookingsWeek,
    bookingsToday,
    requestsOpen,
    emailsPending,
  ] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n FROM users"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE blocked = 1"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE created_at >= ?").bind(weekAgo),
    env.DB.prepare("SELECT COUNT(*) AS n FROM provider_profiles"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM provider_profiles WHERE visible_in_search = 1"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM bookings"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM bookings WHERE created_at >= ?").bind(weekAgo),
    env.DB.prepare(
      "SELECT COUNT(*) AS n FROM bookings WHERE created_at >= ? AND status IN ('confirmed','pending','proposed')"
    ).bind(dayAgo),
    env.DB.prepare(
      "SELECT COUNT(*) AS n FROM booking_requests WHERE status IN ('pending','proposed')"
    ),
    env.DB.prepare("SELECT COUNT(*) AS n FROM email_outbox WHERE status = 'pending'"),
  ]);

  return json({
    stats: {
      usersTotal: usersTotal.results?.[0]?.n ?? 0,
      usersBlocked: usersBlocked.results?.[0]?.n ?? 0,
      usersLast7d: usersWeek.results?.[0]?.n ?? 0,
      providersTotal: providersTotal.results?.[0]?.n ?? 0,
      providersVisible: providersVisible.results?.[0]?.n ?? 0,
      bookingsTotal: bookingsTotal.results?.[0]?.n ?? 0,
      bookingsLast7d: bookingsWeek.results?.[0]?.n ?? 0,
      bookingsActiveLast24h: bookingsToday.results?.[0]?.n ?? 0,
      requestsOpen: requestsOpen.results?.[0]?.n ?? 0,
      emailsPending: emailsPending.results?.[0]?.n ?? 0,
    },
  });
}

export async function adminListUsers(request, env, url) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = clampOffset(url.searchParams.get("offset"));
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 80);
  const blockedOnly = url.searchParams.get("blocked") === "1";

  let sql = `SELECT id, email, name, phone, email_verified, blocked, blocked_at, blocked_reason,
      role_client, role_provider, created_at
    FROM users WHERE 1=1`;
  const binds = [];
  if (blockedOnly) sql += " AND blocked = 1";
  if (q) {
    sql += " AND (lower(email) LIKE ? ESCAPE '\\' OR lower(name) LIKE ? ESCAPE '\\' OR id = ?)";
    const pattern = "%" + escapeLike(q.toLowerCase()) + "%";
    binds.push(pattern, pattern, q);
  }
  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  binds.push(limit, offset);

  const rows = await env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return json({ users: (rows.results || []).map(mapAdminUser), limit, offset });
}

export async function adminBlockUser(request, env, userId) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const targetId = String(userId || "").trim();
  if (!targetId) return json({ error: "invalid_user_id" }, 400);
  if (targetId === auth.user.id) return json({ error: "cannot_block_self" }, 400);

  const body = (await readJson(request)) || {};
  const reasonResult = String(body.reason || "")
    .trim()
    .slice(0, 280);
  const reason = reasonResult || null;

  const target = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetId).first();
  if (!target) return json({ error: "not_found" }, 404);
  if (isAdminUser(target, env)) return json({ error: "cannot_block_admin" }, 403);

  const ts = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET blocked = 1, blocked_at = ?, blocked_reason = ?, updated_at = ? WHERE id = ?`
    ).bind(ts, reason, ts, targetId),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetId),
  ]);

  await writeAudit(env, auth.user.id, "user.block", "user", targetId, {
    reason,
    email: target.email || null,
  });

  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetId).first();
  return json({ ok: true, user: mapAdminUser(user) });
}

export async function adminUnblockUser(request, env, userId) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const targetId = String(userId || "").trim();
  if (!targetId) return json({ error: "invalid_user_id" }, 400);

  const target = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetId).first();
  if (!target) return json({ error: "not_found" }, 404);

  const ts = nowIso();
  await env.DB.prepare(
    `UPDATE users SET blocked = 0, blocked_at = NULL, blocked_reason = NULL, updated_at = ? WHERE id = ?`
  )
    .bind(ts, targetId)
    .run();

  await writeAudit(env, auth.user.id, "user.unblock", "user", targetId, {
    email: target.email || null,
  });

  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetId).first();
  return json({ ok: true, user: mapAdminUser(user) });
}

export async function adminListProviders(request, env, url) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = clampOffset(url.searchParams.get("offset"));
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 80);
  const hiddenOnly = url.searchParams.get("hidden") === "1";

  let sql = `SELECT p.*, u.email AS owner_email, u.blocked AS owner_blocked
    FROM provider_profiles p
    JOIN users u ON u.id = p.user_id
    WHERE 1=1`;
  const binds = [];
  if (hiddenOnly) sql += " AND p.visible_in_search = 0";
  if (q) {
    sql += ` AND (
      lower(p.name) LIKE ? ESCAPE '\\'
      OR lower(p.slug) LIKE ? ESCAPE '\\'
      OR lower(IFNULL(p.city,'')) LIKE ? ESCAPE '\\'
      OR lower(IFNULL(u.email,'')) LIKE ? ESCAPE '\\'
      OR p.id = ?
    )`;
    const pattern = "%" + escapeLike(q.toLowerCase()) + "%";
    binds.push(pattern, pattern, pattern, pattern, q);
  }
  sql += " ORDER BY p.created_at DESC LIMIT ? OFFSET ?";
  binds.push(limit, offset);

  const rows = await env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return json({ providers: (rows.results || []).map(mapAdminProvider), limit, offset });
}

export async function adminPatchProvider(request, env, providerId) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const pid = String(providerId || "").trim();
  if (!pid) return json({ error: "invalid_provider_id" }, 400);

  const body = await readJson(request);
  if (!body || typeof body.visibleInSearch !== "boolean") {
    return json({ error: "invalid_body", message: "Wymagane: visibleInSearch (boolean)." }, 400);
  }

  const existing = await env.DB.prepare("SELECT * FROM provider_profiles WHERE id = ?").bind(pid).first();
  if (!existing) return json({ error: "not_found" }, 404);

  await env.DB.prepare(
    "UPDATE provider_profiles SET visible_in_search = ?, updated_at = ? WHERE id = ?"
  )
    .bind(body.visibleInSearch ? 1 : 0, nowIso(), pid)
    .run();

  await writeAudit(env, auth.user.id, "provider.visibility", "provider", pid, {
    visibleInSearch: body.visibleInSearch,
    slug: existing.slug,
  });

  const row = await env.DB.prepare(
    `SELECT p.*, u.email AS owner_email, u.blocked AS owner_blocked
     FROM provider_profiles p JOIN users u ON u.id = p.user_id WHERE p.id = ?`
  )
    .bind(pid)
    .first();
  return json({ ok: true, provider: mapAdminProvider(row) });
}

export async function adminListBookings(request, env, url) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = clampOffset(url.searchParams.get("offset"));
  const status = String(url.searchParams.get("status") || "").trim();
  const allowed = new Set(["confirmed", "pending", "proposed", "rejected", "cancelled"]);

  let sql = `SELECT b.id, b.provider_id, b.client_name, b.client_email, b.date_iso, b.time_from, b.time_to,
      b.status, b.created_at, p.name AS provider_name
    FROM bookings b
    LEFT JOIN provider_profiles p ON p.id = b.provider_id
    WHERE 1=1`;
  const binds = [];
  if (status && allowed.has(status)) {
    sql += " AND b.status = ?";
    binds.push(status);
  }
  sql += " ORDER BY b.created_at DESC LIMIT ? OFFSET ?";
  binds.push(limit, offset);

  const rows = await env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return json({ bookings: (rows.results || []).map(mapAdminBooking), limit, offset });
}

export async function adminListAudit(request, env, url) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = clampOffset(url.searchParams.get("offset"));
  const rows = await env.DB.prepare(
    `SELECT a.*, u.email AS actor_email
     FROM admin_audit_log a
     LEFT JOIN users u ON u.id = a.actor_user_id
     ORDER BY a.created_at DESC
     LIMIT ? OFFSET ?`
  )
    .bind(limit, offset)
    .all();

  return json({
    items: (rows.results || []).map((row) => ({
      id: row.id,
      actorUserId: row.actor_user_id,
      actorEmail: row.actor_email || null,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      meta: row.meta_json
        ? (() => {
            try {
              return JSON.parse(row.meta_json);
            } catch {
              return null;
            }
          })()
        : null,
      createdAt: row.created_at,
    })),
    limit,
    offset,
  });
}

export async function adminEmailsOutbox(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const items = await listOutbox(env, 100);
  return json({ items });
}

export async function adminProcessEmails(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const summary = await processDueEmails(env);
  await writeAudit(env, auth.user.id, "emails.process", "system", "email_outbox", summary);
  return json({ ok: true, ...summary });
}

/** Czy ścieżka należy do przestrzeni /admin (rate-limit + routing). */
export function isAdminPath(path) {
  return path === "/admin" || path.startsWith("/admin/");
}
