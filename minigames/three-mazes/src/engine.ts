// three-mazes — pure logic. No DOM, no window, no Date.now(), no Math.random().
// Everything here is deterministic and unit-testable.

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

export interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A wall segment. `group` ties the pieces of one logical wall (arc polylines)
 *  together so that breaking one piece opens the whole passage. */
export interface Wall extends Seg {
  breakable: boolean;
  group?: number;
}

export interface Pt {
  x: number;
  y: number;
}

export interface Maze {
  walls: Wall[];
  start: Pt;
  finish: Pt;
  /** Patrol posts (normalized), placed on the honest route. Absent = no patrols. */
  patrols?: Pt[];
}

export type MazeType = 'square' | 'hex' | 'circular';

export interface GeneratorParams {
  type: MazeType;
  size: number;
  breakableDensity: number;
  seed: number;
  /** Searchlight patrol count, 0..3. Absent = 0. */
  patrols?: number;
}

/** Radius of the player dot, px. */
export const DOT_RADIUS = 6;
/** Radius of start/finish zones, px. */
export const ZONE_RADIUS = 24;
/** Spring stiffness. */
export const SPRING_K = 120;
/** Critical damping — derived, never configured. */
export const SPRING_C = 2 * Math.sqrt(SPRING_K);
/** Substep budget: step <= 3px, at most 3 substeps per frame. */
export const MAX_SUBSTEPS = 3;
export const SUBSTEP_PX = 3;
/** A breakable wall must short-cut at least this many tree steps. */
export const BREAK_MIN_TREE_DIST = 6;
/** Reference field size used to translate the px clearance rule to normalized units. */
const REF_FIELD_PX = 600;
/** Arc subdivision for circular mazes. */
const ARC_STEP = (10 * Math.PI) / 180;

const EPS = 1e-9;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export function distancePointSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { dist: number; t: number; cx: number; cy: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return { dist: Math.hypot(px - cx, py - cy), t, cx, cy };
}

/** Distance along a unit ray (ox,oy)+(dx,dy)*t to the closest segment, or Infinity. */
export function raycast(walls: Seg[], ox: number, oy: number, dx: number, dy: number): number {
  let best = Infinity;
  for (const w of walls) {
    const ex = w.x2 - w.x1;
    const ey = w.y2 - w.y1;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < EPS) continue;
    const t = ((w.x1 - ox) * ey - (w.y1 - oy) * ex) / den;
    const u = ((w.x1 - ox) * dy - (w.y1 - oy) * dx) / den;
    if (t > 1e-6 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return best;
}

/** Minimum free space required on both sides of a breakable wall. */
export function minClearance(cellSize: number): number {
  return Math.max(0.5 * cellSize, (3 * DOT_RADIUS) / REF_FIELD_PX);
}

// ---------------------------------------------------------------------------
// Seeded RNG
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
}

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------

export interface DotState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Remaining milliseconds of post-break spring relaxation. */
  relaxMs: number;
}

export interface PhysicsParams {
  followSpeed: number;
  bounceSpeed: number;
  bounceDurationMs: number;
  breakAngleDeg: number;
  breakMinSpeedRatio: number;
}

export interface Collision {
  wallIndex: number;
  nx: number;
  ny: number;
  cx: number;
  cy: number;
  speed: number;
}

/** Spring stiffness multiplier: 0.25 right after a break, 1.0 when relaxed. */
export function relaxFactor(relaxMs: number, bounceDurationMs: number): number {
  if (bounceDurationMs <= 0 || relaxMs <= 0) return 1;
  return 0.25 + 0.75 * (1 - Math.min(1, relaxMs / bounceDurationMs));
}

