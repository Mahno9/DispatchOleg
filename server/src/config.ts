import path from 'node:path';

const env = process.env;

// Значения «для локальной разработки»: в production старт с ними падает,
// см. assertProductionSecrets.
const DEV_DEFAULTS = {
  ADMIN_LOGIN: 'admin',
  ADMIN_PASSWORD: 'admin',
  COOKIE_SECRET: 'dev-secret-change-me',
} as const;

const cookieSecret = env.COOKIE_SECRET ?? DEV_DEFAULTS.COOKIE_SECRET;

export const config = {
  host: env.HOST ?? '0.0.0.0',
  port: Number(env.PORT ?? 8080),
  dataDir: path.resolve(env.DATA_DIR ?? path.join(process.cwd(), '..', 'data')),
  adminLogin: env.ADMIN_LOGIN ?? DEV_DEFAULTS.ADMIN_LOGIN,
  adminPassword: env.ADMIN_PASSWORD ?? DEV_DEFAULTS.ADMIN_PASSWORD,
  cookieSecret,
  // QR payloads are signed separately from admin sessions, but fall back to the
  // cookie secret so a single-secret deployment still works.
  qrSecret: env.QR_SECRET ?? cookieSecret,
  logLevel: env.LOG_LEVEL ?? 'info',
  // Режим тестирования без печатных QR: плеер сам выбирает мини-игру.
  noQr: env.NO_QR === '1',
} as const;

/**
 * Fail-fast на старте. С дефолтным COOKIE_SECRET admin-cookie подделывает кто
 * угодно, с дефолтным логином/паролем админка открыта вообще всем — в проде
 * это не должно подниматься молча. В dev проверка не срабатывает.
 */
export function assertProductionSecrets(e: NodeJS.ProcessEnv = env): void {
  if (e.NODE_ENV !== 'production') return;
  const left = Object.entries(DEV_DEFAULTS)
    .filter(([name, def]) => (e[name] ?? def) === def)
    .map(([name]) => name);
  if (left.length === 0) return;
  throw new Error(
    `Отказ старта: в production остались дефолтные значения переменных ${left.join(', ')}. ` +
      'Задайте свои в окружении (см. .env.example) и перезапустите сервер.',
  );
}

export const paths = {
  db: () => path.join(config.dataDir, 'app.sqlite'),
  assets: () => path.join(config.dataDir, 'assets'),
};
