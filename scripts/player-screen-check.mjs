// Живая проверка экрана плеера: headless Edge открывает URL (обычно
// `http://localhost:5173/?test=…`), ждёт текст, снимает скриншот и меряет
// элементы — влезает ли подпись, сколько строк, какой отступ до рамки.
//
//   node scripts/player-screen-check.mjs <url> [--wait <текст>] [--measure <css>]...
//        [--min-gap <px>] [--size 1280x800,800x600] [--out <папка для png>]
//
// Код выхода 1, если текст не дождался, селектор не найден, содержимое
// вылезло за элемент или строка ближе к рамке, чем --min-gap (по умолчанию 0).
//
// Порт отладки выбирает сам Edge (0 → DevToolsActivePort в профиле), так что
// зависшие экземпляры на 9333 не мешают; закрывается через CDP Browser.close.

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const args = process.argv.slice(2);
const url = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const opt = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
if (!url) {
  console.error('usage: player-screen-check.mjs <url> [--wait text] [--measure css]... [--size WxH,...] [--out dir]');
  process.exit(2);
}
const waitText = opt('wait')[0];
const selectors = opt('measure');
const sizes = (opt('size')[0] ?? '1280x800').split(',').map((s) => s.split('x').map(Number));
const outDir = opt('out')[0] ?? process.cwd();
const minGap = Number(opt('min-gap')[0] ?? 0);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'psc-edge-'));
const edge = spawn(
  EDGE,
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'],
  { stdio: 'ignore' },
);

let ws;
try {
  let port;
  for (let i = 0; i < 80 && !port; i++) {
    try {
      port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
    } catch {
      await sleep(125);
    }
  }
  if (!port) throw new Error('Edge не открыл порт отладки');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    pending.get(m.id)?.(m);
    pending.delete(m.id);
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      pending.set(++id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) =>
    (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

  await send('Page.enable');
  let failed = false;
  for (const [width, height] of sizes) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    let found = !waitText;
    for (let t = 0; t < 60 && !found; t++) {
      await sleep(250);
      found = await evaluate(`document.body?.innerText.includes(${JSON.stringify(waitText)})`);
    }
    await sleep(600); // шрифты и typewriter-анимации
    if (!found) failed = true;

    const measures = await evaluate(`(${measure})(${JSON.stringify(selectors)}, ${minGap})`);
    const text = await evaluate('document.body.innerText');
    const png = join(outDir, `screen-${width}x${height}.png`);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(png, Buffer.from(shot.result.data, 'base64'));

    console.log(`\n=== ${width}x${height} ===`);
    if (waitText) console.log(`wait «${waitText}»: ${found ? 'найден' : 'НЕ НАЙДЕН'}`);
    console.log(`screenshot: ${png}`);
    for (const m of measures) {
      console.log(`${m.selector}: ${JSON.stringify(m.result)}`);
      if (!m.result.found || !m.result.fits) failed = true;
    }
    console.log(`text: ${text.replace(/\s+/g, ' ').trim().slice(0, 600)}`);
  }
  await send('Browser.close');
  process.exitCode = failed ? 1 : 0;
} finally {
  ws?.close();
  await sleep(500);
  if (edge.exitCode === null) edge.kill();
  await sleep(300);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    // Edge ещё держит файлы профиля — временная папка, не страшно.
  }
}

/** Выполняется в странице: геометрия каждого селектора (первый совпавший элемент). */
function measure(selectors, minGap) {
  return selectors.map((selector) => {
    const el = document.querySelector(selector);
    if (!el) return { selector, result: { found: false } };
    const box = el.getBoundingClientRect();
    const inner = {
      left: box.left + el.clientLeft,
      right: box.left + el.clientLeft + el.clientWidth,
      top: box.top + el.clientTop,
      bottom: box.top + el.clientTop + el.clientHeight,
    };
    // Строки текста: прямоугольники текстовых узлов, сгруппированные по высоте.
    const rows = new Map();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (!r.width) continue;
        const key = Math.round(r.top);
        const row = rows.get(key) ?? { left: r.left, right: r.right };
        rows.set(key, { left: Math.min(row.left, r.left), right: Math.max(row.right, r.right) });
      }
    }
    const lines = [...rows.values()];
    const gaps = lines.flatMap((l) => [l.left - inner.left, inner.right - l.right]);
    const minGapX = gaps.length ? Math.round(Math.min(...gaps) * 10) / 10 : null;
    return {
      selector,
      result: {
        found: true,
        size: `${Math.round(box.width)}x${Math.round(box.height)}`,
        lines: lines.length,
        minGapX,
        fits: el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight && (minGapX ?? minGap) >= minGap,
        text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 80),
      },
    };
  });
}
