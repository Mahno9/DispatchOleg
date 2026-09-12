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
  /** Открыт ли инструктаж — App гасит под ним нижнюю панель с «Выйти». */
  onBriefing?: (open: boolean) => void;
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
  onBriefing,
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

  const cb = useRef({ onContext, onSpeaker, onBriefing, onFinished });
  cb.current = { onContext, onSpeaker, onBriefing, onFinished };

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
  // бандл поднимается сразу, а тикать начинает только по крестику инструктажа.
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
        // Под инструктажем слот занят его подписью; строка игры доедет по крестику.
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

  // Инструктаж на экране ровно тогда, когда рисуется <Briefing>. На
  // размонтировании снимаем блокировку панели: игру могут закрыть и под ним.
  const briefingOpen = loaded && !briefed;
  useEffect(() => {
    cb.current.onBriefing?.(briefingOpen);
  }, [briefingOpen]);
  useEffect(() => () => cb.current.onBriefing?.(false), []);

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
      {briefingOpen && (
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
export function Briefing({
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
      const box = host!.getBoundingClientRect();
      const next = steps.map((step) => {
        const target = step.target
          ? (host!.querySelector(step.target)?.getBoundingClientRect() ?? null)
          : null;
        return resolveStep(box, target, step);
      });
      setSpots((current) =>
        current.every(
          (spot, i) =>
            spot.x === next[i]?.x && spot.y === next[i]?.y && spot.dir === next[i]?.dir,
        )
          ? current
          : next,
      );
      // Мини-игры подгружают собственные стили после монтирования: позиция цели
      // может измениться без resize или DOM-мутации. Оверлей живёт недолго, поэтому
      // следим за его тремя целями до закрытия.
      frame = requestAnimationFrame(measure);
    }

    measure();
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [steps, hostRef]);

  // Стрелки остаются на целях, подписи занимают ближайшее свободное место внутри
  // оверлея. Препятствия — все стрелки, уже поставленные подписи и крестик.
  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const box = overlay.getBoundingClientRect();
    const PAD = 8;
    const texts = [...overlay.querySelectorAll<HTMLElement>('.tut-text')];
    const arrows = [...overlay.querySelectorAll<HTMLElement>('.tut-arrow')];
    for (const text of texts) {
      text.style.setProperty('--nx', '0px');
      text.style.setProperty('--ny', '0px');
    }
    const rects = texts.map((t) => t.getBoundingClientRect());
    const fixed = arrows.map((a) => a.getBoundingClientRect());
    const close = overlay.querySelector('.tut-close')?.getBoundingClientRect();
    if (close) fixed.push(close);
    const placed: Array<{ left: number; right: number; top: number; bottom: number }> = [];
    const order = rects.map((_, i) => i).sort((a, b) => rects[a]!.top - rects[b]!.top);
    const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
    const overlaps = (
      a: { left: number; right: number; top: number; bottom: number },
      b: { left: number; right: number; top: number; bottom: number },
    ) =>
      a.left < b.right + PAD &&
      a.right > b.left - PAD &&
      a.top < b.bottom + PAD &&
      a.bottom > b.top - PAD;

    for (const i of order) {
      const text = texts[i]!;
      const r = rects[i]!;
      const minX = box.left + PAD;
      const maxX = box.right - PAD - r.width;
      const minY = box.top + PAD;
      const maxY = box.bottom - PAD - r.height;
      const preferred = { x: clamp(r.left, minX, maxX), y: clamp(r.top, minY, maxY) };
      const obstacles = [...fixed, ...placed];
      const xs = new Set([preferred.x, minX, maxX]);
      const ys = new Set([preferred.y, minY, maxY]);
      for (const obstacle of obstacles) {
        xs.add(clamp(obstacle.left - PAD - r.width, minX, maxX));
        xs.add(clamp(obstacle.right + PAD, minX, maxX));
        ys.add(clamp(obstacle.top - PAD - r.height, minY, maxY));
        ys.add(clamp(obstacle.bottom + PAD, minY, maxY));
      }
      const candidates = [...xs].flatMap((x) => [...ys].map((y) => ({ x, y })));
      candidates.sort(
        (a, b) =>
          (a.x - preferred.x) ** 2 + (a.y - preferred.y) ** 2 -
          ((b.x - preferred.x) ** 2 + (b.y - preferred.y) ** 2),
      );
      const spot =
        candidates.find(({ x, y }) => {
          const candidate = { left: x, right: x + r.width, top: y, bottom: y + r.height };
          return !obstacles.some((obstacle) => overlaps(candidate, obstacle));
        }) ?? preferred;
      text.style.setProperty('--nx', `${Math.round(spot.x - r.left)}px`);
      text.style.setProperty('--ny', `${Math.round(spot.y - r.top)}px`);
      placed.push({
        left: spot.x,
        right: spot.x + r.width,
        top: spot.y,
        bottom: spot.y + r.height,
      });
    }
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
      <BriefingClose onClose={onStart} />
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

/**
 * Крестик закрытия инструктажа — в том же углу, где потом встанет `?`
 * (.tut-again): закрыть и открыть заново игрок ищет в одном месте.
 */
export function BriefingClose({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      className="btn tut-close"
      title="Закрыть инструктаж"
      aria-label="Закрыть инструктаж"
      onClick={onClose}
    >
      {/* Крест линиями, а не глифом «×»: у шрифта терминала он мелкий. */}
      <svg className="tut-close-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 5 19 19M19 5 5 19" />
      </svg>
    </button>
  );
}
