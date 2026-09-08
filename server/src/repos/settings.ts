import type { Database } from 'better-sqlite3';

export const SETTING_KEYS = [
  'ui_click_sound_url',
  'meta_music_url',
  'sync_interval_s',
  'final_victory_text',
  // Пресеты бубнежа персонажей, { [speakerId]: preset }.
  'character_voices',
] as const;

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

// Интервал синхронизации плеер читает из этой настройки, поэтому 0 или строка
// вместо числа — это шторм запросов от всех клиентов сразу. Верх — сутки: выше
// настройка означала бы «не синхронизировать», а это делается не так.
const SYNC_INTERVAL_MIN_S = 5;
const SYNC_INTERVAL_MAX_S = 86400;

const isPlainObject = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Проверка значения: null — всё в порядке, строка — текст ошибки для админки. */
const VALIDATORS: Record<SettingKey, (v: unknown) => string | null> = {
  sync_interval_s: (v) =>
    Number.isInteger(v) &&
    (v as number) >= SYNC_INTERVAL_MIN_S &&
    (v as number) <= SYNC_INTERVAL_MAX_S
      ? null
      : `must be an integer between ${SYNC_INTERVAL_MIN_S} and ${SYNC_INTERVAL_MAX_S} seconds`,
  // Щелчок — один ассет либо взвешенный список [{ url, weight }] со вкладки
  // «Ассеты»; null — тишина. Сам url проверяет уже check-content.
  ui_click_sound_url: (v) =>
    v === null ||
    typeof v === 'string' ||
    (Array.isArray(v) && v.every((item) => isPlainObject(item) && typeof item.url === 'string'))
      ? null
      : 'must be a url string, a list of { url, weight }, or null',
  meta_music_url: (v) => (v === null || typeof v === 'string' ? null : 'must be a string or null'),
  // null — «текста нет»: админка так и шлёт пустое поле.
  final_victory_text: (v) =>
    v === null || typeof v === 'string' ? null : 'must be a string or null',
  character_voices: (v) =>
    v === null || isPlainObject(v) ? null : 'must be an object { [speakerId]: preset } or null',
};

export function updateSettings(db: Database, patch: Partial<Settings>): Settings {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
  );
  db.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (!SETTING_KEYS.includes(key as SettingKey)) {
        throw new Error(`unknown setting key: ${key}`);
      }
      const problem = VALIDATORS[key as SettingKey](value);
      if (problem) {
        throw new Error(`invalid value for ${key}: ${problem}`);
      }
      upsert.run(key, JSON.stringify(value));
    }
  })();
  return getAllSettings(db);
}
