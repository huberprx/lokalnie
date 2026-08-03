CREATE TABLE IF NOT EXISTS calendar_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google')),
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  encrypted_access_token TEXT,
  encrypted_refresh_token TEXT NOT NULL,
  token_expires_at TEXT,
  scopes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'error', 'revoked')),
  last_error TEXT,
  connected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_calendar_connections_user
  ON calendar_connections(user_id);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  external_event_id TEXT NOT NULL,
  external_etag TEXT,
  status TEXT NOT NULL DEFAULT 'synced'
    CHECK (status IN ('synced', 'error', 'cancelled')),
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (connection_id, external_event_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_connection
  ON calendar_events(connection_id);
