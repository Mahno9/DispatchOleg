import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

const serverRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const repoRoot = path.dirname(serverRoot);

const playerDist = path.join(repoRoot, 'web', 'player', 'dist');
const adminDist = path.join(repoRoot, 'web', 'admin', 'dist');

export async function registerStatic(app: FastifyInstance) {
  if (fs.existsSync(adminDist)) {
    await app.register(fastifyStatic, {
      root: adminDist,
      prefix: '/admin/',
      decorateReply: false,
    });
    app.get('/admin', (_req, reply) => reply.redirect('/admin/'));
  }

  if (fs.existsSync(playerDist)) {
    await app.register(fastifyStatic, {
      root: playerDist,
      prefix: '/',
    });
    // SPA fallback: unknown non-API paths serve the player app shell
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api/') || req.raw.url?.startsWith('/admin/')) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.sendFile('index.html');
    });
  }
}
