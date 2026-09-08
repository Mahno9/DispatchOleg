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

describe('settings repo', () => {
  it('returns seeded defaults', () => {
    const s = getAllSettings(freshDb());
    expect(s.sync_interval_s).toBe(30);
    expect(s.ui_click_sound_url).toBeNull();
    expect(s.meta_music_url).toBeNull();
  });

  it('applies a partial update', () => {
    const db = freshDb();
    const s = updateSettings(db, { ui_click_sound_url: '/assets-store/x.ogg' });
    expect(s.ui_click_sound_url).toBe('/assets-store/x.ogg');
    expect(s.sync_interval_s).toBe(30);
  });

  it('accepts the lobby music key and clears it back to null', () => {
    const db = freshDb();
    expect(updateSettings(db, { meta_music_url: '/assets-store/mus.ogg' }).meta_music_url).toBe(
      '/assets-store/mus.ogg',
    );
    expect(updateSettings(db, { meta_music_url: null }).meta_music_url).toBeNull();
    // Соседний ключ не задет — патч частичный.
    expect(getAllSettings(db).ui_click_sound_url).toBeNull();
  });

  it('rejects unknown keys atomically', () => {
    const db = freshDb();
    expect(() => updateSettings(db, { sync_interval_s: 10, nope: 1 })).toThrow(/unknown setting/);
    expect(getAllSettings(db).sync_interval_s).toBe(30);
  });
});

describe('settings validation', () => {
  it('отвергает интервал синхронизации вне границ — это шторм запросов', () => {
    const db = freshDb();
    for (const bad of [0, 4, 86401, -1, 30.5, '30', null]) {
      expect(() => updateSettings(db, { sync_interval_s: bad }), String(bad)).toThrow(
        /invalid value for sync_interval_s/,
      );
    }
    // Отказ атомарный: прежнее значение на месте.
    expect(getAllSettings(db).sync_interval_s).toBe(30);
  });

  it('пропускает интервал ровно по границам', () => {
    const db = freshDb();
    expect(updateSettings(db, { sync_interval_s: 5 }).sync_interval_s).toBe(5);
    expect(updateSettings(db, { sync_interval_s: 86400 }).sync_interval_s).toBe(86400);
  });

  it('проверяет тип остальных ключей', () => {
    const db = freshDb();
    expect(() => updateSettings(db, { meta_music_url: 42 })).toThrow(/invalid value/);
    expect(() => updateSettings(db, { final_victory_text: 42 })).toThrow(/invalid value/);
    expect(() => updateSettings(db, { character_voices: [] })).toThrow(/invalid value/);
    expect(() => updateSettings(db, { ui_click_sound_url: [{ weight: 1 }] })).toThrow(
      /invalid value/,
    );
    expect(
      updateSettings(db, { character_voices: { oleg: { hz: 210 } } }).character_voices,
    ).toEqual({ oleg: { hz: 210 } });
  });

  // То, что админка шлёт на самом деле: пустые поля приходят как null, а щелчок
  // со вкладки «Ассеты» — взвешенным списком. Ужесточение не должно это ломать.
  it('пропускает то, чем пользуется админка: null в пустых полях и взвешенный щелчок', () => {
    const db = freshDb();
    const s = updateSettings(db, {
      final_victory_text: null,
      character_voices: null,
      meta_music_url: null,
      ui_click_sound_url: [
        { url: '/assets-store/a.ogg', weight: 2, volume: 80 },
        { url: '/assets-store/b.ogg', weight: 1 },
      ],
    });
    expect(s.final_victory_text).toBeNull();
    expect(s.character_voices).toBeNull();
    expect(s.ui_click_sound_url).toHaveLength(2);
  });

  it('не пишет валидные ключи из патча, если хоть один невалиден', () => {
    const db = freshDb();
    expect(() => updateSettings(db, { final_victory_text: 'победа', sync_interval_s: 0 })).toThrow(
      /invalid value/,
    );
    expect(getAllSettings(db).final_victory_text).not.toBe('победа');
  });
});
