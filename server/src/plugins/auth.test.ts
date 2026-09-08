import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { makeSessionToken, registerAuth, verifySessionToken } from './auth.js';

describe('session token', () => {
  it('round-trips a fresh token', () => {
    expect(verifySessionToken(makeSessionToken())).toBe(true);
  });

  it('rejects an expired token', () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    expect(verifySessionToken(makeSessionToken(eightDaysAgo))).toBe(false);
  });

  it('rejects a tampered token', () => {
    const token = makeSessionToken();
    const [payload] = token.split('.');
    expect(verifySessionToken(`${Number(payload) + 9999999}.${token.split('.')[1]}`)).toBe(false);
    expect(verifySessionToken('garbage')).toBe(false);
  });

  it('rejects a multibyte signature instead of throwing RangeError', () => {
    // Подпись — 43 символа base64url, как настоящая, но кириллица весит вдвое
    // больше в байтах: сравнение длин по строке пускало это в timingSafeEqual.
    const token = `${Date.now() + 60_000}.${'я'.repeat(43)}`;
    expect(() => verifySessionToken(token)).not.toThrow();
    expect(verifySessionToken(token)).toBe(false);
  });
});

describe('POST /api/admin/login', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await registerAuth(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const login = (ip: string, password: string) =>
    app.inject({
      method: 'POST',
      url: '/api/admin/login',
      remoteAddress: ip,
      payload: { login: 'admin', password },
    });

  it('a cyrillic session cookie is unauthorized, not a 500', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/me',
      headers: { cookie: `admin_session=${Date.now() + 60_000}.${'я'.repeat(43)}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('locks out after 10 consecutive failures from one ip', async () => {
    const ip = '10.1.1.1';
    for (let i = 0; i < 10; i += 1) expect((await login(ip, 'nope')).statusCode).toBe(401);
    expect((await login(ip, 'nope')).statusCode).toBe(429);
    // Даже с верным паролем: окно ещё не истекло.
    expect((await login(ip, 'admin')).statusCode).toBe(429);
  });

  it('counts per ip, so one attacker does not lock out the admin', async () => {
    const attacker = '10.1.1.2';
    for (let i = 0; i < 11; i += 1) await login(attacker, 'nope');
    expect((await login(attacker, 'nope')).statusCode).toBe(429);
    expect((await login('10.1.1.3', 'admin')).statusCode).toBe(200);
  });

  it('a successful login clears the failure counter', async () => {
    const ip = '10.1.1.4';
    for (let i = 0; i < 9; i += 1) expect((await login(ip, 'nope')).statusCode).toBe(401);
    expect((await login(ip, 'admin')).statusCode).toBe(200);
    for (let i = 0; i < 9; i += 1) expect((await login(ip, 'nope')).statusCode).toBe(401);
    expect((await login(ip, 'admin')).statusCode).toBe(200);
  });
});