function nearestWall(
  x: number,
  y: number,
  vx: number,
  vy: number,
  walls: Wall[],
): Collision | null {
  let bi = -1;
  let bd = Infinity;
  let bcx = 0;
  let bcy = 0;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i] as Wall;
    const r = distancePointSegment(x, y, w.x1, w.y1, w.x2, w.y2);
    if (r.dist < bd) {
      bd = r.dist;
      bi = i;
      bcx = r.cx;
      bcy = r.cy;
    }
  }
  if (bi < 0 || bd > DOT_RADIUS) return null;
  let nx = x - bcx;
  let ny = y - bcy;
  const len = Math.hypot(nx, ny);
  if (len > EPS) {
    nx /= len;
    ny /= len;
  } else {
    // Dot sits exactly on the segment: use the perpendicular facing the incoming side.
    const w = walls[bi] as Wall;
    const ex = w.x2 - w.x1;
    const ey = w.y2 - w.y1;
    const el = Math.hypot(ex, ey) || 1;
    nx = -ey / el;
    ny = ex / el;
    if (nx * vx + ny * vy > 0) {
      nx = -nx;
      ny = -ny;
    }
  }
  return { wallIndex: bi, nx, ny, cx: bcx, cy: bcy, speed: Math.hypot(vx, vy) };
}

/**
 * Critically damped spring follow with a speed cap, split into substeps of <=3px
 * (max 3) so that a thin wall cannot be tunnelled through. Stops at the first
 * collision and reports it.
 */
export function stepPhysics(
  state: DotState,
  target: Pt,
  dt: number,
  walls: Wall[],
  params: PhysicsParams,
): { state: DotState; collision?: Collision } {
  let { x, y, vx, vy, relaxMs } = state;
  // Substep count is based on the speed the dot can actually reach this frame,
  // not just its current speed — a standing start next to a far target would
  // otherwise get a single 30px step.
  const dist = Math.hypot(target.x - x, target.y - y);
  const reach = Math.min(params.followSpeed, Math.hypot(vx, vy) + SPRING_K * dist * dt);
  const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil((reach * dt) / SUBSTEP_PX)));
  const h = dt / steps;

  for (let i = 0; i < steps; i++) {
    const k = SPRING_K * relaxFactor(relaxMs, params.bounceDurationMs);
    vx += (k * (target.x - x) - SPRING_C * vx) * h;
    vy += (k * (target.y - y) - SPRING_C * vy) * h;
    const sp = Math.hypot(vx, vy);
    if (sp > params.followSpeed) {
      const f = params.followSpeed / sp;
      vx *= f;
      vy *= f;
    }
    x += vx * h;
    y += vy * h;
    relaxMs = Math.max(0, relaxMs - h * 1000);
    const hit = nearestWall(x, y, vx, vy, walls);
    if (hit) return { state: { x, y, vx, vy, relaxMs }, collision: hit };
  }
  return { state: { x, y, vx, vy, relaxMs } };
}

/** Break or scream? Two checks, nothing else. */
export function classifyHit(
  wall: Wall,
  nx: number,
  ny: number,
  vx: number,
  vy: number,
  params: PhysicsParams,
): 'break' | 'fail' {
  if (!wall.breakable) return 'fail';
  const sp = Math.hypot(vx, vy);
  if (sp <= EPS) return 'fail';
  if (sp < params.breakMinSpeedRatio * params.followSpeed - 1e-6) return 'fail';
  const head = -((vx / sp) * nx + (vy / sp) * ny);
  return head >= Math.cos((params.breakAngleDeg * Math.PI) / 180) - 1e-9 ? 'break' : 'fail';
}

