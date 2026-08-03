-- Security hardening: verified OAuth email, media visibility, and D1 rate limits.
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;

ALTER TABLE media ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS rate_limits (
  scope TEXT PRIMARY KEY,
  window_started INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at);
