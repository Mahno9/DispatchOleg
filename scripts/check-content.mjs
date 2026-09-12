// Проверка контента: битые ссылки в диалогах и в проводке игр/меты.
// Ловит то, что плеер молча проглатывает (docs: сломанный диалог просто пропускается).
//   node scripts/check-content.mjs            # рабочая БД data/app.sqlite
//   node scripts/check-content.mjs --content  # то, что лежит в гите: content/*.json
//
// Режим --content нужен потому, что источник правды для репозитория — не БД, а
// выгрузка: расхождение «в assets.json есть запись, а файла в content/assets/
// нет» в БД не видно вообще, а content:load запускает проверку уже после заливки.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(root, 'data'));
const contentDir = path.resolve(process.env.CONTENT_DIR ?? path.join(root, 'content'));
const useContent = process.argv.includes('--content');

const errors = [];
const bad = (msg) => errors.push(msg);

// ---- источник строк: БД либо выгрузка ---------------------------------------
// Наружу оба отдают одинаковые строки: json-колонки — строками, как в SQLite,
// чтобы проверки ниже были одни на оба режима.
const JSON_COLS = {
  dialogues: ['nodes_json'],
  games: ['config_json', 'style_dialogues_json', 'required_game_ids_json'],
  meta_stages: ['background_json', 'characters_json', 'trigger_json'],
  settings: ['value_json'],
};
// Имена как их пишет content-dump: диалоги — каталог «файл на строку».
const CONTENT_FILES = {
  assets: 'assets.json',
  dialogues: 'dialogues',
  characters: 'characters.json',
  games: 'games.json',
  meta_stages: 'meta-stages.json',
  settings: 'settings.json',
};

function contentRows(table) {
  const target = path.join(contentDir, CONTENT_FILES[table]);
  if (!fs.existsSync(target)) return [];
  const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
  const list = fs.statSync(target).isDirectory()
    ? fs
        .readdirSync(target)
        .filter((f) => f.endsWith('.json'))
        .map((f) => readJson(path.join(target, f)))
    : readJson(target);
  for (const row of list) for (const c of JSON_COLS[table] ?? []) row[c] = JSON.stringify(row[c]);
  return list;
}

let rows;
if (useContent) {
  rows = contentRows;
} else {
  const db = new Database(path.join(dataDir, 'app.sqlite'), { readonly: true });
  rows = (table) => db.prepare(`SELECT * FROM ${table}`).all();
}
console.log(`проверяю ${useContent ? contentDir : path.join(dataDir, 'app.sqlite')}`);

const characterIds = new Set(rows('characters').map((r) => r.id));
const dialogueIds = new Set(rows('dialogues').map((r) => r.id));
const gameIds = new Set(rows('games').map((r) => r.id));
const assetRows = rows('assets');
const assetUrls = new Set(assetRows.map((r) => `/assets-store/${r.id}.${r.ext}`));

// ---- диалоги: старт на месте, все переходы ведут в существующий узел --------
for (const row of rows('dialogues')) {
  const where = `диалог #${row.id} «${row.title}»`;
  let doc;
  try {
    doc = JSON.parse(row.nodes_json);
  } catch {
    bad(`${where}: nodes_json не парсится`);
    continue;
  }
  // Фоновая петля сцены — только зарегистрированный ассет: в плеере битый src
  // молча не играет, и заметить это можно лишь на устройстве.
  if (typeof doc?.music === 'string' && !assetUrls.has(doc.music))
    bad(`${where}: фоновая музыка ${doc.music} не зарегистрирована в ассетах`);
  const nodes = doc?.nodes;
  if (!nodes || typeof nodes !== 'object') {
    bad(`${where}: нет объекта nodes`);
    continue;
  }
  if (!nodes[doc.start]) bad(`${where}: start «${doc.start}» не найден среди узлов`);
  for (const [id, n] of Object.entries(nodes)) {
    if (typeof n?.text !== 'string') bad(`${where}: узел ${id} без текста — плеер его пропустит`);
    if (n?.speaker && n.speaker !== 'oleg' && !characterIds.has(Number(n.speaker)))
      bad(`${where}: узел ${id} говорит от лица несуществующего персонажа ${n.speaker}`);
    if (typeof n?.next === 'string' && !nodes[n.next])
      bad(`${where}: узел ${id} → next «${n.next}» не существует`);
    for (const c of n?.choices ?? [])
      if (!nodes[c.next]) bad(`${where}: узел ${id} → выбор «${c.text}» ведёт в «${c.next}»`);
  }
}

