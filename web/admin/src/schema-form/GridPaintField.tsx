import { useEffect, useMemo, useRef, useState } from 'react';
import type { Schema } from './SchemaForm';

// ---------------------------------------------------------------------------
// GridPaintField — widget for x-type:"grid-paint" (tetris-fill `shape`).
// Value written to config_json: { width, height, rows } with rows of '.'/'#'.
// ---------------------------------------------------------------------------

export interface GridShape {
  width: number;
  height: number;
  rows: string[];
}

const DEFAULT_MAX = 16;
const SOFT_CELL_LIMIT = 60;
/** Piece colours cycle; neighbours in the deal order never share one. */
const PALETTE = ['#16A69B', '#E9A928', '#E86836', '#C8A878', '#5DE2D0', '#759C96'];

// ---------------------------------------------------------------------------
// decompose — compact duplicate of `partition()` from
// minigames/tetris-fill/src/engine.ts (cross-workspace import is not possible;
// keep the two in sync — same anchor rule, same 4→1 order, same bound).
// Returns owner[] of length width*height: -1 for cells outside the silhouette,
// otherwise the piece's deal-order index.
// ---------------------------------------------------------------------------

/**
 * Mirror of `orderForGravity()` in the game engine — keep the two in sync.
 * Pieces are lists of flat cell indices; A is dealt before B when some column
 * holds a cell of A strictly below a cell of B. Ties keep the anchor order.
 */
function orderForGravity(pieces: number[][], width: number): number[][] {
  const n = pieces.length;
  const after: number[][] = pieces.map(() => []);
  const indeg = new Array<number>(n).fill(0);
  const isBelow = (a: number[], b: number[]): boolean =>
    a.some((p) => b.some((q) => p % width === q % width && Math.floor(p / width) > Math.floor(q / width)));
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (a !== b && isBelow(pieces[a] as number[], pieces[b] as number[])) {
        (after[a] as number[]).push(b);
        indeg[b] = (indeg[b] as number) + 1;
      }
    }
  }
  const out: number[][] = [];
  const taken = new Uint8Array(n);
  for (let placed = 0; placed < n; placed++) {
    let pick = -1;
    for (let i = 0; i < n; i++) {
      if (!taken[i] && indeg[i] === 0) {
        pick = i;
        break;
      }
    }
    if (pick < 0) {
      // cycle — no gravity order exists; show the anchor order (see the engine)
      for (let i = 0; i < n; i++) if (!taken[i]) out.push(pieces[i] as number[]);
      break;
    }
    taken[pick] = 1;
    out.push(pieces[pick] as number[]);
    for (const b of after[pick] as number[]) indeg[b] = (indeg[b] as number) - 1;
  }
  return out;
}

