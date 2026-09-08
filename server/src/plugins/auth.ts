import crypto from 'node:crypto';
import fastifyCookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';

const COOKIE_NAME = 'admin_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Админка висит в публичном туннеле, а пароль один на всё мероприятие — без
// лимита её подбирают за вечер. Порог с запасом на живого админа, который
// вводит пароль с телефона и промахивается.
const LOGIN_MAX_FAILS = 10;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
// ponytail: счётчик живёт в памяти процесса — сбрасывается на рестарте и не
// общий между инстансами; чистится по размеру, а не по таймеру. Потолок здесь
// — один инстанс за одним туннелем. Апгрейд, если инстансов станет больше
// одного: общий стор (таблица в sqlite или redis).
const loginFails = new Map<string, { count: number; firstAt: number }>();

function loginBlocked(ip: string, now: number): boolean {
  const rec = loginFails.get(ip);
  if (!rec) return false;
  if (now - rec.firstAt > LOGIN_WINDOW_MS) {
    loginFails.delete(ip);
    return false;
  }
  return rec.count >= LOGIN_MAX_FAILS;
}

function noteLoginFail(ip: string, now: number): void {
  if (loginFails.size > 1000)
    for (const [k, v] of loginFails) if (now - v.firstAt > LOGIN_WINDOW_MS) loginFails.delete(k);
  const rec = loginFails.get(ip);
  if (rec && now - rec.firstAt <= LOGIN_WINDOW_MS) rec.count += 1;
  else loginFails.set(ip, { count: 1, firstAt: now });
}

/** Сравнение без утечки по времени. timingSafeEqual работает с байтами, а не с
 *  символами: длины сверяем у буферов, иначе кириллица даёт RangeError. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', config.cookieSecret).update(payload).digest('base64url');
}

export function makeSessionToken(now = Date.now()): string {
  const payload = String(now + SESSION_TTL_MS);
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string, now = Date.now()): boolean {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!safeEqual(sig, sign(payload))) return false;
  return Number(payload) > now;
}

export async function registerAuth(app: FastifyInstance) {
  await app.register(fastifyCookie);

  app.decorate('requireAdmin', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies[COOKIE_NAME];
    if (!token || !verifySessionToken(token)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.post<{ Body: { login: string; password: string } }>(
    '/api/admin/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['login', 'password'],
          properties: { login: { type: 'string' }, password: { type: 'string' } },
        },
      },
    },
    async (req, reply) => {
      const now = Date.now();
      if (loginBlocked(req.ip, now)) {
        return reply.code(429).send({ error: 'too many attempts' });
      }

      const { login, password } = req.body;
      if (!safeEqual(login, config.adminLogin) || !safeEqual(password, config.adminPassword)) {
        noteLoginFail(req.ip, now);
        return reply.code(401).send({ error: 'invalid credentials' });
      }
      loginFails.delete(req.ip);
      reply.setCookie(COOKIE_NAME, makeSessionToken(), {
        path: '/',
        httpOnly: true,
        sameSite: 'strict',
        secure: 'auto',
        maxAge: SESSION_TTL_MS / 1000,
      });
      return { ok: true };
    },
  );

  app.post('/api/admin/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  app.get('/api/admin/me', { preHandler: app.requireAdmin }, async () => ({ ok: true }));
}

declare module 'fastify' {
  interface FastifyInstance {
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  }
}
