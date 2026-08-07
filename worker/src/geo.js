/** Współrzędne WGS84, Haversine i parametry wyszukiwania po odległości. */

export const SEARCH_RADIUS_KM = Object.freeze([5, 10, 15, 20, 25, 30, 40, 50]);
const EARTH_RADIUS_KM = 6371;
const GEO_CANDIDATE_CAP = 500;

export function isValidLatitude(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

export function parseCoordinate(raw) {
  if (raw == null || raw === "") return { value: null };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { error: "invalid_coordinate" };
  return { value: n };
}

export function parseRadiusKm(raw, fallback = 15) {
  if (raw == null || raw === "") return { value: fallback };
  const n = Number(raw);
  if (!Number.isFinite(n) || !SEARCH_RADIUS_KM.includes(n)) {
    return { error: "invalid_radius" };
  }
  return { value: n };
}

/**
 * Parsuje parametry geo z URL. Brak lat+lng = wyszukiwanie bez odległości.
 * Podanie tylko jednego z lat/lng lub złego radius → błąd.
 */
export function parseGeoSearchParams(url) {
  const latRaw = url.searchParams.get("latitude");
  const lngRaw = url.searchParams.get("longitude");
  const radiusRaw = url.searchParams.get("radiusKm");
  const hasLat = latRaw != null && latRaw !== "";
  const hasLng = lngRaw != null && lngRaw !== "";

  if (!hasLat && !hasLng) {
    if (radiusRaw != null && radiusRaw !== "") {
      const radius = parseRadiusKm(radiusRaw);
      if (radius.error) return { error: radius.error };
    }
    return { value: null };
  }
  if (hasLat !== hasLng) return { error: "incomplete_coordinates" };

  const lat = parseCoordinate(latRaw);
  const lng = parseCoordinate(lngRaw);
  const radius = parseRadiusKm(radiusRaw, 15);
  if (lat.error || lng.error) return { error: "invalid_coordinate" };
  if (!isValidLatitude(lat.value) || !isValidLongitude(lng.value)) {
    return { error: "invalid_coordinate" };
  }
  if (radius.error) return { error: radius.error };
  return {
    value: {
      latitude: lat.value,
      longitude: lng.value,
      radiusKm: radius.value,
    },
  };
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Przybliżony prostokąt wokół punktu (stopnie). */
export function boundingBox(latitude, longitude, radiusKm) {
  const latDelta = radiusKm / 111.32;
  const cosLat = Math.cos((latitude * Math.PI) / 180);
  const lngDelta = radiusKm / (111.32 * Math.max(0.2, Math.abs(cosLat)));
  return {
    minLat: Math.max(-90, latitude - latDelta),
    maxLat: Math.min(90, latitude + latDelta),
    minLng: Math.max(-180, longitude - lngDelta),
    maxLng: Math.min(180, longitude + lngDelta),
  };
}

export function formatDistanceLabel(distanceKm) {
  if (typeof distanceKm !== "number" || !Number.isFinite(distanceKm)) return null;
  const rounded = Math.round(distanceKm * 10) / 10;
  return `${String(rounded).replace(".", ",")} km`;
}

export function roundDistanceKm(distanceKm) {
  if (typeof distanceKm !== "number" || !Number.isFinite(distanceKm)) return null;
  return Math.round(distanceKm * 10) / 10;
}

export { GEO_CANDIDATE_CAP };
