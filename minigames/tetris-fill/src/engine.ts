/**
 * Pure tetris-fill logic: silhouette parsing, partition into tetromino-first
 * pieces, rotation, set comparison, the falling/lock rules, score curve.
 * No DOM, no timers, no Math.random — the falling helpers mutate only the
 * `FallState` object handed to them and never reach outside it.
 *
 * Coordinates: x = column 0..width-1 (left→right), y = row 0..height-1
 * (top→bottom, so the "bottom" cell is the one with the largest y).
 */

export interface Shape {
  width: number;
  height: number;
  rows: string[];
}

export interface Cell {
  x: number;
  y: number;
}

/** One piece of the partition: its index in the deal order and its target cells. */
export interface Piece {
  index: number;
  cells: Cell[];
}

export class EmptyShapeError extends Error {
  constructor() {
    super('СИЛУЭТ ПУСТ');
    this.name = 'EmptyShapeError';
  }
}

export const MAX_SIDE = 16;
export const MAX_CELLS = 60;

/** Search budget; see the note next to `search()`. */
const NODE_CAP = 200_000;

const key = (x: number, y: number): number => x * 65536 + y;

const byBottomLeft = (a: Cell, b: Cell): number => b.y - a.y || a.x - b.x;
const byReading = (a: Cell, b: Cell): number => a.y - b.y || a.x - b.x;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Validates the silhouette and returns its cells in reading order. Throws on bad input. */
export function parseShape(shape: Shape): Cell[] {
  const { width, height, rows } = shape ?? ({} as Shape);
  if (!Number.isInteger(width) || width < 1 || width > MAX_SIDE) {
    throw new Error(`ШИРИНА ВНЕ ДИАПАЗОНА 1..${MAX_SIDE}`);
  }
  if (!Number.isInteger(height) || height < 1 || height > MAX_SIDE) {
    throw new Error(`ВЫСОТА ВНЕ ДИАПАЗОНА 1..${MAX_SIDE}`);
  }
  if (!Array.isArray(rows) || rows.length !== height) {
    throw new Error('ЧИСЛО СТРОК НЕ СОВПАДАЕТ С ВЫСОТОЙ');
  }

  const cells: Cell[] = [];
  for (let y = 0; y < height; y++) {
    const row = rows[y];
    if (typeof row !== 'string' || row.length !== width) {
      throw new Error(`ДЛИНА СТРОКИ ${y + 1} НЕ СОВПАДАЕТ С ШИРИНОЙ`);
    }
    for (let x = 0; x < width; x++) {
      const ch = row[x];
      if (ch === '#') cells.push({ x, y });
      else if (ch !== '.') throw new Error(`ПОСТОРОННИЙ СИМВОЛ «${ch}» В СТРОКЕ ${y + 1}`);
    }
  }

  if (cells.length === 0) throw new EmptyShapeError();
  if (cells.length > MAX_CELLS) throw new Error(`СЛИШКОМ МНОГО КЛЕТОК: ${cells.length} > ${MAX_CELLS}`);
  return cells;
}

// ---------------------------------------------------------------------------
// Partition — deterministic backtracking with branch & bound
// ---------------------------------------------------------------------------

/**
 * Splits the silhouette into connected pieces of 1..4 cells, minimising the
 * number of pieces (i.e. maximising the share of real tetrominoes).
 *
 * Deterministic: no RNG, fixed neighbour order (up, left, right, down), fixed
 * branch point (always the lowest-leftmost uncovered cell). The returned order
 * is bottom-up, left-to-right by each piece's anchor cell — a look, not a
 * gravity order; run it through `orderForGravity()` before dealing.
 */
