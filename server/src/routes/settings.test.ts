import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

// DATA_DIR must be set before config.js (and anything importing it) is loaded, so this
// test gets its own fresh sqlite file instead of the real dev DB — hence the dynamic
// imports inside beforeAll rather than static imports at module top.
let app: FastifyInstance;
let dataDir: string;
let closeThisTestDb: () => void;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-settings-test-'));
  process.env.DATA_DIR = dataDir;

  const Fastify = (await import('fastify')).default;
  const { getDb, closeDb } = await import('../db/connection.js');
  const { migrate } = await import('../db/migrate.js');
  const { registerAuth } = await import('../plugins/auth.js');
  const { settingsRoutes } = await import('./settings.js');

  migrate(getDb());

  app = Fastify();
  // registerAuth registers @fastify/cookie itself — don't register it again here.
  await registerAuth(app);
  await app.register(settingsRoutes);
  await app.ready();

  closeThisTestDb = closeDb;
});

afterAll(async () => {
  await app.close();
  closeThisTestDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function loginCookie(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/login',
    payload: { login: 'admin', password: 'admin' },
  });
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return String(raw).split(';')[0]!;
}

describe('GET /api/settings', () => {
  it('includes no_qr, false by default (NO_QR unset)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(res.json()).toMatchObject({ no_qr: false });
  });
});

describe('PUT /api/admin/settings', () => {
  it('rejects no_qr — it is not a DB-backed setting', async () => {
    const cookie = await loginCookie();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: { cookie },
      payload: { no_qr: true },
    });
    expect(res.statusCode).toBe(400);
  });
});
