// Проверка контента в БД: битые ссылки в диалогах и в проводке игр/меты.
// Ловит то, что плеер молча проглатывает (docs: сломанный диалог просто пропускается).
//   node scripts/check-content.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(root, 'data'));
const db = new Database(path.join(dataDir, 'app.sqlite'), { readonly: true });

const errors = [];
const bad = (msg) => errors.push(msg);

const characterIds = new Set(
  db
    .prepare('SELECT id FROM characters')
    .all()
    .map((r) => r.id),
);
const dialogueIds = new Set(
  db
    .prepare('SELECT id FROM dialogues')
    .all()
    .map((r) => r.id),
);
const gameIds = new Set(
  db
    .prepare('SELECT id FROM games')
    .all()
    .map((r) => r.id),
);
const assetUrls = new Set(
  db
    .prepare('SELECT id, ext FROM assets')
    .all()
    .map((r) => `/assets-store/${r.id}.${r.ext}`),
);

// ---- диалоги: старт на месте, все переходы ведут в существующий узел --------
for (const row of db.prepare('SELECT id, title, nodes_json FROM dialogues').all()) {
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
for (const g of db.prepare('SELECT * FROM games').all()) {
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

// ---- мета: расстановка персонажей ------------------------------------------
for (const s of db.prepare('SELECT * FROM meta_stages').all()) {
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
for (const c of db.prepare('SELECT id, name, portrait_asset FROM characters').all())
  checkAsset(c.portrait_asset, `персонаж #${c.id} «${c.name}»`);
for (const g of db.prepare('SELECT id, title, config_json FROM games').all()) {
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

if (errors.length === 0) {
  console.log('контент цел: битых ссылок нет');
} else {
  for (const e of errors) console.error('✗ ' + e);
  console.error(`\nпроблем: ${errors.length}`);
  process.exit(1);
}
