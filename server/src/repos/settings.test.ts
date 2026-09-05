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
