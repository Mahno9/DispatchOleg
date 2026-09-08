import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  api,
  type Character,
  type Game,
  type GameConfig,
  type MetaStage,
  type Settings,
  type VerifiedGame,
} from './api';
import { getSnapshot as cameraSnapshot, subscribe as subscribeCamera } from './camera/camera';
import { pickPostDialogue } from './dialogue/engine';
import { ExitConfirm } from './ui/ExitConfirm';
import { CrtOverlay } from './fx/CrtOverlay';
import { DEFAULT_PLAYER_NAME } from './game/minigameLoader';
import { localState } from './state/localState';
import { getConnectivitySnapshot, startSync, subscribeConnectivity, syncNow } from './state/sync';
import { BarPortrait } from './ui/BarPortrait';
import { BottomBar } from './ui/BottomBar';
import { DialogueScreen } from './screens/DialogueScreen';
import { MetaScreen, isUnlocked, pickRandomGame } from './screens/MetaScreen';
import {
  pendingDialogueIds,
  requiredDialogueCount,
  stageDialogueIds,
  resolveStage,
} from './screens/metaStage';
import { MinigameScreen } from './screens/MinigameScreen';
import { normalizeVoices, type VoicePreset } from './dialogue/voice';
import { AudioSettings } from './ui/AudioSettings';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { QrScanScreen } from './screens/QrScanScreen';
import { useClickSound } from './ui/useClickSound';
import { useMusicLoop } from './ui/useMusicLoop';
import { VictoryScreen } from './screens/VictoryScreen';
import { testTarget } from './testMode';

type Screen = 'onboarding' | 'meta' | 'qr-scan' | 'launch' | 'dialogue' | 'minigame' | 'victory';

/**
 * "The player has already seen the ending." Deliberately outside ClientState:
 * it is a one-off presentation flag, not progress, so it must not enter the
 * sync contract with the server.
 */
const VICTORY_SEEN_KEY = 'dispatch_victory_seen';

/** Which dialogue is on screen and where the chain goes once it ends. */
interface DialogueStep {
  id: number;
  then: 'minigame' | 'meta';
  /** Set for meta chatter: the speaker comes from the character, not the game. */
  characterId?: number;
}

const SYNC_INTERVAL_S = 20;
/** Ниже этого синк не опускаем: ноль из админки устроил бы шторм запросов. */
const MIN_SYNC_INTERVAL_S = 5;

/** Период синка из настройки `sync_interval_s`; не число — запасные 20 с. */
export function syncIntervalS(raw: unknown): number {
  const seconds =
    typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : SYNC_INTERVAL_S;
  return Math.max(MIN_SYNC_INTERVAL_S, seconds);
}

/** Сообщение в слоте 2 меты, когда конфиг задания не доехал. */
const LAUNCH_FAIL_TEXT = 'Задание не загрузилось · повторите';

/** Что делать с ответом `getGameConfig`: экран запуска или молчание. */
export type LaunchAction =
  | { kind: 'ignore' }
  | { kind: 'minigame' }
  | { kind: 'dialogue'; dialogueId: number }
  | { kind: 'error' };

/**
 * Реакция на ответ `getGameConfig`. `run` — номер запуска, на который его
 * ждали, `currentRun` — текущий: пока конфиг летел, игрок мог нажать «Отмена»
 * или улететь на онбординг, и поздний ответ обязан промолчать, а не выкинуть
 * его в пустую мини-игру.
 */
export function launchAction(
  run: number,
  currentRun: number,
  config: GameConfig | null,
): LaunchAction {
  if (run !== currentRun) return { kind: 'ignore' };
  if (!config) return { kind: 'error' };
  if (config.preDialogueId === null) return { kind: 'minigame' };
  return { kind: 'dialogue', dialogueId: config.preDialogueId };
}

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now.toLocaleTimeString('ru-RU', { hour12: false });
}

