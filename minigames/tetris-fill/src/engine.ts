/**
 * Pure tetris-fill logic: silhouette parsing, partition into tetromino-first
 * pieces, rotation, set comparison, score curve. No DOM, no side effects.
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
 * is the deal order — bottom-up, left-to-right by each piece's anchor cell.
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