export function partition(cells: Cell[]): Piece[] {
  const n = cells.length;
  if (n === 0) return [];

  // Scan order: bottom-up, left-to-right. Index 0 is always the next anchor.
  const order = [...cells].sort(byBottomLeft);
  const at = new Map<number, number>();
  order.forEach((c, i) => at.set(key(c.x, c.y), i));

  const neighbours: number[][] = order.map((c) => {
    const out: number[] = [];
    for (const [dx, dy] of [
      [0, -1],
      [-1, 0],
      [1, 0],
      [0, 1],
    ] as const) {
      const j = at.get(key(c.x + dx, c.y + dy));
      if (j !== undefined) out.push(j);
    }
    return out;
  });

  const covered = new Uint8Array(n);
  const inSet = new Uint8Array(n);
  const visited = new Uint8Array(n);
  const optimal = Math.ceil(n / 4);

  let uncovered = n;
  let nodes = 0;
  const picked: number[][] = [];
  let best: number[][] | null = null;

  /** Σ ceil(|component| / 4) over the uncovered area — a lower bound on pieces left. */
  function lowerBound(): number {
    visited.fill(0);
    let bound = 0;
    const stack: number[] = [];
    for (let start = 0; start < n; start++) {
      if (covered[start] || visited[start]) continue;
      let size = 0;
      visited[start] = 1;
      stack.push(start);
      while (stack.length > 0) {
        const i = stack.pop() as number;
        size++;
        for (const j of neighbours[i] as number[]) {
          if (!covered[j] && !visited[j]) {
            visited[j] = 1;
            stack.push(j);
          }
        }
      }
      bound += Math.ceil(size / 4);
    }
    return bound;
  }

  /** All connected uncovered subsets of exactly `k` cells containing `anchor`. */
  function subsets(anchor: number, k: number): number[][] {
    const out: number[][] = [];
    const seen = new Set<string>();
    const chosen: number[] = [anchor];
    inSet[anchor] = 1;

    const grow = (): void => {
      if (chosen.length === k) {
        const id = [...chosen].sort((a, b) => a - b).join(',');
        if (!seen.has(id)) {
          seen.add(id);
          out.push(chosen.slice());
        }
        return;
      }
      const candidates: number[] = [];
      for (const c of chosen) {
        for (const nb of neighbours[c] as number[]) {
          if (!covered[nb] && !inSet[nb] && !candidates.includes(nb)) candidates.push(nb);
        }
      }
      for (const cand of candidates) {
        inSet[cand] = 1;
        chosen.push(cand);
        grow();
        chosen.pop();
        inSet[cand] = 0;
      }
    };

    grow();
    inSet[anchor] = 0;
    return out;
  }

  function search(): void {
    if (uncovered === 0) {
      if (!best || picked.length < best.length) best = picked.map((p) => p.slice());
      return;
    }
    if (best && picked.length + lowerBound() >= best.length) return;
    // ponytail: node cap keeps a pathological silhouette from hanging init; the
    // first descent always completes (k=1 covers any cell), so `best` exists.
    // Upgrade path if we ever hit it: broken-profile DP for widths <= 16.
    if (++nodes > NODE_CAP) return;

    let anchor = -1;
    for (let i = 0; i < n; i++) {
      if (!covered[i]) {
        anchor = i;
        break;
      }
    }

    // 4 → 1: smaller pieces are only reached when no larger one leads anywhere better.
    for (let k = 4; k >= 1; k--) {
      for (const sub of subsets(anchor, k)) {
        for (const i of sub) covered[i] = 1;
        uncovered -= sub.length;
        picked.push(sub);
        search();
        picked.pop();
        uncovered += sub.length;
        for (const i of sub) covered[i] = 0;
        if (best && best.length === optimal) return; // provably optimal
      }
    }
  }

  search();

  // cast: TS narrows `best` to null here — it is only ever assigned inside search()
  const found = (best as number[][] | null) ?? [];
  return found.map((sub, index) => ({
    index,
    cells: sub.map((i) => order[i] as Cell).sort(byReading),
  }));
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Shifts cells so the bounding box starts at (0,0); sorted in reading order. */
export function normalize(cells: Cell[]): Cell[] {
  if (cells.length === 0) return [];
  let minX = Infinity;
  let minY = Infinity;
  for (const c of cells) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
  }
  return cells.map((c) => ({ x: c.x - minX, y: c.y - minY })).sort(byReading);
}

/** Rotates 90° clockwise `turns` times ((x,y) → (−y,x)), normalized. No mirroring. */
export function rotate(cells: Cell[], turns: number): Cell[] {
  const t = ((turns % 4) + 4) % 4;
  let out = cells.map((c) => ({ x: c.x, y: c.y }));
  for (let i = 0; i < t; i++) out = out.map((c) => ({ x: -c.y, y: c.x }));
  return normalize(out);
}

