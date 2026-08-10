import {
  DOT_RADIUS,
  ZONE_RADIUS,
  type DotState,
  type Maze,
  type MazeType,
  type PatrolParams,
  type PatrolState,
  type PhysicsParams,
  type Pt,
  type Wall,
  applyBounce,
  classifyHit,
  computeScore,
  computeStyleTag,
  distancePointSegment,
  generateMaze,
  makePatrol,
  patrolCatches,
  stepPatrol,
  stepPhysics,
} from './engine.js';

// Re-exported for the admin preview widget (x-type "maze-preview"), which
// imports this bundle at runtime to draw a maze from generatorParams.
export { generateMazeDetailed } from './engine.js';

// ---------------------------------------------------------------------------
// Config / callbacks
// ---------------------------------------------------------------------------

interface WeightedAudio {
  url: string;
  weight: number;
  volume?: number;
}
type SoundVal = string | WeightedAudio[] | undefined;

interface GeneratorParamsRaw {
  type?: string;
  size?: number;
  breakableDensity?: number;
  seed?: number;
  patrols?: number;
}

interface MazeConfig {
  generatorParams?: GeneratorParamsRaw;
  walls?: Wall[];
  start?: Pt;
  finish?: Pt;
  patrols?: Pt[];
  scale?: number;
  scorePerMaze?: number;
}

interface GameConfig {
  screamerImage?: string;
  screamerSound?: SoundVal;
  screamerDurationMs?: number;
  followSpeed?: number;
  bounceSpeed?: number;
  bounceDurationMs?: number;
  breakAngleDeg?: number;
  breakMinSpeedRatio?: number;
  breakerThreshold?: number;
  penaltyPerReset?: number;
  patrolLightRadius?: number;
  patrolSpeed?: number;
  patrolSearchMs?: number;
  patrolCatchSpeedRatio?: number;
  mazes?: MazeConfig[];
  sounds?: {
    wallBreak?: SoundVal;
    mazeComplete?: SoundVal;
    gameComplete?: SoundVal;
    ambient?: SoundVal;
  };
  muted?: boolean;
}

