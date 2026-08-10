import { describe, it, expect } from 'vitest';
import {
  BREAK_MIN_TREE_DIST,
  DOT_RADIUS,
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
  generateMazeDetailed,
  makePatrol,
  minClearance,
  patrolCatches,
  placePatrolPosts,
  raycast,
  relaxFactor,
  solvePath,
  stepPatrol,
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

// ---------------------------------------------------------------------------

describe('patrol posts', () => {
  it('patrols do not perturb walls, start or finish', () => {
    for (const type of TYPES)
      for (const size of SIZES)
        for (const seed of SEEDS) {
          const p = { type, size, breakableDensity: 0.3, seed };
          const plain = generateMazeDetailed(p).maze;
          const withPatrols = generateMazeDetailed({ ...p, patrols: 2 }).maze;
          expect(withPatrols.walls).toEqual(plain.walls);
          expect(withPatrols.start).toEqual(plain.start);
          expect(withPatrols.finish).toEqual(plain.finish);
        }
  });

  it('is deterministic and places exactly the requested number of posts', () => {
    for (const type of TYPES) {
      const p = { type, size: 8, breakableDensity: 0.3, seed: 4242, patrols: 2 };
      expect(JSON.stringify(generateMazeDetailed(p))).toBe(JSON.stringify(generateMazeDetailed(p)));
      expect(generateMaze(p).patrols).toHaveLength(2);
    }
  });

  it('no patrols field without patrols or with patrols = 0', () => {
    for (const type of TYPES) {
      const p = { type, size: 8, breakableDensity: 0.3, seed: 4242 };
      expect(generateMaze(p).patrols).toBeUndefined();
      expect(generateMaze({ ...p, patrols: 0 }).patrols).toBeUndefined();
    }
  });

  it('every post sits on the honest route, far from start and finish', () => {
    for (const type of TYPES)
      for (const seed of SEEDS)
        for (const count of [1, 2, 3]) {
          const m = generateMaze({ type, size: 10, breakableDensity: 0.3, seed, patrols: count });
          const path = solvePath(m) as Pt[];
          for (const post of m.patrols as Pt[]) {
            expect(Math.hypot(post.x - m.start.x, post.y - m.start.y)).toBeGreaterThan(0.08);
            expect(Math.hypot(post.x - m.finish.x, post.y - m.finish.y)).toBeGreaterThan(0.08);
            const near = Math.min(...path.map((q) => Math.hypot(post.x - q.x, post.y - q.y)));
            expect(near).toBeLessThan(0.01);
          }
        }
  });

  it('returns nothing for a maze with no path or a non-positive count', () => {
    const sealed = { walls: [wall(0.5, 0, 0.5, 1)], start: { x: 0.2, y: 0.5 }, finish: { x: 0.8, y: 0.5 } };
    expect(placePatrolPosts(sealed, 2)).toEqual([]);
    expect(placePatrolPosts(generateMaze({ type: 'square', size: 8, breakableDensity: 0, seed: 1 }), 0)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('stepPatrol', () => {
  const PP: PatrolParams = {
    lightRadius: 40,
    speed: 100,
    searchMs: 1000,
    orbitRadius: 8,
    orbitPeriodS: 3,
  };
  const post: Pt = { x: 100, y: 100 };
  const dt = 1 / 60;
  const fromPost = (s: PatrolState): number => Math.hypot(s.x - post.x, s.y - post.y);

  it('idles on an orbit around its post', () => {
    let s = makePatrol(post, 0);
    for (let i = 0; i < 300; i++) {
      s = stepPatrol(s, dt, PP);
      expect(s.mode).toBe('IDLE');
      expect(fromPost(s)).toBeLessThanOrEqual(PP.orbitRadius + 1e-6);
    }
  });

  it('phase offset makes two patrols orbit apart', () => {
    const a = stepPatrol(makePatrol(post, 0), dt, PP);
    const b = stepPatrol(makePatrol(post, 1), dt, PP);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1);
  });

  it('does not mutate its input', () => {
    const s = makePatrol(post, 1);
    const before = structuredClone(s);
    stepPatrol(s, dt, PP);
    expect(s).toEqual(before);
  });

  it('alerts to the target, then searches, then returns home', () => {
    const target: Pt = { x: 300, y: 100 }; // D = 200 -> 2s at speed 100
    let s: PatrolState = { ...makePatrol(post, 0), mode: 'ALERT', target };
    let steps = 0;
    while (s.mode === 'ALERT' && steps < 1000) {
      s = stepPatrol(s, dt, PP);
      steps++;
    }
    expect(s.mode).toBe('SEARCH');
    expect(steps).toBeGreaterThanOrEqual(Math.round(2 / dt) - 2);
    expect(steps).toBeLessThanOrEqual(Math.round(2 / dt) + 2);
    expect(s.searchMsLeft).toBe(PP.searchMs);
    expect(Math.hypot(s.x - target.x, s.y - target.y)).toBeLessThanOrEqual(1e-6);

    let search = 0;
    while (s.mode === 'SEARCH' && search < 1000) {
      s = stepPatrol(s, dt, PP);
      search++;
      expect(Math.hypot(s.x - target.x, s.y - target.y)).toBeCloseTo(PP.orbitRadius, 6);
    }
    expect(s.mode).toBe('RETURN');
    expect(search).toBeGreaterThanOrEqual(Math.round(PP.searchMs / 1000 / dt) - 2);
    expect(search).toBeLessThanOrEqual(Math.round(PP.searchMs / 1000 / dt) + 2);

    let back = 0;
    while (s.mode === 'RETURN' && back < 1000) {
      s = stepPatrol(s, dt, PP);
      back++;
    }
    expect(s.mode).toBe('IDLE');
    expect(fromPost(s)).toBeLessThanOrEqual(PP.orbitRadius + 1e-6);
  });
});

// ---------------------------------------------------------------------------

describe('patrolCatches', () => {
  const dot = (x: number, y: number, speed: number) => ({ x, y, vx: speed, vy: 0, relaxMs: 0 });

  it('catches a fast dot inside the light', () => {
    expect(patrolCatches(0, 0, dot(10, 0, 200), 40, 60)).toBe(true);
  });
  it('ignores a slow dot inside the light', () => {
    expect(patrolCatches(0, 0, dot(10, 0, 59), 40, 60)).toBe(false);
  });
  it('ignores a fast dot outside the light', () => {
    expect(patrolCatches(0, 0, dot(41, 0, 200), 40, 60)).toBe(false);
  });
  it('exactly on the radius and exactly at the speed threshold counts', () => {
    expect(patrolCatches(0, 0, dot(40, 0, 60), 40, 60)).toBe(true);
  });
});
