CREATE TABLE IF NOT EXISTS newsroom_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  feed_url TEXT NOT NULL UNIQUE,
  sport TEXT NOT NULL DEFAULT 'General sports',
  priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_fetched_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_newsroom_sources_enabled_priority ON newsroom_sources(enabled, priority);