/** Set equality of two cell lists — order-independent. */
export function sameCells(a: Cell[], b: Cell[]): boolean {
  if (a.length !== b.length) return false;
  const ka = a.map((c) => key(c.x, c.y)).sort((p, q) => p - q);
  const kb = b.map((c) => key(c.x, c.y)).sort((p, q) => p - q);
  return ka.every((v, i) => v === kb[i]);
}

/** Width/height of a normalized cell list. */
function bboxSize(cells: Cell[]): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const c of cells) {
    if (c.x + 1 > w) w = c.x + 1;
    if (c.y + 1 > h) h = c.y + 1;
  }
  return { w, h };
}

// ---------------------------------------------------------------------------
// Falling mode — gravity, steering, magnetic lock
// ---------------------------------------------------------------------------

export type SpawnColumn = 'center' | 'target';

export interface FallRules {
  fallIntervalMs: number;
  softDropFactor: number;
  lockDelayMs: number;
  spawnColumn: SpawnColumn;
}

/** The piece in flight: normalized shape + position of its bbox origin (y may be < 0). */
export interface Active {
  shape: Cell[];
  x: number;
  y: number;
  turns: number;
}

export interface FallState {
  width: number;
  height: number;
  rules: FallRules;
  pieces: Piece[];
  /** width*height flags of already-placed cells. */
  locked: Uint8Array;
  current: number;
  active: Active | null;
  errors: number;
  /** Errors on the piece being dealt now; reset once it is placed (drives the hint). */
  pieceErrors: number;
  fallTimer: number;
  lockTimer: number;
  softDrop: boolean;
  done: boolean;
}

export type FallEvent = 'placed' | 'rejected' | 'won';

/** A tab-resume must not teleport the piece through the board. */
const MAX_DT = 100;

/**
 * Reorders the partition into a gravity order: piece A is dealt before B when
 * some column holds a cell of A strictly below a cell of B. Kahn's algorithm,
 * ties broken by the incoming (anchor) order so the bottom-up look survives.
 *
 * Without this a piece can be buried by an earlier one and become unreachable.
 * Indices are renumbered to the new order (they drive the colour cycle).
 */
export function orderForGravity(pieces: Piece[]): Piece[] {
  const n = pieces.length;
  // ponytail: O(n²) edge scan over ≤ 15 pieces of ≤ 4 cells — an index would
  // cost more than it saves. Revisit only if MAX_CELLS grows 10×.
  const after: number[][] = pieces.map(() => []);
  const indeg = new Array<number>(n).fill(0);
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (a === b) continue;
      const ca = (pieces[a] as Piece).cells;
      const cb = (pieces[b] as Piece).cells;
      if (ca.some((p) => cb.some((q) => p.x === q.x && p.y > q.y))) {
        (after[a] as number[]).push(b);
        indeg[b] = (indeg[b] as number) + 1;
      }
    }
  }

  const out: Piece[] = [];
  const taken = new Uint8Array(n);
  for (let placed = 0; placed < n; placed++) {
    let pick = -1;
    for (let i = 0; i < n; i++) {
      if (!taken[i] && indeg[i] === 0) {
        pick = i;
        break;
      }
    }
    // ponytail: a cycle (A below B in one column, B below A in another) has no
    // gravity order at all — that silhouette is unwinnable whatever we do, so we
    // deal the rest in anchor order instead of hanging. Upgrade path: reject such
    // a silhouette in the admin grid-paint widget.
    if (pick < 0) {
      for (let i = 0; i < n; i++) if (!taken[i]) out.push(pieces[i] as Piece);
      break;
    }
    taken[pick] = 1;
    out.push(pieces[pick] as Piece);
    for (const b of after[pick] as number[]) indeg[b] = (indeg[b] as number) - 1;
  }

  return out.map((p, index) => ({ index, cells: p.cells }));
}

/** Per-level knobs; anything omitted falls back to the top-level config value. */
export interface LevelConfig {
  shape?: Shape;
  fallIntervalMs?: number;
  softDropFactor?: number;
  lockDelayMs?: number;
  spawnColumn?: SpawnColumn;
  hintAfterErrors?: number;
  randomizeRotation?: boolean;
}

