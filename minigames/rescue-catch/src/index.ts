/**
 * rescue-catch — DOM/canvas shell around the pure engine.
 *
 * This file takes no game decisions: it mounts a canvas, runs rAF, translates
 * keys into engine input, draws whatever the state says and plays the sounds
 * the engine asked for.
 */

import {
  applyInput,
  createState,
  CRITICAL_LEAD,
  keysOf,
  landingIn,
  multiplierOf,
  progressText,
  styleTagOf,
  update,
  WINDOW_ROWS,
  type EngineConfig,
  type GameEvent,
  type GameState,
  type InputEvent,
} from './engine';

// ---------------------------------------------------------------------------
// Platform contract types
// ---------------------------------------------------------------------------

interface WeightedAudio {
  url: string;
  weight: number;
  volume?: number;
}
type AudioVal = string | WeightedAudio[] | undefined;

export interface GameConfig extends Partial<EngineConfig> {
  muted?: boolean;
  /** 0…100 from the platform's global volume widget; also arrives live via setVolume. */
  musicVolume?: number;
  sfxVolume?: number;
  music?: AudioVal;
  sounds?: {
    catch?: AudioVal;
    miss?: AudioVal;
    inversionWarn?: AudioVal;
    deny?: AudioVal;
    step?: AudioVal;
    spawn?: AudioVal;
    fall?: AudioVal;
    critical?: AudioVal;
    win?: AudioVal;
    lose?: AudioVal;
  };
}

interface GameResult {
  score: number;
  won: boolean;
  details?: Record<string, string | number>;
}

export interface Callbacks {
  onComplete: (result: GameResult) => void;
  onExit?: () => void;
  onProgress?: (text: string, percent?: number) => void;
}

// ---------------------------------------------------------------------------
// Style constants (STYLE.md palette — no new shades)
// ---------------------------------------------------------------------------

const C = {
  bg: '#030B0C',
  panel: '#062326',
  surface: '#0A3435',
  teal: '#16A69B',
  glow: '#5DE2D0',
  muted: '#759C96',
  text: '#D3DED5',
  amber: '#E9A928',
  orange: '#E86836',
  alarm: '#F0713E',
  frame: '#C8A878',
} as const;

const MONO = "'Share Tech Mono', 'IBM Plex Mono', ui-monospace, monospace";
const COND = "'Barlow Condensed', 'Roboto Condensed', 'Arial Narrow', sans-serif";

/** Logical canvas: everything below is expressed in these units. */
const W = 1000;
const H = 600;
const BUILDING = { x: 310, y: 44, w: 380, h: 336 };
const RING = { cx: 500, cy: 468, rx: 250, ry: 74 };
const ARC = { x0: 250, x1: 750, y: 448, sag: 44 };
const OUTRO_MS = 800;
const FADE_MS = 300;
const PREFIX = 'rc-';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const STYLES = `
.${PREFIX}root{position:absolute;inset:0;background:${C.bg};opacity:0;transition:opacity ${FADE_MS}ms linear;overflow:hidden;
touch-action:none;user-select:none;-webkit-user-select:none}
.${PREFIX}root:focus{outline:none}
.${PREFIX}root.${PREFIX}visible{opacity:1}
.${PREFIX}canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}
.${PREFIX}arrows{position:absolute;left:0;right:0;bottom:14px;display:flex;justify-content:space-between;
padding:0 14px;pointer-events:none}
.${PREFIX}arrow{width:24%;max-width:140px;min-width:80px;height:70px;padding:0;cursor:pointer;pointer-events:auto;
touch-action:none;background:${C.surface};color:${C.glow};border:1px solid ${C.teal};border-radius:0;
font:30px ${MONO};opacity:.85}
.${PREFIX}arrow:active{border-color:${C.glow};color:${C.text}}
.${PREFIX}scan{position:absolute;inset:0;pointer-events:none;opacity:.35;
background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.025) 0,rgba(255,255,255,.025) 1px,transparent 1px,transparent 4px)}
.${PREFIX}btn{position:absolute;top:10px;right:10px;width:34px;height:34px;padding:0;cursor:pointer;
background:${C.surface};color:${C.glow};border:1px solid ${C.teal};border-radius:0;font:14px ${MONO};
line-height:32px;transition:border-color 140ms linear,color 140ms linear}
.${PREFIX}btn:hover{border-color:${C.glow};color:${C.text}}
`;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function pointPos(s: GameState, i: number): { x: number; y: number } {
  if (s.cfg.controlVariant === 'stepwise') {
    const p = i / (s.points - 1);
    return { x: lerp(ARC.x0, ARC.x1, p), y: ARC.y + ARC.sag * Math.sin(Math.PI * p) };
  }
  const a = ((210 + (360 / s.points) * i) * Math.PI) / 180;
  return { x: RING.cx + RING.rx * Math.cos(a), y: RING.cy + RING.ry * Math.sin(a) };
}

