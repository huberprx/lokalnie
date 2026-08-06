-- Jednorazowy state OAuth + PKCE (login i Google Calendar).
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS oauth_states (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL DEFAULT 'login' CHECK (purpose IN ('login', 'calendar')),
  return_to TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  user_id TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_states_used ON oauth_states(used_at);
