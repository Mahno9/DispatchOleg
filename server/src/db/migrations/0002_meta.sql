CREATE TABLE meta_stages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL DEFAULT '',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  background_json TEXT NOT NULL DEFAULT '{}',
  characters_json TEXT NOT NULL DEFAULT '[]',
  trigger_json    TEXT NOT NULL DEFAULT '{"type":"wonCount","value":0}'
);

INSERT INTO settings (key, value_json) VALUES
  ('final_victory_text', '"ВСЕ ОПЕРАЦИИ ЗАВЕРШЕНЫ. СМЕНА ЗАКРЫТА. СПАСИБО, ОПЕРАТОР."');
