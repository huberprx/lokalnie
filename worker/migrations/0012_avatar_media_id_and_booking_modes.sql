-- avatar_key trzyma media.id (nie storage_key R2).
-- booking_mode profilu: auto | queue | approval | request (jak usługi).
PRAGMA foreign_keys = OFF;

UPDATE users
SET avatar_key = (
  SELECT m.id FROM media m WHERE m.storage_key = users.avatar_key LIMIT 1
)
WHERE avatar_key IS NOT NULL
  AND instr(avatar_key, '/') > 0
  AND EXISTS (SELECT 1 FROM media m WHERE m.storage_key = users.avatar_key);

UPDATE provider_profiles
SET avatar_key = (
  SELECT m.id FROM media m WHERE m.storage_key = provider_profiles.avatar_key LIMIT 1
)
WHERE avatar_key IS NOT NULL
  AND instr(avatar_key, '/') > 0
  AND EXISTS (SELECT 1 FROM media m WHERE m.storage_key = provider_profiles.avatar_key);

CREATE TABLE provider_profiles__new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  subcategory TEXT,
  city TEXT,
  address TEXT,
  about TEXT,
  email TEXT,
  email_visible INTEGER NOT NULL DEFAULT 0,
  phone TEXT,
  booking_mode TEXT NOT NULL DEFAULT 'auto'
    CHECK (booking_mode IN ('auto', 'queue', 'approval', 'request')),
  visible_in_search INTEGER NOT NULL DEFAULT 1,
  multi_select INTEGER NOT NULL DEFAULT 1,
  avatar_key TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  locations_json TEXT,
  social_links_json TEXT,
  booking_rules_json TEXT,
  deactivated INTEGER CHECK (deactivated IS NULL OR deactivated IN (0, 1))
);

INSERT INTO provider_profiles__new (
  id, user_id, slug, name, category, subcategory, city, address, about,
  email, email_visible, phone, booking_mode, visible_in_search, multi_select,
  avatar_key, created_at, updated_at, locations_json, social_links_json,
  booking_rules_json, deactivated
)
SELECT
  id, user_id, slug, name, category, subcategory, city, address, about,
  email, email_visible, phone, booking_mode, visible_in_search, multi_select,
  avatar_key, created_at, updated_at, locations_json, social_links_json,
  booking_rules_json, deactivated
FROM provider_profiles;

DROP TABLE provider_profiles;
ALTER TABLE provider_profiles__new RENAME TO provider_profiles;

PRAGMA foreign_keys = ON;
