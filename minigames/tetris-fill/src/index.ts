import {
  EmptyShapeError,
  createFallState,
  hardDrop,
  landingY,
  levelsOf,
  move,
  parseShape,
  rotateActive,
  scoreForElapsed,
  setSoftDrop,
  spawn,
  update,
  type Active,
  type Cell,
  type FallEvent,
  type FallState,
  type LevelConfig,
  type Piece,
  type ScoreThreshold,
  type Shape,
} from './engine.js';

// ---------------------------------------------------------------------------
// Config / callbacks
// ---------------------------------------------------------------------------

type WeightedAudio = { url: string; weight: number; volume?: number };
type AudioValue = string | WeightedAudio[];

interface GameConfig extends LevelConfig {
  /** Уровни по нарастанию сложности; пусто — одна арена из полей верхнего уровня. */
  levels?: LevelConfig[];
  scoreThresholds?: ScoreThreshold[];
  errorPenalty?: number;
  sounds?: {
    rotate?: AudioValue;
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
/** Пауза между уровнями: собранный силуэт успевает вспыхнуть до следующего. */
const LEVEL_MS = 900;
const GAP = 1;
const MIN_CELL = 16;
const MAX_CELL = 48;
/** Rows of empty space kept above the silhouette so a spawning piece is visible. */
const SKY = 2;
/** Auto-repeat of the ◀ ▶ pad buttons while held. */
const REPEAT_MS = 120;
/** Longer than this on ⤓ is a soft drop, shorter is a hard drop. */
const TAP_MS = 250;
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
  flex-direction: column;
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
  padding-top: calc(8px + var(--c) * ${SKY});
  overflow: hidden;
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
.${PREFIX}cell.${PREFIX}ghost {
  border-style: dashed;
  border-color: #E9A928;
  box-shadow: inset 0 0 0 1px rgba(233,169,40,0.35);
}
.${PREFIX}cell.${PREFIX}flash { animation: ${PREFIX}flash 160ms steps(2, end) 2; }

.${PREFIX}piece, .${PREFIX}shadow {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
}
.${PREFIX}piece { z-index: 20; }
.${PREFIX}shadow { z-index: 10; }
.${PREFIX}sq {
  position: absolute;
  box-sizing: border-box;
  background: #6b4d13;
  border: 1px solid #E9A928;
  box-shadow: inset 0 0 0 1px #030B0C;
}
.${PREFIX}shadow .${PREFIX}sq {
  background: transparent;
  border: 1px dashed rgba(233,169,40,0.5);
  box-shadow: none;
}

.${PREFIX}bar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 0 2px;
  font-size: 12px;
  letter-spacing: 0.08em;
  color: #759C96;
}
.${PREFIX}bar .${PREFIX}alert { color: #F0713E; }

.${PREFIX}pad {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  flex: 0 0 auto;
}
.${PREFIX}key {
  padding: 12px 0;
  background: #0A3435;
  border: 1px solid #16A69B;
  box-shadow: inset 0 0 0 1px #062326;
  color: #D3DED5;
  font: inherit;
  font-size: 20px;
  line-height: 1;
  border-radius: 0;
  cursor: pointer;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
}
.${PREFIX}key:active, .${PREFIX}key.${PREFIX}on { background: #12595a; border-color: #5DE2D0; }

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

const intOr = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
};

export function init(container: HTMLElement, config: GameConfig, callbacks: Callbacks): { destroy: () => void; setPaused: (paused: boolean) => void } {
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
  let repeatId = 0;
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

  function stopRepeat(): void {
    if (repeatId) clearInterval(repeatId);
    repeatId = 0;
  }

  function baseDestroy(): void {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    stopRepeat();
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
  const levels = levelsOf(config);
  try {
    // все уровни проверяем сразу: битый силуэт третьего не должен всплыть на третьем уровне
    for (const [i, lv] of levels.entries()) {
      try {
        parseShape(lv.shape as Shape);
      } catch (e) {
        if (levels.length > 1 && e instanceof Error && !(e instanceof EmptyShapeError)) {
          throw new Error(`уровень ${i + 1}: ${e.message}`);
        }
        throw e;
      }
    }
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
    // Битый силуэт: на экране только панель ошибки, замораживать нечего.
    return { destroy: baseDestroy, setPaused: () => {} };
  }

  const errorPenalty = intOr(config.errorPenalty, 5, 0, Number.MAX_SAFE_INTEGER);
  const thresholds = Array.isArray(config.scoreThresholds) ? config.scoreThresholds : [];
  const rng = mulberry32(Date.now());

  // --- per-level state (пересобирается в startLevel) ---
  let levelIndex = 0;
  let state!: FallState;
  let W = 0;
  let H = 0;
  let total = 0;
  let hintAfterErrors = 3;
  let randomizeRotation = true;
  /** Ошибки и детали уже пройденных уровней — текущие живут в state. */
  let errorsDone = 0;
  let piecesDone = 0;

  // --- state ---
  // Заморозка на время инструктажа: деталь не падает, ввод не принимается,
  // а прочитанное время не попадает в счёт — startedAt сдвигается на паузу.
  let held = false;
  let heldAt = 0;
  let startedAt = performance.now();
  const hintOn = (): boolean => state.pieceErrors >= hintAfterErrors;
  let cell = 24;
  let painted = 0;
  let nextTurns = 0;

  // --- chrome ---
  const field = el('div', `${PREFIX}panel ${PREFIX}field`);
  const gridEl = el('div', `${PREFIX}grid`);
  let cellEls: HTMLElement[] = [];

  /** Перерисовывает пустую сетку под силуэт уровня. */
  function buildGrid(cells: Cell[]): void {
    gridEl.innerHTML = '';
    gridEl.style.gridTemplateColumns = `repeat(${W}, var(--c))`;
    cellEls = [];
    const inShape = new Uint8Array(W * H);
    for (const c of cells) inShape[c.y * W + c.x] = 1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const node = el('div', `${PREFIX}cell${inShape[y * W + x] ? '' : ` ${PREFIX}void`}`);
        cellEls.push(node);
        gridEl.appendChild(node);
      }
    }
  }

  const shadowEl = el('div', `${PREFIX}shadow`);
  const pieceEl = el('div', `${PREFIX}piece`);
  field.append(gridEl, shadowEl, pieceEl);

  const muteBtn = el('button', `${PREFIX}mute`);
  muteBtn.setAttribute('aria-label', 'Звук');
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    muteBtn.textContent = muted ? '🔇' : '🔊';
    root.focus({ preventScroll: true });
  });
  field.appendChild(muteBtn);

  const bar = el('div', `${PREFIX}bar`);
  const headEl = el('span');
  const errEl = el('span');
  bar.append(headEl, errEl);

  const pad = el('div', `${PREFIX}pad`);
  root.append(field, bar, pad);

  // --- layout / rendering ---
  const stepPx = (): number => cell + GAP;

  function renderSquares(host: HTMLElement, cs: Cell[]): void {
    host.innerHTML = '';
    for (const c of cs) {
      const sq = el('div', `${PREFIX}sq`);
      sq.style.left = `${c.x * stepPx()}px`;
      sq.style.top = `${c.y * stepPx()}px`;
      sq.style.width = `${cell}px`;
      sq.style.height = `${cell}px`;
      host.appendChild(sq);
    }
  }

  function placeHost(host: HTMLElement, x: number, y: number): void {
    host.style.transform = `translate(${gridEl.offsetLeft + x * stepPx()}px, ${gridEl.offsetTop + y * stepPx()}px)`;
  }

  let shapeKey = '';
  function renderActive(): void {
    const a: Active | null = state.active;
    if (!a || finished) {
      pieceEl.style.display = 'none';
      shadowEl.style.display = 'none';
      shapeKey = '';
      return;
    }
    pieceEl.style.display = '';
    const key = `${levelIndex}:${state.current}:${a.turns}:${cell}`;
    if (key !== shapeKey) {
      shapeKey = key;
      renderSquares(pieceEl, a.shape);
      renderSquares(shadowEl, a.shape);
    }
    placeHost(pieceEl, a.x, a.y);
    const ly = landingY(state);
    placeHost(shadowEl, a.x, ly);
    shadowEl.style.display = ly === a.y ? 'none' : '';
  }

  function relayout(): void {
    const availW = field.clientWidth - 16;
    const availH = field.clientHeight - 16;
    // (H + SKY) rows must fit: the silhouette plus the sky the piece spawns in
    const next = Math.floor(Math.min((availW - (W - 1) * GAP) / W, (availH - (H - 1) * GAP) / (H + SKY)));
    cell = Math.max(MIN_CELL, Math.min(MAX_CELL, Number.isFinite(next) ? next : MIN_CELL));
    root.style.setProperty('--c', `${cell}px`);
    shapeKey = '';
    renderActive();
  }

  const observer = new ResizeObserver(() => relayout());
  observer.observe(field);

  // --- board helpers ---
  function cellAt(x: number, y: number): HTMLElement | undefined {
    if (x < 0 || y < 0 || x >= W || y >= H) return undefined;
    return cellEls[y * W + x];
  }

  function setHint(on: boolean): void {
    for (const node of cellEls) node.classList.remove(`${PREFIX}ghost`);
    if (!on || state.current >= total) return;
    for (const c of (state.pieces[state.current] as Piece).cells) cellAt(c.x, c.y)?.classList.add(`${PREFIX}ghost`);
  }

  const levelTag = (): string => (levels.length > 1 ? `Пробоина ${levelIndex + 1} / ${levels.length} · ` : '');

  function updateBar(): void {
    const pieces = state.current < total ? `Деталь ${state.current + 1} / ${total}` : `Собрано ${total} / ${total}`;
    headEl.textContent = levelTag() + pieces;
    const errors = errorsDone + state.errors;
    errEl.textContent = `Ошибок: ${errors}`;
    errEl.classList.toggle(`${PREFIX}alert`, errors > 0);
  }

  function reportProgress(): void {
    const text = levelTag().toUpperCase() + `СОБРАНО ${state.current} / ${total}`;
    const percent = ((levelIndex + state.current / total) / levels.length) * 100;
    callbacks.onProgress?.(text, Math.round(percent));
  }

  function paintPiece(piece: Piece): void {
    const color = PALETTE[piece.index % PALETTE.length] as string;
    for (const c of piece.cells) {
      const node = cellAt(c.x, c.y);
      if (!node) continue;
      node.classList.add(`${PREFIX}fill`);
      node.classList.remove(`${PREFIX}ghost`);
      node.style.background = color;
    }
  }

  function flash(snap: Active): void {
    for (const c of snap.shape) {
      const node = cellAt(snap.x + c.x, snap.y + c.y);
      if (!node) continue;
      node.classList.add(`${PREFIX}flash`);
      node.addEventListener('animationend', () => node.classList.remove(`${PREFIX}flash`), { once: true });
    }
  }

  // --- game loop ---
  function handle(events: FallEvent[], snap: Active | null): void {
    if (events.length === 0) return;
    for (const ev of events) {
      if (ev === 'placed') {
        play(config.sounds?.place);
        paintPiece(state.pieces[painted++] as Piece);
        nextTurns = randomizeRotation ? Math.floor(rng() * 4) : 0;
        reportProgress();
      } else if (ev === 'rejected') {
        play(config.sounds?.error);
        if (snap) {
          flash(snap);
          nextTurns = snap.turns; // same piece comes back in the same orientation
        }
        // сработало ровно на пороге — подсказка только что зажглась
        if (hintAfterErrors > 0 && state.pieceErrors === hintAfterErrors) play(config.sounds?.hint);
      } else {
        levelDone();
        return;
      }
    }
    updateBar();
    if (!state.active) spawn(state, nextTurns);
    setHint(hintOn());
  }

  let lastFrame = 0;
  function tick(now: number): void {
    rafId = requestAnimationFrame(tick);
    const dt = lastFrame ? now - lastFrame : 0;
    lastFrame = now;
    if (finished || held) return;
    const a = state.active;
    const snap: Active | null = a ? { shape: a.shape, x: a.x, y: a.y, turns: a.turns } : null;
    handle(update(state, dt), snap);
    renderActive();
  }

  function doHardDrop(): void {
    const a = state.active;
    if (finished || held || !a) return;
    const snap: Active = { shape: a.shape, x: a.x, y: landingY(state), turns: a.turns };
    handle(hardDrop(state), snap);
    renderActive();
  }

  function doRotate(): void {
    if (finished || held) return;
    if (rotateActive(state)) {
      play(config.sounds?.rotate);
      shapeKey = '';
      renderActive();
    }
  }

  function doMove(dx: -1 | 1): void {
    if (finished || held) return;
    if (move(state, dx)) renderActive();
  }

  // --- controls (touch first: pad under the field, keyboard in parallel) ---
  function padKey(label: string, down: () => void, up?: () => void): HTMLButtonElement {
    const btn = el('button', `${PREFIX}key`);
    btn.textContent = label;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      root.focus({ preventScroll: true });
      down();
    });
    const release = (): void => up?.();
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
    pad.appendChild(btn);
    return btn;
  }

  function holdMove(dx: -1 | 1): void {
    stopRepeat();
    doMove(dx);
    repeatId = setInterval(() => doMove(dx), REPEAT_MS) as unknown as number;
  }

  padKey('◀', () => holdMove(-1), stopRepeat);
  padKey('▶', () => holdMove(1), stopRepeat);
  padKey('↻', doRotate);

  let dropDownAt = 0;
  padKey(
    '⤓',
    () => {
      dropDownAt = performance.now();
      setSoftDrop(state, true);
    },
    () => {
      if (!state.softDrop) return;
      setSoftDrop(state, false);
      if (performance.now() - dropDownAt < TAP_MS) doHardDrop();
    },
  );

  root.addEventListener('keydown', (e) => {
    if (finished || held) return;
    const k = e.key;
    if (k === 'ArrowLeft') doMove(-1);
    else if (k === 'ArrowRight') doMove(1);
    else if (k === 'ArrowUp' || k === 'r' || k === 'R' || k === 'к' || k === 'К') doRotate();
    else if (k === 'ArrowDown') setSoftDrop(state, true);
    else if (k === ' ' || k === 'Spacebar') {
      if (!e.repeat) doHardDrop();
    } else return;
    e.preventDefault();
  });

  root.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowDown') setSoftDrop(state, false);
  });

  /** Силуэт собран: либо следующий уровень через паузу, либо конец игры. */
  function levelDone(): void {
    stopRepeat();
    renderActive();
    setHint(false);
    updateBar();
    root.classList.add(`${PREFIX}won`);
    if (levelIndex + 1 >= levels.length) {
      win();
      return;
    }
    errorsDone += state.errors;
    piecesDone += total;
    play(config.sounds?.place);
    later(() => {
      root.classList.remove(`${PREFIX}won`);
      startLevel(levelIndex + 1);
    }, LEVEL_MS);
  }

  function win(): void {
    if (finished) return;
    finished = true;
    renderActive();
    play(config.sounds?.win);
    const errors = errorsDone + state.errors;
    const elapsedSeconds = Math.round((performance.now() - startedAt) / 1000);
    const score = Math.max(0, Math.round(scoreForElapsed(thresholds, elapsedSeconds)) - errorPenalty * errors);
    later(() => {
      fadeOut(() =>
        callbacks.onComplete({
          score,
          won: true,
          details: {
            errors,
            pieces: piecesDone + total,
            elapsedSeconds,
            styleTag: errors === 0 ? 'precise' : 'rough',
          },
        }),
      );
    }, WIN_MS);
  }

  /** Собирает поле и состояние под уровень `i` и запускает подачу деталей. */
  function startLevel(i: number): void {
    const lv = levels[i] as LevelConfig;
    const shape = lv.shape as Shape;
    levelIndex = i;
    W = shape.width;
    H = shape.height;
    hintAfterErrors = intOr(lv.hintAfterErrors, 3, 0, Number.MAX_SAFE_INTEGER);
    randomizeRotation = lv.randomizeRotation !== false;
    state = createFallState(shape, {
      fallIntervalMs: intOr(lv.fallIntervalMs, 700, 150, 3000),
      softDropFactor: Math.max(1, Math.min(20, Number(lv.softDropFactor) || 6)),
      lockDelayMs: intOr(lv.lockDelayMs, 500, 0, 2000),
      spawnColumn: lv.spawnColumn === 'target' ? 'target' : 'center',
    });
    total = state.pieces.length;
    painted = 0;
    nextTurns = randomizeRotation ? Math.floor(rng() * 4) : 0;
    buildGrid(parseShape(shape));
    spawn(state, nextTurns);
    relayout();
    updateBar();
    reportProgress();
    setHint(hintOn());
  }

  // --- start ---
  startLevel(0);
  root.focus({ preventScroll: true });
  rafId = requestAnimationFrame(tick);

  return {
    destroy(): void {
      observer.disconnect();
      baseDestroy();
    },
    setPaused(value: boolean): void {
      if (held === value) return;
      held = value;
      if (held) {
        heldAt = performance.now();
        stopRepeat();
        setSoftDrop(state, false);
      } else {
        startedAt += performance.now() - heldAt;
      }
    },
  };
}
