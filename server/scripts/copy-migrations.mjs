import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, 'src', 'db', 'migrations');
const dest = path.join(root, 'dist', 'db', 'migrations');

fs.mkdirSync(dest, { recursive: true });
for (const f of fs.readdirSync(src).filter((f) => f.endsWith('.sql'))) {
  fs.copyFileSync(path.join(src, f), path.join(dest, f));
}
