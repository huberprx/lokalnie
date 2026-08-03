-- Prośby o termin (tryb approval)

CREATE TABLE IF NOT EXISTS booking_requests (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  client_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL DEFAULT '',
  client_phone TEXT,
  client_email TEXT,
  service_ids_json TEXT NOT NULL DEFAULT '[]',
  service_names_json TEXT NOT NULL DEFAULT '[]',
  days_json TEXT NOT NULL DEFAULT '[]',
  proposals_json TEXT NOT NULL DEFAULT '[]',
  accepted_proposal_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'proposed', 'confirmed', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_requests_provider ON booking_requests(provider_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON booking_requests(status);
