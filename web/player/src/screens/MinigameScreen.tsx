import { useEffect, useRef, useState, type ReactNode } from 'react';
import { launchMinigame, type MinigameHandle, type MinigameResult } from '../game/minigameLoader';
import { TUTORIALS, type TutorialStep } from '../game/tutorials';

interface MinigameScreenProps {
  gameId: number;
  /** Какой бандл запустится — ключ инструктажа; игру грузит уже loader. */
  minigameId: string;
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
export function MinigameScreen({
  gameId,
  minigameId,
  muted,
  onContext,
  onFinished,
}: MinigameScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  const steps = TUTORIALS[minigameId] ?? [];
  // Игра без инструктажа стартует сразу, как и раньше.
  const [briefed, setBriefed] = useState(steps.length === 0);

  const cb = useRef({ onContext, onFinished });
  cb.current = { onContext, onFinished };

  // Инструктаж лежит ПОВЕРХ смонтированной игры — иначе стрелки указывают в
  // пустоту. Но игра под ним заморожена (handle.setPaused, minigame_contract.md):
  // бандл поднимается сразу, а тикать начинает только по «Понятно».
  // Refs, потому что бандл догружается асинхронно: к моменту resolve инструктаж
  // может быть уже закрыт, а прогресс — уже прийти.
  const handleRef = useRef<MinigameHandle | null>(null);
  const briefedRef = useRef(briefed);
  briefedRef.current = briefed;
  const progressRef = useRef<ReactNode>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let live = true;

    launchMinigame({
      container,
      gameId,
      muted,
      onProgress: (text, percent) => {
        if (!live) return;
        progressRef.current = (
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
          </>
        );
        // Под инструктажем слот занят его подписью; строка игры доедет по «Понятно».
        if (briefedRef.current) cb.current.onContext(progressRef.current);
      },
      onFinished: (result) => {
        if (live) cb.current.onFinished(result);
      },
    }).then(
      (h) => {
        // Unmounted while the bundle was still loading (StrictMode included).
        if (!live) {
          h.destroy();
          return;
        }
        handleRef.current = h;
        h.setPaused?.(!briefedRef.current);
      },
      (err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : String(err));
      },
    );

    return () => {
      live = false;
      cb.current.onContext(null);
      handleRef.current?.destroy();
      handleRef.current = null;
    };
  }, [gameId, muted]);

  useEffect(() => {
    handleRef.current?.setPaused?.(!briefed);
    cb.current.onContext(
      briefed ? progressRef.current : <div className="label">Инструктаж · перед запуском</div>,
    );
  }, [briefed]);

  return (
    <div className="minigame-host">
      <div className="minigame-container" ref={containerRef} />
      {!briefed && <Briefing steps={steps} onStart={() => setBriefed(true)} />}
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

const GLYPH: Record<TutorialStep['dir'], string> = {
  up: '▲',
  down: '▼',
  left: '◀',
  right: '▶',
};

/** Стрелки с подписями поверх пустой рабочей области; координаты — проценты. */
function Briefing({ steps, onStart }: { steps: TutorialStep[]; onStart: () => void }) {
  return (
    <div className="minigame-tutorial">
      {steps.map((step, i) => (
        <div
          key={i}
          className={`tut-step tut-${step.dir}`}
          style={{ left: `${step.x}%`, top: `${step.y}%` }}
        >
          <span className="tut-arrow" aria-hidden="true">
            {GLYPH[step.dir]}
          </span>
          <span className="tut-text">
            <i className="status status-warn">{i + 1}</i>
            <span className="label">{step.text}</span>
          </span>
        </div>
      ))}
      <button type="button" className="btn tut-start" onClick={onStart}>
        Понятно
      </button>
    </div>
  );
}
