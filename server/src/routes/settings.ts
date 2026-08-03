import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/connection.js';
import { getAllSettings, updateSettings } from '../repos/settings.js';

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', async () => getAllSettings(getDb()));

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
