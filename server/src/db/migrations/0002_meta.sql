CREATE TABLE meta_stages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL DEFAULT '',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  background_json TEXT NOT NULL DEFAULT '{}',
  characters_json TEXT NOT NULL DEFAULT '[]',
  trigger_json    TEXT NOT NULL DEFAULT '{"type":"wonCount","value":0}'
);

-- OR IGNORE: content:load мог уже залить этот ключ из content/settings.json,
-- и тогда голый INSERT ронял бы старт на UNIQUE constraint.
INSERT OR IGNORE INTO settings (key, value_json) VALUES
  ('final_victory_text', '"ВСЕ ОПЕРАЦИИ ЗАВЕРШЕНЫ. СМЕНА ЗАКРЫТА. СПАСИБО, ОПЕРАТОР."');
