import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './migrate.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('migrate', () => {
  it('applies all migrations to a fresh db', () => {
    const db = new Database(':memory:');
    const ran = migrate(db, migrationsDir);
    expect(ran).toContain('0001_core.sql');

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'users',
        'game_states',
        'games',
        'characters',
        'dialogues',
        'assets',
        'settings',
        'schema_migrations',
      ]),
    );

    const interval = db
      .prepare("SELECT value_json FROM settings WHERE key = 'sync_interval_s'")
      .get() as { value_json: string };
    expect(JSON.parse(interval.value_json)).toBe(30);
  });

  it('is idempotent on re-run', () => {
    const db = new Database(':memory:');
    migrate(db, migrationsDir);
    const second = migrate(db, migrationsDir);
    expect(second).toEqual([]);
  });

  it('does not choke on settings keys content:load already inserted', () => {
    // Обновление на боевой БД: content:load залил settings.json со свежим
    // ключом, следом приезжает миграция, которая его же и заводит. Голый
    // INSERT ронял бы старт сервера на UNIQUE constraint.
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    // Ключи, которые заводит каждая миграция, — вытаскиваем из её же текста,
    // чтобы проверка не устарела на следующей миграции с настройкой.
    const keysOf = (file: string) =>
      [
        ...fs
          .readFileSync(path.join(migrationsDir, file), 'utf8')
          .matchAll(/INSERT[\s\S]*?INTO settings[\s\S]*?VALUES([\s\S]*?);/gi),
      ].flatMap((m) => [...m[1]!.matchAll(/\('([a-z0-9_]+)'/g)].map((k) => k[1]!));

    // 0001 создаёт саму таблицу — до неё грузить контент некуда, ей конфликт не грозит.
    const seeding = files.filter((f, i) => i > 0 && keysOf(f).length > 0);
    expect(seeding.length).toBeGreaterThan(0);

    for (const file of seeding) {
      const partial = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-partial-'));
      tmpDirs.push(partial);
      for (const f of files.slice(0, files.indexOf(file)))
        fs.copyFileSync(path.join(migrationsDir, f), path.join(partial, f));

      const db = new Database(':memory:');
      migrate(db, partial);
      for (const key of keysOf(file))
        db.prepare('INSERT OR REPLACE INTO settings (key, value_json) VALUES (?, ?)').run(
          key,
          '"из выгрузки"',
        );

      expect(() => migrate(db, migrationsDir), file).not.toThrow();
      for (const key of keysOf(file))
        // Значение из выгрузки миграция не затирает.
        expect(
          db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key),
          `${file}: ${key}`,
        ).toEqual({ value_json: '"из выгрузки"' });
    }
  });
});
