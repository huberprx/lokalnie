import { id, nowIso } from "./http.js";
import { isValidLatitude, isValidLongitude } from "./geo.js";

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const NOMINATIM_URL = "https://nominatim.openstreetmap.org";
const MAX_QUERY = 200;
const SUGGEST_LIMIT = 8;
const PLACE_TYPES = new Set([
  "city",
  "town",
  "village",
  "hamlet",
  "municipality",
  "suburb",
  "neighbourhood",
  "quarter",
  "isolated_dwelling",
  "administrative",
]);

function userAgent(env) {
  return (
    env.GEOCODER_USER_AGENT ||
    "Lokalnie/1.0 (https://lokalnie.app; geocoding for nearby search)"
  );
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizeQuery(text) {
  return String(text || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_QUERY);
}

function titleCasePl(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Usuwa prefiksy typu „powiat” / „województwo” — jak na portalach ogłoszeniowych. */
export function stripAdminPrefix(value) {
  let s = String(value || "").trim();
  const lower = s.toLowerCase();
  const prefixes = ["powiat ", "województwo ", "wojewodztwo ", "gmina "];
  for (const prefix of prefixes) {
    if (lower.startsWith(prefix)) {
      s = s.slice(prefix.length).trim();
      break;
    }
  }
  return titleCasePl(s);
}

function placeNameFromAddress(address, fallbackName) {
  return (
    address.city ||
    address.town ||
    address.village ||
    address.hamlet ||
    address.suburb ||
    address.municipality ||
    fallbackName ||
    address.county ||
    ""
  );
}

/**
 * Mapuje wynik Nominatim do podpowiedzi:
 * - name: miejscowość
 * - subtitle: „Powiatowy, Województwo”
 */
export function mapNominatimHit(hit) {
  if (!hit || hit.lat == null || hit.lon == null) return null;
  const latitude = Number(hit.lat);
  const longitude = Number(hit.lon);
  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) return null;

  const address = hit.address || {};
  const type = String(hit.type || hit.addresstype || "").toLowerCase();
  const name = String(placeNameFromAddress(address, hit.name) || "").trim();
  if (!name) return null;

  const county = stripAdminPrefix(address.county || address.municipality || "");
  const state = stripAdminPrefix(address.state || "");
  const subtitle = [county, state].filter(Boolean).join(", ");
  const city = String(placeNameFromAddress(address, name)).slice(0, 120);
  const label = subtitle ? `${name}, ${subtitle}` : name;

  return {
    latitude,
    longitude,
    name: name.slice(0, 120),
    city,
    county: county.slice(0, 120),
    state: state.slice(0, 120),
    subtitle: subtitle.slice(0, 200),
    label: label.slice(0, 240),
    type,
  };
}

function isUsefulPlaceHit(hit) {
  if (!hit) return false;
  if (!hit.type) return true;
  if (PLACE_TYPES.has(hit.type)) return true;
  // Adresy uliczne też mogą być użyteczne przy dłuższym zapytaniu.
  return hit.type === "house" || hit.type === "residential" || hit.type === "road";
}

function dedupeSuggestions(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = `${item.name}|${item.county}|${item.state}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function toSuggestionDto(hit) {
  return {
    name: hit.name,
    city: hit.city || hit.name,
    county: hit.county || "",
    state: hit.state || "",
    subtitle: hit.subtitle || "",
    label: hit.label || hit.name,
    latitude: hit.latitude,
    longitude: hit.longitude,
  };
}

async function readCache(env, queryHash) {
  const row = await env.DB.prepare(
    `SELECT latitude, longitude, label, city, name, county, state, suggestions_json, expires_at
     FROM geocode_cache WHERE query_hash=?`
  )
    .bind(queryHash)
    .first();
  if (!row) return null;
  if (row.expires_at && Date.parse(row.expires_at) < Date.now()) {
    await env.DB.prepare("DELETE FROM geocode_cache WHERE query_hash=?").bind(queryHash).run();
    return null;
  }
  let suggestions = null;
  if (row.suggestions_json) {
    try {
      const parsed = JSON.parse(row.suggestions_json);
      if (Array.isArray(parsed)) suggestions = parsed;
    } catch {
      suggestions = null;
    }
  }
  if (row.latitude == null || row.longitude == null) {
    if (suggestions && suggestions.length) {
      return { suggestions, source: "cache" };
    }
    return null;
  }
  return {
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    label: row.label || "",
    city: row.city || "",
    name: row.name || row.city || "",
    county: row.county || "",
    state: row.state || "",
    subtitle: [row.county, row.state].filter(Boolean).join(", "),
    suggestions,
    source: "cache",
  };
}

async function writeCache(env, queryHash, queryText, hit, suggestions = null) {
  const expires = new Date(Date.now() + CACHE_TTL_MS).toISOString();
  const first = hit || (suggestions && suggestions[0]) || null;
  await env.DB.prepare(
    `INSERT INTO geocode_cache (
       query_hash, query_text, latitude, longitude, label, city, name, county, state,
       suggestions_json, created_at, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(query_hash) DO UPDATE SET
       latitude=excluded.latitude,
       longitude=excluded.longitude,
       label=excluded.label,
       city=excluded.city,
       name=excluded.name,
       county=excluded.county,
       state=excluded.state,
       suggestions_json=excluded.suggestions_json,
       expires_at=excluded.expires_at`
  )
    .bind(
      queryHash,
      queryText,
      first?.latitude ?? null,
      first?.longitude ?? null,
      first?.label || "",
      first?.city || "",
      first?.name || "",
      first?.county || "",
      first?.state || "",
      suggestions ? JSON.stringify(suggestions) : null,
      nowIso(),
      expires
    )
    .run();
}

async function fetchNominatim(env, query, { limit = 1, featureType = null } = {}) {
  const url = new URL(`${NOMINATIM_URL}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", String(Math.min(SUGGEST_LIMIT, Math.max(1, limit))));
  url.searchParams.set("countrycodes", "pl");
  if (featureType) url.searchParams.set("featureType", featureType);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": userAgent(env),
      },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map(mapNominatimHit).filter(Boolean).filter(isUsefulPlaceHit);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function nominatimSearch(env, query, { limit = 1 } = {}) {
  // Najpierw miejscowości (jak autocomplete na portalach), potem ogólne wyniki.
  const preferSettlements = query.length <= 40 && !/\d/.test(query);
  if (preferSettlements) {
    const settlements = await fetchNominatim(env, query, { limit, featureType: "settlement" });
    if (settlements.length) return settlements;
  }
  return fetchNominatim(env, query, { limit });
}

/** Geokoduje adres; nie loguje współrzędnych. */
export async function geocodeQuery(env, queryText) {
  const query = normalizeQuery(queryText);
  if (query.length < 2) return null;
  const queryHash = await sha256Hex(query.toLowerCase());
  const cached = await readCache(env, queryHash);
  if (cached) return cached;

  const hits = await nominatimSearch(env, query, { limit: 1 });
  const hit = hits[0];
  if (!hit) return null;
  await writeCache(env, queryHash, query, hit);
  return { ...hit, source: "nominatim" };
}

/** Podpowiedzi miejsc dla UI: nazwa + powiat/województwo (jak na portalach ogłoszeniowych). */
export async function suggestPlaces(env, queryText) {
  const query = normalizeQuery(queryText);
  if (query.length < 2) return [];
  const queryHash = await sha256Hex(`suggest:${query.toLowerCase()}`);
  const cached = await readCache(env, queryHash);
  if (cached?.suggestions?.length) {
    return cached.suggestions.map(toSuggestionDto);
  }
  if (cached && cached.latitude != null) {
    return [toSuggestionDto(cached)];
  }

  const hits = dedupeSuggestions(await nominatimSearch(env, query, { limit: SUGGEST_LIMIT }));
  const suggestions = hits.map(toSuggestionDto);
  if (suggestions.length) {
    await writeCache(env, queryHash, query, hits[0], suggestions);
  }
  return suggestions;
}

function buildAddressQuery(location, profileCity) {
  const parts = [location.address, location.city || profileCity].filter(Boolean);
  return normalizeQuery(parts.join(", "));
}

/**
 * Synchronizuje provider_locations z listą z profilu.
 * Zachowuje istniejące współrzędne gdy adres się nie zmienił.
 */
export async function syncProviderLocations(env, providerId, locations, profile = {}) {
  const ts = nowIso();
  const existingRows = await env.DB.prepare(
    "SELECT * FROM provider_locations WHERE provider_id=?"
  )
    .bind(providerId)
    .all();
  const existingById = new Map((existingRows.results || []).map((row) => [row.id, row]));

  const stmts = [
    env.DB.prepare("DELETE FROM provider_locations WHERE provider_id=?").bind(providerId),
  ];

  const list = Array.isArray(locations) ? locations : [];
  if (!list.length) {
    const city = profile.city || null;
    const address = profile.address || null;
    if (city || address) {
      const mainId = `${providerId}-main`;
      const prev = existingById.get(mainId);
      const sameAddress =
        prev &&
        String(prev.address || "") === String(address || "") &&
        String(prev.city || "") === String(city || "");
      stmts.push(
        env.DB.prepare(
          `INSERT INTO provider_locations (
            id, provider_id, label, address, city, latitude, longitude,
            geocode_status, geocode_source, geocoded_at, tone_index, sort_order, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`
        ).bind(
          mainId,
          providerId,
          "Główna",
          address,
          city,
          sameAddress && prev.geocode_status === "ok" ? prev.latitude : null,
          sameAddress && prev.geocode_status === "ok" ? prev.longitude : null,
          sameAddress && prev.geocode_status === "ok" ? "ok" : address || city ? "pending" : "skipped",
          sameAddress ? prev.geocode_source : null,
          sameAddress ? prev.geocoded_at : null,
          prev?.created_at || ts,
          ts
        )
      );
    }
  } else {
    list.forEach((loc, index) => {
      const locId = String(loc.id || id("loc"));
      const prev = existingById.get(locId);
      const address = loc.address || "";
      const city = loc.city || profile.city || "";
      const sameAddress =
        prev &&
        String(prev.address || "") === String(address) &&
        String(prev.city || "") === String(city);

      let latitude = null;
      let longitude = null;
      let geocodeStatus = address || city ? "pending" : "skipped";
      let geocodeSource = null;
      let geocodedAt = null;

      if (
        typeof loc.latitude === "number" &&
        typeof loc.longitude === "number" &&
        isValidLatitude(loc.latitude) &&
        isValidLongitude(loc.longitude)
      ) {
        latitude = loc.latitude;
        longitude = loc.longitude;
        geocodeStatus = "ok";
        geocodeSource = "client";
        geocodedAt = ts;
      } else if (sameAddress && prev?.geocode_status === "ok") {
        latitude = prev.latitude;
        longitude = prev.longitude;
        geocodeStatus = "ok";
        geocodeSource = prev.geocode_source;
        geocodedAt = prev.geocoded_at;
      }

      stmts.push(
        env.DB.prepare(
          `INSERT INTO provider_locations (
            id, provider_id, label, address, city, latitude, longitude,
            geocode_status, geocode_source, geocoded_at, tone_index, sort_order, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          locId,
          providerId,
          loc.label || "Lokalizacja",
          address || null,
          city || null,
          latitude,
          longitude,
          geocodeStatus,
          geocodeSource,
          geocodedAt,
          Number.isInteger(loc.toneIndex) ? loc.toneIndex : index % 6,
          index,
          prev?.created_at || ts,
          ts
        )
      );
    });
  }

  await env.DB.batch(stmts);
}

/** Geokoduje lokalizacje pending dla jednego usługodawcy (async / waitUntil). */
export async function geocodePendingForProvider(env, providerId) {
  const rows = await env.DB.prepare(
    `SELECT * FROM provider_locations
     WHERE provider_id=? AND geocode_status='pending'
     ORDER BY sort_order LIMIT 20`
  )
    .bind(providerId)
    .all();

  for (const row of rows.results || []) {
    const query = buildAddressQuery(row, row.city);
    if (!query) {
      await env.DB.prepare(
        `UPDATE provider_locations
         SET geocode_status='skipped', updated_at=? WHERE id=?`
      )
        .bind(nowIso(), row.id)
        .run();
      continue;
    }
    const hit = await geocodeQuery(env, query);
    if (!hit) {
      await env.DB.prepare(
        `UPDATE provider_locations
         SET geocode_status='failed', geocode_source='nominatim', geocoded_at=?, updated_at=?
         WHERE id=?`
      )
        .bind(nowIso(), nowIso(), row.id)
        .run();
      continue;
    }
    await env.DB.prepare(
      `UPDATE provider_locations
       SET latitude=?, longitude=?, city=COALESCE(NULLIF(city,''), ?),
           geocode_status='ok', geocode_source=?, geocoded_at=?, updated_at=?
       WHERE id=?`
    )
      .bind(
        hit.latitude,
        hit.longitude,
        hit.city || null,
        hit.source || "nominatim",
        nowIso(),
        nowIso(),
        row.id
      )
      .run();
  }
}
