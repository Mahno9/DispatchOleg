import fs from 'node:fs';
import { buildApp } from './app.js';
import { assertProductionSecrets, config, paths } from './config.js';
import { getDb } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { ensureTutorialGame } from './repos/games.js';

/**
 * Шаги старта до появления логгера. Без обёртки ошибка выходит голым unhandled
 * rejection, а в docker с `restart: unless-stopped` — бесконечным циклом
 * перезапуска, по логу которого не понять, на чём именно упало. Сообщение —
 * в том же стиле, что у assertProductionSecrets.
 */
function startupStep<T>(what: string, run: () => T): T {
  try {
    return run();
  } catch (err) {
    console.error(`Отказ старта: ${what}.`);
    console.error(err);
    process.exit(1);
  }
}

assertProductionSecrets();

startupStep(`не создать рабочие каталоги (${config.dataDir})`, () => {
  for (const dir of [config.dataDir, paths.assets()]) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const ran = startupStep(`не применились миграции БД (${paths.db()})`, () => migrate(getDb()));
const seeded = startupStep('не завести обучающую игру', () => ensureTutorialGame(getDb()));

const app = await buildApp();
if (ran.length > 0) app.log.info({ migrations: ran }, 'applied migrations');
if (seeded) app.log.info({ gameId: seeded.id }, 'seeded tutorial game');
// Без печатных QR вся премиса игры отменяется — в проде это точно не то,
// что включают намеренно и молча.
if (config.noQr) app.log.warn('NO_QR=1: печатные QR отключены, мини-игру выбирает сам плеер');

app.listen({ host: config.host, port: config.port }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
