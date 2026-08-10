import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// MazePreviewField — widget for x-type:"maze-preview" (three-mazes
// `generatorParams`). Draws the deterministic generator output by importing the
// game bundle itself, so the preview can never drift from the runtime.
// ---------------------------------------------------------------------------

interface Params {
  type: 'square' | 'hex' | 'circular';
  size: number;
  breakableDensity: number;
  seed: number;
  patrols: number;
  quietSpots: number;
}

interface Wall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  breakable?: boolean;
}

interface Details {
  maze: {
    walls: Wall[];
    start: { x: number; y: number };
    finish: { x: number; y: number };
    patrols?: { x: number; y: number }[];
    quietSpots?: { x: number; y: number }[];
  };
  routeSteps: number;
  breakableTreeDist: number[];
}

type Engine = { generateMazeDetailed: (p: Params) => Details };

const ENTRY = '/minigames/three-mazes/index.js'; // same path as Minigame.entryUrl (proxied in dev)
let engine: Promise<Engine> | null = null;

function loadEngine(): Promise<Engine> {
  engine ??= (import(/* @vite-ignore */ ENTRY) as Promise<Engine>).catch((e: unknown) => {
    engine = null; // let a later render retry once the bundle is built
    throw e;
  });
  return engine;
}

const SIZE = 260;
const PAD = 6;

function toParams(value: unknown): Params {
  const o = (value && typeof value === 'object' ? value : {}) as Partial<Params>;
  const t = o.type;
  return {
    type: t === 'hex' || t === 'circular' ? t : 'square',
    size: Math.max(3, Math.min(20, Math.round(Number(o.size)) || 8)),
    breakableDensity: Math.max(0, Math.min(1, Number(o.breakableDensity) || 0)),
    seed: Math.round(Number(o.seed)) || 0,
    patrols: Math.max(0, Math.min(3, Math.round(Number(o.patrols)) || 0)),
    quietSpots: Math.max(0, Math.min(3, Math.round(Number(o.quietSpots)) || 0)),
  };
}

function draw(canvas: HTMLCanvasElement, d: Details): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#030B0C';
  ctx.fillRect(0, 0, SIZE, SIZE);

  const span = SIZE - 2 * PAD;
  const px = (v: number): number => PAD + v * span;
  const line = (w: Wall): void => {
    ctx.moveTo(px(w.x1), px(w.y1));
    ctx.lineTo(px(w.x2), px(w.y2));
  };

  ctx.lineCap = 'round';
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#5DE2D0';
  ctx.setLineDash([]);
  ctx.beginPath();
  for (const w of d.maze.walls) if (!w.breakable) line(w);
  ctx.stroke();

  ctx.strokeStyle = '#E9A928';
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  for (const w of d.maze.walls) if (w.breakable) line(w);
  ctx.stroke();
  ctx.setLineDash([]);

  const dot = (p: { x: number; y: number }, color: string): void => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px(p.x), px(p.y), 4, 0, Math.PI * 2);
    ctx.fill();
  };
  dot(d.maze.start, '#16A69B');
  dot(d.maze.finish, '#E9A928');
  for (const p of d.maze.patrols ?? []) dot(p, '#F0713E');

  const ring = (p: { x: number; y: number }): void => {
    ctx.strokeStyle = '#D3DED5';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px(p.x), px(p.y), 5, 0, Math.PI * 2);
    ctx.stroke();
  };
  for (const p of d.maze.quietSpots ?? []) ring(p);
}

interface Props {
  value: unknown;
  onChange: (next: unknown) => void;
}

export function MazePreviewField({ value, onChange }: Props) {
  const params = toParams(value);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [stats, setStats] = useState<
    { steps: number; walls: number; breakable: number; patrols: number; spots: number } | null
  >(null);
  const [failed, setFailed] = useState(false);

  const { type, size, breakableDensity, seed, patrols, quietSpots } = params;
  useEffect(() => {
    let stale = false;
    const id = setTimeout(() => {
      loadEngine()
        .then((mod) => {
          const canvas = canvasRef.current;
          if (stale || !canvas) return;
          const d = mod.generateMazeDetailed({ type, size, breakableDensity, seed, patrols, quietSpots });
          draw(canvas, d);
          setFailed(false);
          setStats({
            steps: d.routeSteps,
            walls: d.maze.walls.length,
            breakable: d.breakableTreeDist.length,
            patrols: d.maze.patrols?.length ?? 0,
            spots: d.maze.quietSpots?.length ?? 0,
          });
        })
        .catch(() => {
          if (!stale) setFailed(true);
        });
    }, 150);
    return () => {
      stale = true;
      clearTimeout(id);
    };
  }, [type, size, breakableDensity, seed, patrols, quietSpots]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
      {failed ? (
        <div
          style={{
            width: SIZE,
            height: SIZE,
            display: 'flex',
            alignItems: 'center',
            textAlign: 'center',
            padding: 12,
            boxSizing: 'border-box',
            border: '1px solid #0A3435',
            background: '#030B0C',
            color: '#E9A928',
            fontSize: 12,
          }}
        >
          Бандл three-mazes недоступен — превью появится после сборки
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          style={{ width: SIZE, height: SIZE, border: '1px solid #0A3435', background: '#030B0C' }}
        />
      )}
      <span style={{ fontSize: 12, color: '#759C96' }}>
        {stats && !failed
          ? `путь: ${stats.steps} шагов · стен: ${stats.walls} · ломаемых: ${stats.breakable}` +
            (stats.patrols > 0 ? ` · патрулей: ${stats.patrols}` : '') +
            (stats.spots > 0 ? ` · реплик: ${stats.spots}` : '')
          : ' '}
      </span>
      <button
        type='button'
        className='sf-pick-btn'
        title='Новый случайный сид'
        onClick={() =>
          onChange({
            ...(value && typeof value === 'object' ? value : {}),
            seed: Math.floor(Math.random() * 1_000_000),
          })
        }
      >
        ПЕРЕГЕНЕРИРОВАТЬ
      </button>
    </div>
  );
}
