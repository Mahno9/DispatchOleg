import { useRef, useState } from 'react';
import type { DialogueDoc, DialogueNode } from '../api';

// ---------------------------------------------------------------------------
// Dialogue graph canvas — SVG edge layer + absolutely positioned node boxes.
// x/y are percentages of the canvas, stored straight in the node objects
// (the server keeps unknown keys, the player's parseDialogue ignores them).
// ponytail: hand-rolled like CurveEditor/MetaSection, no graph library.
// ---------------------------------------------------------------------------

const NODE_W = 156; // px — must match .dlg-gnode width in index.css
const NODE_H = 64;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Targets of a node, in render order. */
function edgesOf(node: DialogueNode): { to: string; label: string | null }[] {
  const choices = Array.isArray(node.choices) ? node.choices : [];
  if (choices.length > 0) {
    return choices
      .filter((c) => typeof c?.next === 'string' && c.next !== '')
      .map((c) => ({ to: c.next, label: c.text ?? '' }));
  }
  return typeof node.next === 'string' && node.next !== ''
    ? [{ to: node.next, label: null }]
    : [];
}

/**
 * Fills x/y for every node that has none: BFS from `start`, depth → column,
 * position inside the layer → row. Unreachable nodes get an extra trailing
 * column. Returns the same doc object when nothing had to be placed.
 */
export function autoLayout(doc: DialogueDoc): DialogueDoc {
  const ids = Object.keys(doc.nodes);
  const missing = ids.filter((id) => {
    const n = doc.nodes[id];
    return typeof n?.x !== 'number' || typeof n?.y !== 'number';
  });
  if (missing.length === 0) return doc;

  const depth = new Map<string, number>();
  if (doc.start in doc.nodes) {
    depth.set(doc.start, 0);
    const queue = [doc.start];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const node = doc.nodes[id];
      if (!node) continue;
      for (const { to } of edgesOf(node)) {
        if (to in doc.nodes && !depth.has(to)) {
          depth.set(to, (depth.get(id) ?? 0) + 1);
          queue.push(to);
        }
      }
    }
  }
  const orphanCol = Math.max(0, ...depth.values()) + (depth.size > 0 ? 1 : 0);

  // column → ids; BFS discovery order first, then whatever was never reached
  const columns = new Map<number, string[]>();
  for (const id of [...depth.keys(), ...ids.filter((i) => !depth.has(i))]) {
    const col = depth.get(id) ?? orphanCol;
    columns.set(col, [...(columns.get(col) ?? []), id]);
  }
  const sortedCols = [...columns.keys()].sort((a, b) => a - b);

  const nodes: Record<string, DialogueNode> = {};
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (!missing.includes(id)) {
      nodes[id] = node;
      continue;
    }
    const col = depth.get(id) ?? orphanCol;
    const list = columns.get(col) ?? [id];
    nodes[id] = {
      ...node,
      x: r1(((sortedCols.indexOf(col) + 0.5) / sortedCols.length) * 100),
      y: r1(((list.indexOf(id) + 0.5) / list.length) * 100),
    };
  }
  return { ...doc, nodes };
}

// ---------------------------------------------------------------------------

interface GraphProps {
  doc: DialogueDoc;
  selected: string | null;
  reachable: Set<string>;
  speakerLabel: (speaker: string) => string;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onConnect: (from: string, to: string) => void;
  onCreateAt: (x: number, y: number) => void;
  onDelete: () => void;
}

type Drag = { id: string; clientX: number; clientY: number; ox: number; oy: number; w: number; h: number };

