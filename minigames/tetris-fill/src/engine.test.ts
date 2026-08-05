import { describe, expect, it } from 'vitest';
import {
  EmptyShapeError,
  collides,
  createFallState,
  hardDrop,
  landingY,
  move,
  normalize,
  orderForGravity,
  parseShape,
  partition,
  rotate,
  rotateActive,
  sameCells,
  scoreForElapsed,
  setSoftDrop,
  spawn,
  update,
  type Active,
  type Cell,
  type FallRules,
  type FallState,
  type Piece,
} from './engine.js';

const shapeOf = (rows: string[]) => ({ width: (rows[0] ?? '').length, height: rows.length, rows });
const cellsOf = (rows: string[]) => parseShape(shapeOf(rows));
const k = (c: Cell) => `${c.x},${c.y}`;

/** Every piece is 1..4 cells and connected by sides. */
function isConnected(cells: Cell[]): boolean {
  const keys = new Set(cells.map(k));
  const seen = new Set<string>([k(cells[0] as Cell)]);
  const stack = [cells[0] as Cell];
  while (stack.length > 0) {
    const c = stack.pop() as Cell;
    for (const [dx, dy] of [
      [0, -1],
      [-1, 0],
      [1, 0],
      [0, 1],
    ] as const) {
      const nb = { x: c.x + dx, y: c.y + dy };
      if (keys.has(k(nb)) && !seen.has(k(nb))) {
        seen.add(k(nb));
        stack.push(nb);
      }
    }
  }
  return seen.size === cells.length;
}

/** Full cover, no overlaps, every piece connected and sized 1..4. */
function expectValidPartition(cells: Cell[], pieces: Piece[]): void {
  const covered = new Set<string>();
  for (const piece of pieces) {
    expect(piece.cells.length).toBeGreaterThanOrEqual(1);
    expect(piece.cells.length).toBeLessThanOrEqual(4);
    expect(isConnected(piece.cells)).toBe(true);
    for (const c of piece.cells) {
      expect(covered.has(k(c))).toBe(false); // no overlap
      covered.add(k(c));
    }
  }
  expect(covered).toEqual(new Set(cells.map(k)));
  expect(pieces.map((p) => p.index)).toEqual(pieces.map((_, i) => i));
}

describe('parseShape', () => {
  it('reads # cells in reading order', () => {
    expect(cellsOf(['#.', '.#'])).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
  });

  it('throws EmptyShapeError on a silhouette without a single #', () => {
    expect(() => cellsOf(['..', '..'])).toThrow(EmptyShapeError);
  });

  it('throws on a row whose length differs from width', () => {
    expect(() => parseShape({ width: 3, height: 2, rows: ['###', '##'] })).toThrow();
  });

  it('throws when the number of rows differs from height', () => {
    expect(() => parseShape({ width: 2, height: 3, rows: ['##', '##'] })).toThrow();
  });

  it('throws on a foreign character', () => {
    expect(() => parseShape({ width: 2, height: 1, rows: ['#x'] })).toThrow();
  });

  it('throws on out-of-range size and on more than 60 cells', () => {
    expect(() => parseShape({ width: 17, height: 1, rows: ['#'.repeat(17)] })).toThrow();
    expect(() => parseShape({ width: 0, height: 1, rows: [''] })).toThrow();
    const big = Array.from({ length: 8 }, () => '#'.repeat(8)); // 64 cells
    expect(() => parseShape({ width: 8, height: 8, rows: big })).toThrow(/КЛЕТОК/);
  });
});

