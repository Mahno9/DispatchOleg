import { useEffect, useRef, useState, type ReactNode } from 'react';
import { launchMinigame, type MinigameHandle, type MinigameResult } from '../game/minigameLoader';

interface MinigameScreenProps {
  gameId: number;
  muted: boolean;
  /** Bottom-bar slot 2 — fed by the game's onProgress (docs/platform.md §3.1). */
  onContext: (node: ReactNode) => void;
  /** Result of the run, or null when the player exited without finishing. */
  onFinished: (result: MinigameResult | null) => void;
}

/**
 * Host for a minigame bundle: the whole work area becomes its container, the
 * bottom bar stays platform-owned (docs/platform.md §2.5, §3.4).
 */
export function MinigameScreen({ gameId, muted, onContext, onFinished }: MinigameScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  const cb = useRef({ onContext, onFinished });
  cb.current = { onContext, onFinished };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let live = true;
    let handle: MinigameHandle | null = null;

    launchMinigame({
      container,
      gameId,
      muted,
      onProgress: (text, percent) => {
        if (!live) return;
        cb.current.onContext(
          <>
            <div className="label">{text}</div>
            {percent !== undefined && (
              <div className="progress">
                <div
                  className="progress-fill"
                  style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
                />
              </div>
            )}
          </>,
        );
      },
      onFinished: (result) => {
        if (live) cb.current.onFinished(result);
      },
    }).then(
      (h) => {
        handle = h;
        // Unmounted while the bundle was still loading (StrictMode included).
        if (!live) h.destroy();
      },
      (err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : String(err));
      },
    );

    return () => {
      live = false;
      cb.current.onContext(null);
      handle?.destroy();
    };
  }, [gameId, muted]);

  return (
    <div className="minigame-host">
      <div className="minigame-container" ref={containerRef} />
      {error && (
        <div className="minigame-error">
          <div className="panel error-panel">
            <h2 className="error-line">Сбой запуска</h2>
            <span className="label">Мини-игра не загрузилась: {error}</span>
            <button type="button" className="btn" onClick={() => onFinished(null)}>
              В МЕТУ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
