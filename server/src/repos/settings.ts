import type { Database } from 'better-sqlite3';

export const SETTING_KEYS = ['ui_click_sound_url', 'sync_interval_s'] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];
export type Settings = Record<SettingKey, unknown>;

export function getAllSettings(db: Database): Settings {
  const rows = db.prepare('SELECT key, value_json FROM settings').all() as {
    key: string;
    value_json: string;
  }[];
  const out = {} as Settings;
  for (const row of rows) {
    out[row.key as SettingKey] = JSON.parse(row.value_json);
  }
  return out;
}

export function updateSettings(db: Database, patch: Partial<Settings>): Settings {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
  );
  db.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (!SETTING_KEYS.includes(key as SettingKey)) {
        throw new Error(`unknown setting key: ${key}`);
      }
      upsert.run(key, JSON.stringify(value));
    }
  })();
  return getAllSettings(db);
}
