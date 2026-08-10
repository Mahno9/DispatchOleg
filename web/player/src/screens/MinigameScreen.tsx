import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { launchMinigame, type MinigameHandle, type MinigameResult } from '../game/minigameLoader';
import { TUTORIALS, resolveStep, type Dir, type TutorialStep } from '../game/tutorials';

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
 * bottom bar stays platform-owned (docs/platform.md §2.5, §3.6).
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
  // Реплика (onLine) перекрывает прогресс в слоте 2, пока висит: игра сама решает,
  // когда её погасить (клик по панели → её собственный onDismiss).
  const lineRef = useRef<ReactNode>(null);

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
        // Пока висит реплика (lineRef) — прогресс копится в progressRef молча,
        // иначе он затирает реплику в слоте на каждую смену этапа.
        if (briefedRef.current && !lineRef.current) cb.current.onContext(progressRef.current);
      },
      onLine: (text, onDismiss) => {
        if (!live) return;
        lineRef.current =
          text === null ? null : (
            <div className="dialogue-context" onClick={onDismiss}>
              <div className="dialogue-line">{text}</div>
            </div>
          );
        if (briefedRef.current) cb.current.onContext(lineRef.current ?? progressRef.current);
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
      briefed
        ? (lineRef.current ?? progressRef.current)
        : <div className="label">Инструктаж · перед запуском</div>,
    );
  }, [briefed]);

  return (
    <div className="minigame-host">
      <div className="minigame-container" ref={containerRef} />
      {!briefed && (
        <Briefing steps={steps} hostRef={containerRef} onStart={() => setBriefed(true)} />
      )}
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

const GLYPH: Record<Dir, string> = {
  up: '▲',
  down: '▼',
  left: '◀',
  right: '▶',
};

/**
 * Стрелки с подписями поверх смонтированной игры. Шаг целится в элемент игры
 * (`step.target`), поэтому позиции измеряются по живому DOM, а не берутся из
 * констант: поле игры вписано с полями по краям, и на широком мониторе те же
 * проценты рабочей области указывают не туда, что на телефоне.
 */
function Briefing({
  steps,
  hostRef,
  onStart,
}: {
  steps: TutorialStep[];
  hostRef: React.RefObject<HTMLDivElement>;
  onStart: () => void;
}) {
  const [spots, setSpots] = useState(() =>
    steps.map((s) => ({ x: s.x ?? 50, y: s.y ?? 50, dir: s.dir ?? 'up' })),
  );
  const overlayRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let frame = 0;
    function measure(): void {
      frame = 0;
      const box = host!.getBoundingClientRect();
      setSpots(
        steps.map((step) => {
          const target = step.target
            ? (host!.querySelector(step.target)?.getBoundingClientRect() ?? null)
            : null;
          return resolveStep(box, target, step);
        }),
      );
    }
    function schedule(): void {
      if (!frame) frame = requestAnimationFrame(measure);
    }

    measure();
    // Бандл игры догружается асинхронно, так что в момент первого замера целей
    // может ещё не быть: пересчитываем и когда игра дорисовала свой DOM, и когда
    // рабочая область сменила размер.
    const resize = new ResizeObserver(schedule);
    resize.observe(host);
    const mutation = new MutationObserver(schedule);
    mutation.observe(host, { childList: true, subtree: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
    };
  }, [steps, hostRef]);

  // Развести подписи: стрелки уже стоят там, где надо, а вот сами подписи могут
  // налезть друг на друга или свеситься за край (цель в углу — кнопка ВВОД у
  // safe-crack). Двигаем ТЕКСТ, а не стрелку: стрелка обязана остаться на цели,
  // иначе смысл привязки теряется. Так координаты не приходится выверять руками.
  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const box = overlay.getBoundingClientRect();
    const PAD = 6;
    const texts = [...overlay.querySelectorAll<HTMLElement>('.tut-text')];
    for (const text of texts) {
      text.style.setProperty('--nx', '0px');
      text.style.setProperty('--ny', '0px');
    }
    const rects = texts.map((t) => t.getBoundingClientRect());
    const shift = rects.map(() => 0);

    // Сверху вниз: каждую следующую подпись сдвигаем ниже всех, с кем она
    // пересекается и по горизонтали тоже — иначе две соседние колонки
    // расталкивались бы зря.
    const order = rects.map((_, i) => i).sort((a, b) => rects[a]!.top - rects[b]!.top);
    order.forEach((i, k) => {
      for (const j of order.slice(0, k)) {
        const overlapX = Math.min(rects[i]!.right, rects[j]!.right) - Math.max(rects[i]!.left, rects[j]!.left);
        if (overlapX <= 0) continue;
        const need = rects[j]!.bottom + shift[j]! + PAD - (rects[i]!.top + shift[i]!);
        if (need > 0) shift[i]! += need;
      }
    });

    texts.forEach((text, i) => {
      const r = rects[i]!;
      const nx = Math.min(0, box.right - PAD - r.right) + Math.max(0, box.left + PAD - r.left);
      let ny = shift[i]!;
      // Зажим сильнее расталкивания: за край подпись не выпускаем в любом случае.
      ny += Math.min(0, box.bottom - PAD - (r.bottom + ny)) + Math.max(0, box.top + PAD - (r.top + ny));
      text.style.setProperty('--nx', `${Math.round(nx)}px`);
      text.style.setProperty('--ny', `${Math.round(ny)}px`);
    });
  }, [spots]);

  return (
    <div className="minigame-tutorial" ref={overlayRef}>
      {steps.map((step, i) => (
        <div
          key={i}
          className={`tut-step tut-${spots[i]?.dir ?? 'up'}`}
          style={{ left: `${spots[i]?.x ?? 50}%`, top: `${spots[i]?.y ?? 50}%` }}
        >
          <span className="tut-arrow" aria-hidden="true">
            {GLYPH[spots[i]?.dir ?? 'up']}
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
