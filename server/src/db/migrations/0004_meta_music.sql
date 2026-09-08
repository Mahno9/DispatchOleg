-- Фоновая музыка лобби (мета/скан/запуск). null — тишины, как было.
-- OR IGNORE: ключ мог приехать из content/settings.json раньше миграции.
INSERT OR IGNORE INTO settings (key, value_json) VALUES
  ('meta_music_url', 'null');
