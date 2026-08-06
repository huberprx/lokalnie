import { json, parseJsonField } from "./http.js";
import { decryptPhone } from "./pii.js";
import { mapService } from "./services.js";
import { readAvailability } from "./provider.js";

const MAX_LIST = 50;
const MAX_Q = 80;

async function mapPublicProvider(row, env, { includePrivateContact = false } = {}) {
  if (!row) return null;
  const locations = parseJsonField(row.locations_json, []);
  const socialLinks = parseJsonField(row.social_links_json, []);
  const bookingRules = parseJsonField(row.booking_rules_json, {});
  const emailVisible = !!row.email_visible;
  const phone = await decryptPhone(row.phone, env);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    subcategory: row.subcategory,
    city: row.city,
    address: row.address,
    about: row.about,
    email: emailVisible || includePrivateContact ? row.email : "",
    emailVisible,
    phone: phone || "",
    bookingMode: row.booking_mode,
    visibleInSearch: !!row.visible_in_search,
    multiSelect: !!row.multi_select,
    avatarKey: row.avatar_key || null,
    avatarUrl: row.avatar_key ? `/media/${row.avatar_key}` : null,
    locations: Array.isArray(locations) ? locations : [],
    socialLinks: Array.isArray(socialLinks) ? socialLinks : [],
    bookingRules:
      bookingRules && typeof bookingRules === "object" && !Array.isArray(bookingRules)
        ? bookingRules
        : {},
    deactivated: !!row.deactivated,
  };
}

function clampLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 20;
  return Math.min(MAX_LIST, Math.floor(n));
}

function clampOffset(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/** Publiczna lista usługodawców widocznych w wyszukiwaniu. */
export async function listPublicProviders(request, env, url) {
  const q = String(url.searchParams.get("q") || "")
    .trim()
    .slice(0, MAX_Q)
    .toLowerCase();
  const city = String(url.searchParams.get("city") || "")
    .trim()
    .slice(0, 120)
    .toLowerCase();
  const category = String(url.searchParams.get("category") || "")
    .trim()
    .slice(0, 100);
  const subcategory = String(url.searchParams.get("subcategory") || "")
    .trim()
    .slice(0, 100);
  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = clampOffset(url.searchParams.get("offset"));

  const where = ["COALESCE(deactivated, 0) = 0", "visible_in_search = 1"];
  const binds = [];
  if (category) {
    where.push("category = ?");
    binds.push(category);
  }
  if (subcategory) {
    where.push("subcategory = ?");
    binds.push(subcategory);
  }
  if (city) {
    where.push("lower(COALESCE(city, '')) LIKE ?");
    binds.push(`%${city}%`);
  }
  if (q) {
    where.push(
      "(lower(name) LIKE ? OR lower(COALESCE(city, '')) LIKE ? OR lower(COALESCE(about, '')) LIKE ?)"
    );
    const like = `%${q}%`;
    binds.push(like, like, like);
  }

  const whereSql = where.join(" AND ");
  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM provider_profiles WHERE ${whereSql}`
  )
    .bind(...binds)
    .first();
  const rows = await env.DB.prepare(
    `SELECT * FROM provider_profiles
     WHERE ${whereSql}
     ORDER BY name COLLATE NOCASE, created_at
     LIMIT ? OFFSET ?`
  )
    .bind(...binds, limit, offset)
    .all();

  const providers = [];
  for (const row of rows.results || []) {
    providers.push(await mapPublicProvider(row, env));
  }
  return json({
    providers,
    total: Number(countRow?.n || 0),
    limit,
    offset,
  });
}

/** Publiczny profil po slug — dostępny także gdy ukryty w wyszukiwaniu (link bezpośredni). */
export async function getPublicProviderBySlug(request, env, slug) {
  const normalized = String(slug || "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized.length > 80) return json({ error: "not_found" }, 404);

  const row = await env.DB.prepare(
    `SELECT * FROM provider_profiles
     WHERE lower(slug) = ? AND COALESCE(deactivated, 0) = 0`
  )
    .bind(normalized)
    .first();
  if (!row) return json({ error: "not_found" }, 404);

  const provider = await mapPublicProvider(row, env);
  const serviceRows = await env.DB.prepare(
    "SELECT * FROM provider_services WHERE provider_id=? ORDER BY sort_order, created_at"
  )
    .bind(row.id)
    .all();
  const services = (serviceRows.results || []).map(mapService);
  const availability = await readAvailability(env, row.id);
  return json({ provider, services, availability });
}
