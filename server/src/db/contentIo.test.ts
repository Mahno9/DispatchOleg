import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './migrate.js';
// @ts-expect-error — скрипты вне tsconfig сервера, типов у .mjs нет.
import { dump, load } from '../../../scripts/content-io.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmpDirs: string[] = [];

function freshDb() {
  const db = new Database(':memory:');
  migrate(db, path.join(here, 'migrations'));
  db.pragma('foreign_keys = ON');
  return db;
}

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-io-'));
  tmpDirs.push(dir);
  return dir;
}

/** Слепок контентных таблиц для сравнения «до/после». */
function snapshot(db: Database.Database) {
  const out: Record<string, unknown[]> = {};
  for (const t of [
    'dialogues',
    'characters',
    'games',
    'meta_stages',
    'minigame_defaults',
    'settings',
    'assets',
  ])
    // Сортировка по содержимому: порядок rowid после заливки другой, данные — те же.
    out[t] = db
      .prepare(`SELECT * FROM ${t}`)
      .all()
      .map((r) => JSON.stringify(r))
      .sort();
  // seed_content — служебный маркер посева, в выгрузку он не попадает.
  out.settings = (out.settings as string[]).filter((r) => !r.includes('"seed_content"'));
  return out;
}

function seed(db: Database.Database) {
  db.prepare('INSERT INTO dialogues (id, title, nodes_json) VALUES (?, ?, ?)').run(
    1,
    'Встреча',
    JSON.stringify({
      start: 'a',
      nodes: { a: { speaker: 'oleg', text: 'Привет', next: 'b' }, b: { text: 'Пока' } },
    }),
  );
  db.prepare('INSERT INTO dialogues (id, title, nodes_json) VALUES (?, ?, ?)').run(
    2,
    'Победа',
    JSON.stringify({ start: 'a', nodes: { a: { text: 'Смена закрыта' } } }),
  );
  db.prepare(
    'INSERT INTO characters (id, name, portrait_asset, meta_dialogue_id, meta_position) VALUES (?, ?, ?, ?, ?)',
  ).run(1, 'Гранит', '/assets-store/hero.svg', 1, 'right');
  db.prepare(
    `INSERT INTO games (id, title, minigame_id, config_json, character_id, pre_dialogue_id,
       post_win_dialogue_id, style_dialogues_json, required_game_ids_json, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(7, 'Смена', 'task-sort', JSON.stringify({ rounds: 3 }), 1, 1, 2, '{}', '[]', 5);
  db.prepare(
    'INSERT INTO meta_stages (id, title, sort_order, background_json, characters_json, trigger_json) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    1,
    'Двор',
    0,
    JSON.stringify({ color: '#111' }),
    JSON.stringify([{ characterId: 1, x: 20, y: 50, scale: 1 }]),
    JSON.stringify({ type: 'games', ids: [7] }),
  );
  db.prepare(
    'INSERT INTO minigame_defaults (minigame_id, config_json, updated_at) VALUES (?, ?, ?)',
  ).run('task-sort', JSON.stringify({ rounds: 2 }), 1700000000);
  db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?)').run('greeting', '"привет"');
  db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?)').run(
    'seed_content',
    JSON.stringify({ games: [7] }),
  );
  db.prepare(
    `INSERT INTO assets (id, kind, mime, ext, original_name, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('hero', 'image', 'image/svg+xml', 'svg', 'hero.svg', 42, 1700000000);
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('content dump/load', () => {
  it('round-trips content through files', () => {
    const src = freshDb();
    seed(src);
    const assetsSrc = tmpDir();
    fs.writeFileSync(path.join(assetsSrc, 'hero.svg'), '<svg/>');

    const contentDir = tmpDir();
    dump(src, contentDir, assetsSrc);

    // JSON-колонки лежат в файлах разложенными, а не экранированной строкой.
    const dialogues = JSON.parse(fs.readFileSync(path.join(contentDir, 'dialogues.json'), 'utf8'));
    expect(dialogues[0].nodes_json.nodes.a.text).toBe('Привет');

    const dst = freshDb();
    const assetsDst = tmpDir();
    load(dst, contentDir, assetsDst);

    expect(snapshot(dst)).toEqual(snapshot(src));
    expect(fs.readFileSync(path.join(assetsDst, 'hero.svg'), 'utf8')).toBe('<svg/>');
  });

  it('is deterministic: dumping twice gives identical files', () => {
    const db = freshDb();
    seed(db);
    const a = tmpDir();
    const b = tmpDir();
    dump(db, a, tmpDir());
    dump(db, b, tmpDir());
    for (const f of fs.readdirSync(a).filter((f) => f.endsWith('.json')))
      expect(fs.readFileSync(path.join(a, f), 'utf8')).toBe(
        fs.readFileSync(path.join(b, f), 'utf8'),
      );
  });

  it('leaves player progress alone', () => {
    const src = freshDb();
    seed(src);
    const contentDir = tmpDir();
    dump(src, contentDir, tmpDir());

    const dst = freshDb();
    dst
      .prepare('INSERT INTO users (id, name, onboarded, created_at) VALUES (?, ?, ?, ?)')
      .run('u1', 'Игрок', 1, 1700000000);
    dst
      .prepare(
        'INSERT INTO game_states (user_id, payload, client_updated_at, synced_at) VALUES (?, ?, ?, ?)',
      )
      .run('u1', '{"won":["7"]}', 1, 2);

    load(dst, contentDir, tmpDir());

    expect(dst.prepare('SELECT * FROM users').all()).toHaveLength(1);
    expect(dst.prepare('SELECT payload FROM game_states').get()).toEqual({
      payload: '{"won":["7"]}',
    });
  });

  it('new admin rows do not collide with loaded ids', () => {
    const src = freshDb();
    seed(src);
    const contentDir = tmpDir();
    dump(src, contentDir, tmpDir());

    const dst = freshDb();
    load(dst, contentDir, tmpDir());
    const id = dst
      .prepare('INSERT INTO dialogues (title, nodes_json) VALUES (?, ?)')
      .run('Новый', '{}').lastInsertRowid;

    expect(Number(id)).toBeGreaterThan(2);
  });
});
