import path from 'node:path';

const env = process.env;

const cookieSecret = env.COOKIE_SECRET ?? 'dev-secret-change-me';

export const config = {
  host: env.HOST ?? '0.0.0.0',
  port: Number(env.PORT ?? 8080),
  dataDir: path.resolve(env.DATA_DIR ?? path.join(process.cwd(), '..', 'data')),
  adminLogin: env.ADMIN_LOGIN ?? 'admin',
  adminPassword: env.ADMIN_PASSWORD ?? 'admin',
  cookieSecret,
  // QR payloads are signed separately from admin sessions, but fall back to the
  // cookie secret so a single-secret deployment still works.
  qrSecret: env.QR_SECRET ?? cookieSecret,
  logLevel: env.LOG_LEVEL ?? 'info',
} as const;

export const paths = {
  db: () => path.join(config.dataDir, 'app.sqlite'),
  assets: () => path.join(config.dataDir, 'assets'),
};
