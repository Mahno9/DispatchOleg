// Контент ↔ файлы: выгрузка БД в content/*.json и обратная заливка.
//
// Гит — источник правды для контента, БД — рабочая копия. Загрузка замещающая:
// контентные таблицы чистятся целиком и наполняются строками из файлов с теми же
// id. Слияние двух правок делает гит на уровне текста, а не этот скрипт.
//
// users / game_states / schema_migrations не трогаются никогда — это прогресс
// игроков и служебка, а не контент.
import fs from 'node:fs';
import path from 'node:path';

/**
 * Контентные таблицы в порядке вставки (обратный — для удаления).
 * jsonCols разворачиваются в настоящие объекты, иначе диалог в дифе — одна
 * нечитаемая строка на 4 КБ.
 */
const TABLES = [
  { file: 'assets.json', table: 'assets', key: 'id', jsonCols: [] },
  { file: 'dialogues.json', table: 'dialogues', key: 'id', jsonCols: ['nodes_json'] },
  { file: 'characters.json', table: 'characters', key: 'id', jsonCols: [] },
  {
    file: 'games.json',
    table: 'games',
    key: 'id',
    jsonCols: ['config_json', 'style_dialogues_json', 'required_game_ids_json'],
  },
  {
    file: 'meta-stages.json',
    table: 'meta_stages',
    key: 'id',
    jsonCols: ['background_json', 'characters_json', 'trigger_json'],
  },
  {
    file: 'minigame-defaults.json',
    table: 'minigame_defaults',
    key: 'minigame_id',
    jsonCols: ['config_json'],
  },
  { file: 'settings.json', table: 'settings', key: 'key', jsonCols: ['value_json'] },
];

/** Служебный маркер посева seed-content.mjs — в гит ему не надо. */
const SKIP_SETTINGS = new Set(['seed_content']);

const parse = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return s; // битый JSON выгружаем как есть, чтобы не терять данные
  }
};

/** Детерминированный вывод: иначе каждый dump даёт шум в дифе. */
const write = (file, rows) => fs.writeFileSync(file, JSON.stringify(rows, null, 2) + '\n', 'utf8');
const read = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []);

/**
 * БД → каталог с json-файлами (+ копии ассетов).
 * @param {import('better-sqlite3').Database} db
 * @param {string} dir каталог content/
 * @param {string} [assetsDir] откуда брать файлы ассетов (data/assets)
 * @returns {Record<string, number>} сколько строк выгружено по таблицам
 */
export function dump(db, dir, assetsDir) {
  fs.mkdirSync(dir, { recursive: true });
  const counts = {};

  for (const { file, table, key, jsonCols } of TABLES) {
    let rows = db.prepare(`SELECT * FROM ${table} ORDER BY ${key}`).all();
    if (table === 'settings') rows = rows.filter((r) => !SKIP_SETTINGS.has(r.key));
    for (const row of rows) for (const c of jsonCols) row[c] = parse(row[c]);
    write(path.join(dir, file), rows);
    counts[table] = rows.length;
  }

  // Файлы ассетов — рядом, в content/assets/ (content/avatars/ это исходники посева).
  const outDir = path.join(dir, 'assets');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  let copied = 0;
  for (const a of db.prepare('SELECT id, ext FROM assets').all()) {
    const src = path.join(assetsDir, `${a.id}.${a.ext}`);
    if (!fs.existsSync(src)) {
      console.warn(`! файла ассета нет на диске, пропущен: ${src}`);
      continue;
    }
    fs.copyFileSync(src, path.join(outDir, `${a.id}.${a.ext}`));
    copied += 1;
  }
  counts.assetFiles = copied;
  return counts;
}

/**
 * Каталог с json-файлами → БД. Замещает контент целиком, прогресс не трогает.
 * @param {import('better-sqlite3').Database} db
 * @param {string} dir каталог content/
 * @param {string} [assetsDir] куда класть файлы ассетов (data/assets)
 * @returns {Record<string, number>} сколько строк залито по таблицам
 */
export function load(db, dir, assetsDir) {
  const counts = {};
  const payload = TABLES.map((t) => ({ ...t, rows: read(path.join(dir, t.file)) }));

  db.transaction(() => {
    // Обратный порядок: games ссылаются на characters/dialogues, meta_stages — на characters.
    for (const { table } of [...TABLES].reverse()) db.prepare(`DELETE FROM ${table}`).run();

    for (const { table, rows, jsonCols } of payload) {
      if (rows.length === 0) {
        counts[table] = 0;
        continue;
      }
      // Колонки берём из первой строки: файл писал dump, порядок = порядок колонок таблицы.
      const cols = Object.keys(rows[0]);
      const stmt = db.prepare(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      );
      for (const row of rows)
        stmt.run(cols.map((c) => (jsonCols.includes(c) ? JSON.stringify(row[c]) : row[c])));
      counts[table] = rows.length;
    }
  })();

  // id вставлены явно, sqlite_sequence SQLite поднимает сам — новые записи из
  // админки не столкнутся с загруженными.

  if (assetsDir) {
    fs.mkdirSync(assetsDir, { recursive: true });
    const srcDir = path.join(dir, 'assets');
    let copied = 0;
    for (const a of db.prepare('SELECT id, ext FROM assets').all()) {
      const src = path.join(srcDir, `${a.id}.${a.ext}`);
      if (!fs.existsSync(src)) {
        console.warn(`! нет файла ассета в выгрузке, пропущен: ${src}`);
        continue;
      }
      fs.copyFileSync(src, path.join(assetsDir, `${a.id}.${a.ext}`));
      copied += 1;
    }
    counts.assetFiles = copied;
  }
  return counts;
}

/** Общие для CLI-обёрток пути. */
export function resolvePaths(root) {
  const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(root, 'data'));
  return {
    dataDir,
    dbFile: path.join(dataDir, 'app.sqlite'),
    assetsDir: path.join(dataDir, 'assets'),
    contentDir: path.join(root, 'content'),
  };
}

export const summary = (counts) =>
  Object.entries(counts)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
