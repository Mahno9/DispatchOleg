import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  DEFAULT_PLAYER_NAME,
  launchMinigame,
  type MinigameHandle,
  type MinigameResult,
} from '../game/minigameLoader';
import type { GameConfig } from '../api';
import { localState, type AudioPrefs } from '../state/localState';
import { TUTORIALS, resolveStep, type Dir, type TutorialStep } from '../game/tutorials';
import { TypedLine, splitSpeaker } from '../dialogue/Line';
import { OLEG } from '../dialogue/engine';
import type { VoicePreset } from '../dialogue/voice';

interface MinigameScreenProps {
  gameId: number;
  /** Какой бандл запустится — ключ инструктажа; игру грузит уже loader. */
  minigameId: string;
  /** Конфиг задания, уже загруженный App: лоадер его не перезапрашивает. */
  config: GameConfig;
  /** Платформа просит игру замереть (подтверждение выхода), не разрушая её. */
  paused?: boolean;
  /** Общий регулятор звука; меняется на лету, без перезапуска игры. */
  /** Целиком `AudioPrefs`, а не только каналы игры: реплики в слоте 2
   *  печатает голос персонажа, и ему нужны свои громкость и мьют. */
  audio: AudioPrefs;
  /** Имя персонажа игры — подписывает его реплики (onLine) в слоте 2. */
  speaker?: string;
  /** `games.character_id` — по нему берётся пресет бубнежа персонажа игры. */
  characterId?: number | null;
  /** Пресеты бубнежа по id говорящего (настройка `character_voices`). */
  voices?: Record<string, VoicePreset>;
  /** Имя игрока: им подписаны реплики диспетчера в двухголосых репликах игр. */
  playerName?: string;
  /** Кто говорит в слоте 2: персонаж, игрок или никто (реплики нет). */
  onSpeaker?: (who: 'character' | 'player' | null) => void;
  /** Bottom-bar slot 2 — fed by the game's onProgress (docs/platform.md §3.1). */
  onContext: (node: ReactNode) => void;
  /** Запоминать просмотр инструктажа в прогрессе. Песочница оставляет его нетронутым. */
  persistBriefing?: boolean;
  /** Result of the run, or null when the player exited without finishing. */
  onFinished: (result: MinigameResult | null) => void;
}

/**
 * Показывать ли инструктаж сам, без просьбы. Игра без шагов стартует сразу, как
 * и раньше; у видевшего их игрока на повторной попытке стрелки не всплывают —
 * он бы снова кликал их перед каждой попыткой.
 */
export function needsBriefing(minigameId: string, briefedMinigames: string[]): boolean {
  return (TUTORIALS[minigameId] ?? []).length > 0 && !briefedMinigames.includes(minigameId);
}

export function rememberBriefing(minigameId: string, persist: boolean): void {
  if (persist) localState.markBriefed(minigameId);
}

/**
 * Host for a minigame bundle: the whole work area becomes its container, the
 * bottom bar stays platform-owned (docs/platform.md §2.5, §3.6).
 */