// ---- игры: персонаж, диалоги, предусловия ----------------------------------
for (const g of rows('games')) {
  const where = `игра #${g.id} «${g.title}»`;
  if (g.character_id !== null && !characterIds.has(g.character_id))
    bad(`${where}: character_id ${g.character_id} не существует`);
  for (const col of ['pre_dialogue_id', 'post_win_dialogue_id', 'post_lose_dialogue_id'])
    if (g[col] !== null && !dialogueIds.has(g[col]))
      bad(`${where}: ${col} ${g[col]} не существует`);
  for (const [tag, id] of Object.entries(JSON.parse(g.style_dialogues_json)))
    if (!dialogueIds.has(id)) bad(`${where}: стилевой диалог «${tag}» → ${id} не существует`);
  for (const id of JSON.parse(g.required_game_ids_json)) {
    if (!gameIds.has(id)) bad(`${where}: requiredGameIds ссылается на несуществующую игру ${id}`);
    if (id === g.id) bad(`${where}: игра требует саму себя — навсегда заблокирована`);
  }
}

// ---- финал смены: ровно один, ни от кого не зависит и никого не открывает ----
// Финал запускают кнопкой «Закрыть смену» с победного экрана, а не по QR из
// ростера. Поэтому предусловий у него нет (их роль играет сам победный экран),
// и никакая другая игра не может висеть на его прохождении — до неё уже не дойти.
// Ссылка из триггера меты на финал законна: «После смены» и должна ждать финала.
{
  const games = rows('games');
  const finales = games.filter((g) => g.is_finale);
  if (finales.length > 1)
    bad(`финалом смены помечено несколько игр: ${finales.map((g) => `#${g.id}`).join(', ')}`);
  for (const f of finales) {
    const where = `игра #${f.id} «${f.title}»`;
    if (f.is_tutorial) bad(`${where}: помечена и обучалкой, и финалом смены`);
    if (JSON.parse(f.required_game_ids_json).length > 0)
      bad(`${where}: у финала смены не должно быть requiredGameIds — он открывается победой`);
    for (const g of games)
      if (JSON.parse(g.required_game_ids_json).includes(f.id))
        bad(`игра #${g.id} «${g.title}»: ждёт финала смены #${f.id} — до неё не дойти`);
  }
}

// ---- мета: расстановка персонажей ------------------------------------------
for (const s of rows('meta_stages')) {
  const where = `этап меты #${s.id} «${s.title}»`;
  for (const c of JSON.parse(s.characters_json)) {
    if (!characterIds.has(c.characterId)) bad(`${where}: персонаж ${c.characterId} не существует`);
    if (c.dialogueId != null && !dialogueIds.has(c.dialogueId))
      bad(`${where}: диалог ${c.dialogueId} не существует`);
  }
  const t = JSON.parse(s.trigger_json);
  for (const id of t?.ids ?? [])
    if (!gameIds.has(id)) bad(`${where}: триггер ждёт несуществующую игру ${id}`);
}

// ---- ассеты: ссылки на /assets-store/ ведут в живой файл --------------------
const checkAsset = (url, where) => {
  if (typeof url === 'string' && url.startsWith('/assets-store/') && !assetUrls.has(url))
    bad(`${where}: ассет ${url} не зарегистрирован`);
};
for (const c of rows('characters')) checkAsset(c.portrait_asset, `персонаж #${c.id} «${c.name}»`);
for (const g of rows('games')) {
  const walk = (v) => {
    if (typeof v === 'string') checkAsset(v, `игра #${g.id} «${g.title}»`);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  try {
    walk(JSON.parse(g.config_json));
  } catch {
    bad(`игра #${g.id} «${g.title}»: config_json не парсится`);
  }
}

// ---- выгрузка: у каждой записи ассета лежит файл, и наоборот -----------------
// Только для --content: в data/assets файлы появляются при заливке, а в гите
// запись и файл — две части одного коммита, и рассинхрон ловить надо здесь.
if (useContent) {
  const filesDir = path.join(contentDir, 'assets');
  const onDisk = new Set(fs.existsSync(filesDir) ? fs.readdirSync(filesDir) : []);
  for (const a of assetRows) {
    const file = `${a.id}.${a.ext}`;
    if (!onDisk.delete(file))
      bad(`ассет ${a.id} «${a.original_name}»: нет файла content/assets/${file}`);
  }
  for (const extra of [...onDisk].sort())
    bad(`content/assets/${extra}: файл есть, а записи в assets.json нет`);
}

if (errors.length === 0) {
  console.log('контент цел: битых ссылок нет');
} else {
  for (const e of errors) console.error('✗ ' + e);
  console.error(`\nпроблем: ${errors.length}`);
  process.exit(1);
}
