import { useEffect, useRef, useState } from 'react';
import type { Schema } from './SchemaForm';
import { LiveNumberInput } from './LiveNumberInput';

// ---------------------------------------------------------------------------
// CurveEditor — Unity-style AnimationCurve editor for x-type:"curve" fields.
// Points carry optional in/out tangents (slopes); the rendered curve uses the
// SAME cubic-Hermite math as the runner engine's speedAt() — keep them in sync.
// ponytail: hand-rolled Hermite (a few multiplies), no curve library.
// ---------------------------------------------------------------------------

interface Pt {
  x: number;
  y: number;
  inTangent?: number;
  outTangent?: number;
}

interface CurveEditorProps {
  schema: Schema;
  value: unknown;
  onChange: (next: unknown) => void;
}

const PAD = { l: 38, r: 12, t: 12, b: 22 };
const HEIGHT = 220;
const HIT = 9; // px hit radius for points/handles
const HANDLE_PX = 42; // pixel length of a tangent handle

// Map the field's item-schema property names: first numeric prop = x, second = y.
function axisKeys(schema: Schema): { xKey: string; yKey: string } {
  const props = schema.items?.properties ?? {};
  const keys = Object.keys(props).filter((k) => k !== 'inTangent' && k !== 'outTangent');
  return { xKey: keys[0] ?? 'distance', yKey: keys[1] ?? 'speed' };
}

function toPoints(value: unknown, xKey: string, yKey: string): Pt[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const p: Pt = { x: Number(o[xKey] ?? 0), y: Number(o[yKey] ?? 0) };
      if (typeof o.inTangent === 'number') p.inTangent = o.inTangent;
      if (typeof o.outTangent === 'number') p.outTangent = o.outTangent;
      return p;
    })
    .sort((a, b) => a.x - b.x);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function fromPoints(points: Pt[], xKey: string, yKey: string): unknown[] {
  return points
    .slice()
    .sort((a, b) => a.x - b.x)
    .map((p) => {
      const o: Record<string, number> = { [xKey]: r2(p.x), [yKey]: r2(p.y) };
      if (p.inTangent !== undefined) o.inTangent = r2(p.inTangent);
      if (p.outTangent !== undefined) o.outTangent = r2(p.outTangent);
      return o;
    });
}

// Cubic-Hermite sample of the whole curve at x (mirror of engine speedAt).
function sampleAt(points: Pt[], x: number): number {
  if (points.length === 0) return 0;
  if (points.length === 1) return points[0]!.y;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (x <= first.x) return first.y;
  if (x >= last.x) return last.y;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (x >= a.x && x <= b.x) {
      const dx = b.x - a.x;
      if (dx <= 0) return b.y;
      const t = (x - a.x) / dx;
      const linear = (b.y - a.y) / dx;
      const m0 = a.outTangent ?? linear;
      const m1 = b.inTangent ?? linear;
      const t2 = t * t;
      const t3 = t2 * t;
      return (
        (2 * t3 - 3 * t2 + 1) * a.y +
        (t3 - 2 * t2 + t) * dx * m0 +
        (-2 * t3 + 3 * t2) * b.y +
        (t3 - t2) * dx * m1
      );
    }
  }
  return last.y;
}

type Drag =
  | { kind: 'point'; i: number }
  | { kind: 'handle'; i: number; side: 'in' | 'out' }
  | null;