export function decompose(rows: string[], width: number, height: number): number[] {
  const owner = new Array<number>(width * height).fill(-1);
  const idx: number[] = []; // cell indices, bottom-up then left-to-right
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      if ((rows[y] ?? '')[x] === '#') idx.push(y * width + x);
    }
  }
  const n = idx.length;
  if (n === 0) return owner;

  const at = new Map<number, number>();
  idx.forEach((cellIndex, i) => at.set(cellIndex, i));
  const neighbours = idx.map((cellIndex) => {
    const x = cellIndex % width;
    const y = Math.floor(cellIndex / width);
    const out: number[] = [];
    for (const [dx, dy] of [
      [0, -1],
      [-1, 0],
      [1, 0],
      [0, 1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = at.get(ny * width + nx);
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

  const lowerBound = (): number => {
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
  };

  const subsets = (anchor: number, k: number): number[][] => {
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
  };

  const search = (): void => {
    if (uncovered === 0) {
      if (!best || picked.length < best.length) best = picked.map((p) => p.slice());
      return;
    }
    if (best && picked.length + lowerBound() >= best.length) return;
    if (++nodes > 200_000) return;
    let anchor = -1;
    for (let i = 0; i < n; i++) {
      if (!covered[i]) {
        anchor = i;
        break;
      }
    }
    for (let k = 4; k >= 1; k--) {
      for (const sub of subsets(anchor, k)) {
        for (const i of sub) covered[i] = 1;
        uncovered -= sub.length;
        picked.push(sub);
        search();
        picked.pop();
        uncovered += sub.length;
        for (const i of sub) covered[i] = 0;
        if (best && best.length === optimal) return;
      }
    }
  };

  search();
  const found = (best as number[][] | null) ?? [];
  const dealt = orderForGravity(
    found.map((sub) => sub.map((i) => idx[i] as number)),
    width,
  );
  dealt.forEach((sub, pieceIndex) => {
    for (const cellIndex of sub) owner[cellIndex] = pieceIndex;
  });
  return owner;
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

function clampSize(n: unknown, max: number): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(1, Math.min(max, v)) : 4;
}

function toShape(value: unknown, max: number): GridShape {
  const o = (value && typeof value === 'object' ? value : {}) as Partial<GridShape>;
  const width = clampSize(o.width ?? 4, max);
  const height = clampSize(o.height ?? 4, max);
  const src = Array.isArray(o.rows) ? o.rows : [];
  const rows = Array.from({ length: height }, (_, y) => {
    const row = typeof src[y] === 'string' ? (src[y] as string) : '';
    let out = '';
    for (let x = 0; x < width; x++) out += row[x] === '#' ? '#' : '.';
    return out;
  });
  return { width, height, rows };
}

/** Resize keeping the intersection (crop right/bottom, pad with empties). */
function resized(shape: GridShape, width: number, height: number): GridShape {
  return toShape({ width, height, rows: shape.rows }, Math.max(width, height));
}

function cutCount(shape: GridShape, width: number, height: number): number {
  let cut = 0;
  for (let y = 0; y < shape.height; y++) {
    for (let x = 0; x < shape.width; x++) {
      if ((x >= width || y >= height) && (shape.rows[y] ?? '')[x] === '#') cut++;
    }
  }
  return cut;
}

function withCell(shape: GridShape, x: number, y: number, filled: boolean): GridShape {
  const rows = shape.rows.slice();
  const row = rows[y] ?? '';
  rows[y] = row.slice(0, x) + (filled ? '#' : '.') + row.slice(x + 1);
  return { ...shape, rows };
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

interface Props {
  schema: Schema;
  value: unknown;
  onChange: (next: unknown) => void;
}

const box: React.CSSProperties = {
  border: '1px solid #0A3435',
  background: '#030B0C',
  padding: 8,
};

export function GridPaintField({ schema, value, onChange }: Props) {
  const max = typeof schema['x-max-size'] === 'number' ? schema['x-max-size'] : DEFAULT_MAX;
  const shape = toShape(value, max);
  const [pending, setPending] = useState<{ width: number; height: number; cut: number } | null>(null);
  const paint = useRef<{ fill: boolean } | null>(null);

  // preview of the auto-partition, debounced (the search is cheap but the
  // silhouette changes on every painted cell)
  const shapeKey = `${shape.width}x${shape.height}:${shape.rows.join('')}`;
  const [debouncedKey, setDebouncedKey] = useState(shapeKey);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedKey(shapeKey), 120);
    return () => clearTimeout(id);
  }, [shapeKey]);

  const preview = useMemo(() => {
    const [size, body] = debouncedKey.split(':');
    const [w, h] = (size ?? '').split('x').map(Number);
    const width = w ?? 1;
    const height = h ?? 1;
    const rows = Array.from({ length: height }, (_, y) => (body ?? '').slice(y * width, (y + 1) * width));
    const owner = decompose(rows, width, height);
    const sizes = new Map<number, number>();
    for (const o of owner) if (o >= 0) sizes.set(o, (sizes.get(o) ?? 0) + 1);
    let tetro = 0;
    for (const s of sizes.values()) if (s === 4) tetro++;
    return { owner, width, height, count: sizes.size, tetro, small: sizes.size - tetro };
  }, [debouncedKey]);

  const filledCount = shape.rows.join('').split('#').length - 1;

  function setShape(next: GridShape): void {
    onChange({ width: next.width, height: next.height, rows: next.rows });
  }

  function requestSize(width: number, height: number): void {
    const w = clampSize(width, max);
    const h = clampSize(height, max);
    if (w === shape.width && h === shape.height) return;
    const cut = cutCount(shape, w, h);
    if (cut > 0) setPending({ width: w, height: h, cut });
    else setShape(resized(shape, w, h));
  }

  function applyCell(x: number, y: number): void {
    const fill = paint.current?.fill;
    if (fill === undefined) return;
    if (((shape.rows[y] ?? '')[x] === '#') === fill) return;
    setShape(withCell(shape, x, y, fill));
  }

  const cellStyle = (filled: boolean): React.CSSProperties => ({
    width: 18,
    height: 18,
    boxSizing: 'border-box',
    borderRadius: 0,
    background: filled ? '#0F4F4B' : '#030B0C',
    border: filled ? '1px solid #5DE2D0' : '1px solid #122b2c',
    cursor: 'crosshair',
  });

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: '#759C96' }}>
            Ширина
            <input
              type='number'
              min={1}
              max={max}
              value={shape.width}
              style={{ width: 64 }}
              onChange={(e) => requestSize(Number(e.target.value), shape.height)}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: '#759C96' }}>
            Высота
            <input
              type='number'
              min={1}
              max={max}
              value={shape.height}
              style={{ width: 64 }}
              onChange={(e) => requestSize(shape.width, Number(e.target.value))}
            />
          </label>
          <button
            type='button'
            className='sf-pick-btn'
            title='Очистить силуэт'
            onClick={() => setShape(toShape({ width: shape.width, height: shape.height, rows: [] }, max))}
          >
            Очистить
          </button>
          <button
            type='button'
            className='sf-pick-btn'
            title='Инвертировать: заполненные ↔ пустые'
            onClick={() =>
              setShape({
                ...shape,
                rows: shape.rows.map((r) => r.replace(/[.#]/g, (c) => (c === '#' ? '.' : '#'))),
              })
            }
          >
            Инвертировать
          </button>
        </div>

        {pending && (
          <div style={{ ...box, borderColor: '#E9A928', color: '#E9A928', fontSize: 12 }}>
            Уменьшение отрежет закрашенных клеток: {pending.cut}.{' '}
            <button
              type='button'
              className='sf-pick-btn'
              onClick={() => {
                setShape(resized(shape, pending.width, pending.height));
                setPending(null);
              }}
            >
              Подтвердить
            </button>{' '}
            <button type='button' className='sf-pick-btn' onClick={() => setPending(null)}>
              Отмена
            </button>
          </div>
        )}

        <div
          style={{
            ...box,
            display: 'grid',
            gridTemplateColumns: `repeat(${shape.width}, 18px)`,
            gap: 1,
            width: 'max-content',
            touchAction: 'none',
          }}
          onPointerUp={() => {
            paint.current = null;
          }}
          onPointerLeave={() => {
            paint.current = null;
          }}
        >
          {shape.rows.flatMap((row, y) =>
            Array.from({ length: shape.width }, (_, x) => {
              const filled = row[x] === '#';
              return (
                <div
                  key={`${x},${y}`}
                  style={cellStyle(filled)}
                  title={`${x + 1}, ${y + 1}`}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    paint.current = { fill: !filled };
                    applyCell(x, y);
                  }}
                  onPointerEnter={(e) => {
                    if (e.buttons === 0) paint.current = null;
                    else applyCell(x, y);
                  }}
                />
              );
            }),
          )}
        </div>

        {filledCount === 0 && (
          <div style={{ color: '#F0713E', fontSize: 12, letterSpacing: '0.08em' }}>
            СИЛУЭТ ПУСТ — игра не запустится
          </div>
        )}
        {filledCount > SOFT_CELL_LIMIT && (
          <div style={{ color: '#E9A928', fontSize: 12 }}>
            Клеток: {filledCount} — больше {SOFT_CELL_LIMIT}, разбиение может подтормаживать
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12, color: '#759C96' }}>Превью авторазбиения</span>
        <div
          style={{
            ...box,
            display: 'grid',
            gridTemplateColumns: `repeat(${preview.width}, 18px)`,
            gap: 1,
            width: 'max-content',
          }}
        >
          {Array.from({ length: preview.width * preview.height }, (_, i) => {
            const owner = preview.owner[i] ?? -1;
            const color = owner >= 0 ? (PALETTE[owner % PALETTE.length] as string) : undefined;
            const first = owner >= 0 && preview.owner.indexOf(owner) === i;
            return (
              <div
                key={i}
                style={{
                  width: 18,
                  height: 18,
                  boxSizing: 'border-box',
                  background: color ?? '#030B0C',
                  border: color ? '1px solid #030B0C' : '1px solid #122b2c',
                  color: '#030B0C',
                  fontSize: 10,
                  lineHeight: '16px',
                  textAlign: 'center',
                  fontWeight: 700,
                }}
              >
                {first ? owner + 1 : ''}
              </div>
            );
          })}
        </div>
        <span style={{ fontSize: 12, color: '#759C96' }}>
          Деталей: {preview.count} (тетромино {preview.tetro}, мелких {preview.small})
        </span>
      </div>
    </div>
  );
}
