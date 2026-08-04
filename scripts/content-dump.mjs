// Выгрузка контента из БД в content/ — коммитьте результат в гит.
//   node scripts/content-dump.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { dump, resolvePaths, summary } from './content-io.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { dbFile, assetsDir, contentDir } = resolvePaths(root);

if (!fs.existsSync(dbFile)) {
  console.error(`нет БД: ${dbFile} — сначала запустите сервер, он применит миграции`);
  process.exit(1);
}

const db = new Database(dbFile, { readonly: true });
console.log('выгружено — ' + summary(dump(db, contentDir, assetsDir)));
console.log(`каталог: ${contentDir}`);
