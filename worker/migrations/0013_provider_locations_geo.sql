-- Lokalizacje usługodawców ze współrzędnymi WGS84 + cache geokodowania.
-- locations_json w provider_profiles pozostaje źródłem UI; ta tabela służy wyszukiwaniu geo.

CREATE TABLE IF NOT EXISTS provider_locations (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  address TEXT,
  city TEXT,
  latitude REAL,
  longitude REAL,
  geocode_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (geocode_status IN ('pending', 'ok', 'failed', 'skipped')),
  geocode_source TEXT,
  geocoded_at TEXT,
  tone_index INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
  CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180))
);

CREATE INDEX IF NOT EXISTS idx_provider_locations_provider
  ON provider_locations(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_locations_lat_lng
  ON provider_locations(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_provider_locations_status
  ON provider_locations(geocode_status);

CREATE TABLE IF NOT EXISTS geocode_cache (
  query_hash TEXT PRIMARY KEY,
  query_text TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  label TEXT,
  city TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_geocode_cache_expires ON geocode_cache(expires_at);

-- Migracja: lokalizacje z locations_json (bez współrzędnych → pending).
INSERT OR IGNORE INTO provider_locations (
  id, provider_id, label, address, city, geocode_status, sort_order, tone_index, created_at, updated_at
)
SELECT
  json_extract(j.value, '$.id'),
  p.id,
  COALESCE(NULLIF(json_extract(j.value, '$.label'), ''), 'Lokalizacja'),
  NULLIF(json_extract(j.value, '$.address'), ''),
  p.city,
  'pending',
  j.key,
  COALESCE(json_extract(j.value, '$.toneIndex'), 0),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM provider_profiles p,
  json_each(COALESCE(p.locations_json, '[]')) j
WHERE json_extract(j.value, '$.id') IS NOT NULL
  AND length(json_extract(j.value, '$.id')) BETWEEN 1 AND 100;

-- Profil z adresem ulicznym bez locations_json → lokalizacja do geokodowania.
-- Samo miasto bez ulicy traktujemy jako online (skipped) — nie geokodujemy centrum miasta.
INSERT OR IGNORE INTO provider_locations (
  id, provider_id, label, address, city, geocode_status, sort_order, tone_index, created_at, updated_at
)
SELECT
  p.id || '-main',
  p.id,
  'Główna',
  p.address,
  p.city,
  CASE
    WHEN TRIM(COALESCE(p.address, '')) = '' THEN 'skipped'
    ELSE 'pending'
  END,
  0,
  0,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM provider_profiles p
WHERE NOT EXISTS (SELECT 1 FROM provider_locations pl WHERE pl.provider_id = p.id)
  AND TRIM(COALESCE(p.address, '')) != '';

-- Znane współrzędne demo (Warszawa) — bez zewnętrznego geokodera.
UPDATE provider_locations
SET
  latitude = 52.2297,
  longitude = 21.0122,
  geocode_status = 'ok',
  geocode_source = 'seed',
  geocoded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE geocode_status = 'pending'
  AND (
    lower(COALESCE(address, '')) LIKE '%marszałkowska 12%'
    OR lower(COALESCE(address, '')) LIKE '%marszalkowska 12%'
  );

UPDATE provider_locations
SET
  latitude = 52.2319,
  longitude = 21.0194,
  geocode_status = 'ok',
  geocode_source = 'seed',
  geocoded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE geocode_status = 'pending'
  AND (
    lower(COALESCE(address, '')) LIKE '%nowy świat 24%'
    OR lower(COALESCE(address, '')) LIKE '%nowy swiat 24%'
  );

UPDATE provider_locations
SET
  latitude = 52.2002,
  longitude = 21.0235,
  geocode_status = 'ok',
  geocode_source = 'seed',
  geocoded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE geocode_status = 'pending'
  AND lower(COALESCE(address, '')) LIKE '%puławska 100%';

UPDATE provider_locations
SET
  latitude = 52.1875,
  longitude = 21.0045,
  geocode_status = 'ok',
  geocode_source = 'seed',
  geocoded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE geocode_status = 'pending'
  AND lower(COALESCE(address, '')) LIKE '%wołoska 60%';

UPDATE provider_locations
SET
  latitude = 52.2198,
  longitude = 21.0172,
  geocode_status = 'ok',
  geocode_source = 'seed',
  geocoded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE geocode_status = 'pending'
  AND lower(COALESCE(address, '')) LIKE '%mokotowska 15%';

UPDATE provider_locations
SET
  latitude = 52.2135,
  longitude = 20.9812,
  geocode_status = 'ok',
  geocode_source = 'seed',
  geocoded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE geocode_status = 'pending'
  AND lower(COALESCE(address, '')) LIKE '%grójecka 5%';