describe('partition', () => {
  it('splits a rectangle divisible by 4 into tetrominoes only', () => {
    for (const rows of [
      ['####', '####', '####', '####'], // 4x4
      ['######', '######', '######', '######'], // 6x4
      ['########', '########'], // 8x2
    ]) {
      const cells = cellsOf(rows);
      const pieces = partition(cells);
      expectValidPartition(cells, pieces);
      expect(pieces.every((p) => p.cells.length === 4)).toBe(true);
      expect(pieces).toHaveLength(cells.length / 4);
    }
  });

  it('splits an L-shape into tetrominoes only', () => {
    const cells = cellsOf(['##..', '##..', '####']);
    const pieces = partition(cells);
    expectValidPartition(cells, pieces);
    expect(pieces).toHaveLength(2);
    expect(pieces.every((p) => p.cells.length === 4)).toBe(true);
  });

  it('handles the 4x4 frame from the spec — hole cells belong to no piece', () => {
    const rows = ['####', '#..#', '#..#', '####'];
    const cells = cellsOf(rows);
    const pieces = partition(cells);
    expectValidPartition(cells, pieces);
    expect(pieces).toHaveLength(3);
    const all = pieces.flatMap((p) => p.cells);
    for (const hole of [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ]) {
      expect(all.some((c) => k(c) === k(hole))).toBe(false);
    }
  });

  it('handles a disconnected shape (two islands)', () => {
    const rows = ['##...', '##...', '.....', '..###', '...##'];
    const cells = cellsOf(rows);
    const pieces = partition(cells);
    expectValidPartition(cells, pieces);
    // left island is one O-tetromino, right island is 5 cells → 2 pieces
    expect(pieces).toHaveLength(3);
    // no piece straddles the islands
    for (const p of pieces) {
      const leftIsland = p.cells.filter((c) => c.y < 2).length;
      expect(leftIsland === 0 || leftIsland === p.cells.length).toBe(true);
    }
  });

  it('handles 1- and 2-cell shapes', () => {
    expect(partition(cellsOf(['#']))).toEqual([{ index: 0, cells: [{ x: 0, y: 0 }] }]);
    const adjacent = partition(cellsOf(['##']));
    expect(adjacent).toHaveLength(1);
    expect(adjacent[0]?.cells).toHaveLength(2);
    const apart = partition(cellsOf(['#.#']));
    expect(apart).toHaveLength(2);
    expect(apart.every((p) => p.cells.length === 1)).toBe(true);
  });

  it('is deterministic', () => {
    const cells = cellsOf(['.###.', '#####', '##.##', '.###.']);
    expect(partition(cells)).toEqual(partition(cells));
    expect(partition([...cells].reverse())).toEqual(partition(cells));
  });

  it('orders pieces so gravity can reach every target', () => {
    for (const rows of [
      ['####', '####', '####', '####'],
      ['##', '##', '.#'],
      ['###', '...', '###'],
      ['####', '#..#', '#..#', '####'],
      ['.###.', '#####', '##.##', '.###.'],
    ]) {
      const pieces = orderForGravity(partition(cellsOf(rows)));
      expect(pieces.map((p) => p.index)).toEqual(pieces.map((_, i) => i));
      for (let i = 0; i < pieces.length; i++) {
        for (let j = i + 1; j < pieces.length; j++) {
          const above = (pieces[i] as Piece).cells.some((a) =>
            (pieces[j] as Piece).cells.some((b) => a.x === b.x && a.y < b.y),
          );
          expect(above).toBe(false); // an earlier piece must never sit above a later one
        }
      }
    }
  });

  it('splits a 60-cell silhouette in well under 50 ms', () => {
    const rows = Array.from({ length: 10 }, () => '######'); // 6x10 = 60
    const cells = cellsOf(rows);
    const t0 = performance.now();
    const pieces = partition(cells);
    const ms = performance.now() - t0;
    expectValidPartition(cells, pieces);
    expect(pieces).toHaveLength(15);
    expect(ms).toBeLessThan(50);
  });
});

describe('rotate', () => {
  it('returns the normalized original after 4 turns', () => {
    const s = normalize([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ]); // J-tetromino
    expect(rotate(s, 4)).toEqual(s);
    expect(rotate(s, 0)).toEqual(s);
    expect(rotate(s, -1)).toEqual(rotate(s, 3));
    expect(rotate(rotate(s, 1), 3)).toEqual(s);
    expect(rotate(s, 1)).not.toEqual(s);
  });

  it('leaves the O-tetromino invariant in all 4 orientations', () => {
    const o = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ];
    for (let t = 0; t < 4; t++) expect(sameCells(rotate(o, t), o)).toBe(true);
  });

  it('rotates I-tetromino between two distinct orientations', () => {
    const i = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ];
    expect(sameCells(rotate(i, 2), i)).toBe(true);
    expect(sameCells(rotate(i, 1), i)).toBe(false);
    expect(sameCells(rotate(i, 1), rotate(i, 3))).toBe(true);
  });
});

