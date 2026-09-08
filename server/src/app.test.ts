import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

// DATA_DIR must be set before config.js is loaded — hence dynamic imports below.
let app: FastifyInstance;
let dataDir: string;
let db: import('better-sqlite3').Database;
let closeThisTestDb: () => void;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-app-test-'));
  fs.mkdirSync(path.join(dataDir, 'assets'), { recursive: true });
  process.env.DATA_DIR = dataDir;
  process.env.LOG_LEVEL = 'silent'; // иначе каждый inject печатает пару строк лога

  const { buildApp } = await import('./app.js');
  const { getDb, closeDb } = await import('./db/connection.js');
  const { migrate } = await import('./db/migrate.js');

  migrate(getDb());
  db = getDb();
  app = await buildApp();
  await app.ready();
  closeThisTestDb = closeDb;
});

afterAll(async () => {
  await app.close();
  closeThisTestDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('the app boots', () => {
  it('serves /api/health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });
});

// ---------------------------------------------------------------------------
// Every /api/admin/* route must be behind requireAdmin
// ---------------------------------------------------------------------------

/**
 * Routes as the app actually registered them. printRoutes() prints a radix tree:
 * a node's full path is its own label appended to its ancestors' labels.
 * Reading it back beats a hand-written list — a new admin route joins this test
 * by existing, which is the whole point.
 */
function registeredRoutes(tree: string): { method: string; url: string }[] {
  const branch = /^([\s│]*)(?:├──|└──) (.*)$/;
  const trail: string[] = [];
  const out: { method: string; url: string }[] = [];

  for (const line of tree.split('\n')) {
    const m = branch.exec(line);
    if (!m) continue;
    const depth = m[1]!.length / 4;
    let label = m[2]!;
    const methods = /\s*\(([A-Z, ]+)\)$/.exec(label);
    if (methods) label = label.slice(0, methods.index);
    trail.length = depth;
    trail[depth] = label;
    if (!methods) continue;
    for (const method of methods[1]!.split(', ')) out.push({ method, url: trail.join('') });
  }
  return out;
}

// Deliberately open: the only way in, and the way out.
const PUBLIC_ADMIN_ROUTES = ['/api/admin/login', '/api/admin/logout'];

describe('/api/admin/* without a session cookie', () => {
  const adminRoutes = () =>
    registeredRoutes(app.printRoutes({ commonPrefix: false })).filter(
      (r) =>
        r.url.startsWith('/api/admin/') &&
        r.method !== 'HEAD' &&
        !PUBLIC_ADMIN_ROUTES.includes(r.url),
    );

  it('finds the admin routes at all (guards against a parse that quietly matches nothing)', () => {
    expect(adminRoutes().length).toBeGreaterThan(10);
    expect(adminRoutes().map((r) => r.url)).toContain('/api/admin/settings');
  });

  it('answers 401 on every one of them', async () => {
    // Fastify валидирует тело ДО preHandler, поэтому тело должно проходить схему —
    // иначе вместо 401 прилетит 400 и тест перестанет проверять именно защиту.
    // Здесь собраны обязательные поля всех admin-схем: новый роут с ещё одним
    // обязательным полем уронит этот тест, а не проскочит мимо него.
    const body = { title: 'x', name: 'x', minigameId: 'noop', config: {}, gameId: 1 };
    for (const { method, url } of adminRoutes()) {
      // Параметры любые: до обработчика запрос дойти не должен.
      const target = url.replace(/:[a-zA-Z]+/g, '1');
      const res = await app.inject({ method: method as 'GET', url: target, payload: body });
      expect(res.statusCode, `${method} ${target}`).toBe(401);
    }
  });
});

// ---------------------------------------------------------------------------
// Upload limits
// ---------------------------------------------------------------------------

async function adminCookie(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/login',
    payload: { login: 'admin', password: 'admin' },
  });
  const raw = res.headers['set-cookie'];
  return String(Array.isArray(raw) ? raw[0] : raw).split(';')[0]!;
}

function multipart(boundary: string, filename: string, mime: string, body: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${mime}\r\n\r\n`,
    ),
    body,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('POST /api/admin/assets', () => {
  const boundary = '----dispatchtest';

  // Содержимое теперь сверяется с заявленным типом, поэтому «файл нужного
  // размера» — это настоящая png-сигнатура плюс набивка.
  const upload = (cookie: string, size: number) =>
    app.inject({
      method: 'POST',
      url: '/api/admin/assets',
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart(
        boundary,
        'big.png',
        'image/png',
        Buffer.concat([PNG_MAGIC, Buffer.alloc(size - PNG_MAGIC.length, 0x61)]),
      ),
    });

  it('rejects a file over the size limit with 413, not a 500 or an OOM', async () => {
    const cookie = await adminCookie();
    const res = await upload(cookie, 11 * 1024 * 1024);
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ code: 'FST_REQ_FILE_TOO_LARGE' });
  });

  it('still accepts a file of a realistic size', async () => {
    const cookie = await adminCookie();
    const res = await upload(cookie, 2 * 1024 * 1024);
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toHaveLength(1);
  });
});

describe('POST /api/admin/assets — содержимое против заявленного типа', () => {
  const boundary = '----dispatchtest';
  const send = (cookie: string, filename: string, mime: string, body: Buffer) =>
    app.inject({
      method: 'POST',
      url: '/api/admin/assets',
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart(boundary, filename, mime, body),
    });

  it('отвергает html, назвавшийся картинкой', async () => {
    const cookie = await adminCookie();
    const res = await send(
      cookie,
      'evil.png',
      'image/png',
      Buffer.from('<html><script>alert(document.cookie)</script></html>'),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toHaveLength(0);
    expect(res.json().rejected[0]).toMatch(/evil\.png/);
  });

  it('принимает настоящие png и ogg', async () => {
    const cookie = await adminCookie();
    const png = await send(
      cookie,
      'ok.png',
      'image/png',
      Buffer.concat([PNG_MAGIC, Buffer.alloc(64)]),
    );
    expect(png.json().accepted).toHaveLength(1);
    const ogg = await send(
      cookie,
      'ok.ogg',
      'audio/ogg',
      Buffer.concat([Buffer.from('OggS'), Buffer.alloc(64)]),
    );
    expect(ogg.json().accepted).toHaveLength(1);
    expect(ogg.json().accepted[0].url).toMatch(/^\/assets-store\/.+\.ogg$/);
  });
});

// ---------------------------------------------------------------------------
// Отдача /assets-store/
// ---------------------------------------------------------------------------

describe('GET /assets-store/*', () => {
  it('отдаёт файл с запретом скриптов — фильтр SVG обходится сущностями', async () => {
    fs.writeFileSync(
      path.join(dataDir, 'assets', 'probe.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>',
    );
    const res = await app.inject({ method: 'GET', url: '/assets-store/probe.svg' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<circle');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain('sandbox');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    // Хук с ACAO: * снят — в dev плеер и админка ходят через vite-proxy, origin свой.
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/assets/:id/usage
// ---------------------------------------------------------------------------

describe('GET /api/admin/assets/:id/usage', () => {
  it('находит ассет в конфиге игры и в портрете персонажа, 404 на несуществующий', async () => {
    const cookie = await adminCookie();
    const url = '/assets-store/usg1.png';
    db.prepare(
      `INSERT INTO assets (id, kind, mime, ext, original_name, size_bytes, created_at)
         VALUES ('usg1', 'image', 'image/png', 'png', 'p.png', 1, 0)`,
    ).run();
    db.prepare('INSERT INTO characters (id, name, portrait_asset) VALUES (91, ?, ?)').run('Ц', url);
    db.prepare('INSERT INTO games (id, title, minigame_id, config_json) VALUES (92, ?, ?, ?)').run(
      'Игра',
      'noop',
      JSON.stringify({ bg: url }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/assets/usg1/usage',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { kind: 'game', id: 92, title: 'Игра', field: 'конфиг: bg' },
      { kind: 'character', id: 91, title: 'Ц', field: 'портрет' },
    ]);

    const missing = await app.inject({
      method: 'GET',
      url: '/api/admin/assets/nosuch/usage',
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// trustProxy
// ---------------------------------------------------------------------------

describe('доверие к X-Forwarded-*', () => {
  it('верит прокси рядом и не верит запросу прямо с публичного адреса', async () => {
    const Fastify = (await import('fastify')).default;
    const { TRUST_PROXY } = await import('./app.js');
    const probe = Fastify({ trustProxy: TRUST_PROXY });
    probe.get('/ip', async (req) => ({ ip: req.ip, proto: req.protocol }));
    await probe.ready();

    const headers = { 'x-forwarded-for': '9.9.9.9', 'x-forwarded-proto': 'https' };
    // cloudflared: петля (quick-tunnel) или частная сеть docker.
    for (const remoteAddress of ['127.0.0.1', '172.18.0.4']) {
      const near = await probe.inject({ url: '/ip', remoteAddress, headers });
      expect(near.json(), remoteAddress).toEqual({ ip: '9.9.9.9', proto: 'https' });
    }
    const far = await probe.inject({ url: '/ip', remoteAddress: '203.0.113.7', headers });
    expect(far.json()).toEqual({ ip: '203.0.113.7', proto: 'http' });

    await probe.close();
  });
});
