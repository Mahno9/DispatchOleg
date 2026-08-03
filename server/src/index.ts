import fs from 'node:fs';
import { buildApp } from './app.js';
import { config, paths } from './config.js';
import { getDb } from './db/connection.js';
import { migrate } from './db/migrate.js';

for (const dir of [config.dataDir, paths.assets()]) {
  fs.mkdirSync(dir, { recursive: true });
}

const ran = migrate(getDb());

const app = await buildApp();
if (ran.length > 0) app.log.info({ migrations: ran }, 'applied migrations');

app.listen({ host: config.host, port: config.port }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
