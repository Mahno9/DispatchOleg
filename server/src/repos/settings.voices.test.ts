import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from '../db/migrate.js';
import { getAllSettings, updateSettings } from './settings.js';

function freshDb() {
  const db = new Database(':memory:');
  migrate(db, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations'));
  return db;
}

describe('settings repo — character_voices', () => {
  it('на свежей БД значение отсутствует', () => {
    const s = getAllSettings(freshDb());
    expect(s.character_voices).toBeUndefined();
  });

  it('принимает и возвращает объект пресетов бубнежа round-trip', () => {
    const db = freshDb();
    const preset = {
      oleg: { source: 'osc', wave: 'triangle', hz: 210, charMs: 30, blipMs: 50 },
      '58': { source: 'osc', wave: 'square', hz: 140, charMs: 25, blipMs: 40 },
    };
    const s = updateSettings(db, { character_voices: preset });
    expect(s.character_voices).toEqual(preset);
    expect(getAllSettings(db).character_voices).toEqual(preset);
  });

  it('частичный патч соседнего ключа не сносит character_voices', () => {
    const db = freshDb();
    const preset = { oleg: { source: 'osc', wave: 'sine', hz: 200, charMs: 30, blipMs: 50 } };
    updateSettings(db, { character_voices: preset });
    updateSettings(db, { sync_interval_s: 10 });
    expect(getAllSettings(db).character_voices).toEqual(preset);
  });
});