/**
 * Levels to play, in order: each level's own values win over the top-level ones.
 * A config without `levels` (or with an empty list) is a single level — the old
 * one-silhouette config keeps working unchanged.
 */
export function levelsOf(config: LevelConfig & { levels?: LevelConfig[] }): LevelConfig[] {
  const { levels, ...base } = config;
  if (!Array.isArray(levels) || levels.length === 0) return [base];
  return levels.map((lv) => ({ ...base, ...lv }));
}

export function createFallState(shape: Shape, rules: FallRules): FallState {
  const cells = parseShape(shape);
  return {
    width: shape.width,
    height: shape.height,
    rules,
    pieces: orderForGravity(partition(cells)),
    locked: new Uint8Array(shape.width * shape.height),
    current: 0,
    active: null,
    errors: 0,
    pieceErrors: 0,
    fallTimer: 0,
    lockTimer: 0,
    softDrop: false,
    done: false,
  };
}

/**
 * Places the current piece fully above row 0, where nothing can block it — the
 * player is free to rotate and slide it into any column from there. If `turns`
 * is wider than the board, the next orientation that fits is used instead.
 */
export function spawn(state: FallState, turns: number): void {
  const piece = state.pieces[state.current];
  if (!piece) return;
  const base = normalize(piece.cells);
  let t = turns;
  let shape = rotate(base, t);
  for (let i = 1; i <= 3 && bboxSize(shape).w > state.width; i++) {
    t = turns + i;
    shape = rotate(base, t);
  }
  const box = bboxSize(shape);
  const wanted =
    state.rules.spawnColumn === 'target'
      ? Math.min(...piece.cells.map((c) => c.x))
      : Math.floor((state.width - box.w) / 2);
  state.active = {
    shape,
    x: Math.max(0, Math.min(state.width - box.w, wanted)),
    // clearance for the tallest of the 4 orientations, so rotating up there is
    // never blocked by an already-locked cell
    y: -Math.max(box.w, box.h),
    turns: ((t % 4) + 4) % 4,
  };
  state.fallTimer = 0;
  state.lockTimer = 0;
}

/** Walls, floor and locked cells block; above the board is free; silhouette voids are not walls. */
export function collides(state: FallState, shape: Cell[], x: number, y: number): boolean {
  for (const c of shape) {
    const ax = x + c.x;
    const ay = y + c.y;
    if (ax < 0 || ax >= state.width || ay >= state.height) return true;
    if (ay >= 0 && state.locked[ay * state.width + ax]) return true;
  }
  return false;
}

export function matchesTarget(state: FallState, active: Active): boolean {
  const piece = state.pieces[state.current];
  if (!piece) return false;
  return sameCells(
    active.shape.map((c) => ({ x: active.x + c.x, y: active.y + c.y })),
    piece.cells,
  );
}

export function move(state: FallState, dx: -1 | 1): boolean {
  const a = state.active;
  if (!a || state.done || collides(state, a.shape, a.x + dx, a.y)) return false;
  a.x += dx;
  state.lockTimer = 0;
  return true;
}

/** 90° CW; tries the current column, then a one-cell kick left/right. */
export function rotateActive(state: FallState): boolean {
  const a = state.active;
  if (!a || state.done) return false;
  const next = rotate(a.shape, 1);
  for (const dx of [0, -1, 1]) {
    if (collides(state, next, a.x + dx, a.y)) continue;
    a.shape = next;
    a.x += dx;
    a.turns = (a.turns + 1) % 4;
    state.lockTimer = 0;
    return true;
  }
  return false;
}

export function setSoftDrop(state: FallState, on: boolean): void {
  state.softDrop = on;
}

function commit(state: FallState, out: FallEvent[]): void {
  const piece = state.pieces[state.current] as Piece;
  for (const c of piece.cells) state.locked[c.y * state.width + c.x] = 1;
  state.active = null;
  state.current++;
  state.pieceErrors = 0;
  state.fallTimer = 0;
  state.lockTimer = 0;
  out.push('placed');
  if (state.current >= state.pieces.length) {
    state.done = true;
    out.push('won');
  }
}

function reject(state: FallState, out: FallEvent[]): void {
  state.errors++;
  state.pieceErrors++;
  state.active = null;
  state.fallTimer = 0;
  state.lockTimer = 0;
  out.push('rejected');
}

