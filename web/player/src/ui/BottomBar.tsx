import type { ReactNode } from 'react';
import { CameraPanel } from './CameraPanel';

interface BottomBarProps {
  /** Camera slot is live only after onboarding; before it, a NO SIGNAL plate. */
  cameraOn: boolean;
  /** Slot 2 — the only screen-dependent part of the bar. */
  context?: ReactNode;
  /** Портрет собеседника слева от кнопки — только там, где есть кто говорить. */
  portrait?: ReactNode;
  /** Slot 3 — platform-owned action button (START / ОТМЕНА / ВЫЙТИ / nothing). */
  action?: ReactNode;
  /** Под инструктажем мини-игры панель — часть его скрима: гаснет и не кликается,
   *  иначе игрок жмёт «Выйти» вместо крестика инструктажа. */
  locked?: boolean;
}

/**
 * The permanent bottom panel. Mounted above the screen state machine so it
 * survives every screen switch — only the slot contents change.
 */
export function BottomBar({ cameraOn, context, portrait, action, locked = false }: BottomBarProps) {
  // inert гасит слоты и для клавиатуры (Tab → Enter на «Выйти»); мышь и палец
  // ловит скрим поверх. В типах React 18 атрибута нет — отсюда spread.
  const slot = locked ? { inert: '' } : {};
  return (
    <div
      className={`bottombar${portrait ? ' bottombar-portrait' : ''}${locked ? ' bottombar-locked' : ''}`}
    >
      <div className="slot slot-camera" {...slot}>
        {cameraOn ? (
          <CameraPanel />
        ) : (
          <div className="camera-placeholder">
            <span className="status status-warn">
              <i className="marker marker-blink" />
              NO SIGNAL
            </span>
          </div>
        )}
      </div>
      <div className="slot slot-context" {...slot}>
        {context}
      </div>
      {portrait && (
        <div className="slot slot-portrait" {...slot}>
          {portrait}
        </div>
      )}
      <div className="slot-action" {...slot}>
        {action}
      </div>
      {locked && <div className="bottombar-scrim" aria-hidden="true" />}
    </div>
  );
}
