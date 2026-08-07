import { json, parseJsonField } from "./http.js";
import { decryptPhone } from "./pii.js";
import { mapService } from "./services.js";
import { readAvailability } from "./provider.js";
import {
  boundingBox,
  formatDistanceLabel,
  GEO_CANDIDATE_CAP,
  haversineKm,
  parseGeoSearchParams,
  roundDistanceKm,
} from "./geo.js";

const MAX_LIST = 50;
const MAX_Q = 80;

async function mapPublicProvider(row, env, { includePrivateContact = false } = {}) {
  if (!row) return null;
  const locations = parseJsonField(row.locations_json, []);
  const socialLinks = parseJsonField(row.social_links_json, []);
  const bookingRules = parseJsonField(row.booking_rules_json, {});
  const emailVisible = !!row.email_visible;
  const phone = await decryptPhone(row.phone, env);
  const mapped = {
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
  if (typeof row._distanceKm === "number" && Number.isFinite(row._distanceKm)) {
    mapped.distanceKm = roundDistanceKm(row._distanceKm);
    mapped.distanceLabel = formatDistanceLabel(row._distanceKm);
    if (row._matchLocation) {
      mapped.location = {
        id: row._matchLocation.id || null,
        label: row._matchLocation.label || null,
        city: row._matchLocation.city || row.city || "",
        address: row._matchLocation.address || row.address || "",
      };
    }
  } else if (row._online) {
    mapped.distanceKm = null;
    mapped.distanceLabel = null;
    mapped.location = { city: row.city || "", address: row.address || "", online: true };
  }
  return mapped;
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

function buildTextFilters(url) {
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

  const where = ["COALESCE(p.deactivated, 0) = 0", "p.visible_in_search = 1"];
  const binds = [];
  if (category) {
    where.push("p.category = ?");
    binds.push(category);
  }
  if (subcategory) {
    where.push("p.subcategory = ?");
    binds.push(subcategory);
  }
  if (city) {
    where.push("lower(COALESCE(p.city, '')) LIKE ?");
    binds.push(`%${city}%`);
  }
  if (q) {
    where.push(
      "(lower(p.name) LIKE ? OR lower(COALESCE(p.city, '')) LIKE ? OR lower(COALESCE(p.about, '')) LIKE ?)"
    );
    const like = `%${q}%`;
    binds.push(like, like, like);
  }
  return { where, binds, q, city, category, subcategory };
}

/** Online = brak adresu ulicznego (samo miasto nie wystarczy do dystansu). */
function isOnlineProvider(profile, locationRows) {
  const hasStreet = !!(profile.address && String(profile.address).trim());
  const locHasStreet = (locationRows || []).some(
    (loc) => loc.address && String(loc.address).trim()
  );
  return !hasStreet && !locHasStreet;
}

function bestDistanceForProvider(locationRows, geo) {
  let best = null;
  let matchLoc = null;
  for (const loc of locationRows || []) {
    if (loc.geocode_status !== "ok") continue;
    if (loc.latitude == null || loc.longitude == null) continue;
    const d = haversineKm(geo.latitude, geo.longitude, Number(loc.latitude), Number(loc.longitude));
    if (!Number.isFinite(d)) continue;
    if (best == null || d < best) {
      best = d;
      matchLoc = loc;
    }
  }
  return { distanceKm: best, matchLoc };
}

/** Publiczna lista usługodawców widocznych w wyszukiwaniu. */
export async function listPublicProviders(request, env, url) {
  const geoParsed = parseGeoSearchParams(url);
  if (geoParsed.error) {
    return json({ error: geoParsed.error }, 400);
  }
  const geo = geoParsed.value;
  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = clampOffset(url.searchParams.get("offset"));
  const { where, binds } = buildTextFilters(url);

  if (!geo) {
    const whereSql = where.join(" AND ");
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM provider_profiles p WHERE ${whereSql}`
    )
      .bind(...binds)
      .first();
    const rows = await env.DB.prepare(
      `SELECT p.* FROM provider_profiles p
       WHERE ${whereSql}
       ORDER BY p.name COLLATE NOCASE, p.created_at
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

  const box = boundingBox(geo.latitude, geo.longitude, geo.radiusKm);
  const whereSql = where.join(" AND ");

  const candidateRows = await env.DB.prepare(
    `SELECT p.*,
            pl.id AS loc_id, pl.label AS loc_label, pl.address AS loc_address,
            pl.city AS loc_city, pl.latitude AS loc_lat, pl.longitude AS loc_lng,
            pl.geocode_status AS loc_status
     FROM provider_profiles p
     LEFT JOIN provider_locations pl ON pl.provider_id = p.id
     WHERE ${whereSql}
       AND (
         (pl.geocode_status = 'ok'
           AND pl.latitude BETWEEN ? AND ?
           AND pl.longitude BETWEEN ? AND ?)
         OR (
           TRIM(COALESCE(p.address, '')) = ''
           AND NOT EXISTS (
             SELECT 1 FROM provider_locations x
             WHERE x.provider_id = p.id AND x.geocode_status = 'ok'
           )
         )
       )
     LIMIT ?`
  )
    .bind(...binds, box.minLat, box.maxLat, box.minLng, box.maxLng, GEO_CANDIDATE_CAP)
    .all();

  const byProvider = new Map();
  for (const row of candidateRows.results || []) {
    let entry = byProvider.get(row.id);
    if (!entry) {
      entry = { profile: row, locations: [] };
      byProvider.set(row.id, entry);
    }
    if (row.loc_id) {
      entry.locations.push({
        id: row.loc_id,
        label: row.loc_label,
        address: row.loc_address,
        city: row.loc_city,
        latitude: row.loc_lat,
        longitude: row.loc_lng,
        geocode_status: row.loc_status,
      });
    }
  }

  const matched = [];
  for (const entry of byProvider.values()) {
    const online = isOnlineProvider(entry.profile, entry.locations);
    if (online) {
      matched.push({
        ...entry.profile,
        _online: true,
        _distanceKm: null,
      });
      continue;
    }
    const { distanceKm, matchLoc } = bestDistanceForProvider(entry.locations, geo);
    if (distanceKm == null || distanceKm > geo.radiusKm) continue;
    matched.push({
      ...entry.profile,
      _distanceKm: distanceKm,
      _matchLocation: matchLoc,
    });
  }

  matched.sort((a, b) => {
    const da = typeof a._distanceKm === "number" ? a._distanceKm : Number.POSITIVE_INFINITY;
    const db = typeof b._distanceKm === "number" ? b._distanceKm : Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return String(a.name || "").localeCompare(String(b.name || ""), "pl");
  });

  const total = matched.length;
  const page = matched.slice(offset, offset + limit);
  const providers = [];
  for (const row of page) {
    providers.push(await mapPublicProvider(row, env));
  }
  return json({
    providers,
    total,
    limit,
    offset,
    search: {
      latitude: geo.latitude,
      longitude: geo.longitude,
      radiusKm: geo.radiusKm,
    },
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
