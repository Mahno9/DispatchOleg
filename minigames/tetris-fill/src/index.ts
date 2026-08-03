import {
  EmptyShapeError,
  normalize,
  parseShape,
  partition,
  rotate,
  sameCells,
  scoreForElapsed,
  type Cell,
  type Piece,
  type ScoreThreshold,
  type Shape,
} from './engine.js';

// ---------------------------------------------------------------------------
// Config / callbacks
// ---------------------------------------------------------------------------

type WeightedAudio = { url: string; weight: number; volume?: number };
type AudioValue = string | WeightedAudio[];

interface GameConfig {
  shape?: Shape;
  scoreThresholds?: ScoreThreshold[];
  errorPenalty?: number;
  hintAfterErrors?: number;
  randomizeRotation?: boolean;
  sounds?: {
    pickUp?: AudioValue;
    place?: AudioValue;
    error?: AudioValue;
    hint?: AudioValue;
    win?: AudioValue;
  };
  muted?: boolean;
}

interface Callbacks {
  onComplete: (result: { score: number; won: boolean; details?: Record<string, number | string> }) => void;
  onExit: () => void;
  onProgress?: (text: string, percent?: number) => void;
}

const PREFIX = 'tf-';
const FADE_MS = 300;
const WIN_MS = 400;
const GAP = 1;
const MIN_CELL = 16;
const MAX_CELL = 48;
/** Piece colours cycle; neighbours in the deal order never share one. */
const PALETTE = ['#16A69B', '#E9A928', '#E86836', '#C8A878', '#5DE2D0', '#759C96'];

// ---------------------------------------------------------------------------
// Styles — scoped under .tf-root, no global rules
// ---------------------------------------------------------------------------