/** Kick the dot back along the wall normal and relax the spring for a while. */
export function applyBounce(
  state: DotState,
  col: Collision,
  params: PhysicsParams,
): DotState {
  const sp = Math.hypot(state.vx, state.vy);
  const out = Math.max(params.bounceSpeed, 1.15 * sp);
  return {
    x: col.cx + col.nx * (DOT_RADIUS + 0.5),
    y: col.cy + col.ny * (DOT_RADIUS + 0.5),
    vx: col.nx * out,
    vy: col.ny * out,
    relaxMs: params.bounceDurationMs,
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function computeStyleTag(wallsBroken: number, breakerThreshold: number): 'ghost' | 'breaker' {
  return wallsBroken < breakerThreshold ? 'ghost' : 'breaker';
}

export function computeScore(
  mazeScores: number[],
  resets: number,
  penaltyPerReset: number,
): number {
  const raw = mazeScores.reduce((s, v) => s + v, 0) - penaltyPerReset * resets;
  return Math.max(0, Math.round(raw));
}

// ---------------------------------------------------------------------------
// Cell graphs (generator-only; the runtime never sees them)
// ---------------------------------------------------------------------------

interface Edge {
  a: number;
  b: number;
  segs: Seg[];
  /** Too narrow to be a passage — stays a wall forever, never a short-cut. */
  forbidden?: boolean;
}

interface Grid {
  centers: Pt[];
  edges: Edge[];
  border: Seg[][];
  cellSize: number;
}

/** Segment of length `len` on the perpendicular bisector of p–q. */
function bisector(p: Pt, q: Pt, len: number): Seg {
  const mx = (p.x + q.x) / 2;
  const my = (p.y + q.y) / 2;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const l = Math.hypot(dx, dy) || 1;
  const ux = (-dy / l) * (len / 2);
  const uy = (dx / l) * (len / 2);
  return { x1: mx - ux, y1: my - uy, x2: mx + ux, y2: my + uy };
}

function buildSquare(size: number): Grid {
  const cs = 1 / size;
  const centers: Pt[] = [];
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++) centers.push({ x: (c + 0.5) * cs, y: (r + 0.5) * cs });
  const edges: Edge[] = [];
  const border: Seg[][] = [];
  const dirs = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const a = r * size + c;
      const p = centers[a] as Pt;
      for (let d = 0; d < 4; d++) {
        const dir = dirs[d] as number[];
        const dc = dir[0] as number;
        const dr = dir[1] as number;
        const q = { x: p.x + dc * cs, y: p.y + dr * cs };
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= size || nr >= size) border.push([bisector(p, q, cs)]);
        else if (d < 2) edges.push({ a, b: nr * size + nc, segs: [bisector(p, q, cs)] });
      }
    }
  }
  return { centers, edges, border, cellSize: cs };
}

function buildHex(size: number): Grid {
  const R = Math.min(1 / (Math.sqrt(3) * (size + 0.5)), 1 / (1.5 * size + 0.5));
  const w = Math.sqrt(3) * R;
  const ox = (1 - w * (size + 0.5)) / 2;
  const oy = (1 - R * (1.5 * size + 0.5)) / 2;
  const center = (c: number, r: number): Pt => ({
    x: ox + (c + (Math.abs(r % 2) === 1 ? 0.5 : 0) + 0.5) * w,
    y: oy + R + r * 1.5 * R,
  });
  // 0=E, 1=SE, 2=SW (canonical, emit edges), 3=W, 4=NW, 5=NE
  const even = [
    [1, 0],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
  ];
  const odd = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, -1],
  ];
  const centers: Pt[] = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) centers.push(center(c, r));
  const edges: Edge[] = [];
  const border: Seg[][] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const a = r * size + c;
      const p = centers[a] as Pt;
      const table = Math.abs(r % 2) === 1 ? odd : even;
      for (let d = 0; d < 6; d++) {
        const dir = table[d] as number[];
        const nc = c + (dir[0] as number);
        const nr = r + (dir[1] as number);
        const q = center(nc, nr);
        if (nc < 0 || nr < 0 || nc >= size || nr >= size) border.push([bisector(p, q, R)]);
        else if (d < 3) edges.push({ a, b: nr * size + nc, segs: [bisector(p, q, R)] });
      }
    }
  }
  return { centers, edges, border, cellSize: w };
}

function arcSegs(r: number, a0: number, a1: number): Seg[] {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / ARC_STEP));
  const out: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const s = a0 + ((a1 - a0) * i) / n;
    const e = a0 + ((a1 - a0) * (i + 1)) / n;
    out.push({
      x1: 0.5 + r * Math.cos(s),
      y1: 0.5 + r * Math.sin(s),
      x2: 0.5 + r * Math.cos(e),
      y2: 0.5 + r * Math.sin(e),
    });
  }
  return out;
}