export function App() {
  const state = useSyncExternalStore(localState.subscribe, localState.getSnapshot);
  const online = useSyncExternalStore(subscribeConnectivity, getConnectivitySnapshot);
  const camera = useSyncExternalStore(subscribeCamera, cameraSnapshot);
  const clock = useClock();

  const [screen, setScreen] = useState<Screen>(() => {
    if (testTarget?.kind === 'game') return 'launch';
    if (testTarget?.kind === 'dialogue') return 'dialogue';
    return state.onboarded ? 'meta' : 'onboarding';
  });
  const [games, setGames] = useState<Game[]>([]);
  /** Каст — ради портрета и имени того, кто ведёт игрока по мини-игре. */
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedGame, setSelectedGame] = useState<VerifiedGame | null>(null);
  const [onboardStatus, setOnboardStatus] = useState('');
  /** Почему сорвался запуск задания — строкой в слоте 2 меты, по-русски. */
  const [launchError, setLaunchError] = useState<string | null>(null);
  /** Период фонового синка: настройка админки, до её приезда — запасные 20 с. */
  const [syncSeconds, setSyncSeconds] = useState(SYNC_INTERVAL_S);
  /** Texts/timings of the tutorial game — null until (or unless) it loads. */
  const [tutorialConfig, setTutorialConfig] = useState<Record<string, unknown> | null>(null);
  /** Фоновая петля лобби из настроек (`meta_music_url`); null — тишина. */
  const [lobbyMusicUrl, setLobbyMusicUrl] = useState<string | null>(null);
  const [clickSound, setClickSound] = useState<Settings['ui_click_sound_url']>(null);
  // Голоса бубнежа: настройка админки, одна на терминал (dialogue/voice.ts).
  const [voices, setVoices] = useState<Record<string, VoicePreset>>({});
  /** Стадии меты живут здесь, а не в MetaScreen: сцена, значки «Диалог» и гейт
   *  START обязаны смотреть на одну и ту же текущую стадию. */
  const [stages, setStages] = useState<MetaStage[]>([]);
  /** Сервер запущен с NO_QR=1 — операции выдаёт жребий, а не код на стене. */
  const [noQr, setNoQr] = useState(false);

  // -- game chain: config is fetched once per run, then pre → game → post --
  const [gameConfig, setGameConfig] = useState<GameConfig | null>(null);
  // ?test=dialogue:<id> — сразу сцена, без игры вокруг; по концу уходит на мету.
  const [dialogue, setDialogue] = useState<DialogueStep | null>(() =>
    testTarget?.kind === 'dialogue' ? { id: testTarget.dialogueId, then: 'meta' } : null,
  );
  /** Slot 2 rented out to the dialogue scene / the running minigame. */
  const [slotContext, setSlotContext] = useState<ReactNode>(null);
  /**
   * Кто говорит в слоте 2 во время мини-игры. `null` — реплик нет вовсе
   * (кухня, тетрис): портрета в панели тогда тоже нет, ему нечего озвучивать.
   */
  const [speaking, setSpeaking] = useState<'character' | 'player' | null>(null);
  /** Игрок нажал «Выйти» из мини-игры — ждём подтверждения, игра заморожена. */
  const [confirmExit, setConfirmExit] = useState(false);

  // Onboarding hands this to timer-driven screens: it must be referentially
  // stable, or their setTimeout effects restart on every App re-render (the
  // clock ticks once a second) and never fire.
  const finishOnboarding = useCallback(() => {
    // Local flag first, meta immediately — sync catches up in background.
    localState.setOnboarded(true);
    setScreen('meta');
  }, []);

  /** Номер текущего запуска: сверка в колбэке отсекает ответ отменённого. */
  const runRef = useRef(0);

  const endChain = useCallback(() => {
    // Уходим с экрана запуска — конфиг, который ещё в пути, больше не нужен.
    runRef.current += 1;
    setConfirmExit(false);
    setDialogue(null);
    setGameConfig(null);
    setSelectedGame(null);
    setSlotContext(null);
    setSpeaking(null);
    setScreen('meta');
  }, []);

  // pre-dialogue → minigame → post-dialogue, entered from a QR scan or a test run.
  const startGame = useCallback(
    (game: VerifiedGame) => {
      const run = (runRef.current += 1);
      setLaunchError(null);
      setConfirmExit(false);
      setSelectedGame(game);
      setSpeaking(null);
      setScreen('launch');

      const apply = (config: GameConfig | null): void => {
        const action = launchAction(run, runRef.current, config);
        switch (action.kind) {
          case 'ignore':
            return;
          case 'error':
            // Конфиг не доехал: назад на мету с русской строкой — пустой экран
            // мини-игры и английский `Failed to fetch` игроку ни о чём не говорят.
            setLaunchError(LAUNCH_FAIL_TEXT);
            return endChain();
          case 'minigame':
            setGameConfig(config);
            return setScreen('minigame');
          case 'dialogue':
            setGameConfig(config);
            setDialogue({ id: action.dialogueId, then: 'minigame' });
            return setScreen('dialogue');
        }
      };

      api.getGameConfig(game.id).then(
        (config) => apply(config),
        (err: unknown) => {
          console.error('[app] failed to load game config', err);
          apply(null);
        },
      );
    },
    [endChain],
  );

  // ?test=game:<id> — straight into the chain, no QR.
  useEffect(() => {
    const target = testTarget;
    if (target?.kind !== 'game' || games.length === 0) return;
    const game = games.find((g) => g.id === target.gameId);
    if (!game) {
      console.error(`[app] test game #${target.gameId} not found`);
      return endChain();
    }
    startGame(game);
  }, [games, startGame, endChain]);

  useEffect(() => {
    // Портрет — украшение: не загрузился каст, панель просто останется без него.
    api.getCharacters().then(setCharacters, () => setCharacters([]));
    // Не доехали стадии — мета покажет запасную раскладку, а гейт пропустит.
    api
      .getMetaStages()
      .then(setStages, (err: unknown) => console.error('[app] failed to load meta stages', err));
  }, []);

  useEffect(() => {
    api.getGames().then(
      (list) => {
        setGames(list);
        // The tutorial row carries the onboarding texts. Missing row or failed
        // fetch → the screen keeps its built-in defaults, so the flow still runs.
        const tutorial = list.find((g) => g.isTutorial);
        if (!tutorial) return;
        api.getGameConfig(tutorial.id).then(
          (cfg) => setTutorialConfig(cfg.config),
          (err: unknown) => console.error('[app] failed to load tutorial config', err),
        );
      },
      (err: unknown) => {
        console.error('[app] failed to load games', err);
      },
    );
  }, []);

  useEffect(() => {
    // Музыка — украшение: не доехали настройки, лобби просто останется тихим.
    api.getSettings().then(
      (settings) => {
        setLobbyMusicUrl(settings.meta_music_url || null);
        setClickSound(settings.ui_click_sound_url ?? null);
        setVoices(normalizeVoices(settings.character_voices));
        setNoQr(settings.no_qr === true);
        setSyncSeconds(syncIntervalS(settings.sync_interval_s));
      },
      (err: unknown) => console.error('[app] failed to load settings', err),
    );
  }, []);

  useEffect(() => {
    void syncNow();
  }, []);

  // Период приезжает настройкой позже старта — интервал тогда перезапускается.
  useEffect(() => startSync(syncSeconds), [syncSeconds]);

  // Щелчок по кнопкам — на всех экранах; у мини-игр в iframe свой звук, и их
  // клики до этого документа не долетают.
  useClickSound({ value: clickSound, prefs: state.prefs });

  // Лобби — мета, скан и экран запуска; диалог, игра и победа звучат сами.
  useMusicLoop({
    url: lobbyMusicUrl,
    active: screen === 'meta' || screen === 'qr-scan' || screen === 'launch',
    prefs: state.prefs,
  });

  // Onboarding is a one-way gate: leaving it is what sets `onboarded`.
  useEffect(() => {
    if (state.onboarded || screen === 'onboarding') return;
    // Тоже уход с экрана запуска (истёкшая сессия): ответ конфига обязан молчать.
    runRef.current += 1;
    setScreen('onboarding');
  }, [state.onboarded, screen]);

  const playable = games.filter((g) => !g.isTutorial);
  const won = playable.filter((g) => state.gameResults[String(g.id)]?.won).length;
  const unlocked = playable.filter((g) => isUnlocked(g, state.gameResults)).length;
  const allWon = playable.length > 0 && won === playable.length;

  // Текущая стадия меты. ?test=meta:<id> форсит конкретную; ?test=meta (stageId
  // null) оставляет обычный разбор триггеров, как и было в MetaScreen.
  const forceStageId = testTarget?.kind === 'meta' ? testTarget.stageId : null;
  const playableIds = useMemo(() => games.filter((g) => !g.isTutorial).map((g) => g.id), [games]);
  const stage = useMemo(() => {
    if (forceStageId !== null) return stages.find((s) => s.id === forceStageId) ?? null;
    return resolveStage(stages, state.gameResults, playableIds);
  }, [stages, state.gameResults, playableIds, forceStageId]);
  // Пока каст и стадии не доехали, список пуст — гейт ошибается в сторону
  // «пропустить», а не запирает игрока навсегда на упавшем запросе.
  const pending = pendingDialogueIds(stage, characters, state.seenDialogues);
  // Сцена, живущая несколько операций подряд, не требует всех перед каждой —
  // порция растёт ступенями (см. requiredDialogueCount).
  const stageDialogues = stageDialogueIds(stage, characters).length;
  const required = requiredDialogueCount(stages, stage, won, stageDialogues);
  const remaining = Math.max(0, required - (stageDialogues - pending.length));

  // The ending fires once per completed run. Falling short of a full clear —
  // an admin reset, a new game added — arms it again for the next time.
  useEffect(() => {
    // Test mode must not touch the terminal's real "ending seen" flag.
    if (testTarget) return;
    if (!allWon) return localStorage.removeItem(VICTORY_SEEN_KEY);
    // Only the meta screen may be interrupted: a dialogue or a running minigame
    // gets to finish, and lands back on the meta, where this fires.
    if (screen !== 'meta' || localStorage.getItem(VICTORY_SEEN_KEY) === '1') return;
    localStorage.setItem(VICTORY_SEEN_KEY, '1');
    setScreen('victory');
  }, [allWon, screen]);

  let workarea;
  let context;
  let action;
  let portrait;
  const gameCharacter = characters.find((c) => c.id === gameConfig?.characterId) ?? null;

  switch (screen) {
    case 'onboarding':
      workarea = (
        <OnboardingScreen
          // Test run: the emergency skip lever is forced on, so the scan step
          // passes without a printed QR (a real scan still works too).
          config={
            testTarget?.kind === 'onboarding' || noQr
              ? { ...tutorialConfig, allowSkipScan: true }
              : tutorialConfig
          }
          onStatus={setOnboardStatus}
          onDone={finishOnboarding}
        />
      );
      context = <div className="label">{onboardStatus}</div>;
      break;

    case 'meta':
      workarea = (
        <MetaScreen
          games={games}
          characters={characters}
          stage={stage}
          seen={state.seenDialogues}
          // Meta chatter: no game, no results — the dialogue just leads back
          // here. The id comes with the click: a stage placement may point the
          // same character at a different dialogue than their default one.
          onCharacter={({ character, dialogueId }) => {
            // Отметка — за открытую сцену, не за дочитанную: заглянул — засчитано.
            localState.markDialogueSeen(dialogueId);
            void syncNow();
            setDialogue({ id: dialogueId, then: 'meta', characterId: character.id });
            setScreen('dialogue');
          }}
        />
      );
      context = (
        <>
          <div className="label">
            Прогресс по всей игре · операций завершено {won} / {playable.length} · доступно{' '}
            {unlocked}
          </div>
          <div className="seg-bar">
            {playable.map((game) => (
              <i
                key={game.id}
                className={`seg ${state.gameResults[String(game.id)]?.won ? 'seg-done' : ''}`}
              />
            ))}
          </div>
          {remaining > 0 && (
            <div className="label">Сначала опросите персонал · осталось {remaining}</div>
          )}
          {launchError && (
            <div className="label error-line">
              <i className="marker marker-blink" />
              {launchError}
            </div>
          )}
        </>
      );
      action = (
        <button
          type="button"
          // Открылась — мигает как тревога: диалоги прочитаны, квест ждёт.
          className={`btn btn-key ${remaining === 0 ? 'btn-alert' : ''}`}
          disabled={remaining > 0}
          onClick={() => {
            // Без QR: код на стене заменяет жребий по разблокированным операциям.
            if (!noQr) return setScreen('qr-scan');
            const next = pickRandomGame(games, state.gameResults);
            if (next) startGame(next);
          }}
        >
          START
        </button>
      );
      break;

    case 'qr-scan':
      workarea = (
        <QrScanScreen
          userId={state.profile.userId}
          onVerified={startGame}
          onBack={() => setScreen('meta')}
        />
      );
      context = <div className="label">Наведите камеру на код</div>;
      action = (
        <button type="button" className="btn btn-key btn-danger" onClick={() => setScreen('meta')}>
          Отмена
        </button>
      );
      break;

    case 'launch':
      workarea = (
        <div className="screen screen-stub">
          <span className="label">Загрузка задания…</span>
        </div>
      );
      context = <div className="label">{selectedGame?.title ?? '—'}</div>;
      action = (
        <button type="button" className="btn btn-key btn-danger" onClick={endChain}>
          Отмена
        </button>
      );
      break;

    case 'dialogue':
      // The scene advances by clicking itself; slot 3 only offers a way out.
      workarea = dialogue && (
        <DialogueScreen
          dialogueId={dialogue.id}
          characterId={dialogue.characterId ?? gameConfig?.characterId ?? null}
          prefs={state.prefs}
          voices={voices}
          playerName={state.profile.name || DEFAULT_PLAYER_NAME}
          onContext={setSlotContext}
          onFinish={() => {
            setSlotContext(null);
            setDialogue(null);
            if (dialogue.then === 'minigame') setScreen('minigame');
            else endChain();
          }}
        />
      );
      context = slotContext;
      action = (
        <button type="button" className="btn btn-key btn-danger" onClick={endChain}>
          Выйти
        </button>
      );
      break;

    case 'minigame':
      // Slot 2 is fed by the game's onProgress; slot 3 stays platform-owned —
      // the minigame cannot write to either (docs/platform.md §3.6).
      workarea = selectedGame && gameConfig && (
        <MinigameScreen
          gameId={selectedGame.id}
          minigameId={selectedGame.minigameId}
          // Конфиг уже загружен startGame — лоадер за ним второй раз не ходит.
          config={gameConfig}
          paused={confirmExit}
          audio={state.prefs}
          speaker={gameCharacter?.name ?? ''}
          characterId={gameConfig?.characterId ?? null}
          voices={voices}
          playerName={state.profile.name || DEFAULT_PLAYER_NAME}
          onContext={setSlotContext}
          onSpeaker={setSpeaking}
          onFinished={(result) => {
            if (!result) return endChain();
            localState.recordGameResult(selectedGame.id, result);
            void syncNow();
            const postId = gameConfig ? pickPostDialogue(gameConfig, result) : null;
            setSlotContext(null);
            if (postId === null) return endChain();
            setDialogue({ id: postId, then: 'meta' });
            setScreen('dialogue');
          }}
        />
      );
      context = slotContext;
      // В диалоге персонажи стоят в рабочей области — там панели портрет не нужен.
      portrait = speaking !== null && gameCharacter && (
        <BarPortrait character={gameCharacter} speaking={speaking === 'character'} />
      );
      action = (
        <button
          type="button"
          className="btn btn-key btn-danger"
          onClick={() => setConfirmExit(true)}
        >
          Выйти
        </button>
      );
      break;

    case 'victory':
      workarea = <VictoryScreen playerName={state.profile.name || DEFAULT_PLAYER_NAME} />;
      context = (
        <div className="label">
          Прогресс по всей игре · операций завершено {won} / {playable.length} · смена закрыта
        </div>
      );
      action = (
        <button type="button" className="btn btn-key" onClick={() => setScreen('meta')}>
          НА МЕТУ
        </button>
      );
      break;
  }

  return (
    <div className="terminal">
      <div className="terminal-bar">
        <span className="terminal-title">CALL OF DOODY</span>
        <span>{clock}</span>
        <span className="terminal-bar-spacer" />
        {testTarget && (
          <span className="status status-offline">
            <i className="marker" />
            ТЕСТ-РЕЖИМ
          </span>
        )}
        {noQr && (
          <span className="status status-offline">
            <i className="marker" />
            БЕЗ QR
          </span>
        )}
        <AudioSettings prefs={state.prefs} />
        <span>{state.profile.name || 'ГОСТЬ'}</span>
        <span className={`status ${online ? 'status-active' : 'status-offline'}`}>
          <i className="marker" />
          {online ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>

      <div className="workarea">
        {workarea}
        {/* Только ручной выход: штатный конец игры уводит с экрана сам. */}
        {screen === 'minigame' && confirmExit && (
          <ExitConfirm onConfirm={endChain} onCancel={() => setConfirmExit(false)} />
        )}
      </div>

      {/* The camera slot comes alive as soon as onboarding gets the stream. */}
      <BottomBar
        cameraOn={state.onboarded || camera.status === 'live'}
        context={context}
        portrait={portrait}
        action={action}
      />

      <CrtOverlay />
    </div>
  );
}
