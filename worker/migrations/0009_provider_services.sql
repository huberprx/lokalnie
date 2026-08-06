-- Trwały katalog usług usługodawcy.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS provider_services (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  booking_mode TEXT NOT NULL DEFAULT 'auto'
    CHECK (booking_mode IN ('auto', 'queue', 'approval', 'request')),
  duration_min INTEGER NOT NULL CHECK (duration_min BETWEEN 5 AND 1440),
  price_cents INTEGER CHECK (price_cents IS NULL OR price_cents BETWEEN 0 AND 1000000000),
  photo_ids_json TEXT NOT NULL DEFAULT '[]',
  location_ids_json TEXT NOT NULL DEFAULT '[]',
  variants_json TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_provider_services_provider_order
  ON provider_services(provider_id, sort_order, created_at);
