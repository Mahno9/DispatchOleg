import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Старт целиком, отдельным процессом: смысл проверки — что видно снаружи
// (stderr и код возврата), когда падает шаг до создания логгера. В docker с
// `restart: unless-stopped` именно это отличает внятный отказ от бесконечного
// цикла перезапуска.
const serverDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let dataDir: string | null = null;

afterEach(() => {
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  dataDir = null;
});

function startServer(dir: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: serverDir,
      env: { ...process.env, DATA_DIR: dir, PORT: '0', LOG_LEVEL: 'silent' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    // Если процесс не упал, он слушает порт и не завершится сам.
    const timer = setTimeout(() => child.kill(), 20_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

describe('падение шага старта', () => {
  it('пишет, на чём именно упало, и выходит с ненулевым кодом', async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-startup-test-'));
    // Файл на месте, но это не база — миграция падает ровно так же, как на
    // повреждённом томе в проде.
    fs.writeFileSync(path.join(dataDir, 'app.sqlite'), 'это не база данных, а мусор');

    const { code, stderr } = await startServer(dataDir);

    expect(code).toBe(1);
    expect(stderr).toMatch(/Отказ старта: не применились миграции БД/);
    expect(stderr).toMatch(/app\.sqlite/);
    // Причина остаётся видна, а не съедается своим же сообщением.
    expect(stderr).toMatch(/not a database/i);
  }, 40_000);
});
