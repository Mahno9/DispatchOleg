// Copies each minigame's built dist into server/static/minigames/<id>/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const minigamesSrc = path.join(root, 'minigames');
const dest = path.join(root, 'server', 'static', 'minigames');

if (!fs.existsSync(minigamesSrc)) process.exit(0);

for (const id of fs.readdirSync(minigamesSrc)) {
  const dist = path.join(minigamesSrc, id, 'dist');
  const assets = path.join(minigamesSrc, id, 'assets');
  if (!fs.existsSync(path.join(dist, 'index.js'))) continue;
  const target = path.join(dest, id);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(dist, target, { recursive: true });
  if (fs.existsSync(assets)) fs.cpSync(assets, path.join(target, 'assets'), { recursive: true });
  console.log(`synced minigame: ${id}`);
}
