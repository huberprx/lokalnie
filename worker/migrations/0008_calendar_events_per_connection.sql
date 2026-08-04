-- A booking can be represented in both the client's and provider's calendars.
CREATE TABLE calendar_events_new (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  external_event_id TEXT NOT NULL,
  external_etag TEXT,
  status TEXT NOT NULL DEFAULT 'synced'
    CHECK (status IN ('synced', 'error', 'cancelled')),
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (connection_id, booking_id),
  UNIQUE (connection_id, external_event_id)
);

INSERT INTO calendar_events_new (
  id, connection_id, booking_id, external_event_id, external_etag, status, last_error, updated_at
)
SELECT id, connection_id, booking_id, external_event_id, external_etag, status, last_error, updated_at
FROM calendar_events;

DROP TABLE calendar_events;
ALTER TABLE calendar_events_new RENAME TO calendar_events;

CREATE INDEX IF NOT EXISTS idx_calendar_events_connection
  ON calendar_events(connection_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_booking
  ON calendar_events(booking_id);
