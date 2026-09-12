import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

// DATA_DIR должен быть выставлен до загрузки config.js — отсюда динамические импорты.
let app: FastifyInstance;
let dataDir: string;
let closeThisTestDb: () => void;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-games-test-'));
  fs.mkdirSync(path.join(dataDir, 'assets'), { recursive: true });
  process.env.DATA_DIR = dataDir;
  process.env.LOG_LEVEL = 'silent';

  const { buildApp } = await import('../app.js');
  const { getDb, closeDb } = await import('../db/connection.js');
  const { migrate } = await import('../db/migrate.js');

  migrate(getDb());
  app = await buildApp();
  await app.ready();
  closeThisTestDb = closeDb;
});

afterAll(async () => {
  await app.close();
  closeThisTestDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function adminCookie(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/login',
    payload: { login: 'admin', password: 'admin' },
  });
  const raw = res.headers['set-cookie'];
  return String(Array.isArray(raw) ? raw[0] : raw).split(';')[0]!;
}

const create = (cookie: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/admin/games', headers: { cookie }, payload });

describe('isFinale через API', () => {
  it('по умолчанию false — колонка не обязана быть в теле запроса', async () => {
    const cookie = await adminCookie();
    const res = await create(cookie, { title: 'Обычная', minigameId: 'noop' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ isFinale: false, isTutorial: false });
  });

  it('создание с isFinale: true возвращает флаг обратно', async () => {
    const cookie = await adminCookie();
    const res = await create(cookie, { title: 'Финал', minigameId: 'task-sort', isFinale: true });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ isFinale: true });
  });

  it('PUT снимает и ставит флаг', async () => {
    const cookie = await adminCookie();
    const id = create(cookie, { title: 'Качели', minigameId: 'noop', isFinale: true });
    const gameId = (await id).json().id as number;

    const off = await app.inject({
      method: 'PUT',
      url: `/api/admin/games/${gameId}`,
      headers: { cookie },
      payload: { isFinale: false },
    });
    expect(off.json()).toMatchObject({ isFinale: false });

    const on = await app.inject({
      method: 'PUT',
      url: `/api/admin/games/${gameId}`,
      headers: { cookie },
      payload: { isFinale: true },
    });
    expect(on.json()).toMatchObject({ isFinale: true, title: 'Качели' });
  });

  it('GET /api/games отдаёт isFinale — по нему плеер прячет финал из ростера', async () => {
    const cookie = await adminCookie();
    const finale = (
      await create(cookie, { title: 'Закрытие смены', minigameId: 'task-sort', isFinale: true })
    ).json();
    const plain = (await create(cookie, { title: 'Не финал', minigameId: 'noop' })).json();

    const res = await app.inject({ method: 'GET', url: '/api/games' });
    expect(res.statusCode).toBe(200);
    const list = res.json() as { id: number; isFinale: boolean }[];
    expect(list.find((g) => g.id === finale.id)).toMatchObject({ isFinale: true });
    expect(list.find((g) => g.id === plain.id)).toMatchObject({ isFinale: false });
  });

  it('GET /api/games/:id/config отдаёт isFinale вместе с конфигом', async () => {
    const cookie = await adminCookie();
    const game = (
      await create(cookie, { title: 'Конфиг финала', minigameId: 'task-sort', isFinale: true })
    ).json();
    const res = await app.inject({ method: 'GET', url: `/api/games/${game.id}/config` });
    expect(res.json()).toMatchObject({ id: game.id, isFinale: true });
  });

  it('POST /api/qr/verify отдаёт isFinale — плеер отказывает в запуске по QR', async () => {
    const { qrPayload } = await import('./qr.js');
    const cookie = await adminCookie();
    const game = (
      await create(cookie, { title: 'QR финала', minigameId: 'task-sort', isFinale: true })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: '/api/qr/verify',
      payload: { payload: qrPayload(game.id), userId: 'u-test' },
    });
    expect(res.json()).toMatchObject({ ok: true, game: { id: game.id, isFinale: true } });
  });
});