function windowPos(s: GameState, target: number, floor: number): { x: number; y: number } {
  const p = pointPos(s, target);
  const rowH = (BUILDING.h - 70) / WINDOW_ROWS;
  return {
    x: clamp(p.x, BUILDING.x + 46, BUILDING.x + BUILDING.w - 46),
    y: BUILDING.y + 46 + floor * rowH,
  };
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

export function init(
  container: HTMLElement,
  config: GameConfig,
  callbacks: Callbacks,
): {
  destroy: () => void;
  setPaused: (paused: boolean) => void;
  setVolume: (v: { muted: boolean; musicVolume: number; sfxVolume: number }) => void;
} {
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLES;
  container.appendChild(styleEl);

  const root = document.createElement('div');
  root.className = `${PREFIX}root`;
  root.tabIndex = 0; // keyboard listener lives here, not on window (contract)
  const canvas = document.createElement('canvas');
  canvas.className = `${PREFIX}canvas`;
  const scan = document.createElement('div');
  // ponytail: the platform draws its own CRT overlay; if it reads as double
  // moire on device, delete this element and the .rc-scan rule.
  scan.className = `${PREFIX}scan`;
  const muteBtn = document.createElement('button');
  muteBtn.className = `${PREFIX}btn`;
  root.append(canvas, scan, muteBtn);
  container.appendChild(root);
  requestAnimationFrame(() => root.classList.add(`${PREFIX}visible`));

  const ctx = canvas.getContext('2d');

  // --- state -------------------------------------------------------------
  let state = createState(config, (Date.now() ^ (Math.random() * 0xffffffff)) | 0);
  const keys = keysOf(state.cfg.controlVariant);
  const codeToIndex = new Map<string, number>(keys.map((k, i) => [`Key${k}`, i]));

  let anim = 0; // free-running clock for pulses, seconds
  let paused = false; // фокус потерян — со своим оверлеем
  let held = false; // заморозка платформой на время инструктажа — без оверлея
  let finished = false;
  let outroAt = 0; // performance.now() when the outro ends
  let raf = 0;
  let fadeTimer = 0;
  let last = performance.now();
  let alarm = 0; // whole-scene alarm flash, seconds left
  let bounce = 0; // rescuer hop, seconds left
  const flashes: { point: number; kind: 'catch' | 'miss' | 'deny' | 'step'; t: number }[] = [];

  // --- audio -------------------------------------------------------------
  let muted = config.muted === true;
  const gainOf = (v: unknown, fallback: number): number =>
    Math.max(0, Math.min(100, typeof v === 'number' && Number.isFinite(v) ? v : fallback)) / 100;
  let musicGain = gainOf(config.musicVolume, 100);
  let sfxGain = gainOf(config.sfxVolume, 100);
  const audioCtx = new AudioContext();
  const master = audioCtx.createGain();
  master.gain.value = muted ? 0 : sfxGain;
  master.connect(audioCtx.destination);
  const buffers = new Map<string, AudioBuffer>();
  let music: HTMLAudioElement | null = null;

  function pick(val: AudioVal): { url: string; volume: number } | undefined {
    if (!val) return undefined;
    if (typeof val === 'string') return { url: val, volume: 100 };
    if (!val.length) return undefined;
    let r = Math.random() * val.reduce((sum, v) => sum + v.weight, 0);
    for (const v of val) {
      r -= v.weight;
      if (r <= 0) return { url: v.url, volume: v.volume ?? 100 };
    }
    const lastV = val[val.length - 1]!;
    return { url: lastV.url, volume: lastV.volume ?? 100 };
  }

  function preload(val: AudioVal): void {
    const urls = typeof val === 'string' ? [val] : Array.isArray(val) ? val.map((v) => v.url) : [];
    for (const url of urls) {
      if (!url || buffers.has(url)) continue;
      void fetch(url)
        .then((r) => r.arrayBuffer())
        .then((ab) => audioCtx.decodeAudioData(ab))
        .then((buf) => buffers.set(url, buf))
        .catch(() => {});
    }
  }
  const sounds = config.sounds ?? {};
  for (const val of Object.values(sounds)) preload(val as AudioVal);

  function play(val: AudioVal): void {
    const sound = pick(val);
    if (!sound) return;
    const buf = buffers.get(sound.url);
    if (!buf) return; // still decoding — skipping beats a late blast
    const fire = (): void => {
      const src = audioCtx.createBufferSource();
      const gain = audioCtx.createGain();
      gain.gain.value = clamp(sound.volume, 0, 200) / 100;
      src.buffer = buf;
      src.connect(gain);
      gain.connect(master);
      src.start(0);
    };
    if (audioCtx.state !== 'running')
      void audioCtx
        .resume()
        .then(fire)
        .catch(() => {});
    else fire();
  }

  const musicSound = pick(config.music);
  if (musicSound) {
    music = new Audio(musicSound.url);
    music.loop = true;
  }

  function applyMusicVolume(): void {
    if (!music || !musicSound) return;
    music.volume = clamp((musicSound.volume / 100) * 0.4 * musicGain, 0, 1);
  }

  function syncMusic(): void {
    if (!music) return;
    applyMusicVolume();
    // musicGain at 0 means "don't play", not "play silently" — a looping
    // track would otherwise keep spinning for nothing.
    if (muted || finished || paused || held || musicGain === 0) music.pause();
    else void music.play().catch(() => {});
  }

  function stopMusic(): void {
    if (!music) return;
    music.pause();
    // Пустой src резолвится в адрес страницы — элемент заново лезет в неё за
    // ресурсом и сыплет MEDIA_ELEMENT_ERROR. Снимаем атрибут вместо этого.
    if (music.hasAttribute('src')) {
      music.removeAttribute('src');
      music.load();
    }
    music = null;
  }

  function applyMute(): void {
    master.gain.value = muted ? 0 : sfxGain;
    muteBtn.textContent = muted ? '🔇' : '🔊';
    syncMusic();
  }
  muteBtn.title = 'Звук';
  muteBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    muted = !muted;
    applyMute();
  });
  applyMute();
  // Autoplay stays blocked until the document sees a gesture, and the game mounts
  // under the briefing overlay that eats the first one.
  // ponytail: one top-up attempt, not a retry loop.
  root.addEventListener('pointerdown', syncMusic, { once: true });

  // --- progress / completion --------------------------------------------
  function report(): void {
    const p = progressText(state);
    callbacks.onProgress?.(p.text, p.percent);
  }
  report();

  function finish(): void {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    stopMusic();
    root.classList.remove(`${PREFIX}visible`);
    const s = state;
    fadeTimer = window.setTimeout(() => {
      callbacks.onComplete({
        score: s.score,
        won: s.status === 'won',
        details: {
          controlVariant: s.cfg.controlVariant,
          rescued: s.rescued,
          missed: s.missed,
          bestStreak: s.bestStreak,
          livesLeft: Math.max(0, s.lives),
          styleTag: styleTagOf(s),
        },
      });
    }, FADE_MS);
  }

  /** Turn engine events into sound + effects + panel updates. */
  function drain(events: GameEvent[]): void {
    let touched = false;
    for (const e of events) {
      switch (e.type) {
        case 'catch':
          play(sounds.catch);
          bounce = 0.2;
          flashes.push({ point: e.point ?? state.position, kind: 'catch', t: 0.25 });
          touched = true;
          break;
        case 'miss':
          play(sounds.miss);
          alarm = 0.35;
          flashes.push({ point: e.point ?? state.position, kind: 'miss', t: 0.35 });
          touched = true;
          break;
        case 'deny':
          play(sounds.deny);
          flashes.push({ point: e.point ?? state.position, kind: 'deny', t: 0.18 });
          break;
        case 'step':
          play(sounds.step);
          flashes.push({ point: e.point ?? state.position, kind: 'step', t: 0.14 });
          break;
        // ponytail: no per-frame priority arbiter — two short quiet foley hits in
        // one frame is normal density; if a playtest hears mush, the `volume`
        // field in the admin config fixes it.
        case 'spawn':
          play(sounds.spawn);
          break;
        case 'fall':
          play(sounds.fall);
          break;
        case 'critical':
          play(sounds.critical);
          break;
        case 'inversionWarn':
          play(sounds.inversionWarn);
          break;
        case 'win':
          play(sounds.win);
          touched = true;
          break;
        case 'lose':
          play(sounds.lose);
          touched = true;
          break;
        default:
          break;
      }
    }
    if (touched && !finished) report();
  }

  // --- input -------------------------------------------------------------
  function feed(input: InputEvent): void {
    state = applyInput(state, input, state.now);
    drain(state.events);
  }

  const usesArrows =
    state.cfg.controlVariant === 'inverted' || state.cfg.controlVariant === 'bidirectional';

  function live(): boolean {
    return !paused && !held && !finished && state.status === 'running';
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.repeat || !live()) return;
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      if (!usesArrows) return;
      e.preventDefault();
      feed({ type: 'arrow', dir: e.code === 'ArrowRight' ? 1 : -1 });
      return;
    }
    const index = codeToIndex.get(e.code);
    if (index === undefined) return;
    e.preventDefault();
    feed({ type: 'point', index });
  }
  root.addEventListener('keydown', onKeyDown);

  // Tap a point on the canvas — the only control a phone has.
  canvas.addEventListener('pointerdown', (e) => {
    root.focus({ preventScroll: true });
    if (!live()) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - offX) / scale;
    const y = (e.clientY - rect.top - offY) / scale;
    let hit = -1;
    let best = 44 * 44; // logical units, generous enough for a fingertip
    for (let i = 0; i < state.points; i++) {
      const p = pointPos(state, i);
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < best) {
        best = d;
        hit = i;
      }
    }
    if (hit < 0) return;
    e.preventDefault();
    feed({ type: 'point', index: hit });
  });

  if (usesArrows) {
    const arrows = document.createElement('div');
    arrows.className = `${PREFIX}arrows`;
    for (const dir of [-1, 1] as const) {
      const btn = document.createElement('button');
      btn.className = `${PREFIX}arrow`;
      btn.textContent = dir === 1 ? '▶' : '◀';
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        root.focus({ preventScroll: true });
        if (live()) feed({ type: 'arrow', dir });
      });
      arrows.appendChild(btn);
    }
    root.appendChild(arrows);
  }

  // --- pause -------------------------------------------------------------
  /** Общий хвост обеих заморозок: фокус (`paused`) и инструктаж (`held`). */
  function syncFrozen(): void {
    if (paused || held) {
      void audioCtx.suspend().catch(() => {});
      if (music) music.pause();
      return;
    }
    last = performance.now(); // critical: no multi-second dt on the first frame
    void audioCtx.resume().catch(() => {});
    syncMusic();
  }
  function pause(): void {
    if (paused) return;
    paused = true;
    syncFrozen();
  }
  function resume(): void {
    if (!paused) return;
    paused = false;
    syncFrozen();
  }
  function setPaused(value: boolean): void {
    if (held === value) return;
    held = value;
    syncFrozen();
  }
  const onVisibility = (): void => (document.hidden ? pause() : resume());
  window.addEventListener('blur', pause);
  window.addEventListener('focus', resume);
  document.addEventListener('visibilitychange', onVisibility);

  // --- canvas sizing -----------------------------------------------------
  let scale = 1;
  let offX = 0;
  let offY = 0;
  function resize(): void {
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (!ctx || cw <= 0 || ch <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    scale = Math.min(cw / W, ch / H);
    offX = (cw - W * scale) / 2;
    offY = (ch - H * scale) / 2;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offX * dpr, offY * dpr);
    render();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // --- drawing helpers ---------------------------------------------------
  function glow(color: string, blur: number, width: number, draw: () => void): void {
    if (!ctx) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.lineWidth = width;
    draw();
    ctx.restore();
  }

  function label(
    text: string,
    x: number,
    y: number,
    color: string,
    size: number,
    font = COND,
  ): void {
    if (!ctx) return;
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = `${size}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  /** Angular status bar, STYLE.md style. */
  function statusBar(x: number, y: number, text: string, color: string, align: 'l' | 'r'): void {
    if (!ctx) return;
    ctx.save();
    ctx.font = `16px ${COND}`;
    const w = ctx.measureText(text).width + 22;
    const bx = align === 'l' ? x : x - w;
    ctx.fillStyle = C.surface;
    ctx.fillRect(bx, y, w, 24);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, y + 0.5, w - 1, 23);
    ctx.fillStyle = color;
    ctx.fillRect(bx + 4, y + 8, 6, 8);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + 16, y + 13);
    ctx.restore();
  }

  function drawFrame(): void {
    if (!ctx) return;
    ctx.fillStyle = C.panel;
    ctx.fillRect(16, 16, W - 32, H - 32);
    const cut = 14;
    glow(alarm > 0 ? C.alarm : C.surface, alarm > 0 ? 12 : 0, 2, () => {
      ctx.beginPath();
      ctx.moveTo(10 + cut, 10);
      ctx.lineTo(W - 10 - cut, 10);
      ctx.lineTo(W - 10, 10 + cut);
      ctx.lineTo(W - 10, H - 10 - cut);
      ctx.lineTo(W - 10 - cut, H - 10);
      ctx.lineTo(10 + cut, H - 10);
      ctx.lineTo(10, H - 10 - cut);
      ctx.lineTo(10, 10 + cut);
      ctx.closePath();
      ctx.stroke();
    });
    ctx.strokeStyle = C.frame;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.strokeRect(20.5, 20.5, W - 41, H - 41);
    ctx.globalAlpha = 1;
  }

  function drawBuilding(): void {
    if (!ctx) return;
    const { x, y, w, h } = BUILDING;
    glow(C.teal, 6, 1.5, () => {
      ctx.strokeRect(x, y, w, h);
      ctx.beginPath();
      for (let i = 1; i < WINDOW_ROWS + 1; i++) {
        const fy = y + 22 + (i * (h - 30)) / (WINDOW_ROWS + 1);
        ctx.moveTo(x, fy);
        ctx.lineTo(x + w, fy);
      }
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w / 2, y + h);
      ctx.stroke();
      // roof
      ctx.beginPath();
      ctx.moveTo(x - 18, y);
      ctx.lineTo(x + w + 18, y);
      ctx.moveTo(x + 40, y);
      ctx.lineTo(x + 40, y - 16);
      ctx.moveTo(x + w - 40, y);
      ctx.lineTo(x + w - 40, y - 16);
      ctx.stroke();
    });

    // window grid; a deterministic subset burns
    const cols = 5;
    const rowH = (h - 70) / WINDOW_ROWS;
    const colW = (w - 60) / cols;
    for (let r = 0; r < WINDOW_ROWS; r++) {
      for (let c = 0; c < cols; c++) {
        const wx = x + 30 + c * colW + colW * 0.18;
        const wy = y + 30 + r * rowH;
        const ww = colW * 0.64;
        const wh = rowH * 0.52;
        const burning = (r * 7 + c * 3) % 4 === 0;
        if (burning) {
          const p = 0.5 + 0.5 * Math.sin(anim * 5 + r * 1.7 + c);
          glow(p > 0.5 ? C.orange : C.amber, 10 * p, 1.5, () => ctx.strokeRect(wx, wy, ww, wh));
          ctx.globalAlpha = 0.12 + 0.1 * p;
          ctx.fillStyle = C.orange;
          ctx.fillRect(wx, wy, ww, wh);
          ctx.globalAlpha = 1;
        } else {
          ctx.strokeStyle = C.surface;
          ctx.lineWidth = 1;
          ctx.strokeRect(wx + 0.5, wy + 0.5, ww, wh);
        }
      }
    }
  }

  function pointState(i: number): 'occupied' | 'critical' | 'targeted' | 'blocked' | 'idle' {
    if (i === state.position) return 'occupied';
    const v = state.victims.find((vv) => vv.target === i);
    if (v) return landingIn(v, state.cfg) < CRITICAL_LEAD ? 'critical' : 'targeted';
    if (state.cfg.controlVariant === 'clockwise' && i !== (state.position + 1) % state.points) {
      return 'blocked';
    }
    if (state.cfg.controlVariant === 'bidirectional') {
      const d = (i - state.position + state.points) % state.points;
      if (d !== 1 && d !== state.points - 1) return 'blocked';
    }
    return 'idle';
  }

  function drawPoints(): void {
    if (!ctx) return;
    // the ring/arc guide line
    ctx.save();
    ctx.strokeStyle = C.surface;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < state.points; i++) {
      const p = pointPos(state, i);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    if (state.cfg.controlVariant !== 'stepwise') ctx.closePath();
    ctx.stroke();
    ctx.restore();

    for (let i = 0; i < state.points; i++) {
      const p = pointPos(state, i);
      const st = pointState(i);
      const blink = Math.sin(anim * 12 * Math.PI) > 0;
      const color =
        st === 'occupied'
          ? C.glow
          : st === 'critical'
            ? blink
              ? C.orange
              : C.surface
            : st === 'targeted'
              ? C.amber
              : st === 'blocked'
                ? C.muted
                : C.teal;
      const pulse = st === 'targeted' ? 1 + 0.1 * Math.sin(anim * 8) : 1;
      glow(color, st === 'blocked' ? 0 : 10, st === 'idle' ? 1 : 1.6, () => {
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 15 * pulse, 15 * pulse * 0.62, 0, 0, Math.PI * 2);
        ctx.stroke();
      });
      label(keys[i] ?? '?', p.x, p.y + 26, st === 'blocked' ? C.muted : color, 15, MONO);
    }

    for (const f of flashes) {
      const p = pointPos(state, f.point);
      const a = clamp(f.t * 3, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      const fc =
        f.kind === 'catch'
          ? C.glow
          : f.kind === 'deny'
            ? C.orange
            : f.kind === 'step'
              ? C.teal
              : C.alarm;
      glow(fc, 16, 3, () => {
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 15 + (1 - a) * 22, (15 + (1 - a) * 22) * 0.62, 0, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.restore();
    }
  }

  function drawRescuer(): void {
    if (!ctx) return;
    const p = pointPos(state, state.position);
    const hop = bounce > 0 ? Math.sin((1 - bounce / 0.2) * Math.PI) * 10 : 0;
    const y = p.y - hop;
    glow(C.glow, 12, 2, () => {
      // trampoline
      ctx.beginPath();
      ctx.ellipse(p.x, p.y - 6, 26, 9, 0, 0, Math.PI * 2);
      ctx.stroke();
      // figure holding it
      ctx.beginPath();
      ctx.arc(p.x, y - 44, 7, 0, Math.PI * 2);
      ctx.moveTo(p.x, y - 37);
      ctx.lineTo(p.x, y - 20);
      ctx.moveTo(p.x - 14, y - 14);
      ctx.lineTo(p.x, y - 32);
      ctx.lineTo(p.x + 14, y - 14);
      ctx.moveTo(p.x, y - 20);
      ctx.lineTo(p.x - 9, y - 6);
      ctx.moveTo(p.x, y - 20);
      ctx.lineTo(p.x + 9, y - 6);
      ctx.stroke();
    });
  }

  function drawVictims(): void {
    if (!ctx) return;
    for (const v of state.victims) {
      const from = windowPos(state, v.target, v.window);
      const to = pointPos(state, v.target);
      if (v.phase === 'telegraph') {
        const p = 0.5 + 0.5 * Math.sin(anim * 9);
        glow(C.amber, 8 + 8 * p, 1.5, () => {
          ctx.strokeRect(from.x - 16, from.y - 4, 32, 30);
        });
        drawFigure(from.x, from.y + 12, C.amber);
        // dashed trace window -> point
        ctx.save();
        ctx.setLineDash([6, 8]);
        ctx.globalAlpha = 0.5 + 0.3 * p;
        glow(C.amber, 6, 1, () => {
          ctx.beginPath();
          ctx.moveTo(from.x, from.y + 26);
          ctx.lineTo(to.x, to.y);
          ctx.stroke();
        });
        ctx.restore();
      } else {
        const t = clamp(v.t / state.cfg.fallTime, 0, 1);
        const x = lerp(from.x, to.x, t);
        const y = lerp(from.y + 12, to.y - 12, t) - 48 * Math.sin(Math.PI * t);
        // short motion trail
        for (let k = 1; k <= 3; k++) {
          const tt = Math.max(0, t - k * 0.05);
          ctx.save();
          ctx.globalAlpha = 0.18 * (4 - k);
          drawFigure(
            lerp(from.x, to.x, tt),
            lerp(from.y + 12, to.y - 12, tt) - 48 * Math.sin(Math.PI * tt),
            C.teal,
          );
          ctx.restore();
        }
        drawFigure(x, y, landingIn(v, state.cfg) < CRITICAL_LEAD ? C.orange : C.amber);
      }
    }
  }

  function drawFigure(x: number, y: number, color: string): void {
    if (!ctx) return;
    glow(color, 8, 1.5, () => {
      ctx.beginPath();
      ctx.arc(x, y - 12, 5, 0, Math.PI * 2);
      ctx.moveTo(x, y - 7);
      ctx.lineTo(x, y + 3);
      ctx.moveTo(x - 8, y - 6);
      ctx.lineTo(x + 8, y - 6);
      ctx.moveTo(x, y + 3);
      ctx.lineTo(x - 6, y + 12);
      ctx.moveTo(x, y + 3);
      ctx.lineTo(x + 6, y + 12);
      ctx.stroke();
    });
  }

  function drawHud(): void {
    if (!ctx) return;
    const mult = multiplierOf(state.streak, state.cfg);
    statusBar(28, 28, `СЕРИЯ ×${mult}`, mult > 1 ? C.amber : C.teal, 'l');

    if (state.cfg.controlVariant === 'inverted') {
      const toFlip = state.inversionAt - state.now;
      const warning = toFlip <= state.cfg.inversionWarnTime;
      const text = warning
        ? `REV IN ${Math.max(1, Math.ceil(toFlip))}`
        : state.inverted
          ? 'REV'
          : 'NORM';
      const color = warning
        ? Math.sin(anim * 14) > 0
          ? C.amber
          : C.surface
        : state.inverted
          ? C.orange
          : C.muted;
      statusBar(W - 28, 28, text, color, 'r');
    }

    if (state.cfg.controlVariant === 'stepwise' && state.position !== state.targetIndex) {
      const steps = Math.abs(state.targetIndex - state.position);
      const from = pointPos(state, state.position);
      const to = pointPos(state, state.targetIndex);
      ctx.save();
      ctx.setLineDash([5, 6]);
      glow(C.amber, 6, 1, () => {
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      });
      ctx.restore();
      statusBar(
        W - 28,
        28,
        `ETA ${steps}×${Math.round(state.cfg.stepDelay * 1000)}MS`,
        C.amber,
        'r',
      );
    }

    if (state.cfg.controlVariant === 'clockwise') {
      const next = keys[(state.position + 1) % state.points] ?? '';
      statusBar(W - 28, 28, `NEXT ${next}`, C.glow, 'r');
    }
  }

  function drawBanner(text: string, color: string): void {
    if (!ctx) return;
    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, H / 2 - 46, W, 92);
    ctx.restore();
    glow(color, 14, 2, () => {
      ctx.beginPath();
      ctx.moveTo(0, H / 2 - 46);
      ctx.lineTo(W, H / 2 - 46);
      ctx.moveTo(0, H / 2 + 46);
      ctx.lineTo(W, H / 2 + 46);
      ctx.stroke();
    });
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    label(text, W / 2, H / 2, color, 46);
    ctx.restore();
  }

  function render(): void {
    if (!ctx || container.clientWidth <= 0 || container.clientHeight <= 0) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    drawFrame();
    if (alarm > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(alarm, 0, 1) * 0.12;
      ctx.fillStyle = C.alarm;
      ctx.fillRect(16, 16, W - 32, H - 32);
      ctx.restore();
    }
    drawBuilding();
    drawPoints();
    drawVictims();
    drawRescuer();
    drawHud();

    if (state.status === 'won') drawBanner('MISSION COMPLETE', C.glow);
    else if (state.status === 'lost') drawBanner('MISSION FAILED', C.orange);
    else if (paused) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      label('PAUSED — ФОКУС ПОТЕРЯН', W / 2, H / 2, C.amber, 34);
    }
  }

  // --- loop --------------------------------------------------------------
  function loop(t: number): void {
    raf = requestAnimationFrame(loop);
    const dt = Math.min((t - last) / 1000, 0.1); // clamp lag / background tabs
    last = t;
    if (!paused && !held) {
      anim += dt;
      if (state.status === 'running') {
        state = update(state, dt);
        drain(state.events);
        if (state.status !== 'running') outroAt = t + OUTRO_MS;
      } else if (outroAt && t >= outroAt) {
        finish();
        return;
      }
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i]!;
        f.t -= dt;
        if (f.t <= 0) flashes.splice(i, 1);
      }
      alarm = Math.max(0, alarm - dt);
      bounce = Math.max(0, bounce - dt);
    }
    render();
  }
  raf = requestAnimationFrame(loop);
  root.focus({ preventScroll: true });

  // --- destroy -----------------------------------------------------------
  function destroy(): void {
    finished = true; // destroy never fires onComplete — the platform decides
    cancelAnimationFrame(raf);
    clearTimeout(fadeTimer);
    ro.disconnect();
    root.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('blur', pause);
    window.removeEventListener('focus', resume);
    document.removeEventListener('visibilitychange', onVisibility);
    stopMusic();
    buffers.clear();
    void audioCtx.close().catch(() => {});
    container.innerHTML = '';
  }

  function setVolume(v: { muted: boolean; musicVolume: number; sfxVolume: number }): void {
    musicGain = gainOf(v.musicVolume, 100);
    sfxGain = gainOf(v.sfxVolume, 100);
    muted = v.muted === true;
    applyMute();
  }

  return { destroy, setPaused, setVolume };
}
