import type { ReactNode } from 'react';
import { CameraPanel } from './CameraPanel';

interface BottomBarProps {
  /** Camera slot is live only after onboarding; before it, a NO SIGNAL plate. */
  cameraOn: boolean;
  /** Slot 2 — the only screen-dependent part of the bar. */
  context?: ReactNode;
  /** Slot 3 — platform-owned action button (START / ОТМЕНА / ВЫЙТИ / nothing). */
  action?: ReactNode;
}

/**
 * The permanent bottom panel. Mounted above the screen state machine so it
 * survives every screen switch — only the slot contents change.
 */
export function BottomBar({ cameraOn, context, action }: BottomBarProps) {
  return (
    <div className="bottombar">
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
      <div className="slot-action">{action}</div>
    </div>
  );
}
