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

-- Built-in feeds removed or edited from the Sources page.
CREATE TABLE IF NOT EXISTS newsroom_source_overrides (
  feed_url TEXT PRIMARY KEY,
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS newsroom_source_edits (
  feed_url TEXT PRIMARY KEY,
  name TEXT,
  override_feed_url TEXT,
  sport TEXT,
  updated_at TEXT NOT NULL
);

-- Saved stories keep a copy of the story so they survive after the RSS feed drops it.
CREATE TABLE IF NOT EXISTS newsroom_saved_stories (
  id TEXT PRIMARY KEY,
  story_json TEXT NOT NULL,
  saved_at TEXT NOT NULL
);

-- Short links created from the Share page and served by the link Worker (link.falsewinger.com).
CREATE TABLE IF NOT EXISTS newsroom_links (
  code TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  created_at TEXT NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  last_clicked_at TEXT
);