function buildCircular(size: number): Grid {
  const ringW = 0.5 / (size + 1);
  const rad = (i: number): number => ringW * (i + 1);
  const sect = (i: number): number => 6 + 4 * i;
  const base: number[] = [];
  let acc = 0;
  for (let i = 0; i < size; i++) {
    base.push(acc);
    acc += sect(i);
  }
  const centers: Pt[] = [];
  for (let i = 0; i < size; i++) {
    const rm = (rad(i) + rad(i + 1)) / 2;
    const step = (Math.PI * 2) / sect(i);
    for (let j = 0; j < sect(i); j++) {
      const a = (j + 0.5) * step;
      centers.push({ x: 0.5 + rm * Math.cos(a), y: 0.5 + rm * Math.sin(a) });
    }
  }
  const edges: Edge[] = [];
  const border: Seg[][] = [];
  for (let i = 0; i < size; i++) {
    const step = (Math.PI * 2) / sect(i);
    // radial walls inside a ring
    for (let j = 0; j < sect(i); j++) {
      const a = (j + 1) * step;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      edges.push({
        a: (base[i] as number) + j,
        b: (base[i] as number) + ((j + 1) % sect(i)),
        segs: [
          {
            x1: 0.5 + rad(i) * cos,
            y1: 0.5 + rad(i) * sin,
            x2: 0.5 + rad(i + 1) * cos,
            y2: 0.5 + rad(i + 1) * sin,
          },
        ],
      });
    }
    // Ring walls between ring i and ring i+1. An outer cell can straddle two
    // inner cells: one graph edge per angular overlap, so the geometry and the
    // graph agree exactly — otherwise opening one edge would tear a hole no
    // spanning tree ever asked for. Overlaps too thin to walk through are
    // marked forbidden and stay walls.
    if (i + 1 < size) {
      const so = (Math.PI * 2) / sect(i + 1);
      const minOpen = 0.35 * so;
      for (let jo = 0; jo < sect(i + 1); jo++) {
        const a0 = jo * so;
        const a1 = a0 + so;
        for (let ji = Math.floor(a0 / step + 1e-9); ji * step < a1 - 1e-9; ji++) {
          const s = Math.max(a0, ji * step);
          const e = Math.min(a1, (ji + 1) * step);
          if (e - s < 1e-9) continue;
          const edge: Edge = {
            a: (base[i] as number) + (ji % sect(i)),
            b: (base[i + 1] as number) + jo,
            segs: arcSegs(rad(i + 1), s, e),
          };
          if (e - s < minOpen) edge.forbidden = true;
          edges.push(edge);
        }
      }
    }
  }
  border.push(arcSegs(rad(0), 0, Math.PI * 2));
  border.push(arcSegs(rad(size), 0, Math.PI * 2));
  return { centers, edges, border, cellSize: ringW };
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export interface MazeDetails {
  maze: Maze;
  cellSize: number;
  /** Number of cells on the honest route from start to finish. */
  routeSteps: number;
  /** Tree distance short-cut by each breakable logical wall. */
  breakableTreeDist: number[];
}

export function generateMaze(params: GeneratorParams): Maze {
  return generateMazeDetailed(params).maze;
}

export function generateMazeDetailed(params: GeneratorParams): MazeDetails {
  const size = Math.max(3, Math.min(20, Math.floor(params.size)));
  const density = Math.max(0, Math.min(1, params.breakableDensity));
  const grid =
    params.type === 'hex'
      ? buildHex(size)
      : params.type === 'circular'
        ? buildCircular(size)
        : buildSquare(size);
  const rng = mulberry32(params.seed | 0);
  const n = grid.centers.length;

  // --- spanning tree (iterative DFS) ---
  const adj: { e: number; to: number }[][] = grid.centers.map(() => []);
  grid.edges.forEach((e, i) => {
    if (e.forbidden) return;
    (adj[e.a] as { e: number; to: number }[]).push({ e: i, to: e.b });
    (adj[e.b] as { e: number; to: number }[]).push({ e: i, to: e.a });
  });
  for (const list of adj) shuffle(list, rng);

  const root = Math.floor(rng() * n) % n;
  const inTree = new Uint8Array(grid.edges.length);
  const visited = new Uint8Array(n);
  const ptr = new Int32Array(n);
  const stack: number[] = [root];
  visited[root] = 1;
  while (stack.length > 0) {
    const v = stack[stack.length - 1] as number;
    const list = adj[v] as { e: number; to: number }[];
    let advanced = false;
    while ((ptr[v] as number) < list.length) {
      const link = list[ptr[v] as number] as { e: number; to: number };
      ptr[v] = (ptr[v] as number) + 1;
      if (!visited[link.to]) {
        visited[link.to] = 1;
        inTree[link.e] = 1;
        stack.push(link.to);
        advanced = true;
        break;
      }
    }
    if (!advanced) stack.pop();
  }

  // --- tree BFS helpers ---
  const treeAdj: number[][] = grid.centers.map(() => []);
  grid.edges.forEach((e, i) => {
    if (inTree[i]) {
      (treeAdj[e.a] as number[]).push(e.b);
      (treeAdj[e.b] as number[]).push(e.a);
    }
  });
  const bfs = (src: number): { dist: Int32Array; parent: Int32Array } => {
    const dist = new Int32Array(n).fill(-1);
    const parent = new Int32Array(n).fill(-1);
    const queue = [src];
    dist[src] = 0;
    for (let qi = 0; qi < queue.length; qi++) {
      const v = queue[qi] as number;
      for (const to of treeAdj[v] as number[]) {
        if (dist[to] === -1) {
          dist[to] = (dist[v] as number) + 1;
          parent[to] = v;
          queue.push(to);
        }
      }
    }
    return { dist, parent };
  };
  const far = (d: Int32Array): number => {
    let best = 0;
    for (let i = 0; i < n; i++) if ((d[i] as number) > (d[best] as number)) best = i;
    return best;
  };

  // Endpoints of the tree diameter: the longest honest route the maze can offer.
  const startCell = far(bfs(root).dist);
  const fromStart = bfs(startCell);
  const finishCell = far(fromStart.dist);
  const depth = fromStart.dist;
  const parent = fromStart.parent;

  const treeDist = (a: number, b: number): number => {
    let u = a;
    let v = b;
    let d = 0;
    while ((depth[u] as number) > (depth[v] as number)) {
      u = parent[u] as number;
      d++;
    }
    while ((depth[v] as number) > (depth[u] as number)) {
      v = parent[v] as number;
      d++;
    }
    while (u !== v) {
      u = parent[u] as number;
      v = parent[v] as number;
      d += 2;
    }
    return d;
  };

  // --- walls: outer border + every edge that did not make it into the tree ---
  const walls: Wall[] = [];
  let group = 0;
  for (const piece of grid.border) {
    for (const s of piece) walls.push({ ...s, breakable: false, group });
    group++;
  }
  const candidates: { group: number; dist: number; first: number; count: number }[] = [];
  grid.edges.forEach((e, i) => {
    if (inTree[i]) return;
    const first = walls.length;
    for (const s of e.segs) walls.push({ ...s, breakable: false, group });
    const d = e.forbidden ? 0 : treeDist(e.a, e.b);
    if (d >= BREAK_MIN_TREE_DIST) candidates.push({ group, dist: d, first, count: e.segs.length });
    group++;
  });

  // --- breakable walls: real short-cuts with room to bounce back on both sides ---
  const clear = minClearance(grid.cellSize);
  const roomy = candidates.filter((c) => {
    const w = walls[c.first + (c.count >> 1)] as Wall;
    const mx = (w.x1 + w.x2) / 2;
    const my = (w.y1 + w.y2) / 2;
    const ex = w.x2 - w.x1;
    const ey = w.y2 - w.y1;
    const l = Math.hypot(ex, ey) || 1;
    const nx = -ey / l;
    const ny = ex / l;
    return (
      raycast(walls, mx, my, nx, ny) >= clear && raycast(walls, mx, my, -nx, -ny) >= clear
    );
  });
  shuffle(roomy, rng);
  const take = Math.round(density * roomy.length);
  const breakableTreeDist: number[] = [];
  for (let i = 0; i < take; i++) {
    const c = roomy[i] as { group: number; dist: number; first: number; count: number };
    for (let j = 0; j < c.count; j++) (walls[c.first + j] as Wall).breakable = true;
    breakableTreeDist.push(c.dist);
  }

  // --- patrols: placed on the honest route, after the RNG stream is done ---
  const maze: Maze = {
    walls,
    start: { ...(grid.centers[startCell] as Pt) },
    finish: { ...(grid.centers[finishCell] as Pt) },
  };
  const patrolCount = Math.max(0, Math.min(3, Math.floor(params.patrols ?? 0)));
  if (patrolCount > 0) maze.patrols = placePatrolPosts(maze, patrolCount);

  return {
    maze,
    cellSize: grid.cellSize,
    routeSteps: fromStart.dist[finishCell] as number,
    breakableTreeDist,
  };
}

// ---------------------------------------------------------------------------
// Solver — BFS over open corridors on a raster of the normalized field.
// Breakable walls count as walls: this proves an honest, no-break path exists.
// ---------------------------------------------------------------------------

export function solvePath(maze: Maze, res = 384): Pt[] | null {
  const blocked = new Uint8Array(res * res);
  const step = 1 / res;
  const mark = (gx: number, gy: number): void => {
    // 2x2 stamp seals the line against 4-connected leaks through diagonals.
    for (let dy = 0; dy <= 1; dy++)
      for (let dx = 0; dx <= 1; dx++) {
        const x = gx + dx;
        const y = gy + dy;
        if (x >= 0 && y >= 0 && x < res && y < res) blocked[y * res + x] = 1;
      }
  };
  for (const w of maze.walls) {
    const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
    const n = Math.max(1, Math.ceil(len / (step * 0.5)));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      mark(
        Math.floor((w.x1 + (w.x2 - w.x1) * t) / step),
        Math.floor((w.y1 + (w.y2 - w.y1) * t) / step),
      );
    }
  }
  const cell = (p: Pt): number => {
    const gx = Math.max(0, Math.min(res - 1, Math.floor(p.x / step)));
    const gy = Math.max(0, Math.min(res - 1, Math.floor(p.y / step)));
    return gy * res + gx;
  };
  const src = cell(maze.start);
  const dst = cell(maze.finish);
  if (blocked[src] || blocked[dst]) return null;

  const prev = new Int32Array(res * res).fill(-1);
  const queue = new Int32Array(res * res);
  let head = 0;
  let tail = 0;
  queue[tail++] = src;
  prev[src] = src;
  while (head < tail) {
    const v = queue[head++] as number;
    if (v === dst) break;
    const vx = v % res;
    const vy = (v - vx) / res;
    for (let d = 0; d < 4; d++) {
      const nx = vx + (d === 0 ? 1 : d === 1 ? -1 : 0);
      const ny = vy + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= res || ny >= res) continue;
      const to = ny * res + nx;
      if (blocked[to] || prev[to] !== -1) continue;
      prev[to] = v;
      queue[tail++] = to;
    }
  }
  if (prev[dst] === -1) return null;
  const path: Pt[] = [];
  let cur = dst;
  while (cur !== src) {
    const cx = cur % res;
    path.push({ x: (cx + 0.5) * step, y: ((cur - cx) / res + 0.5) * step });
    cur = prev[cur] as number;
  }
  path.push({ ...maze.start });
  path.reverse();
  return path;
}

