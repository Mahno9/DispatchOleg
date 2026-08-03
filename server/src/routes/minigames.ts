import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/connection.js';
import { getAllDefaults, setDefaults } from '../repos/minigameDefaults.js';

const serverRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
export const minigamesDir = path.join(serverRoot, 'static', 'minigames');
/** Schema-only pseudo-minigames (onboarding): no bundle, the player implements them. */
export const systemMinigamesDir = path.join(serverRoot, 'system-minigames');

interface MinigameInfo {
  id: string;
  title: string;
  /** null for system games — there is nothing to import. */
  entryUrl: string | null;
  schemaUrl: string;
  /** Top-level `default` values from schema.json — the base layer of a game's
   *  effective config. Same extraction the admin editor does client-side. */
  schemaDefaults: Record<string, unknown>;
  system?: true;
}

interface SchemaFile {
  title?: string;
  properties?: Record<string, { default?: unknown }>;
}

function scanDir(dir: string, system: boolean): MinigameInfo[] {
  if (!fs.existsSync(dir)) return [];
  const out: MinigameInfo[] = [];
  for (const id of fs.readdirSync(dir)) {
    const schemaPath = path.join(dir, id, 'schema.json');
    if (!fs.existsSync(schemaPath)) continue;
    // A bundled game without index.js is a half-built game, not a type.
    if (!system && !fs.existsSync(path.join(dir, id, 'index.js'))) continue;
    let title = id;
    const schemaDefaults: Record<string, unknown> = {};
    try {
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')) as SchemaFile;
      if (schema.title) title = schema.title;
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (sub && typeof sub === 'object' && sub.default !== undefined) {
          schemaDefaults[key] = sub.default;
        }
      }
    } catch {
      // malformed schema → keep id as title, no defaults
    }
    out.push({
      id,
      title,
      entryUrl: system ? null : `/minigames/${id}/index.js`,
      schemaUrl: `/minigames/${id}/schema.json`,
      schemaDefaults,
      ...(system ? { system: true as const } : {}),
    });
  }
  return out;
}

export function scanMinigames(dir = minigamesDir, systemDir = systemMinigamesDir): MinigameInfo[] {
  return [...scanDir(dir, false), ...scanDir(systemDir, true)];
}

export async function minigamesRoutes(app: FastifyInstance) {
  // GET /api/minigames — scanned games, each augmented with its effective default
  // config: schema.json defaults ⊕ admin-stored overrides. The player's launcher
  // merges defaultConfig ⊕ games.config_json, so schema defaults must be part of
  // this layer — with an empty minigame_defaults table a game would otherwise
  // start on an empty config and die on its own config validation.
  app.get('/api/minigames', async () => {
    const defaults = getAllDefaults(getDb());
    return scanMinigames().map((m) => ({
      ...m,
      defaultConfig: { ...m.schemaDefaults, ...(defaults[m.id] ?? {}) },
    }));
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

  // Both roots share the /minigames/ prefix: bundles first, then the schema-only
  // system games — ids never collide, so order is only a tie-break that never fires.
  const roots = [minigamesDir, systemMinigamesDir].filter((d) => fs.existsSync(d));
  if (roots.length > 0) {
    await app.register(fastifyStatic, {
      root: roots,
      prefix: '/minigames/',
      decorateReply: false,
      // Default Cache-Control (public, max-age=0 + ETag) is what we want:
      // browsers revalidate on every load, so a rebuilt bundle shows up
      // immediately. NB: a setHeaders() override here silently loses to the
      // plugin's own cache-control header — don't reintroduce it.
    });
  }
}