const STYLES = `
.${PREFIX}root {
  position: absolute;
  inset: 0;
  display: flex;
  gap: 6px;
  padding: 8px;
  box-sizing: border-box;
  background: #030B0C;
  color: #D3DED5;
  font-family: 'Barlow Condensed', 'Roboto Condensed', 'Rajdhani', system-ui, sans-serif;
  font-size: 15px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  overflow: hidden;
  opacity: 0;
  transition: opacity ${FADE_MS}ms ease;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
}
.${PREFIX}root.${PREFIX}visible { opacity: 1; }
.${PREFIX}root:focus { outline: none; }
.${PREFIX}mono { font-family: 'Share Tech Mono', 'IBM Plex Mono', ui-monospace, monospace; }

.${PREFIX}panel {
  background: #062326;
  border: 1px solid #0A3435;
  box-shadow: inset 0 0 0 1px #030B0C;
}
.${PREFIX}field {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
}
.${PREFIX}grid {
  display: grid;
  gap: ${GAP}px;
  transition: filter 160ms ease;
}
.${PREFIX}root.${PREFIX}won .${PREFIX}grid { filter: drop-shadow(0 0 10px rgba(93,226,208,0.75)); }

.${PREFIX}cell {
  width: var(--c);
  height: var(--c);
  box-sizing: border-box;
  background: #0A3435;
  border: 1px solid #16A69B;
  transition: background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
}
.${PREFIX}cell.${PREFIX}void { background: transparent; border-color: transparent; }
.${PREFIX}cell.${PREFIX}fill { border-color: #030B0C; }
.${PREFIX}cell.${PREFIX}ok { background: #12595a; box-shadow: inset 0 0 0 1px #5DE2D0; }
.${PREFIX}cell.${PREFIX}bad { background: #1b2526; border-color: #759C96; }
.${PREFIX}cell.${PREFIX}ghost {
  border-style: dashed;
  border-color: #E9A928;
  box-shadow: inset 0 0 0 1px rgba(233,169,40,0.35);
}
.${PREFIX}cell.${PREFIX}flash { animation: ${PREFIX}flash 160ms steps(2, end) 2; }

.${PREFIX}piece {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 20;
  cursor: grab;
  touch-action: none;
}
.${PREFIX}piece.${PREFIX}drag { cursor: grabbing; }
.${PREFIX}piece.${PREFIX}hidden { display: none; }
.${PREFIX}sq {
  position: absolute;
  box-sizing: border-box;
  background: #6b4d13;
  border: 1px solid #E9A928;
  box-shadow: inset 0 0 0 1px #030B0C;
}
.${PREFIX}piece.${PREFIX}drag .${PREFIX}sq {
  background: #8a6316;
  box-shadow: inset 0 0 0 1px #030B0C, 0 0 8px rgba(233,169,40,0.45);
}

.${PREFIX}tray {
  flex: 0 0 auto;
  width: 168px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  box-sizing: border-box;
}
.${PREFIX}head {
  padding: 2px 6px;
  background: #16A69B;
  color: #030B0C;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.1em;
}
.${PREFIX}stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 64px;
  border: 1px dashed #0A3435;
}
.${PREFIX}line {
  font-size: 12px;
  letter-spacing: 0.08em;
  color: #759C96;
}
.${PREFIX}line.${PREFIX}alert { color: #F0713E; }

.${PREFIX}mute {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #0A3435;
  border: 1px solid #16A69B;
  box-shadow: inset 0 0 0 1px #062326;
  color: #D3DED5;
  border-radius: 0;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  z-index: 30;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.${PREFIX}mute:hover { border-color: #5DE2D0; box-shadow: 0 0 6px rgba(93,226,208,0.35); }

.${PREFIX}fault {
  margin: auto;
  max-width: 420px;
  border: 1px solid #F0713E;
  background: #062326;
  text-align: center;
}
.${PREFIX}fault__status {
  padding: 2px 8px;
  background: #F0713E;
  color: #030B0C;
  font-weight: 700;
  letter-spacing: 0.1em;
  font-size: 12px;
}
.${PREFIX}fault p { margin: 0; padding: 16px 12px; font-size: 14px; letter-spacing: 0.08em; }
.${PREFIX}btn {
  margin: 0 12px 14px;
  padding: 6px 18px;
  background: #0A3435;
  border: 1px solid #E9A928;
  color: #E9A928;
  font: inherit;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border-radius: 0;
  cursor: pointer;
}

@keyframes ${PREFIX}flash {
  50% { background: #E9A928; border-color: #E9A928; }
}
@media (max-width: 640px) {
  .${PREFIX}root { flex-direction: column; }
  .${PREFIX}tray { width: auto; flex: 0 0 auto; flex-direction: row; align-items: center; flex-wrap: wrap; }
  .${PREFIX}stage { min-width: 120px; min-height: 56px; }
}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/** Deterministic-per-session RNG; only decides the orientation a piece is dealt in. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function init(container: HTMLElement, config: GameConfig, callbacks: Callbacks): { destroy: () => void } {
  const styleEl = el('style');
  styleEl.textContent = STYLES;
  container.appendChild(styleEl);

  const root = el('div', `${PREFIX}root`);
  root.tabIndex = 0;
  container.appendChild(root);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add(`${PREFIX}visible`)));
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  const timers = new Set<ReturnType<typeof setTimeout>>();
  let rafId = 0;
  let finished = false;

  function later(fn: () => void, ms: number): void {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  }

  function fadeOut(cb: () => void): void {
    root.classList.remove(`${PREFIX}visible`);
    later(cb, FADE_MS);
  }

  // --- audio ---
  let muted = config.muted === true;
  const audioCache = new Map<string, HTMLAudioElement>();

  function pickSound(value: AudioValue | undefined): { url: string; volume: number } | undefined {
    if (!value) return undefined;
    if (typeof value === 'string') return { url: value, volume: 100 };
    if (!value.length) return undefined;
    let r = Math.random() * value.reduce((s, v) => s + (Number(v.weight) || 0), 0);
    for (const v of value) {
      r -= Number(v.weight) || 0;
      if (r <= 0) return { url: v.url, volume: Number(v.volume) || 100 };
    }
    const last = value[value.length - 1] as WeightedAudio;
    return { url: last.url, volume: Number(last.volume) || 100 };
  }

  function play(value: AudioValue | undefined): void {
    if (muted) return;
    const sound = pickSound(value);
    if (!sound) return;
    let base = audioCache.get(sound.url);
    if (!base) {
      base = new Audio(sound.url);
      base.preload = 'auto';
      audioCache.set(sound.url, base);
    }
    const node = base.cloneNode() as HTMLAudioElement;
    node.volume = Math.max(0, Math.min(1, sound.volume / 100));
    node.play().catch(() => {});
  }

  function baseDestroy(): void {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    for (const audio of audioCache.values()) {
      audio.pause();
      audio.src = '';
    }
    audioCache.clear();
    container.innerHTML = '';
  }

  // --- config parsing (§6: bad silhouette → alarm panel + onExit) ---
  let cells: Cell[];
  try {
    cells = parseShape(config.shape as Shape);
  } catch (e) {
    const box = el('div', `${PREFIX}fault`);
    const status = el('div', `${PREFIX}fault__status`);
    status.textContent = 'ALERT';
    const text = el('p');
    text.textContent =
      e instanceof EmptyShapeError
        ? 'Ошибка конфигурации: силуэт пуст'
        : `Ошибка конфигурации: ${e instanceof Error ? e.message : 'неверный силуэт'}`;
    const exitBtn = el('button', `${PREFIX}btn`);
    exitBtn.textContent = 'Завершить';
    exitBtn.addEventListener('click', () => {
      if (finished) return;
      finished = true;
      fadeOut(() => callbacks.onExit());
    });
    box.append(status, text, exitBtn);
    root.appendChild(box);
    return { destroy: baseDestroy };
  }

  const shape = config.shape as Shape;
  const W = shape.width;
  const H = shape.height;
  const pieces: Piece[] = partition(cells);
  const total = pieces.length;

  const errorPenalty = Number.isFinite(Number(config.errorPenalty))
    ? Math.max(0, Math.round(Number(config.errorPenalty)))
    : 5;
  const hintAfterErrors = Number.isFinite(Number(config.hintAfterErrors))
    ? Math.max(0, Math.round(Number(config.hintAfterErrors)))
    : 3;
  const randomizeRotation = config.randomizeRotation !== false;
  const thresholds = Array.isArray(config.scoreThresholds) ? config.scoreThresholds : [];
  const rng = mulberry32(Date.now());

  // --- state ---
  const startedAt = performance.now();
  let current = 0;
  let errors = 0;
  let turns = 0;
  let hintOn = hintAfterErrors <= 0;
  let cell = 24;

  // --- chrome ---
  const field = el('div', `${PREFIX}panel ${PREFIX}field`);
  const gridEl = el('div', `${PREFIX}grid`);
  gridEl.style.gridTemplateColumns = `repeat(${W}, var(--c))`;
  const cellEls: HTMLElement[] = [];
  const inShape = new Uint8Array(W * H);
  for (const c of cells) inShape[c.y * W + c.x] = 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const node = el('div', `${PREFIX}cell${inShape[y * W + x] ? '' : ` ${PREFIX}void`}`);
      cellEls.push(node);
      gridEl.appendChild(node);
    }
  }
  field.appendChild(gridEl);

  const muteBtn = el('button', `${PREFIX}mute`);
  muteBtn.setAttribute('aria-label', 'Звук');
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    muteBtn.textContent = muted ? '🔇' : '🔊';
    root.focus();
  });
  field.appendChild(muteBtn);

  const tray = el('div', `${PREFIX}panel ${PREFIX}tray`);
  const headEl = el('div', `${PREFIX}head`);
  const stage = el('div', `${PREFIX}stage`);
  const errEl = el('div', `${PREFIX}line`);
  const hintEl = el('div', `${PREFIX}line`);
  hintEl.textContent = 'R / ПКМ — поворот';
  tray.append(headEl, stage, errEl, hintEl);

  const pieceEl = el('div', `${PREFIX}piece`);
  root.append(field, tray, pieceEl);

  interface Drag {
    pointerId: number;
    offX: number;
    offY: number;
    clientX: number;
    clientY: number;
    col: number;
    row: number;
    over: boolean;
  }
  let drag: Drag | null = null;

  // --- layout ---
  function shapeCells(): Cell[] {
    const piece = pieces[current] as Piece;
    return rotate(normalize(piece.cells), turns);
  }

  function bbox(cs: Cell[]): { w: number; h: number } {
    let w = 0;
    let h = 0;
    for (const c of cs) {
      if (c.x + 1 > w) w = c.x + 1;
      if (c.y + 1 > h) h = c.y + 1;
    }
    return { w, h };
  }

  function step(): number {
    return cell + GAP;
  }

  function renderPiece(): void {
    pieceEl.innerHTML = '';
    if (finished || current >= total) {
      pieceEl.classList.add(`${PREFIX}hidden`);
      return;
    }
    pieceEl.classList.remove(`${PREFIX}hidden`);
    const cs = shapeCells();
    const box = bbox(cs);
    pieceEl.style.width = `${box.w * step() - GAP}px`;
    pieceEl.style.height = `${box.h * step() - GAP}px`;
    for (const c of cs) {
      const sq = el('div', `${PREFIX}sq`);
      sq.style.left = `${c.x * step()}px`;
      sq.style.top = `${c.y * step()}px`;
      sq.style.width = `${cell}px`;
      sq.style.height = `${cell}px`;
      pieceEl.appendChild(sq);
    }
  }

  function homePosition(): { x: number; y: number } {
    const rootRect = root.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const box = bbox(shapeCells());
    const pw = box.w * step() - GAP;
    const ph = box.h * step() - GAP;
    return {
      x: Math.round(stageRect.left - rootRect.left + (stageRect.width - pw) / 2),
      y: Math.round(stageRect.top - rootRect.top + (stageRect.height - ph) / 2),
    };
  }

  function goHome(): void {
    if (current >= total) return;
    const p = homePosition();
    pieceEl.style.transform = `translate(${p.x}px, ${p.y}px)`;
  }

  function relayout(): void {
    const availW = field.clientWidth - 20;
    const availH = field.clientHeight - 20;
    const next = Math.floor(Math.min((availW - (W - 1) * GAP) / W, (availH - (H - 1) * GAP) / H));
    cell = Math.max(MIN_CELL, Math.min(MAX_CELL, Number.isFinite(next) ? next : MIN_CELL));
    root.style.setProperty('--c', `${cell}px`);
    renderPiece();
    if (!drag) goHome();
  }

  const observer = new ResizeObserver(() => relayout());
  observer.observe(field);
  observer.observe(stage);

  // --- board helpers ---
  function cellAt(x: number, y: number): HTMLElement | undefined {
    if (x < 0 || y < 0 || x >= W || y >= H) return undefined;
    return cellEls[y * W + x];
  }

  function setHint(on: boolean): void {
    for (const node of cellEls) node.classList.remove(`${PREFIX}ghost`);
    if (!on || current >= total) return;
    for (const c of (pieces[current] as Piece).cells) cellAt(c.x, c.y)?.classList.add(`${PREFIX}ghost`);
  }

  let highlighted: HTMLElement[] = [];
  function clearHighlight(): void {
    for (const node of highlighted) node.classList.remove(`${PREFIX}ok`, `${PREFIX}bad`);
    highlighted = [];
  }

  function highlight(col: number, row: number): void {
    clearHighlight();
    for (const c of shapeCells()) {
      const node = cellAt(col + c.x, row + c.y);
      if (!node) continue;
      const idx = (row + c.y) * W + (col + c.x);
      const free = inShape[idx] === 1 && !node.classList.contains(`${PREFIX}fill`);
      node.classList.add(free ? `${PREFIX}ok` : `${PREFIX}bad`);
      highlighted.push(node);
    }
  }

  function updateTray(): void {
    headEl.textContent = current < total ? `Деталь ${current + 1} / ${total}` : `Собрано ${total} / ${total}`;
    errEl.textContent = `Ошибок: ${errors}`;
    errEl.classList.toggle(`${PREFIX}alert`, errors > 0);
  }

  function reportProgress(): void {
    callbacks.onProgress?.(`СОБРАНО ${current} / ${total}`, Math.round((current / total) * 100));
  }

  // --- drag ---
  function frame(): void {
    rafId = 0;
    const d = drag;
    if (!d) return;
    const rootRect = root.getBoundingClientRect();
    const gridRect = gridEl.getBoundingClientRect();
    let px = d.clientX - rootRect.left - d.offX;
    let py = d.clientY - rootRect.top - d.offY;
    d.over =
      d.clientX >= gridRect.left &&
      d.clientX <= gridRect.right &&
      d.clientY >= gridRect.top &&
      d.clientY <= gridRect.bottom;
    if (d.over) {
      d.col = Math.round((d.clientX - d.offX - gridRect.left) / step());
      d.row = Math.round((d.clientY - d.offY - gridRect.top) / step());
      px = gridRect.left - rootRect.left + d.col * step();
      py = gridRect.top - rootRect.top + d.row * step();
      highlight(d.col, d.row);
    } else {
      clearHighlight();
    }
    pieceEl.style.transform = `translate(${px}px, ${py}px)`;
  }

  function schedule(): void {
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  function endDrag(): void {
    const d = drag;
    drag = null;
    clearHighlight();
    pieceEl.classList.remove(`${PREFIX}drag`);
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (d) {
      try {
        pieceEl.releasePointerCapture(d.pointerId);
      } catch {
        /* pointer already released */
      }
    }
    goHome();
  }

  pieceEl.addEventListener('pointerdown', (e) => {
    if (finished || drag || current >= total) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const rect = pieceEl.getBoundingClientRect();
    drag = {
      pointerId: e.pointerId,
      offX: e.clientX - rect.left,
      offY: e.clientY - rect.top,
      clientX: e.clientX,
      clientY: e.clientY,
      col: 0,
      row: 0,
      over: false,
    };
    pieceEl.classList.add(`${PREFIX}drag`);
    try {
      pieceEl.setPointerCapture(e.pointerId);
    } catch {
      /* capture unavailable — pointer events still bubble */
    }
    root.focus();
    play(config.sounds?.pickUp);
    schedule();
  });

  pieceEl.addEventListener('pointermove', (e) => {
    const d = drag;
    if (!d || e.pointerId !== d.pointerId) return;
    d.clientX = e.clientX;
    d.clientY = e.clientY;
    schedule();
  });

  pieceEl.addEventListener('pointerup', (e) => {
    const d = drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const { over, col, row } = d;
    endDrag();
    if (over) attempt(col, row); // outside the grid = cancel, not an error (§1.3)
  });

  pieceEl.addEventListener('pointercancel', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    endDrag();
  });

  pieceEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    turnPiece();
  });

  root.addEventListener('keydown', (e) => {
    if (finished) return;
    if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') {
      e.preventDefault();
      turnPiece();
    } else if (e.key === 'Escape' && drag) {
      e.preventDefault();
      endDrag();
    }
  });

  function turnPiece(): void {
    if (finished || current >= total) return;
    turns = (turns + 1) % 4;
    // keep the grab point inside the new bounding box
    const box = bbox(shapeCells());
    if (drag) {
      drag.offX = Math.min(drag.offX, box.w * step() - GAP);
      drag.offY = Math.min(drag.offY, box.h * step() - GAP);
    }
    renderPiece();
    if (drag) schedule();
    else goHome();
  }

  // --- placement ---
  function attempt(col: number, row: number): void {
    const piece = pieces[current] as Piece;
    const placed = shapeCells().map((c) => ({ x: col + c.x, y: row + c.y }));
    if (sameCells(placed, piece.cells)) {
      const color = PALETTE[piece.index % PALETTE.length] as string;
      for (const c of piece.cells) {
        const node = cellAt(c.x, c.y);
        if (!node) continue;
        node.classList.add(`${PREFIX}fill`);
        node.classList.remove(`${PREFIX}ghost`);
        node.style.background = color;
      }
      play(config.sounds?.place);
      current++;
      turns = randomizeRotation ? Math.floor(rng() * 4) : 0;
      updateTray();
      reportProgress();
      if (current >= total) {
        win();
        return;
      }
      renderPiece();
      goHome();
      setHint(hintOn);
      return;
    }

    errors++;
    play(config.sounds?.error);
    for (const c of placed) {
      const node = cellAt(c.x, c.y);
      if (!node) continue;
      node.classList.add(`${PREFIX}flash`);
      node.addEventListener('animationend', () => node.classList.remove(`${PREFIX}flash`), { once: true });
    }
    updateTray();
    if (!hintOn && errors >= hintAfterErrors) {
      hintOn = true;
      play(config.sounds?.hint);
      setHint(true);
    }
  }

  function win(): void {
    if (finished) return;
    finished = true;
    renderPiece();
    setHint(false);
    root.classList.add(`${PREFIX}won`);
    play(config.sounds?.win);
    const elapsedSeconds = Math.round((performance.now() - startedAt) / 1000);
    const score = Math.max(0, Math.round(scoreForElapsed(thresholds, elapsedSeconds)) - errorPenalty * errors);
    later(() => {
      fadeOut(() =>
        callbacks.onComplete({
          score,
          won: true,
          details: {
            errors,
            pieces: total,
            elapsedSeconds,
            styleTag: errors === 0 ? 'precise' : 'rough',
          },
        }),
      );
    }, WIN_MS);
  }

  // --- start ---
  turns = randomizeRotation ? Math.floor(rng() * 4) : 0;
  relayout();
  updateTray();
  reportProgress();
  setHint(hintOn);
  root.focus({ preventScroll: true });

  return {
    destroy(): void {
      observer.disconnect();
      endDrag();
      baseDestroy();
    },
  };
}
