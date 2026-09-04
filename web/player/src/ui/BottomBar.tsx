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
}

/**
 * The permanent bottom panel. Mounted above the screen state machine so it
 * survives every screen switch — only the slot contents change.
 */
export function BottomBar({ cameraOn, context, portrait, action }: BottomBarProps) {
  return (
    <div className={`bottombar${portrait ? ' bottombar-portrait' : ''}`}>
      <div className="slot slot-camera">
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
      <div className="slot slot-context">{context}</div>
      {portrait && <div className="slot slot-portrait">{portrait}</div>}
      <div className="slot-action">{action}</div>
    </div>
  );
}
