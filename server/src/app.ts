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

/**
 * Кому верим на слово про X-Forwarded-*. Обратный прокси всегда рядом: в docker
 * cloudflared стучится с адреса частной сети, в quick-tunnel — с петли. Чужой
 * запрос прямо с публичного адреса (порт открыт по недосмотру) подделать
 * протокол и ip уже не может, а от этого зависят secure у cookie, ip в логах и
 * ключ лимита попыток логина.
 */
export const TRUST_PROXY = ['loopback', 'linklocal', 'uniquelocal'];

export async function buildApp() {
  const app = Fastify({
    logger: { level: config.logLevel },
    // Trust reverse-proxy headers (X-Forwarded-Proto/Host) so req.protocol is
    // 'https' behind cloudflared/CDN.
    trustProxy: TRUST_PROXY,
  });

  app.get('/api/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  // Every uploaded part is read fully into memory (part.toBuffer() in
  // routes/assets.ts) and the container gets 400 MB, so the ceiling has to stay
  // well under that. The biggest real asset is a ~1.9 MB music loop; 10 MB
  // leaves room for a lossless source without letting one file OOM-kill the box.
  await app.register(fastifyMultipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 20 },
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
