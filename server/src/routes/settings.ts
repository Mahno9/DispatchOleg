import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';
import { getAllSettings, updateSettings } from '../repos/settings.js';

export async function settingsRoutes(app: FastifyInstance) {
  // no_qr — из env (config.noQr), не из БД: не в SETTING_KEYS, значит и не редактируется
  // через PUT /api/admin/settings ниже.
  app.get('/api/settings', async () => ({ ...getAllSettings(getDb()), no_qr: config.noQr }));

  app.put<{ Body: Record<string, unknown> }>(
    '/api/admin/settings',
    {
      preHandler: app.requireAdmin,
      schema: { body: { type: 'object', minProperties: 1 } },
    },
    async (req, reply) => {
      try {
        return updateSettings(getDb(), req.body);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );
}