// ---------------------------------------------------------------------------
// Searchlight patrols
// ---------------------------------------------------------------------------

/** A post must not stand on the doorstep of start or finish (normalized units). */
export const PATROL_END_CLEARANCE = 0.09;

/** Posts spread over the middle 70% of the honest route — never next to start/finish. */
export function placePatrolPosts(maze: Maze, count: number): Pt[] {
  if (count <= 0) return [];
  const path = solvePath(maze);
  if (path === null || path.length < 2) return [];
  const acc: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as Pt;
    const b = path[i] as Pt;
    acc.push((acc[i - 1] as number) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = acc[acc.length - 1] as number;
  // Arc length says nothing about how close the route folds back to its own ends.
  const clear = (p: Pt): boolean =>
    Math.hypot(p.x - maze.start.x, p.y - maze.start.y) >= PATROL_END_CLEARANCE &&
    Math.hypot(p.x - maze.finish.x, p.y - maze.finish.y) >= PATROL_END_CLEARANCE;

  const out: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const want = total * (0.15 + (0.7 * (i + 0.5)) / count);
    let j = 1;
    while (j < acc.length - 1 && (acc[j] as number) < want) j++;
    const a = path[j - 1] as Pt;
    const b = path[j] as Pt;
    const seg = (acc[j] as number) - (acc[j - 1] as number);
    const f = seg > EPS ? (want - (acc[j - 1] as number)) / seg : 0;
    let pt = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    if (!clear(pt)) {
      // Slide to the closest point of the route (by arc length) that is clear.
      let best = -1;
      for (let k = 0; k < path.length; k++)
        if (
          clear(path[k] as Pt) &&
          (best < 0 || Math.abs((acc[k] as number) - want) < Math.abs((acc[best] as number) - want))
        )
          best = k;
      if (best >= 0) pt = { ...(path[best] as Pt) };
    }
    out.push(pt);
  }
  return out;
}