export function MinigameScreen({
  gameId,
  minigameId,
  config,
  paused = false,
  audio,
  speaker = '',
  characterId = null,
  voices,
  playerName = DEFAULT_PLAYER_NAME,
  onContext,
  onSpeaker,
  persistBriefing = true,
  onFinished,
}: MinigameScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Бандл и все его ассеты в памяти, init отработал. До этого — экран загрузки,
  // а не полусобранная игра: инструктаж целится в живой DOM и не должен
  // показываться раньше, чем он есть.
  const [loaded, setLoaded] = useState(false);

  const steps = TUTORIALS[minigameId] ?? [];
  const [briefed, setBriefed] = useState(
    () => !needsBriefing(minigameId, localState.getSnapshot().briefedMinigames),
  );

  // Имя приезжает асинхронно (список персонажей), а колбэк игры замыкается
  // один раз на запуске — читаем через ref, чтобы не перемонтировать игру.
  const namesRef = useRef({ character: speaker, player: playerName });
  namesRef.current = { character: speaker, player: playerName };

  // Голоса приезжают настройкой, уже после запуска игры, — тоже через ref:
  // колбэк onLine замкнулся на монтировании и свежее значение так и не увидел бы.
  const voicesRef = useRef({ voices, characterId });
  voicesRef.current = { voices, characterId };

  const cb = useRef({ onContext, onSpeaker, onFinished });
  cb.current = { onContext, onSpeaker, onFinished };

  // Громкость НЕ в зависимостях запускающего эффекта: иначе каждое движение
  // ползунка перемонтировало бы игру и сбрасывало разложенные карточки.
  // В запуск отдаём свежее значение через ref, дальше — через setVolume.
  const audioRef = useRef(audio);
  audioRef.current = audio;

  // Конфиг замыкается на запуске, как и звук: приехать заново он не может,
  // а перемонтировать игру из-за новой ссылки на объект — тем более незачем.
  const configRef = useRef(config);
  configRef.current = config;

  // Пауза от платформы — тоже через ref: бандл догружается асинхронно, и к
  // моменту resolve подтверждение выхода может уже висеть.
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

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
    setLoaded(false);

    launchMinigame({
      container,
      config: configRef.current,
      audio: audioRef.current,
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
        // Реплика игры печатается тем же кодом, что и диалоговая (dialogue/Line.tsx).
        // Двухголосые реплики (лабиринт) подписаны префиксом «ИМЯ:» — вынимаем
        // говорящего оттуда: диспетчер слева, где его камера, персонаж справа, где
        // его портрет. Без префикса говорит персонаж игры, как было.
        const { character, player } = namesRef.current;
        const said = text === null ? null : splitSpeaker(text, [character, player]);
        const fromPlayer = said?.name === player && player !== '';
        // Бубнёж: реплику диспетчера печатает его голос, всё остальное — голос
        // персонажа игры. Громкость снимаем на момент появления реплики —
        // ползунок в её пределах (пара секунд) звук уже не догонит.
        const v = voicesRef.current;
        const voiceId = fromPlayer ? OLEG : String(v.characterId ?? '');
        const preset = v.voices?.[voiceId] ?? null;
        // key — чтобы на смене текста печать начиналась заново, а не дописывалась.
        lineRef.current =
          said === null ? null : (
            <TypedLine
              key={text}
              name={said.name ?? character}
              text={said.text}
              side={fromPlayer ? 'left' : 'right'}
              voice={{ preset, audio: audioRef.current }}
              onClick={onDismiss}
            />
          );
        cb.current.onSpeaker?.(said === null ? null : fromPlayer ? 'player' : 'character');
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
        setLoaded(true);
        h.setPaused?.(!briefedRef.current || pausedRef.current);
        // Бандл грузится асинхронно: всё, что игрок накрутил регулятором за
        // это время, ушло в никуда — handleRef был ещё пуст.
        h.setVolume?.(audioRef.current);
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
  }, [gameId]);

  useEffect(() => {
    handleRef.current?.setVolume?.(audio);
  }, [audio]);

  // Игра замирает и под инструктажем, и под подтверждением выхода.
  useEffect(() => {
    handleRef.current?.setPaused?.(!briefed || paused);
  }, [briefed, paused, loaded]);

  useEffect(() => {
    cb.current.onContext(
      briefed ? (
        lineRef.current ?? progressRef.current
      ) : (
        <div className="label">{loaded ? 'Инструктаж · перед запуском' : 'Загрузка · подождите'}</div>
      ),
    );
  }, [briefed, loaded]);

  return (
    <div className="minigame-host">
      <div className="minigame-container" ref={containerRef} />
      {!loaded && !error && (
        <div className="minigame-loading">
          <div className="panel">
            <h2>Загрузка</h2>
            <span className="label">Бандл и звук операции · подождите</span>
            <div className="progress">
              <div className="progress-fill" />
            </div>
          </div>
        </div>
      )}
      {loaded && !briefed && (
        <Briefing
          minigameId={minigameId}
          steps={steps}
          hostRef={containerRef}
          onStart={() => {
            rememberBriefing(minigameId, persistBriefing);
            setBriefed(true);
          }}
        />
      )}
      {loaded && briefed && steps.length > 0 && !error && (
        <button
          type="button"
          className="btn tut-again"
          title="Показать инструктаж"
          onClick={() => setBriefed(false)}
        >
          ?
        </button>
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
  minigameId,
  steps,
  hostRef,
  onStart,
}: {
  minigameId: string;
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
      {minigameId === 'three-mazes' && <MazeTutorialDemos />}
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

function MazeTutorialDemos() {
  return (
    <div className="tut-maze-demos" aria-label="Ключевые механики лабиринта">
      <div className="tut-maze-demo">
        <div className="tut-maze-scene tut-maze-break" aria-hidden="true">
          <span className="tut-maze-dot" />
          <span className="tut-maze-wall tut-maze-wall-top" />
          <span className="tut-maze-wall tut-maze-wall-bottom" />
        </div>
        <div className="tut-maze-caption">
          <strong>МОЖНО:</strong> разогнаться и пробить пунктирную стену.
          <span><strong>НЕЛЬЗЯ:</strong> бить обычную или вскользь.</span>
        </div>
      </div>
      <div className="tut-maze-demo">
        <div className="tut-maze-scene tut-maze-patrol" aria-hidden="true">
          <span className="tut-maze-patrol-ring">ДОЗОР</span>
          <svg className="tut-maze-suspicion" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="29" pathLength="100" />
          </svg>
          <span className="tut-maze-dot" />
        </div>
        <div className="tut-maze-caption">
          <strong>МОЖНО:</strong> пройти круг дозора медленно.
          <span><strong>НЕЛЬЗЯ:</strong> бежать — заметят.</span>
        </div>
      </div>
    </div>
  );
}