export function DialogueGraph({
  doc,
  selected,
  reachable,
  speakerLabel,
  onSelect,
  onMove,
  onConnect,
  onCreateAt,
  onDelete,
}: GraphProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  // live link being dragged from an output port: source id + cursor position (%)
  const [link, setLink] = useState<{ from: string; x: number; y: number } | null>(null);

  const pos = (id: string): { x: number; y: number } => {
    const n = doc.nodes[id];
    return { x: typeof n?.x === 'number' ? n.x : 50, y: typeof n?.y === 'number' ? n.y : 50 };
  };

  function percentAt(clientX: number, clientY: number): { x: number; y: number } {
    const el = boxRef.current;
    if (!el) return { x: 50, y: 50 };
    const rect = el.getBoundingClientRect();
    return {
      x: clamp(((clientX - rect.left) / (rect.width || 1)) * 100, 0, 100),
      y: clamp(((clientY - rect.top) / (rect.height || 1)) * 100, 0, 100),
    };
  }

  /** Node whose box contains the pointer, or null. */
  function nodeAt(clientX: number, clientY: number): string | null {
    const el = boxRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    for (const id of Object.keys(doc.nodes)) {
      const p = pos(id);
      const cx = rect.left + (p.x / 100) * rect.width;
      const cy = rect.top + (p.y / 100) * rect.height;
      if (Math.abs(clientX - cx) <= NODE_W / 2 && Math.abs(clientY - cy) <= NODE_H / 2) return id;
    }
    return null;
  }

  // --- node drag ------------------------------------------------------------

  function startDrag(e: React.PointerEvent, id: string) {
    const el = boxRef.current;
    if (!el) return;
    onSelect(id);
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pos(id);
    dragRef.current = {
      id,
      clientX: e.clientX,
      clientY: e.clientY,
      ox: p.x,
      oy: p.y,
      w: el.clientWidth || 1,
      h: el.clientHeight || 1,
    };
  }

  function moveDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    onMove(
      d.id,
      r1(clamp(d.ox + ((e.clientX - d.clientX) / d.w) * 100, 2, 98)),
      r1(clamp(d.oy + ((e.clientY - d.clientY) / d.h) * 100, 3, 97)),
    );
  }

  // --- link drag ------------------------------------------------------------

  function startLink(e: React.PointerEvent, from: string) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setLink({ from, ...percentAt(e.clientX, e.clientY) });
  }

  function moveLink(e: React.PointerEvent) {
    setLink((cur) => (cur ? { ...cur, ...percentAt(e.clientX, e.clientY) } : cur));
  }

  function endLink(e: React.PointerEvent) {
    if (!link) return;
    const target = nodeAt(e.clientX, e.clientY);
    if (target && target !== link.from) onConnect(link.from, target);
    setLink(null);
  }

  // --- render ---------------------------------------------------------------

  const edges = Object.entries(doc.nodes).flatMap(([from, node]) =>
    edgesOf(node)
      .filter((e) => e.to in doc.nodes && e.to !== from)
      .map((e) => ({ from, ...e })),
  );

  return (
    <div
      className='dlg-graph'
      ref={boxRef}
      tabIndex={0}
      onPointerMove={moveDrag}
      onPointerUp={() => (dragRef.current = null)}
      onPointerCancel={() => (dragRef.current = null)}
      onDoubleClick={(e) => {
        if (e.target !== e.currentTarget && (e.target as Element).tagName !== 'svg') return;
        const p = percentAt(e.clientX, e.clientY);
        onCreateAt(r1(clamp(p.x, 2, 98)), r1(clamp(p.y, 3, 97)));
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
          e.preventDefault();
          onDelete();
        }
      }}
    >
      <svg className='dlg-graph-edges'>
        {edges.map((e, i) => {
          const a = pos(e.from);
          const b = pos(e.to);
          return (
            <g key={`${e.from}-${e.to}-${i}`}>
              <line
                x1={`${a.x}%`}
                y1={`${a.y}%`}
                x2={`${b.x}%`}
                y2={`${b.y}%`}
                className={e.label === null ? 'dlg-edge' : 'dlg-edge dlg-edge--choice'}
              />
              {e.label !== null && (
                <text className='dlg-edge-label' x={`${(a.x + b.x) / 2}%`} y={`${(a.y + b.y) / 2}%`}>
                  {e.label.length > 20 ? `${e.label.slice(0, 20)}…` : e.label || '(вариант)'}
                </text>
              )}
            </g>
          );
        })}
        {link && (
          <line
            className='dlg-edge dlg-edge--live'
            x1={`${pos(link.from).x}%`}
            y1={`${pos(link.from).y}%`}
            x2={`${link.x}%`}
            y2={`${link.y}%`}
          />
        )}
      </svg>

      {Object.entries(doc.nodes).map(([id, node]) => {
        const p = pos(id);
        const cls = [
          'dlg-gnode',
          id === doc.start ? 'dlg-gnode--start' : '',
          reachable.has(id) ? '' : 'dlg-gnode--orphan',
          id === selected ? 'dlg-gnode--sel' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <div
            key={id}
            className={cls}
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
            onPointerDown={(e) => startDrag(e, id)}
            title={node?.text ?? ''}
          >
            <span className='dlg-gnode-id'>
              {id === doc.start && '▶ '}
              {!reachable.has(id) && '⚠ '}
              {id}
            </span>
            <span className='dlg-gnode-text'>
              {speakerLabel(node?.speaker ?? '')}: {(node?.text ?? '').slice(0, 34) || '—'}
            </span>
            <span
              className='dlg-gnode-port'
              title='Тянуть на другой узел, чтобы связать'
              onPointerDown={(e) => startLink(e, id)}
              onPointerMove={moveLink}
              onPointerUp={endLink}
              onPointerCancel={() => setLink(null)}
            />
          </div>
        );
      })}

      {Object.keys(doc.nodes).length === 0 && (
        <p className='dlg-graph-empty'>Двойной клик по полю — новый узел.</p>
      )}
    </div>
  );
}
