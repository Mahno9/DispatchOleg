CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  onboarded  INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE game_states (
  user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload           TEXT NOT NULL,
  client_updated_at INTEGER NOT NULL,
  synced_at         INTEGER NOT NULL
);

CREATE TABLE dialogues (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  nodes_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE characters (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  portrait_asset   TEXT,
  meta_dialogue_id INTEGER REFERENCES dialogues(id) ON DELETE SET NULL,
  meta_position    TEXT NOT NULL DEFAULT 'left'
);

CREATE TABLE games (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  title                  TEXT NOT NULL,
  minigame_id            TEXT NOT NULL,
  config_json            TEXT NOT NULL DEFAULT '{}',
  character_id           INTEGER REFERENCES characters(id) ON DELETE SET NULL,
  pre_dialogue_id        INTEGER REFERENCES dialogues(id) ON DELETE SET NULL,
  post_win_dialogue_id   INTEGER REFERENCES dialogues(id) ON DELETE SET NULL,
  post_lose_dialogue_id  INTEGER REFERENCES dialogues(id) ON DELETE SET NULL,
  style_dialogues_json   TEXT NOT NULL DEFAULT '{}',
  required_game_ids_json TEXT NOT NULL DEFAULT '[]',
  sort_order             INTEGER NOT NULL DEFAULT 0,
  is_tutorial            INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE minigame_defaults (
  minigame_id TEXT PRIMARY KEY,
  config_json TEXT NOT NULL DEFAULT '{}',
  updated_at  INTEGER NOT NULL
);

CREATE TABLE assets (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('image','audio','gif')),
  mime          TEXT NOT NULL,
  ext           TEXT NOT NULL,
  original_name TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

INSERT INTO settings (key, value_json) VALUES
  ('ui_click_sound_url', 'null'),
  ('sync_interval_s',    '30');
