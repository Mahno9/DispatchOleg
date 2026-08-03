import fs from 'node:fs';
import { buildApp } from './app.js';
import { config, paths } from './config.js';
import { getDb } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { ensureTutorialGame } from './repos/games.js';

for (const dir of [config.dataDir, paths.assets()]) {
  fs.mkdirSync(dir, { recursive: true });
}

const ran = migrate(getDb());
const seeded = ensureTutorialGame(getDb());

const app = await buildApp();
if (ran.length > 0) app.log.info({ migrations: ran }, 'applied migrations');
if (seeded) app.log.info({ gameId: seeded.id }, 'seeded tutorial game');

app.listen({ host: config.host, port: config.port }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
