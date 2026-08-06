-- Ustawienia profilu i trwała dostępność usługodawcy.
PRAGMA foreign_keys = ON;

-- Kolumny są nullable, aby ALTER TABLE nie wymagał przepisywania istniejących
-- wierszy ani stałych wartości domyślnych. API mapuje NULL na bezpieczne wartości.
ALTER TABLE provider_profiles ADD COLUMN locations_json TEXT;
ALTER TABLE provider_profiles ADD COLUMN social_links_json TEXT;
ALTER TABLE provider_profiles ADD COLUMN booking_rules_json TEXT;
ALTER TABLE provider_profiles ADD COLUMN deactivated INTEGER
  CHECK (deactivated IS NULL OR deactivated IN (0, 1));

CREATE TABLE IF NOT EXISTS provider_availability (
  provider_id TEXT NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  date_iso TEXT NOT NULL,
  block_index INTEGER NOT NULL CHECK (block_index BETWEEN 0 AND 2),
  time_from TEXT NOT NULL,
  time_to TEXT NOT NULL,
  location_id TEXT,
  repeat TEXT NOT NULL CHECK (repeat IN ('none', 'weekly', 'biweekly')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (provider_id, date_iso, block_index),
  CHECK (
    date_iso GLOB
      '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  CHECK (
    time_from GLOB '[0-2][0-9]:[0-5][0-9]'
    AND time_to GLOB '[0-2][0-9]:[0-5][0-9]'
    AND substr(time_from, 1, 2) BETWEEN '00' AND '23'
    AND substr(time_to, 1, 2) BETWEEN '00' AND '23'
    AND time_from < time_to
  ),
  CHECK (location_id IS NULL OR length(location_id) BETWEEN 1 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_provider_availability_provider_date
  ON provider_availability(provider_id, date_iso);
CREATE INDEX IF NOT EXISTS idx_provider_availability_location
  ON provider_availability(provider_id, location_id);