interface Callbacks {
  onComplete: (result: {
    score: number;
    won: boolean;
    details: { wallsBroken: number; totalBreakable: number; styleTag: 'ghost' | 'breaker' };
  }) => void;
  onExit: () => void;
  onProgress?: (text: string, percent?: number) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PREFIX = 'tm-';
const FADE_MS = 300;
const FINISH_FLASH_MS = 250;
const SHARD_MS = 400;
const MARGIN = 0.05;

const C = {
  bg: '#030B0C',
  grid: '#0A3435',
  wall: '#5DE2D0',
  breakable: '#E9A928',
  dot: '#D3DED5',
  alarm: '#F0713E',
  frame: '#C8A878',
  muted: '#759C96',
};

const STYLES = `
.${PREFIX}root {
  position: absolute; inset: 0; overflow: hidden;
  background: ${C.bg};
  opacity: 0; transition: opacity ${FADE_MS}ms ease;
  user-select: none; touch-action: none; cursor: none;
  font-family: 'Barlow Condensed', 'Roboto Condensed', 'IBM Plex Mono', system-ui, sans-serif;
}
.${PREFIX}root.${PREFIX}visible { opacity: 1; }
.${PREFIX}canvas { display: block; width: 100%; height: 100%; }
.${PREFIX}mute {
  position: absolute; top: 10px; right: 10px; width: 32px; height: 32px;
  padding: 0; border-radius: 0; cursor: pointer;
  background: rgba(6,35,38,0.8); border: 1px solid ${C.frame};
  box-shadow: inset 0 0 0 1px rgba(93,226,208,0.15);
  color: ${C.wall}; display: flex; align-items: center; justify-content: center;
  transition: box-shadow 140ms ease, border-color 140ms ease;
}
.${PREFIX}mute:hover { border-color: ${C.wall}; box-shadow: 0 0 8px rgba(93,226,208,0.5); }
.${PREFIX}mute svg { width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 1.5; }
.${PREFIX}mute.${PREFIX}off { color: ${C.muted}; }
`;

const SPEAKER_SVG =
  '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path class="wave" d="M16 9c1.4 1.6 1.4 4.4 0 6"/><path class="cross" d="M16 9l5 6M21 9l-5 6" style="display:none"/></svg>';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function num(v: number | undefined, dflt: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : dflt;
  return Math.max(min, Math.min(max, n));
}

function pickSound(val: SoundVal): { url: string; volume: number } | undefined {
  if (!val) return undefined;
  if (typeof val === 'string') return { url: val, volume: 100 };
  if (!val.length) return undefined;
  const vol = (w: WeightedAudio): number => num(w.volume, 100, 0, 200);
  let r = Math.random() * val.reduce((s, v) => s + Math.max(0, v.weight), 0);
  for (const v of val) {
    r -= Math.max(0, v.weight);
    if (r <= 0) return { url: v.url, volume: vol(v) };
  }
  const last = val[val.length - 1] as WeightedAudio;
  return { url: last.url, volume: vol(last) };
}

/** Deterministic per-wall pseudo random in [0,1) — for crack decoration. */
function hash01(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// ---------------------------------------------------------------------------

interface RtMaze {
  walls: Wall[];
  start: Pt;
  finish: Pt;
  patrols: Pt[];
  scale: number;
  score: number;
  breakableGroups: number;
}

const isFiniteWall = (w: Wall): boolean =>
  [w.x1, w.y1, w.x2, w.y2].every((v) => typeof v === 'number' && Number.isFinite(v));

/** Logical wall id: pieces of one arc share a group and break together. */
const groupOf = (w: Wall, index: number): number => (typeof w.group === 'number' ? w.group : -1 - index);

function normalizeMaze(raw: MazeConfig, index: number): RtMaze {
  let walls = Array.isArray(raw.walls) ? raw.walls.filter(isFiniteWall) : [];
  let start = raw.start;
  let finish = raw.finish;
  let patrols = Array.isArray(raw.patrols)
    ? raw.patrols.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y))
    : [];
  if (walls.length === 0) {
    // Not generated in the admin yet — reproduce it from the (deterministic)
    // generator params so the game is playable straight out of the form.
    const g = raw.generatorParams ?? {};
    const byIndex: MazeType = index === 1 ? 'hex' : index === 2 ? 'circular' : 'square';
    const type: MazeType =
      g.type === 'hex' || g.type === 'circular' || g.type === 'square' ? g.type : byIndex;
    const maze: Maze = generateMaze({
      type,
      size: Math.round(num(g.size, 8, 3, 20)),
      breakableDensity: num(g.breakableDensity, 0.15, 0, 1),
      seed: Math.floor(num(g.seed, 1 + index * 7919, -2147483648, 2147483647)),
      patrols: Math.round(num(g.patrols, 0, 0, 3)),
    });
    walls = maze.walls;
    start = maze.start;
    finish = maze.finish;
    patrols = maze.patrols ?? [];
  }
  const groups = new Set<number>();
  walls.forEach((w, i) => {
    if (w.breakable) groups.add(groupOf(w, i));
  });
  return {
    walls,
    start: start ?? { x: 0.5, y: 0.5 },
    finish: finish ?? { x: 0.5, y: 0.5 },
    patrols,
    scale: num(raw.scale, 1, 0.3, 3),
    score: Math.round(num(raw.scorePerMaze, 100, 0, 1e6)),
    breakableGroups: groups.size,
  };
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

export function init(
  container: HTMLElement,
  config: GameConfig,
  callbacks: Callbacks,
): { destroy: () => void; setPaused: (paused: boolean) => void } {
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLES;
  container.appendChild(styleEl);

  const root = document.createElement('div');
  root.className = `${PREFIX}root`;
  container.appendChild(root);
  const canvas = document.createElement('canvas');
  canvas.className = `${PREFIX}canvas`;
  root.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add(`${PREFIX}visible`)));

  // --- config ---
  const params: PhysicsParams = {
    followSpeed: Math.round(num(config.followSpeed, 600, 100, 2000)),
    bounceSpeed: Math.round(num(config.bounceSpeed, 400, 0, 2000)),
    bounceDurationMs: Math.round(num(config.bounceDurationMs, 300, 0, 2000)),
    breakAngleDeg: Math.round(num(config.breakAngleDeg, 40, 5, 89)),
    breakMinSpeedRatio: num(config.breakMinSpeedRatio, 0.55, 0, 1),
  };
  const patrolParams: PatrolParams = {
    lightRadius: Math.round(num(config.patrolLightRadius, 56, 20, 200)),
    speed: Math.round(num(config.patrolSpeed, 260, 50, 2000)),
    searchMs: Math.round(num(config.patrolSearchMs, 2500, 0, 10000)),
    orbitRadius: 7,
    orbitPeriodS: 4,
  };
  const patrolCatchSpeed = num(config.patrolCatchSpeedRatio, 0.35, 0, 1) * params.followSpeed;
  const screamerMs = Math.round(num(config.screamerDurationMs, 1200, 300, 4000));
  const breakerThreshold = Math.round(num(config.breakerThreshold, 1, 1, 1e6));
  const penaltyPerReset = Math.round(num(config.penaltyPerReset, 50, 0, 1e6));
  const sounds = config.sounds ?? {};
  const mazes: RtMaze[] = (Array.isArray(config.mazes) ? config.mazes : []).map(normalizeMaze);
  const totalBreakable = mazes.reduce((s, m) => s + m.breakableGroups, 0);

  // --- audio ---
  let muted = config.muted === true;
  let ambient: HTMLAudioElement | null = null;
  const live: HTMLAudioElement[] = [];

  function play(val: SoundVal): void {
    const s = pickSound(val);
    if (muted || !s) return;
    const a = new Audio(s.url);
    a.volume = Math.min(s.volume / 100, 1);
    a.addEventListener('ended', () => {
      const i = live.indexOf(a);
      if (i >= 0) live.splice(i, 1);
    });
    live.push(a);
    a.play().catch(() => {});
  }

  function syncAmbient(on: boolean): void {
    if (on && !muted) {
      if (!ambient) {
        const s = pickSound(sounds.ambient);
        if (!s) return;
        ambient = new Audio(s.url);
        ambient.loop = true;
        ambient.volume = Math.min((s.volume / 100) * 0.5, 1);
      }
      ambient.play().catch(() => {});
    } else if (ambient) {
      ambient.pause();
    }
  }

  // --- mute button ---
  const muteBtn = document.createElement('button');
  muteBtn.className = `${PREFIX}mute`;
  muteBtn.type = 'button';
  muteBtn.title = 'ЗВУК';
  muteBtn.innerHTML = SPEAKER_SVG;
  function renderMute(): void {
    muteBtn.classList.toggle(`${PREFIX}off`, muted);
    const wave = muteBtn.querySelector<SVGPathElement>('.wave');
    const cross = muteBtn.querySelector<SVGPathElement>('.cross');
    if (wave) wave.style.display = muted ? 'none' : '';
    if (cross) cross.style.display = muted ? '' : 'none';
  }
  renderMute();
  muteBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    muted = !muted;
    renderMute();
    if (muted) {
      for (const a of live) a.pause();
      live.length = 0;
    }
    syncAmbient(phase === 'ACTIVE');
  });
  root.appendChild(muteBtn);

  // --- screamer image (lazy, silent fallback on error) ---
  let screamerImg: HTMLImageElement | null = null;
  if (config.screamerImage) {
    const img = new Image();
    img.onload = () => {
      screamerImg = img;
    };
    img.onerror = () => {
      screamerImg = null;
    };
    img.src = config.screamerImage;
  }

  // --- layout: normalized maze -> css pixels ---
  let side = 1;
  let ox = 0;
  let oy = 0;
  let cw = 1;
  let ch = 1;
  let dpr = 1;

  function layout(): { side: number; ox: number; oy: number } {
    const rect = root.getBoundingClientRect();
    cw = Math.max(1, rect.width);
    ch = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(cw * dpr);
    canvas.height = Math.floor(ch * dpr);
    const s = Math.min(cw, ch) * (1 - 2 * MARGIN) * (mz?.scale ?? 1);
    return { side: s, ox: (cw - s) / 2, oy: (ch - s) / 2 };
  }

  const toPx = (p: Pt): Pt => ({ x: ox + p.x * side, y: oy + p.y * side });

  // --- game state ---
  type Phase = 'FROZEN' | 'ACTIVE' | 'SCREAMER' | 'FINISH';
  let mazeIndex = 0;
  let mz: RtMaze | undefined = mazes[0];
  let phase: Phase = 'FROZEN';
  let dot: DotState | null = null;
  const target: Pt = { x: 0, y: 0 };
  let pointerInside = false;
  let brokenGroups = new Set<number>();
  let activeWalls: Wall[] = [];
  let wallsBrokenCurrent = 0;
  let wallsBrokenTotal = 0;
  let resets = 0;
  const earned: number[] = [];
  let shards: { x: number; y: number; vx: number; vy: number; born: number }[] = [];
  let patrols: PatrolState[] = [];
  let deadline = 0; // end of SCREAMER / FINISH flash
  let paused = false; // фокус потерян — со своим оверлеем «П А У З А»
  let held = false; // заморозка платформой на время инструктажа — без оверлея
  let skipPhysics = false;
  let finished = false;
  let rafId: number | null = null;
  let timerId: number | null = null;
  let last = performance.now();

  function rebuildWalls(): void {
    if (!mz) {
      activeWalls = [];
      return;
    }
    activeWalls = [];
    mz.walls.forEach((w, i) => {
      if (brokenGroups.has(groupOf(w, i))) return;
      activeWalls.push({
        x1: ox + w.x1 * side,
        y1: oy + w.y1 * side,
        x2: ox + w.x2 * side,
        y2: oy + w.y2 * side,
        breakable: w.breakable === true,
        group: groupOf(w, i),
      });
    });
  }

  function resetPatrols(): void {
    patrols = (mz?.patrols ?? []).map((p, i) => makePatrol(toPx(p), i));
  }

  function applyLayout(): void {
    const prev = { side, ox, oy };
    const next = layout();
    side = next.side;
    ox = next.ox;
    oy = next.oy;
    const remap = (p: Pt): void => {
      if (prev.side <= 0) return;
      p.x = ox + ((p.x - prev.ox) / prev.side) * side;
      p.y = oy + ((p.y - prev.oy) / prev.side) * side;
    };
    remap(target);
    if (dot) remap(dot);
    for (const p of patrols) {
      remap(p); // PatrolState carries its own x/y
      remap(p.post);
      remap(p.target);
    }
    rebuildWalls();
    skipPhysics = true; // one physics-free frame so remapping cannot fake a touch
  }

  function progress(): void {
    callbacks.onProgress?.(
      `ЛАБИРИНТ ${Math.min(mazeIndex + 1, mazes.length)} / ${mazes.length}`,
      Math.round((mazeIndex / Math.max(1, mazes.length)) * 100),
    );
  }

  function loadMaze(i: number): void {
    mazeIndex = i;
    mz = mazes[i];
    phase = 'FROZEN';
    dot = null;
    brokenGroups = new Set();
    wallsBrokenCurrent = 0;
    shards = [];
    applyLayout();
    resetPatrols();
    progress();
    syncAmbient(false);
  }

  function complete(): void {
    if (finished) return;
    finished = true;
    syncAmbient(false);
    const styleTag = computeStyleTag(wallsBrokenTotal, breakerThreshold);
    const score = computeScore(earned, resets, penaltyPerReset);
    root.classList.remove(`${PREFIX}visible`);
    timerId = window.setTimeout(() => {
      callbacks.onComplete({
        score,
        won: true,
        details: { wallsBroken: wallsBrokenTotal, totalBreakable, styleTag },
      });
    }, FADE_MS);
  }

  function finishMaze(now: number): void {
    phase = 'FINISH';
    deadline = now + FINISH_FLASH_MS;
    wallsBrokenTotal += wallsBrokenCurrent;
    earned.push(mz?.score ?? 0);
    syncAmbient(false);
    play(mazeIndex + 1 >= mazes.length ? sounds.gameComplete : sounds.mazeComplete);
  }

  function screamer(now: number): void {
    phase = 'SCREAMER';
    deadline = now + screamerMs;
    resets++;
    syncAmbient(false);
    play(config.screamerSound);
  }

  function breakWall(hit: Wall, col: { cx: number; cy: number; nx: number; ny: number }, now: number): void {
    brokenGroups.add(hit.group as number);
    wallsBrokenCurrent++;
    rebuildWalls();
    for (const p of patrols) {
      p.mode = 'ALERT';
      p.target = { x: col.cx, y: col.cy }; // a second breach simply re-aims them
    }
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 140;
      shards.push({ x: col.cx, y: col.cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, born: now });
    }
    play(sounds.wallBreak);
  }

  // --- input ---
  function onPointerMove(e: PointerEvent): void {
    const r = canvas.getBoundingClientRect();
    target.x = e.clientX - r.left;
    target.y = e.clientY - r.top;
    pointerInside = true;
  }
  function onPointerLeave(): void {
    // Target simply stops updating; physics keeps running (spec 6.1).
    pointerInside = false;
  }
  function onBlur(): void {
    paused = true;
    syncAmbient(false);
  }
  function onFocus(): void {
    paused = false;
    syncAmbient(!held && phase === 'ACTIVE');
  }
  function setPaused(value: boolean): void {
    if (held === value) return;
    held = value;
    syncAmbient(!held && !paused && phase === 'ACTIVE');
  }
  function onVisibility(): void {
    if (document.hidden) onBlur();
    else onFocus();
  }
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibility);

  const ro = new ResizeObserver(() => applyLayout());
  ro.observe(root);

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  function update(dt: number, now: number): void {
    if (!mz) return;
    const startPx = toPx(mz.start);
    const finishPx = toPx(mz.finish);

    if (phase === 'SCREAMER') {
      if (now >= deadline) {
        // full reset of the current maze, kept counters stay kept (spec 6.4)
        brokenGroups = new Set();
        wallsBrokenCurrent = 0;
        shards = [];
        dot = null;
        phase = 'FROZEN';
        rebuildWalls();
        resetPatrols();
        progress();
      }
      return;
    }
    if (phase === 'FINISH') {
      if (now >= deadline) {
        if (mazeIndex + 1 >= mazes.length) complete();
        else loadMaze(mazeIndex + 1);
      }
      return;
    }
    // Lights circle while frozen too — the danger is visible before the start.
    patrols = patrols.map((p) => stepPatrol(p, dt, patrolParams));

    if (phase === 'FROZEN') {
      if (pointerInside && Math.hypot(target.x - startPx.x, target.y - startPx.y) <= ZONE_RADIUS) {
        // Materialize at the cursor (no spring jerk), unless that spot already
        // touches a wall — then use the start centre, or the player would be
        // screamed at for materializing.
        const safe = activeWalls.every(
          (w) => distancePointSegment(target.x, target.y, w.x1, w.y1, w.x2, w.y2).dist > DOT_RADIUS + 1,
        );
        const p = safe ? target : startPx;
        dot = { x: p.x, y: p.y, vx: 0, vy: 0, relaxMs: 0 };
        phase = 'ACTIVE';
        syncAmbient(true);
      }
      return;
    }
    // ACTIVE
    if (!dot) return;
    const r = stepPhysics(dot, target, dt, activeWalls, params);
    dot = r.state;
    if (r.collision) {
      const hit = activeWalls[r.collision.wallIndex] as Wall;
      const verdict = classifyHit(hit, r.collision.nx, r.collision.ny, dot.vx, dot.vy, params);
      if (verdict === 'break') {
        breakWall(hit, r.collision, now);
        dot = applyBounce(dot, r.collision, params);
      } else {
        screamer(now);
      }
      return;
    }
    // ponytail: caught check once per frame, not per substep — light is >=20px
    // wide and the dot moves at most followSpeed*0.05 per frame, so no tunneling.
    for (const p of patrols) {
      if (patrolCatches(p.x, p.y, dot, patrolParams.lightRadius, patrolCatchSpeed)) {
        screamer(now);
        return;
      }
    }
    if (Math.hypot(dot.x - finishPx.x, dot.y - finishPx.y) <= ZONE_RADIUS) finishMaze(now);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  function drawWalls(now: number): void {
    if (!ctx) return;
    const pulse = 0.75 + 0.25 * Math.sin((now / 1500) * Math.PI * 2);
    ctx.lineCap = 'round';
    // solid walls
    ctx.strokeStyle = C.wall;
    ctx.lineWidth = 2;
    ctx.shadowColor = C.wall;
    ctx.shadowBlur = 6;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const w of activeWalls) {
      if (w.breakable) continue;
      ctx.moveTo(w.x1, w.y1);
      ctx.lineTo(w.x2, w.y2);
    }
    ctx.stroke();
    // breakable: amber dashes + cracks
    ctx.strokeStyle = C.breakable;
    ctx.shadowColor = C.breakable;
    ctx.globalAlpha = pulse;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    for (const w of activeWalls) {
      if (!w.breakable) continue;
      ctx.moveTo(w.x1, w.y1);
      ctx.lineTo(w.x2, w.y2);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const w of activeWalls) {
      if (!w.breakable) continue;
      const g = w.group as number;
      for (let k = 0; k < 3; k++) {
        const t = 0.25 + 0.25 * k;
        const cx = w.x1 + (w.x2 - w.x1) * t;
        const cy = w.y1 + (w.y2 - w.y1) * t;
        const a = hash01(g, k) * Math.PI * 2;
        const l = 3 + hash01(g, k + 10) * 4;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  function drawZone(p: Pt, color: string, dbl: boolean, alpha: number): void {
    if (!ctx) return;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, ZONE_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    if (dbl) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, ZONE_RADIUS - 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  function render(now: number): void {
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, cw, ch);

    // technical grid
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= cw; x += 40) {
      ctx.moveTo(Math.floor(x) + 0.5, 0);
      ctx.lineTo(Math.floor(x) + 0.5, ch);
    }
    for (let y = 0; y <= ch; y += 40) {
      ctx.moveTo(0, Math.floor(y) + 0.5);
      ctx.lineTo(cw, Math.floor(y) + 0.5);
    }
    ctx.stroke();

    if (mz) {
      const startPx = toPx(mz.start);
      const finishPx = toPx(mz.finish);
      drawWalls(now);

      // searchlights: status colour + label, plus a noise meter when the dot is inside
      const hud = {
        IDLE: { rgb: '211,222,213', color: C.dot, alpha: 0.13, label: 'ДОЗОР' },
        ALERT: { rgb: '240,113,62', color: C.alarm, alpha: 0.25, label: 'ТРЕВОГА' },
        SEARCH: { rgb: '240,113,62', color: C.alarm, alpha: 0.25, label: 'ОБЫСК' },
        RETURN: { rgb: '117,156,150', color: C.muted, alpha: 0.12, label: 'ОТБОЙ' },
      };
      const r = patrolParams.lightRadius;
      for (const p of patrols) {
        const h = hud[p.mode];
        // noise: how close the dot's speed is to the catch threshold, 0 when outside the light
        const t =
          dot && Math.hypot(dot.x - p.x, dot.y - p.y) <= r
            ? Math.min(1, Math.hypot(dot.vx, dot.vy) / patrolCatchSpeed)
            : 0;
        const loud = t >= 0.6;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, `rgba(${h.rgb},${(h.alpha + t * 0.15).toFixed(3)})`);
        g.addColorStop(0.6, `rgba(${h.rgb},${(h.alpha * 0.45).toFixed(3)})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = h.color;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (t > 0) {
          ctx.strokeStyle = loud ? C.alarm : C.breakable;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
          ctx.stroke();
          ctx.lineWidth = 1;
        }
        ctx.fillStyle = loud ? C.alarm : h.color;
        ctx.globalAlpha = loud ? 0.9 : 0.8;
        ctx.font = `700 11px 'Barlow Condensed', system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(loud ? 'СЛЫШУ!' : h.label, p.x, p.y + 1);
        ctx.globalAlpha = 1;
      }
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';

      // shards of freshly broken walls
      ctx.strokeStyle = C.breakable;
      ctx.lineWidth = 1.5;
      shards = shards.filter((s) => now - s.born < SHARD_MS);
      for (const s of shards) {
        const t = (now - s.born) / 1000;
        const x = s.x + s.vx * t;
        const y = s.y + s.vy * t;
        ctx.globalAlpha = 1 - (now - s.born) / SHARD_MS;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + s.vx * 0.02, y + s.vy * 0.02);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // zones
      const frozenPulse = 0.5 + 0.5 * Math.sin((now / 1000) * Math.PI * 2);
      drawZone(
        startPx,
        phase === 'FROZEN' ? C.breakable : C.wall,
        false,
        phase === 'FROZEN' ? 0.45 + 0.55 * frozenPulse : 0.6,
      );
      drawZone(finishPx, C.breakable, true, 1);
      if (phase === 'FINISH') {
        const k = 1 - Math.max(0, (deadline - now) / FINISH_FLASH_MS);
        drawZone(finishPx, C.wall, false, 1 - k);
        ctx.strokeStyle = C.wall;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 1 - k;
        ctx.beginPath();
        ctx.arc(finishPx.x, finishPx.y, ZONE_RADIUS + k * 60, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // the dot
      if (dot) {
        const fast = Math.hypot(dot.vx, dot.vy) >= params.breakMinSpeedRatio * params.followSpeed;
        const halo = fast ? C.breakable : C.wall;
        ctx.strokeStyle = halo;
        ctx.shadowColor = halo;
        ctx.shadowBlur = 10;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, DOT_RADIUS + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = C.dot;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    // cursor marker (the dot is not the cursor — show where the leash pulls)
    if (pointerInside && (phase === 'ACTIVE' || phase === 'FROZEN')) {
      ctx.strokeStyle = C.muted;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(target.x - 5, target.y);
      ctx.lineTo(target.x + 5, target.y);
      ctx.moveTo(target.x, target.y - 5);
      ctx.lineTo(target.x, target.y + 5);
      ctx.stroke();
    }

    if (phase === 'SCREAMER') {
      const left = Math.max(0, deadline - now) / screamerMs;
      if (screamerImg) {
        const s = Math.max(cw / screamerImg.width, ch / screamerImg.height);
        const w = screamerImg.width * s;
        const h = screamerImg.height * s;
        ctx.drawImage(screamerImg, (cw - w) / 2, (ch - h) / 2, w, h);
      } else {
        ctx.globalAlpha = 0.85 * left;
        ctx.fillStyle = C.alarm;
        ctx.fillRect(0, 0, cw, ch);
        ctx.globalAlpha = Math.min(1, 0.85 * left + 0.15);
        ctx.strokeStyle = C.bg;
        ctx.lineWidth = 8;
        ctx.font = `700 ${Math.floor(Math.min(cw, ch) * 0.5)}px 'Barlow Condensed', system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeText('!', cw / 2, ch / 2);
        ctx.globalAlpha = 1;
      }
    }

    if (paused) {
      ctx.fillStyle = 'rgba(3,11,12,0.72)';
      ctx.fillRect(0, 0, cw, ch);
      ctx.strokeStyle = C.frame;
      ctx.lineWidth = 1;
      ctx.strokeRect(cw / 2 - 90, ch / 2 - 26, 180, 52);
      ctx.strokeRect(cw / 2 - 86, ch / 2 - 22, 172, 44);
      ctx.fillStyle = C.breakable;
      ctx.font = `700 26px 'Barlow Condensed', system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('П А У З А', cw / 2, ch / 2 + 1);
    }
  }

  // -------------------------------------------------------------------------
  // Loop
  // -------------------------------------------------------------------------

  function frame(now: number): void {
    rafId = window.requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!finished) {
      if (paused || held) {
        // physics frozen; dt is reset next frame by `last = now`
      } else if (skipPhysics) {
        skipPhysics = false;
      } else {
        update(dt, now);
      }
    }
    render(now);
  }

  // --- start ---
  applyLayout();
  resetPatrols();
  if (mazes.length === 0) {
    // Broken config: never hang, finish immediately (spec 6.7).
    timerId = window.setTimeout(complete, 0);
  } else {
    progress();
    rafId = window.requestAnimationFrame(frame);
  }

  // --- destroy ---
  function destroy(): void {
    if (rafId !== null) window.cancelAnimationFrame(rafId);
    rafId = null;
    if (timerId !== null) window.clearTimeout(timerId);
    timerId = null;
    ro.disconnect();
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisibility);
    for (const a of live) {
      a.pause();
      a.src = '';
    }
    live.length = 0;
    if (ambient) {
      ambient.pause();
      ambient.src = '';
      ambient = null;
    }
    screamerImg = null;
    activeWalls = [];
    shards = [];
    patrols = [];
    container.innerHTML = '';
  }

  return { destroy, setPaused };
}
