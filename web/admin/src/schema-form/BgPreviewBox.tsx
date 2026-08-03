import { useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Draggable background preview box
// ---------------------------------------------------------------------------

export const BG_SIZE: Record<string, string> = {
  cover: 'cover', contain: 'contain',
  'fill-x': '100% auto', 'fill-y': 'auto 100%',
  center: 'auto', tile: 'auto',
};

interface BgPreviewBoxProps {
  url: string; fit: string; scale: number;
  offset: { x: number; y: number };
  onOffsetChange: (o: { x: number; y: number }) => void;
  width: number; height: number; label: string;
}

export function BgPreviewBox({ url, fit, scale, offset, onOffsetChange, width, height, label }: BgPreviewBoxProps) {
  const [grabbing, setGrabbing] = useState(false);
  const drag = useRef<{ clientX: number; clientY: number; ox: number; oy: number } | null>(null);

  const px = (offset.x / 100) * width;
  const py = (offset.y / 100) * height;
  const bgPos = fit === 'fill-x'
    ? `center calc(50% + ${py}px)`
    : fit === 'fill-y'
      ? `calc(50% + ${px}px) center`
      : fit === 'tile'
        ? `${px}px ${py}px`
        : `calc(50% + ${px}px) calc(50% + ${py}px)`;

  return (
    <div className='sf-bg-preview-item'>
      <div style={{ width, height, flexShrink: 0, overflow: 'hidden', border: '1px solid #3a3a6a', borderRadius: 4, cursor: grabbing ? 'grabbing' : 'grab', userSelect: 'none' }}
        title='Перетащите для смещения. Двойной клик — сброс.'
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setGrabbing(true); drag.current = { clientX: e.clientX, clientY: e.clientY, ox: offset.x, oy: offset.y }; }}
        onPointerMove={(e) => { if (!drag.current) return; const dx = e.clientX - drag.current.clientX; const dy = e.clientY - drag.current.clientY; onOffsetChange({ x: drag.current.ox + (dx / width) * 100, y: drag.current.oy + (dy / height) * 100 }); }}
        onPointerUp={() => { setGrabbing(false); drag.current = null; }}
        onPointerCancel={() => { setGrabbing(false); drag.current = null; }}
        onDoubleClick={() => onOffsetChange({ x: 0, y: 0 })}
      >
        <div style={{
          width: '100%', height: '100%',
          backgroundImage: `url(${url})`,
          backgroundSize: BG_SIZE[fit] ?? '100% 100%',
          backgroundRepeat: fit === 'tile' ? 'repeat' : 'no-repeat',
          backgroundPosition: bgPos,
          transform: scale !== 1 ? `scale(${scale})` : undefined,
          transformOrigin: 'center center',
        }} />
      </div>
      <span>{label}</span>
    </div>
  );
}
