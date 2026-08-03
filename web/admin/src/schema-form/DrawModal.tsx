import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// DrawModal — minimal Paint-like popup. Freehand brush on a TRANSPARENT canvas;
// "Готово" exports a PNG File that the caller uploads as a (temporary) asset,
// mirroring the mic-recording flow. ponytail: brush + eraser only.
// ---------------------------------------------------------------------------

interface DrawModalProps {
  onClose: () => void;
  onDone: (file: File) => void;
}

const W = 512;
const H = 384;

export function DrawModal({ onClose, onDone }: DrawModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<[number, number] | null>(null);
  const [color, setColor] = useState('#ffffff');
  const [size, setSize] = useState(6);
  const [eraser, setEraser] = useState(false);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
  }, []);

  // Esc closes the draw popup only. Capture phase + preventDefault so the parent
  // settings modal's Esc handler doesn't also fire and close everything.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  function pos(e: React.PointerEvent): [number, number] {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [
      ((e.clientX - rect.left) / rect.width) * W,
      ((e.clientY - rect.top) / rect.height) * H,
    ];
  }

  function down(e: React.PointerEvent) {
    canvasRef.current!.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastRef.current = pos(e);
    stroke(e); // a dot for single taps
  }

  function stroke(e: React.PointerEvent) {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const [x, y] = pos(e);
    const [lx, ly] = lastRef.current ?? [x, y];
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(x, y);
    ctx.stroke();
    lastRef.current = [x, y];
  }

  function up() {
    drawingRef.current = false;
    lastRef.current = null;
  }

  function clear() {
    const ctx = canvasRef.current!.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
  }

  function done() {
    canvasRef.current!.toBlob((blob) => {
      if (!blob) return;
      onDone(new File([blob], 'drawing.png', { type: 'image/png' }));
    }, 'image/png');
  }

  return (
    <div className='modal-overlay' onClick={onClose}>
      <div className='modal-card draw-modal' onClick={(e) => e.stopPropagation()}>
        <div className='modal-header'>
          <span className='modal-title'>Рисование</span>
          <button className='modal-close' title='Закрыть' onClick={onClose}>
            ✕
          </button>
        </div>
        <div className='modal-body'>
          <div className='draw-toolbar'>
            <input
              type='color'
              value={color}
              title='Цвет'
              onChange={(e) => { setColor(e.target.value); setEraser(false); }}
            />
            <label className='draw-size'>
              <input
                type='range'
                min={1}
                max={48}
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
              />
              <span>{size}px</span>
            </label>
            <button
              type='button'
              className={eraser ? 'draw-tool draw-tool--active' : 'draw-tool'}
              title='Ластик'
              onClick={() => setEraser((v) => !v)}
            >
              ⌫
            </button>
            <button type='button' className='draw-tool' title='Очистить' onClick={clear}>
              🗑
            </button>
          </div>
          <div className='draw-canvas-wrap'>
            <canvas
              ref={canvasRef}
              width={W}
              height={H}
              className='draw-canvas'
              style={{ touchAction: 'none' }}
              onPointerDown={down}
              onPointerMove={stroke}
              onPointerUp={up}
              onPointerCancel={up}
            />
          </div>
        </div>
        <div className='modal-actions'>
          <div className='modal-actions-spacer' />
          <button onClick={done}>Готово</button>
          <button onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}
