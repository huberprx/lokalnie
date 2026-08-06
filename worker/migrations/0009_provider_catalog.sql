-- Dane potrzebne do wyświetlenia i rezerwacji profilu usługodawcy w katalogu publicznym.
ALTER TABLE provider_profiles ADD COLUMN services_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE provider_profiles ADD COLUMN availability_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE provider_profiles ADD COLUMN locations_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE provider_profiles ADD COLUMN booking_rules_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE provider_profiles ADD COLUMN deactivated INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_provider_profiles_catalog
  ON provider_profiles(visible_in_search, deactivated, category, city);
