import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/connection.js';
import { getAllDefaults, setDefaults } from '../repos/minigameDefaults.js';

const serverRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
export const minigamesDir = path.join(serverRoot, 'static', 'minigames');

interface MinigameInfo {
  id: string;
  title: string;
  entryUrl: string;
  schemaUrl: string;
}

export function scanMinigames(dir = minigamesDir): MinigameInfo[] {
  if (!fs.existsSync(dir)) return [];
  const out: MinigameInfo[] = [];
  for (const id of fs.readdirSync(dir)) {
    const entry = path.join(dir, id, 'index.js');
    const schemaPath = path.join(dir, id, 'schema.json');
    if (!fs.existsSync(entry) || !fs.existsSync(schemaPath)) continue;
    let title = id;
    try {
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')) as { title?: string };
      if (schema.title) title = schema.title;
    } catch {
      // malformed schema → keep id as title
    }
    out.push({
      id,
      title,
      entryUrl: `/minigames/${id}/index.js`,
      schemaUrl: `/minigames/${id}/schema.json`,
    });
  }
  return out;
}

export async function minigamesRoutes(app: FastifyInstance) {
  // GET /api/minigames — scanned games, each augmented with its stored default config.
  app.get('/api/minigames', async () => {
    const defaults = getAllDefaults(getDb());
    return scanMinigames().map((m) => ({ ...m, defaultConfig: defaults[m.id] ?? {} }));
  });

  // PUT /api/admin/minigames/:id/defaults — set a game's default config.
  app.put<{ Params: { id: string }; Body: { config: Record<string, unknown> } }>(
    '/api/admin/minigames/:id/defaults',
    {
      preHandler: app.requireAdmin,
      schema: {
        body: {
          type: 'object',
          required: ['config'],
          properties: { config: { type: 'object' } },
        },
      },
    },
    async (req, reply) => {
      const known = scanMinigames().some((m) => m.id === req.params.id);
      if (!known) return reply.code(404).send({ error: 'Unknown minigame' });
      setDefaults(getDb(), req.params.id, req.body.config);
      return { ok: true };
    },
  );

  if (fs.existsSync(minigamesDir)) {
    await app.register(fastifyStatic, {
      root: minigamesDir,
      prefix: '/minigames/',
      decorateReply: false,
      // Default Cache-Control (public, max-age=0 + ETag) is what we want:
      // browsers revalidate on every load, so a rebuilt bundle shows up
      // immediately. NB: a setHeaders() override here silently loses to the
      // plugin's own cache-control header — don't reintroduce it.
    });
  }
}
