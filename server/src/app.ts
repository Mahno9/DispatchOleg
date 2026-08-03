import Fastify from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import { config } from './config.js';
import { registerAuth } from './plugins/auth.js';
import { registerStatic } from './plugins/static.js';
import { settingsRoutes } from './routes/settings.js';
import { minigamesRoutes } from './routes/minigames.js';
import { gamesRoutes } from './routes/games.js';
import { charactersRoutes } from './routes/characters.js';
import { metaStagesRoutes } from './routes/metaStages.js';
import { dialoguesRoutes } from './routes/dialogues.js';
import { qrRoutes } from './routes/qr.js';
import { sessionRoutes } from './routes/session.js';
import { assetsRoutes } from './routes/assets.js';

export async function buildApp() {
  const app = Fastify({
    logger: { level: config.logLevel },
    // Trust reverse-proxy headers (X-Forwarded-Proto/Host) so req.protocol is
    // 'https' behind cloudflared/CDN.
    trustProxy: true,
  });

  app.get('/api/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  // Allow cross-origin access to public read-only assets (stored files,
  // minigames). Needed in dev where player (5173) and admin (5174) are on
  // different origins from the backend (8081). Harmless in prod (same-origin).
  app.addHook('onSend', async (req, reply) => {
    const { url } = req;
    if (url.startsWith('/assets-store/') || url.startsWith('/minigames/')) {
      void reply.header('Access-Control-Allow-Origin', '*');
    }
  });

  await app.register(fastifyMultipart, {
    limits: { fileSize: 100 * 1024 * 1024, files: 200 },
  });

  await registerAuth(app);
  await app.register(settingsRoutes);
  await app.register(minigamesRoutes);
  await app.register(gamesRoutes);
  await app.register(charactersRoutes);
  await app.register(metaStagesRoutes);
  await app.register(dialoguesRoutes);
  await app.register(qrRoutes);
  await app.register(sessionRoutes);
  await app.register(assetsRoutes);
  await registerStatic(app);

  return app;
}
