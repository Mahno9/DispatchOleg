// Заливка контента из content/ в БД. Замещает контент целиком; прогресс
// игроков (users, game_states) не трогает.
//   node scripts/content-load.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { load, resolvePaths, summary } from './content-io.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { dbFile, assetsDir, contentDir } = resolvePaths(root);

if (!fs.existsSync(dbFile)) {
  console.error(`нет БД: ${dbFile} — сначала запустите сервер, он применит миграции`);
  process.exit(1);
}
// Без этой проверки пустой каталог просто вычистил бы весь контент.
if (!fs.existsSync(path.join(contentDir, 'dialogues.json'))) {
  console.error(
    `нет выгрузки: ${contentDir} — сделайте npm run content:dump на инстансе-источнике`,
  );
  process.exit(1);
}

const db = new Database(dbFile);
db.pragma('foreign_keys = ON');
console.log('залито — ' + summary(load(db, contentDir, assetsDir)));
