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
  const [previewRun, setPreviewRun] = useState(0);

  const cb = useRef({ onContext, onFinished });
  cb.current = { onContext, onFinished };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Инструктаж идёт ПОВЕРХ живой игры — иначе стрелки указывают в пустоту.
    // Этот прогон одноразовый: звук выключен, результат и прогресс игнорируются,
    // а по «Понятно» эффект перезапускается и бандл поднимается с нуля. Поэтому
    // натикавшее за время чтения (упавшая деталь, таймер сейфа) роли не играет.
    if (!briefed) cb.current.onContext(<div className="label">Инструктаж · перед запуском</div>);

    let live = true;
    let handle: MinigameHandle | null = null;

    launchMinigame({
      container,
      gameId,
      muted: muted || !briefed,
      onProgress: (text, percent) => {
        if (!live || !briefed) return;
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
        if (!live) return;
        if (briefed) cb.current.onFinished(result);
        // Превью доигралось само (rescue-catch без ввода теряет три жизни
        // секунд за пятнадцать) — под инструктажем осталась бы пустота после
        // fadeOut. Поднимаем заново; PREVIEW_RELAUNCH_CAP на случай бандла,
        // который завершается прямо в init.
        else if (previewRun < PREVIEW_RELAUNCH_CAP) setPreviewRun(previewRun + 1);
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
  }, [gameId, muted, briefed, previewRun]);

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

/** Потолок перезапусков превью — страховка от бандла, падающего в init. */
const PREVIEW_RELAUNCH_CAP = 20;

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
