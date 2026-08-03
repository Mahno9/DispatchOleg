import { describe, it, expect } from 'vitest';
import {
  BREAK_MIN_TREE_DIST,
  DOT_RADIUS,
  type MazeType,
  type PhysicsParams,
  type Wall,
  applyBounce,
  classifyHit,
  computeScore,
  computeStyleTag,
  distancePointSegment,
  generateMaze,
  generateMazeDetailed,
  minClearance,
  raycast,
  relaxFactor,
  solvePath,
  stepPhysics,
} from './engine.js';

const P: PhysicsParams = {
  followSpeed: 600,
  bounceSpeed: 400,
  bounceDurationMs: 300,
  breakAngleDeg: 40,
  breakMinSpeedRatio: 0.55,
};

const wall = (x1: number, y1: number, x2: number, y2: number, breakable = false): Wall => ({
  x1,
  y1,
  x2,
  y2,
  breakable,
});

// ---------------------------------------------------------------------------

describe('distancePointSegment', () => {
  it('projects onto the segment', () => {
    const r = distancePointSegment(5, 3, 0, 0, 10, 0);
    expect(r.dist).toBeCloseTo(3);
    expect(r.t).toBeCloseTo(0.5);
    expect(r.cx).toBeCloseTo(5);
    expect(r.cy).toBeCloseTo(0);
  });

  it('clamps t outside the segment', () => {
    const a = distancePointSegment(-4, 3, 0, 0, 10, 0);
    expect(a.t).toBe(0);
    expect(a.dist).toBeCloseTo(5);
    const b = distancePointSegment(14, -3, 0, 0, 10, 0);
    expect(b.t).toBe(1);
    expect(b.dist).toBeCloseTo(5);
  });

  it('handles a degenerate segment', () => {
    const r = distancePointSegment(3, 4, 1, 1, 1, 1);
    expect(r.dist).toBeCloseTo(Math.hypot(2, 3));
    expect(r.t).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('classifyHit', () => {
  // Wall is horizontal, dot above it -> normal points up (0,-1); a head-on hit
  // moves down (0, +speed).
  const n = { x: 0, y: -1 };
  const hit = (breakable: boolean, speed: number, angleDeg: number): 'break' | 'fail' => {
    const a = (angleDeg * Math.PI) / 180;
    // velocity = -n rotated by angle
    const vx = Math.sin(a) * speed;
    const vy = Math.cos(a) * speed;
    return classifyHit(wall(0, 0, 100, 0, breakable), n.x, n.y, vx, vy, P);
  };

  it('head-on fast hit on a breakable wall breaks it', () => {
    expect(hit(true, 600, 0)).toBe('break');
  });
  it('same hit on a solid wall fails', () => {
    expect(hit(false, 600, 0)).toBe('fail');
  });
  it('41 degrees fails, 39 breaks (breakAngleDeg = 40)', () => {
    expect(hit(true, 600, 41)).toBe('fail');
    expect(hit(true, 600, 39)).toBe('break');
  });
  it('exactly at the angle threshold breaks', () => {
    expect(hit(true, 600, 40)).toBe('break');
  });
  it('too slow fails, exactly at the speed threshold breaks', () => {
    expect(hit(true, 0.54 * 600, 0)).toBe('fail');
    expect(hit(true, 0.55 * 600, 0)).toBe('break');
  });
  it('zero speed fails', () => {
    expect(hit(true, 0, 0)).toBe('fail');
  });
});

// ---------------------------------------------------------------------------

describe('applyBounce', () => {
  const col = { wallIndex: 0, nx: 0, ny: -1, cx: 50, cy: 0, speed: 600 };

  it('sends the dot along the normal, out of the wall', () => {
    const s = applyBounce({ x: 50, y: -2, vx: 0, vy: 600, relaxMs: 0 }, col, P);
    expect(s.vx).toBeCloseTo(0);
    expect(s.vy).toBeCloseTo(-Math.max(400, 1.15 * 600));
    const d = distancePointSegment(s.x, s.y, 0, 0, 100, 0).dist;
    expect(d).toBeGreaterThan(DOT_RADIUS);
    expect(s.relaxMs).toBe(P.bounceDurationMs);
  });

  it('slow hits still get the minimum bounce speed', () => {
    const s = applyBounce({ x: 50, y: -2, vx: 0, vy: 100, relaxMs: 0 }, col, P);
    expect(Math.hypot(s.vx, s.vy)).toBeCloseTo(400);
  });

  it('spring stiffness relaxes back to 1.0 exactly over bounceDurationMs', () => {
    expect(relaxFactor(300, 300)).toBeCloseTo(0.25);
    expect(relaxFactor(150, 300)).toBeCloseTo(0.625);
    expect(relaxFactor(0, 300)).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('stepPhysics', () => {
  it('never exceeds followSpeed and never overshoots the target', () => {
    let s = { x: 0, y: 0, vx: 0, vy: 0, relaxMs: 0 };
    const target = { x: 200, y: 0 };
    for (let i = 0; i < 600; i++) {
      const r = stepPhysics(s, target, 1 / 60, [], P);
      s = r.state;
      expect(Math.hypot(s.vx, s.vy)).toBeLessThanOrEqual(P.followSpeed + 1e-6);
      expect(s.x).toBeLessThanOrEqual(target.x + 1e-6); // critical damping: no overshoot
    }
    expect(s.x).toBeCloseTo(200, 1);
  });

  it('does not tunnel through a thin wall at full speed with dt = 50ms', () => {
    const walls = [wall(100, -100, 100, 100)];
    let s = { x: 40, y: 0, vx: P.followSpeed, vy: 0, relaxMs: 0 };
    let collided = false;
    for (let i = 0; i < 10 && !collided; i++) {
      const r = stepPhysics(s, { x: 400, y: 0 }, 0.05, walls, P);
      s = r.state;
      if (r.collision) collided = true;
      expect(s.x).toBeLessThan(100 + DOT_RADIUS);
    }
    expect(collided).toBe(true);
  });

  it('does not tunnel from a standing start with a far target and dt = 50ms', () => {
    const walls = [wall(100, -100, 100, 100)];
    let s = { x: 40, y: 0, vx: 0, vy: 0, relaxMs: 0 };
    let collided = false;
    for (let i = 0; i < 10 && !collided; i++) {
      const r = stepPhysics(s, { x: 400, y: 0 }, 0.05, walls, P);
      s = r.state;
      if (r.collision) collided = true;
      expect(s.x).toBeLessThan(100 + DOT_RADIUS);
    }
    expect(collided).toBe(true);
  });

  it('reports the nearest wall when two are in range', () => {
    const walls = [wall(0, -8, 100, -8), wall(0, 3, 100, 3, true)];
    const r = stepPhysics({ x: 50, y: 0, vx: 0, vy: 60, relaxMs: 0 }, { x: 50, y: 50 }, 1 / 60, walls, P);
    expect(r.collision?.wallIndex).toBe(1);
  });

  it('normal points from the wall towards the dot', () => {
    const walls = [wall(0, 0, 100, 0)];
    const r = stepPhysics({ x: 50, y: -5, vx: 0, vy: 60, relaxMs: 0 }, { x: 50, y: 50 }, 1 / 60, walls, P);
    expect(r.collision).toBeDefined();
    expect(r.collision?.ny).toBeCloseTo(-1);
  });
});

// ---------------------------------------------------------------------------

describe('scoring', () => {
  it('computeStyleTag', () => {
    expect(computeStyleTag(0, 1)).toBe('ghost');
    expect(computeStyleTag(1, 1)).toBe('breaker');
    expect(computeStyleTag(1, 2)).toBe('ghost');
    expect(computeStyleTag(5, 2)).toBe('breaker');
  });

  it('computeScore never goes negative', () => {
    expect(computeScore([100, 100, 150], 0, 50)).toBe(350);
    expect(computeScore([100, 100, 150], 3, 50)).toBe(200);
    expect(computeScore([100], 10, 50)).toBe(0);
    expect(computeScore([], 0, 50)).toBe(0);
  });
});

// ---------------------------------------------------------------------------

const TYPES: MazeType[] = ['square', 'hex', 'circular'];
const SIZES = [3, 5, 8, 12, 20];
const DENSITIES = [0, 0.15, 0.5, 1];
const SEEDS = [1, 7, 42, 1337, 48211, 99999, 123456, 2024];

describe('generateMaze', () => {
  const cases: [MazeType, number, number, number][] = [];
  for (const type of TYPES)
    for (const size of SIZES)
      for (const density of DENSITIES)
        for (const seed of SEEDS) cases.push([type, size, density, seed]);

  it.each(cases)('honest path exists: %s size=%i density=%f seed=%i', (type, size, density, seed) => {
    const maze = generateMaze({ type, size, breakableDensity: density, seed });
    // solvePath treats breakable walls as walls — the path must need no breaking.
    expect(solvePath(maze)).not.toBeNull();
  });

  it('is deterministic for the same seed and differs for another', () => {
    for (const type of TYPES) {
      const p = { type, size: 8, breakableDensity: 0.3, seed: 4242 };
      expect(JSON.stringify(generateMaze(p))).toBe(JSON.stringify(generateMaze(p)));
      expect(JSON.stringify(generateMaze(p))).not.toBe(
        JSON.stringify(generateMaze({ ...p, seed: 4243 })),
      );
    }
  });

  it('start differs from finish and the honest route is long', () => {
    for (const type of TYPES)
      for (const size of SIZES)
        for (const seed of SEEDS) {
          const m = generateMaze({ type, size, breakableDensity: 0.15, seed });
          expect(m.start).not.toEqual(m.finish);
          const path = solvePath(m) as { x: number; y: number }[];
          let len = 0;
          for (let i = 1; i < path.length; i++) {
            const a = path[i - 1] as { x: number; y: number };
            const b = path[i] as { x: number; y: number };
            len += Math.hypot(b.x - a.x, b.y - a.y);
          }
          // route (not straight-line distance) is at least half the field
          expect(len).toBeGreaterThan(0.5);
        }
  });

  it('breakableDensity = 0 leaves no breakable walls', () => {
    for (const type of TYPES)
      for (const seed of SEEDS) {
        const m = generateMaze({ type, size: 8, breakableDensity: 0, seed });
        expect(m.walls.some((w) => w.breakable)).toBe(false);
      }
  });

  it('breakableDensity = 1 produces breakable walls', () => {
    for (const type of TYPES) {
      const m = generateMaze({ type, size: 8, breakableDensity: 1, seed: 777 });
      expect(m.walls.filter((w) => w.breakable).length).toBeGreaterThan(0);
    }
  });

  it('every breakable wall is a real short-cut', () => {
    for (const type of TYPES)
      for (const seed of SEEDS) {
        const d = generateMazeDetailed({ type, size: 10, breakableDensity: 0.5, seed });
        for (const dist of d.breakableTreeDist) expect(dist).toBeGreaterThanOrEqual(BREAK_MIN_TREE_DIST);
      }
  });

  it('every breakable wall has open corridor on both sides', () => {
    for (const type of TYPES)
      for (const seed of SEEDS) {
        const d = generateMazeDetailed({ type, size: 10, breakableDensity: 1, seed });
        const need = minClearance(d.cellSize);
        const groups = new Map<number, Wall[]>();
        for (const w of d.maze.walls) {
          if (!w.breakable) continue;
          const g = w.group ?? -1;
          const list = groups.get(g) ?? [];
          list.push(w);
          groups.set(g, list);
        }
        for (const list of groups.values()) {
          // same probe the generator used: midpoint of the middle piece
          const w = list[list.length >> 1] as Wall;
          const mx = (w.x1 + w.x2) / 2;
          const my = (w.y1 + w.y2) / 2;
          const ex = w.x2 - w.x1;
          const ey = w.y2 - w.y1;
          const l = Math.hypot(ex, ey) || 1;
          const nx = -ey / l;
          const ny = ex / l;
          const front = raycast(d.maze.walls, mx, my, nx, ny);
          const back = raycast(d.maze.walls, mx, my, -nx, -ny);
          expect(Math.min(front, back)).toBeGreaterThanOrEqual(need);
        }
      }
  });
});