/** Lowest y the active piece can reach — where it matches, or where it is blocked. */
function dropY(state: FallState, a: Active): number {
  let y = a.y;
  while (!matchesTarget(state, { ...a, y }) && !collides(state, a.shape, a.x, y + 1)) y++;
  return y;
}

export function landingY(state: FallState): number {
  return state.active ? dropY(state, state.active) : 0;
}

export function update(state: FallState, dtMs: number): FallEvent[] {
  const out: FallEvent[] = [];
  const a = state.active;
  if (!a || state.done) return out;
  const dt = Math.min(Math.max(dtMs, 0), MAX_DT);

  // 1. magnetic lock — a piece that covers its target is done, even if it could
  // still descend (otherwise ['###','...','###'] is unwinnable).
  if (matchesTarget(state, a)) {
    commit(state, out);
    return out;
  }

  // 2. resting on something that is not its place → dissolve after lockDelayMs
  if (collides(state, a.shape, a.x, a.y + 1)) {
    state.lockTimer += dt;
    if (state.lockTimer >= state.rules.lockDelayMs) reject(state, out);
    return out;
  }

  // 3. gravity
  state.lockTimer = 0;
  state.fallTimer += dt;
  const interval = Math.max(1, state.rules.fallIntervalMs / (state.softDrop ? state.rules.softDropFactor : 1));
  while (state.fallTimer >= interval) {
    state.fallTimer -= interval;
    if (collides(state, a.shape, a.x, a.y + 1)) break;
    a.y++;
    if (matchesTarget(state, a)) {
      commit(state, out);
      return out;
    }
  }
  return out;
}

/** Slams the piece down and settles it immediately, bypassing the lock delay. */
export function hardDrop(state: FallState): FallEvent[] {
  const out: FallEvent[] = [];
  const a = state.active;
  if (!a || state.done) return out;
  a.y = dropY(state, a);
  if (matchesTarget(state, a)) commit(state, out);
  else reject(state, out);
  return out;
}

// ---------------------------------------------------------------------------
// Score curve — same implementation as sliding-puzzle / find-object
// ---------------------------------------------------------------------------

export interface ScoreThreshold {
  maxSeconds: number;
  points: number;
  /** Slope (Δpoints/Δseconds) leaving this point toward the next. */
  outTangent?: number;
  /** Slope arriving at this point from the previous. */
  inTangent?: number;
}

/**
 * Samples the score curve at `elapsedSeconds` and rounds to whole points.
 * Same cubic-Hermite math as the admin CurveEditor (tangents default to the
 * linear slope, so a plain point list interpolates linearly), clamped to the
 * first/last point's value outside the curve. Returns 0 for an empty list.
 * To award 0 for very slow solves, end the curve with a points:0 point.
 */
export function scoreForElapsed(thresholds: ScoreThreshold[], elapsedSeconds: number): number {
  if (thresholds.length === 0) return 0;

  const pts = [...thresholds].sort((a, b) => a.maxSeconds - b.maxSeconds);
  const first = pts[0] as ScoreThreshold;
  const last = pts[pts.length - 1] as ScoreThreshold;
  if (elapsedSeconds <= first.maxSeconds) return Math.round(first.points);
  if (elapsedSeconds >= last.maxSeconds) return Math.round(last.points);

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i] as ScoreThreshold;
    const b = pts[i + 1] as ScoreThreshold;
    if (elapsedSeconds > b.maxSeconds) continue;
    const dx = b.maxSeconds - a.maxSeconds;
    if (dx <= 0) return Math.round(b.points);
    const t = (elapsedSeconds - a.maxSeconds) / dx;
    const linear = (b.points - a.points) / dx;
    const m0 = a.outTangent ?? linear;
    const m1 = b.inTangent ?? linear;
    const t2 = t * t;
    const t3 = t2 * t;
    return Math.round(
      (2 * t3 - 3 * t2 + 1) * a.points +
        (t3 - 2 * t2 + t) * dx * m0 +
        (-2 * t3 + 3 * t2) * b.points +
        (t3 - t2) * dx * m1,
    );
  }

  return Math.round(last.points);
}