describe('sameCells', () => {
  it('ignores order', () => {
    const a = [
      { x: 1, y: 2 },
      { x: 0, y: 0 },
    ];
    expect(sameCells(a, [...a].reverse())).toBe(true);
  });

  it('distinguishes S from Z (no mirroring)', () => {
    const s = [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ];
    const z = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ];
    expect(sameCells(s, z)).toBe(false);
    for (let t = 0; t < 4; t++) expect(sameCells(rotate(s, t), z)).toBe(false);
  });

  it('differs on length', () => {
    expect(sameCells([{ x: 0, y: 0 }], [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Falling mode
// ---------------------------------------------------------------------------

const rulesOf = (over: Partial<FallRules> = {}): FallRules => ({
  fallIntervalMs: 700,
  softDropFactor: 6,
  lockDelayMs: 500,
  spawnColumn: 'center',
  ...over,
});
const fallOf = (rows: string[], over?: Partial<FallRules>) => createFallState(shapeOf(rows), rulesOf(over));
const dot = [{ x: 0, y: 0 }];

describe('collides', () => {
  const s = fallOf(['###', '...', '###']);

  it('blocks walls and the floor but leaves everything above row 0 free', () => {
    expect(collides(s, dot, -1, 0)).toBe(true);
    expect(collides(s, dot, 3, 0)).toBe(true);
    expect(collides(s, dot, 0, 3)).toBe(true);
    expect(collides(s, dot, 0, -5)).toBe(false);
    expect(collides(s, dot, -1, -5)).toBe(true); // walls apply above the board too
  });

  it('lets a piece pass through silhouette voids but not through locked cells', () => {
    expect(collides(s, dot, 1, 1)).toBe(false); // the '...' row is not part of the silhouette
    s.locked[1 * 3 + 1] = 1;
    expect(collides(s, dot, 1, 1)).toBe(true);
  });
});

describe('update timing', () => {
  const ready = (over?: Partial<FallRules>): FallState => {
    const s = fallOf(['.....', '.....', '.....', '.##..'], over);
    spawn(s, 0);
    (s.active as Active).x = 3; // off target, so nothing commits mid-flight
    return s;
  };

  it('does not move below one interval and moves exactly one row at the interval', () => {
    const s = ready();
    const y0 = (s.active as Active).y;
    update(s, 99);
    update(s, 99);
    update(s, 99); // 297 ms < 700
    expect((s.active as Active).y).toBe(y0);
    for (let i = 0; i < 5; i++) update(s, 99); // 792 ms total → one row
    expect((s.active as Active).y).toBe(y0 + 1);
  });

  it('divides the interval by softDropFactor', () => {
    const s = ready({ fallIntervalMs: 700, softDropFactor: 7 });
    const y0 = (s.active as Active).y;
    update(s, 100);
    expect((s.active as Active).y).toBe(y0); // 100 < 700
    setSoftDrop(s, true);
    update(s, 100); // 200 accumulated, interval now 100 → two rows
    expect((s.active as Active).y).toBe(y0 + 2);
  });

  it('clamps a tab-resume delta to 100 ms', () => {
    const s = ready();
    const y0 = (s.active as Active).y;
    update(s, 5000);
    expect((s.active as Active).y).toBe(y0);
    expect(s.fallTimer).toBe(100);
  });
});

describe('lock delay', () => {
  it('rejects exactly once after lockDelayMs, and a successful move resets it', () => {
    const s = fallOf(['.....', '.....', '.....', '.##..'], { lockDelayMs: 500 });
    spawn(s, 0);
    const a = s.active as Active;
    a.x = 3;
    a.y = 3; // resting on the floor, off target

    expect(update(s, 100)).toEqual([]);
    expect(update(s, 100)).toEqual([]);
    expect(s.lockTimer).toBe(200);

    expect(move(s, -1)).toBe(true);
    expect(s.lockTimer).toBe(0);

    for (let i = 0; i < 4; i++) expect(update(s, 100)).toEqual([]);
    expect(update(s, 100)).toEqual(['rejected']);
    expect(s.errors).toBe(1);
    expect(s.current).toBe(0); // the same piece will be dealt again
    expect(s.active).toBe(null);
  });
});

describe('magnetic lock', () => {
  it("locks on the target even when the piece could still fall — ['###','...','###']", () => {
    const s = fallOf(['###', '...', '###']);
    expect(s.pieces).toHaveLength(2);
    expect((s.pieces[0] as Piece).cells.every((c) => c.y === 2)).toBe(true); // bottom bar first

    spawn(s, 0);
    (s.active as Active).y = 2;
    expect(update(s, 0)).toEqual(['placed']);

    spawn(s, 0);
    const a = s.active as Active;
    a.y = 0;
    expect(collides(s, a.shape, a.x, a.y + 1)).toBe(false); // nothing under it — it could keep falling
    expect(update(s, 0)).toEqual(['placed', 'won']);
    expect(s.done).toBe(true);
    expect(s.errors).toBe(0);
  });
});

describe('hardDrop', () => {
  it('lands where landingY promised and rejects once when that is not the target', () => {
    const s = fallOf(['.....', '.....', '.....', '.##..']);
    spawn(s, 0);
    (s.active as Active).x = 3;
    expect(landingY(s)).toBe(3);
    expect(hardDrop(s)).toEqual(['rejected']);
    expect(s.errors).toBe(1);
    expect(s.current).toBe(0);
    expect(s.active).toBe(null);
  });
});

describe('pieceErrors', () => {
  it('counts errors of the current piece only and resets once it is placed', () => {
    const s = fallOf(['.....', '.....', '.....', '.##..']);

    spawn(s, 0);
    (s.active as Active).x = 3;
    expect(hardDrop(s)).toEqual(['rejected']); // легла не туда
    expect(s.pieceErrors).toBe(1);

    spawn(s, 0);
    (s.active as Active).x = 1;
    expect(hardDrop(s)).toEqual(['placed', 'won']);
    expect(s.pieceErrors).toBe(0); // подсказка гаснет вместе со счётчиком
    expect(s.errors).toBe(1); // суммарные ошибки остаются
  });
});

describe('winnability', () => {
  /** Steers every piece onto its target and hard-drops it. */
  function solve(rows: string[]): FallState {
    const s = fallOf(rows);
    while (!s.done) {
      spawn(s, 3); // deliberately not the target orientation
      const target = (s.pieces[s.current] as Piece).cells;
      const base = normalize(target);
      const wantX = Math.min(...target.map((c) => c.x));
      const a = s.active as Active;
      for (let k = 0; k < 4 && !sameCells(a.shape, base); k++) expect(rotateActive(s)).toBe(true);
      expect(sameCells(a.shape, base)).toBe(true);
      while (a.x > wantX) expect(move(s, -1)).toBe(true);
      while (a.x < wantX) expect(move(s, 1)).toBe(true);
      expect(hardDrop(s)[0]).toBe('placed');
    }
    return s;
  }

  const table: [string, string[]][] = [
    ['two bars with a gap', ['###', '...', '###']],
    ['piece that would bury another', ['##', '##', '.#']],
    ['single row', ['####', '....']],
    ['4x4 frame', ['####', '#..#', '#..#', '####']],
    ['two islands', ['##...', '##...', '.....', '..###', '...##']],
    ['6x10 slab', Array.from({ length: 10 }, () => '######')],
  ];

  for (const [name, rows] of table) {
    it(`is fully solvable without a single error — ${name}`, () => {
      const s = solve(rows);
      expect(s.done).toBe(true);
      expect(s.errors).toBe(0);
      expect(s.current).toBe(s.pieces.length);
    });
  }
});

describe('scoreForElapsed', () => {
  const curve = [
    { maxSeconds: 10, points: 100 },
    { maxSeconds: 60, points: 50 },
    { maxSeconds: 120, points: 0 },
  ];

  it('returns 0 for an empty curve', () => {
    expect(scoreForElapsed([], 5)).toBe(0);
  });

  it('clamps outside the curve', () => {
    expect(scoreForElapsed(curve, 0)).toBe(100);
    expect(scoreForElapsed(curve, 10)).toBe(100);
    expect(scoreForElapsed(curve, 500)).toBe(0);
  });

  it('interpolates between points and stays monotonic here', () => {
    const mid = scoreForElapsed(curve, 35);
    expect(mid).toBeGreaterThan(50);
    expect(mid).toBeLessThan(100);
    expect(scoreForElapsed(curve, 60)).toBe(50);
  });

  it('does not depend on the input order', () => {
    expect(scoreForElapsed([...curve].reverse(), 35)).toBe(scoreForElapsed(curve, 35));
  });

  it('honours explicit tangents', () => {
    const flat = [
      { maxSeconds: 0, points: 100, outTangent: 0 },
      { maxSeconds: 10, points: 0, inTangent: 0 },
    ];
    expect(scoreForElapsed(flat, 5)).toBe(50);
    expect(scoreForElapsed(flat, 1)).toBeGreaterThan(scoreForElapsed([{ maxSeconds: 0, points: 100 }, { maxSeconds: 10, points: 0 }], 1));
  });
});