export function CurveEditor({ schema, value, onChange }: CurveEditorProps) {
  const { xKey, yKey } = axisKeys(schema);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [width, setWidth] = useState(480);
  const dragRef = useRef<Drag>(null);

  const points = toPoints(value, xKey, yKey);

  // --- data <-> pixel mapping ------------------------------------------------
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = xs.length ? Math.min(...xs) : 0;
  let xMax = xs.length ? Math.max(...xs) : 1;
  let yMin = ys.length ? Math.min(...ys) : 0;
  let yMax = ys.length ? Math.max(...ys) : 1;
  if (xMax - xMin < 1e-6) xMax = xMin + 1;
  const yPad = (yMax - yMin) * 0.15 || 1;
  yMin -= yPad;
  yMax += yPad;

  const plotW = width - PAD.l - PAD.r;
  const plotH = HEIGHT - PAD.t - PAD.b;
  const toPx = (x: number, y: number): [number, number] => [
    PAD.l + ((x - xMin) / (xMax - xMin)) * plotW,
    PAD.t + (1 - (y - yMin) / (yMax - yMin)) * plotH,
  ];
  const toData = (px: number, py: number): [number, number] => [
    xMin + ((px - PAD.l) / plotW) * (xMax - xMin),
    yMin + (1 - (py - PAD.t) / plotH) * (yMax - yMin),
  ];

  // Out handle anchor (pixels) for point i — placed HANDLE_PX to one side.
  function handlePx(i: number, side: 'in' | 'out'): [number, number] {
    const p = points[i]!;
    const linear = neighborSlope(points, i);
    const slope = side === 'out' ? p.outTangent ?? linear : p.inTangent ?? linear;
    const dirX = side === 'out' ? 1 : -1;
    const dDataX = (dirX * HANDLE_PX) / (plotW / (xMax - xMin));
    return toPx(p.x + dDataX, p.y + slope * dDataX);
  }

  // --- drawing ---------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = HEIGHT * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);

    // grid + axes
    ctx.strokeStyle = '#334155';
    ctx.fillStyle = '#64748b';
    ctx.font = '10px sans-serif';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const yy = PAD.t + (g / 4) * plotH;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.moveTo(PAD.l, yy);
      ctx.lineTo(width - PAD.r, yy);
      ctx.stroke();
      ctx.globalAlpha = 1;
      const val = yMax - (g / 4) * (yMax - yMin);
      ctx.fillText(r2(val).toString(), 2, yy + 3);
    }
    const xTicks = 4;
    for (let g = 0; g <= xTicks; g++) {
      const xx = PAD.l + (g / xTicks) * plotW;
      const val = xMin + (g / xTicks) * (xMax - xMin);
      ctx.fillText(Math.round(val).toString(), xx - 8, HEIGHT - 6);
    }

    if (points.length > 0) {
      // curve
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const steps = Math.max(2, Math.floor(plotW));
      for (let s = 0; s <= steps; s++) {
        const x = xMin + (s / steps) * (xMax - xMin);
        const [px, py] = toPx(x, sampleAt(points, x));
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // tangent handles for selected point
      if (selected !== null && points[selected]) {
        const [px, py] = toPx(points[selected]!.x, points[selected]!.y);
        const sides: ('in' | 'out')[] =
          selected === 0 ? ['out'] : selected === points.length - 1 ? ['in'] : ['in', 'out'];
        for (const side of sides) {
          const [hx, hy] = handlePx(selected, side);
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(hx, hy);
          ctx.stroke();
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          ctx.arc(hx, hy, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // points
      points.forEach((p, i) => {
        const [px, py] = toPx(p.x, p.y);
        ctx.fillStyle = i === selected ? '#f8fafc' : '#60a5fa';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    }
  });

  // --- resize ----------------------------------------------------------------
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // --- interaction -----------------------------------------------------------
  function localXY(e: React.PointerEvent): [number, number] {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function commit(next: Pt[]) {
    onChange(fromPoints(next, xKey, yKey));
  }

  function onPointerDown(e: React.PointerEvent) {
    const [mx, my] = localXY(e);
    // handle hit (only for selected point)
    if (selected !== null && points[selected]) {
      const sides: ('in' | 'out')[] =
        selected === 0 ? ['out'] : selected === points.length - 1 ? ['in'] : ['in', 'out'];
      for (const side of sides) {
        const [hx, hy] = handlePx(selected, side);
        if (Math.hypot(hx - mx, hy - my) <= HIT) {
          dragRef.current = { kind: 'handle', i: selected, side };
          canvasRef.current!.setPointerCapture(e.pointerId);
          return;
        }
      }
    }
    // point hit
    for (let i = 0; i < points.length; i++) {
      const [px, py] = toPx(points[i]!.x, points[i]!.y);
      if (Math.hypot(px - mx, py - my) <= HIT) {
        setSelected(i);
        dragRef.current = { kind: 'point', i };
        canvasRef.current!.setPointerCapture(e.pointerId);
        return;
      }
    }
    // empty area → add a point
    if (mx >= PAD.l && mx <= width - PAD.r && my >= PAD.t && my <= PAD.t + plotH) {
      const [dx, dy] = toData(mx, my);
      const next = [...points, { x: dx, y: dy }].sort((a, b) => a.x - b.x);
      const idx = next.findIndex((p) => p.x === dx && p.y === dy);
      setSelected(idx);
      commit(next);
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const [mx, my] = localXY(e);
    const [dx, dy] = toData(mx, my);
    const next = points.map((p) => ({ ...p }));
    if (drag.kind === 'point') {
      const p = next[drag.i]!;
      p.x = dx;
      p.y = dy;
    } else {
      const p = next[drag.i]!;
      const ddx = dx - p.x;
      // require dragging to the correct side; ignore degenerate horizontal
      if (drag.side === 'out' && ddx <= 1e-6) return;
      if (drag.side === 'in' && ddx >= -1e-6) return;
      const slope = (dy - p.y) / ddx;
      // unified tangents (Unity default): set both interior sides
      p.outTangent = slope;
      p.inTangent = slope;
    }
    commit(next);
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  function removeAt(i: number) {
    const next = points.filter((_, idx) => idx !== i);
    setSelected(null);
    commit(next);
  }

  function setAxis(i: number, axis: 'x' | 'y', num: number) {
    const next = points.map((p, idx) => (idx === i ? { ...p, [axis]: num } : p));
    commit(next);
  }

  function addPoint() {
    const last = points[points.length - 1];
    const p: Pt = last ? { x: last.x + 100, y: last.y } : { x: 0, y: 0 };
    const next = [...points, p].sort((a, b) => a.x - b.x);
    setSelected(next.indexOf(p));
    commit(next);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected !== null) {
      // don't hijack Delete/Backspace while typing in the list inputs
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      e.preventDefault();
      removeAt(selected);
    }
  }

  return (
    <div className='curve-editor' tabIndex={0} onKeyDown={onKeyDown}>
      <div className='curve-editor-main'>
        <div className='curve-editor-canvas' ref={wrapRef}>
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: HEIGHT, touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </div>
        <div className='curve-editor-list'>
          <div className='curve-pt-head'>
            <span>{xKey}</span>
            <span>{yKey}</span>
            <span />
          </div>
          {points.map((p, i) => (
            <div
              className={`curve-pt-row${i === selected ? ' is-sel' : ''}`}
              key={i}
              onPointerDown={() => setSelected(i)}
            >
              <LiveNumberInput value={p.x} onCommit={(n) => setAxis(i, 'x', n)} />
              <LiveNumberInput value={p.y} onCommit={(n) => setAxis(i, 'y', n)} />
              <button type='button' className='curve-pt-del' title='Удалить точку' onClick={() => removeAt(i)}>
                ✕
              </button>
            </div>
          ))}
          <button type='button' className='curve-pt-add' onClick={addPoint}>
            + точка
          </button>
        </div>
      </div>
      <div className='curve-editor-bar'>
        <span className='curve-editor-hint'>
          Тяните точки и жёлтые маркеры наклона на графике · точные значения — в списке справа
        </span>
      </div>
    </div>
  );
}

// Average neighbor slope at point i (Catmull-Rom-ish) — default handle direction.
function neighborSlope(points: Pt[], i: number): number {
  const p = points[i]!;
  const prev = points[i - 1];
  const nextP = points[i + 1];
  if (prev && nextP) return (nextP.y - prev.y) / (nextP.x - prev.x || 1);
  if (nextP) return (nextP.y - p.y) / (nextP.x - p.x || 1);
  if (prev) return (p.y - prev.y) / (p.x - prev.x || 1);
  return 0;
}
