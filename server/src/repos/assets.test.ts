import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from '../db/migrate.js';
import { assetUsage } from './assets.js';

const URL = '/assets-store/tst123.ogg';
const OTHER = '/assets-store/other.ogg';

function freshDb() {
  const db = new Database(':memory:');
  migrate(db, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations'));
  return db;
}

/** База с ассетом, прописанным во все места сразу, где он может встретиться. */
function seeded() {
  const db = freshDb();
  db.prepare(
    `INSERT INTO assets (id, kind, mime, ext, original_name, size_bytes, created_at)
       VALUES ('tst123', 'audio', 'audio/ogg', 'ogg', 'hit.ogg', 1, 0)`,
  ).run();
  db.prepare('INSERT INTO characters (id, name, portrait_asset) VALUES (7, ?, ?)').run(
    'Генадий',
    URL,
  );
  db.prepare('INSERT INTO games (id, title, minigame_id, config_json) VALUES (3, ?, ?, ?)').run(
    'Мост',
    'bridge',
    // Взвешенные звуки — массив объектов на глубине: обход должен доставать и их.
    JSON.stringify({
      music: OTHER,
      sounds: {
        hit: [
          { url: OTHER, weight: 1 },
          { url: URL, weight: 2 },
        ],
      },
    }),
  );
  db.prepare('INSERT INTO dialogues (id, title, nodes_json) VALUES (9, ?, ?)').run(
    'Кухня · до',
    JSON.stringify({ start: 'n1', music: URL, nodes: { n1: { text: 'а', portrait: URL } } }),
  );
  db.prepare(
    'INSERT INTO meta_stages (id, title, background_json, characters_json) VALUES (4, ?, ?, ?)',
  ).run('Смена принята', JSON.stringify({ image: URL }), JSON.stringify([{ characterId: 7 }]));
  db.prepare('UPDATE settings SET value_json = ? WHERE key = ?').run(
    JSON.stringify(URL),
    'ui_click_sound_url',
  );
  return db;
}

describe('assetUsage', () => {
  it('находит ассет и в конфиге игры, и в портрете персонажа', () => {
    const usage = assetUsage(seeded(), URL);
    expect(usage).toContainEqual({
      kind: 'game',
      id: 3,
      title: 'Мост',
      field: 'конфиг: sounds.hit[1].url',
    });
    expect(usage).toContainEqual({
      kind: 'character',
      id: 7,
      title: 'Генадий',
      field: 'портрет',
    });
  });

  it('доходит до узлов диалога, мета-этапов и настроек', () => {
    const usage = assetUsage(seeded(), URL);
    expect(usage).toContainEqual({
      kind: 'dialogue',
      id: 9,
      title: 'Кухня · до',
      field: 'узлы: music',
    });
    expect(usage).toContainEqual({
      kind: 'dialogue',
      id: 9,
      title: 'Кухня · до',
      field: 'узлы: nodes.n1.portrait',
    });
    expect(usage).toContainEqual({
      kind: 'metaStage',
      id: 4,
      title: 'Смена принята',
      field: 'фон: image',
    });
    expect(usage).toContainEqual({
      kind: 'setting',
      id: 'ui_click_sound_url',
      title: 'ui_click_sound_url',
      field: 'значение',
    });
  });

  it('не путает похожие ссылки и молчит про неиспользуемый ассет', () => {
    expect(assetUsage(seeded(), '/assets-store/nobody.png')).toEqual([]);
    // Подстрока чужого url тоже не совпадение: сверяем строку целиком.
    expect(assetUsage(seeded(), '/assets-store/tst123.og')).toEqual([]);
  });
});