export type PatrolMode = 'IDLE' | 'ALERT' | 'SEARCH' | 'RETURN';

export interface PatrolState {
  post: Pt;
  x: number;
  y: number;
  mode: PatrolMode;
  /** Where the light is heading / searching (equals post while idle). */
  target: Pt;
  searchMsLeft: number;
  /** Orbit clock, keeps running in every mode. */
  t: number;
  phaseOffset: number;
}

export interface PatrolParams {
  lightRadius: number;
  speed: number;
  searchMs: number;
  orbitRadius: number;
  orbitPeriodS: number;
}

/** Idle patrol on its post; index spreads the orbit phases without an RNG. */
export function makePatrol(post: Pt, index: number): PatrolState {
  return {
    post: { ...post },
    x: post.x,
    y: post.y,
    mode: 'IDLE',
    target: { ...post },
    searchMsLeft: 0,
    t: 0,
    phaseOffset: index * 2.399,
  };
}

/** One tick of the patrol state machine. Pure: returns a new state. */
export function stepPatrol(p: PatrolState, dt: number, params: PatrolParams): PatrolState {
  const t = p.t + dt;
  if (p.mode === 'IDLE' || p.mode === 'SEARCH') {
    const c = p.mode === 'IDLE' ? p.post : p.target;
    const a = (2 * Math.PI * t) / params.orbitPeriodS + p.phaseOffset;
    const searchMsLeft = p.mode === 'SEARCH' ? p.searchMsLeft - dt * 1000 : p.searchMsLeft;
    return {
      ...p,
      t,
      x: c.x + params.orbitRadius * Math.cos(a),
      y: c.y + params.orbitRadius * Math.sin(a),
      mode: p.mode === 'SEARCH' && searchMsLeft <= 0 ? 'RETURN' : p.mode,
      searchMsLeft,
    };
  }
  // ALERT / RETURN — straight line, light does not care about walls.
  const goal = p.mode === 'ALERT' ? p.target : p.post;
  const dx = goal.x - p.x;
  const dy = goal.y - p.y;
  const d = Math.hypot(dx, dy);
  const stepLen = params.speed * dt;
  if (d <= stepLen) {
    return p.mode === 'ALERT'
      ? { ...p, t, x: goal.x, y: goal.y, mode: 'SEARCH', searchMsLeft: params.searchMs }
      : { ...p, t, x: goal.x, y: goal.y, mode: 'IDLE', target: { ...p.post } };
  }
  return { ...p, t, x: p.x + (dx / d) * stepLen, y: p.y + (dy / d) * stepLen };
}

/** Caught: inside the light cone and moving fast enough to be noticed. */
export function patrolCatches(
  px: number,
  py: number,
  dot: DotState,
  lightRadius: number,
  minSpeed: number,
): boolean {
  return (
    Math.hypot(dot.x - px, dot.y - py) <= lightRadius + EPS &&
    Math.hypot(dot.vx, dot.vy) >= minSpeed - EPS
  );
}
