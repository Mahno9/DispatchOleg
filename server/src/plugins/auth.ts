import crypto from 'node:crypto';
import fastifyCookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';

const COOKIE_NAME = 'admin_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
  const expected = sign(payload);
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
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
      const { login, password } = req.body;
      if (login !== config.adminLogin || password !== config.adminPassword) {
        return reply.code(401).send({ error: 'invalid credentials' });
      }
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
