import { useRef } from 'react';

// Normalized crop rect over the source image (each value in [0,1]).
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  imageUrl?: string | undefined;
  value?: Crop | undefined;
  onChange: (next: Crop | undefined) => void;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const DEFAULT_CROP: Crop = { x: 0.2, y: 0.2, w: 0.6, h: 0.6 };

// Drag-to-crop overlay + "how it looks in-game" square preview.
// ponytail: hand-rolled pointer drag (matches BgPreviewBox/FindObjectEditor); no crop lib.
export function ImageCropField({ imageUrl, value, onChange }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<
    | { mode: 'move' | 'resize'; clientX: number; clientY: number; crop: Crop; rectW: number; rectH: number }
    | null
  >(null);

  if (!imageUrl) {
    return (
      <div className='sf-field sf-field--full'>
        <span className='sf-label'>Кадрирование</span>
        <span className='sf-asset-hint'>Сначала выберите изображение.</span>
      </div>
    );
  }

  function start(e: React.PointerEvent, mode: 'move' | 'resize') {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    e.stopPropagation();
    stageRef.current?.setPointerCapture(e.pointerId);
    drag.current = {
      mode,
      clientX: e.clientX,
      clientY: e.clientY,
      crop: value ?? DEFAULT_CROP,
      rectW: rect.width,
      rectH: rect.height,
    };
  }

  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.clientX) / d.rectW;
    const dy = (e.clientY - d.clientY) / d.rectH;
    if (d.mode === 'move') {
      onChange({
        ...d.crop,
        x: clamp01(Math.min(d.crop.x + dx, 1 - d.crop.w)),
        y: clamp01(Math.min(d.crop.y + dy, 1 - d.crop.h)),
      });
    } else {
      onChange({
        ...d.crop,
        w: Math.max(0.05, Math.min(d.crop.w + dx, 1 - d.crop.x)),
        h: Math.max(0.05, Math.min(d.crop.h + dy, 1 - d.crop.y)),
      });
    }
  }

  function end() {
    drag.current = null;
  }

  const crop = value;
  const previewStyle: React.CSSProperties = crop
    ? {
        backgroundImage: `url(${imageUrl})`,
        backgroundSize: `${crop.w >= 1 ? 100 : 100 / crop.w}% ${crop.h >= 1 ? 100 : 100 / crop.h}%`,
        backgroundPosition: `${crop.w >= 1 ? 0 : (crop.x / (1 - crop.w)) * 100}% ${crop.h >= 1 ? 0 : (crop.y / (1 - crop.h)) * 100}%`,
        backgroundRepeat: 'no-repeat',
      }
    : { backgroundImage: `url(${imageUrl})`, backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat' };

  return (
    <div className='sf-field sf-field--full sf-crop'>
      <span className='sf-label'>Кадрирование</span>
      <div className='sf-crop-row'>
        <div
          ref={stageRef}
          className='sf-crop-stage'
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        >
          <img className='sf-crop-img' src={imageUrl} alt='' draggable={false} />
          {crop && (
            <div
              className='sf-crop-box'
              style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
              onPointerDown={(e) => start(e, 'move')}
            >
              <div className='sf-crop-handle' onPointerDown={(e) => start(e, 'resize')} />
            </div>
          )}
        </div>
        <div className='sf-crop-preview' style={previewStyle} title='Как будет в игре' />
      </div>
      <div className='sf-crop-actions'>
        {crop ? (
          <button type='button' onClick={() => onChange(undefined)}>Сбросить (всё изображение)</button>
        ) : (
          <button type='button' onClick={() => onChange(DEFAULT_CROP)}>Вырезать фрагмент</button>
        )}
      </div>
    </div>
  );
}
