-- Dual-slot booking reschedule: current slot stays binding while proposed_* is pending.

ALTER TABLE bookings ADD COLUMN proposed_date_iso TEXT;
ALTER TABLE bookings ADD COLUMN proposed_time_from TEXT;
ALTER TABLE bookings ADD COLUMN proposed_time_to TEXT;
ALTER TABLE bookings ADD COLUMN proposed_location_label TEXT;
ALTER TABLE bookings ADD COLUMN reschedule_expires_at TEXT;
ALTER TABLE bookings ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_bookings_propose_expiry ON bookings(status, reschedule_expires_at);
CREATE INDEX IF NOT EXISTS idx_bookings_proposed_date ON bookings(proposed_date_iso);
