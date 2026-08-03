import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { api, type Game, type GameConfig, type VerifiedGame } from './api';
import { getSnapshot as cameraSnapshot, subscribe as subscribeCamera } from './camera/camera';
import { pickPostDialogue } from './dialogue/engine';
import { CrtOverlay } from './fx/CrtOverlay';
import { localState } from './state/localState';
import { getConnectivitySnapshot, startSync, subscribeConnectivity, syncNow } from './state/sync';
import { BottomBar } from './ui/BottomBar';
import { DialogueScreen } from './screens/DialogueScreen';
import { MetaScreen, isUnlocked } from './screens/MetaScreen';
import { MinigameScreen } from './screens/MinigameScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { QrScanScreen } from './screens/QrScanScreen';
import { VictoryScreen } from './screens/VictoryScreen';

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

  const [screen, setScreen] = useState<Screen>(state.onboarded ? 'meta' : 'onboarding');
  const [games, setGames] = useState<Game[]>([]);
  const [selectedGame, setSelectedGame] = useState<VerifiedGame | null>(null);
  const [onboardStatus, setOnboardStatus] = useState('');
  /** Texts/timings of the tutorial game — null until (or unless) it loads. */
  const [tutorialConfig, setTutorialConfig] = useState<Record<string, unknown> | null>(null);

  // -- game chain: config is fetched once per run, then pre → game → post --
  const [gameConfig, setGameConfig] = useState<GameConfig | null>(null);
  const [dialogue, setDialogue] = useState<DialogueStep | null>(null);
  /** Slot 2 rented out to the dialogue scene / the running minigame. */
  const [slotContext, setSlotContext] = useState<ReactNode>(null);

  // Onboarding hands this to timer-driven screens: it must be referentially
  // stable, or their setTimeout effects restart on every App re-render (the
  // clock ticks once a second) and never fire.
  const finishOnboarding = useCallback(() => {
    // Local flag first, meta immediately — sync catches up in background.
    localState.setOnboarded(true);
    setScreen('meta');
  }, []);

  const endChain = useCallback(() => {
    setDialogue(null);
    setGameConfig(null);
    setSelectedGame(null);
    setSlotContext(null);
    setScreen('meta');
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
    void syncNow();
    return startSync(SYNC_INTERVAL_S);
  }, []);

  // Onboarding is a one-way gate: leaving it is what sets `onboarded`.
  useEffect(() => {
    if (!state.onboarded && screen !== 'onboarding') setScreen('onboarding');
  }, [state.onboarded, screen]);

  const playable = games.filter((g) => !g.isTutorial);
  const won = playable.filter((g) => state.gameResults[String(g.id)]?.won).length;
  const unlocked = playable.filter((g) => isUnlocked(g, state.gameResults)).length;
  const allWon = playable.length > 0 && won === playable.length;

  // The ending fires once per completed run. Falling short of a full clear —
  // an admin reset, a new game added — arms it again for the next time.
  useEffect(() => {
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

  switch (screen) {
    case 'onboarding':
      workarea = (
        <OnboardingScreen
          config={tutorialConfig}
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
          results={state.gameResults}
          // Meta chatter: no game, no results — the dialogue just leads back
          // here. The id comes with the click: a stage placement may point the
          // same character at a different dialogue than their default one.
          onCharacter={({ character, dialogueId }) => {
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
            {playable.map((game) => {
              const done = state.gameResults[String(game.id)]?.won;
              const open = isUnlocked(game, state.gameResults);
              return (
                <i
                  key={game.id}
                  className={`seg ${done ? 'seg-done' : open ? 'seg-open' : ''}`}
                  title={game.title}
                />
              );
            })}
          </div>
        </>
      );
      action = (
        <button type="button" className="btn btn-key" onClick={() => setScreen('qr-scan')}>
          START
        </button>
      );
      break;

    case 'qr-scan':
      workarea = (
        <QrScanScreen
          userId={state.profile.userId}
          onVerified={(game) => {
            setSelectedGame(game);
            setScreen('launch');
            api.getGameConfig(game.id).then(
              (config) => {
                setGameConfig(config);
                if (config.preDialogueId === null) return setScreen('minigame');
                setDialogue({ id: config.preDialogueId, then: 'minigame' });
                setScreen('dialogue');
              },
              (err: unknown) => {
                // The loader fetches the config too — let it report the failure.
                console.error('[app] failed to load game config', err);
                setScreen('minigame');
              },
            );
          }}
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
      // the minigame cannot write to either (docs/platform.md §3.4).
      workarea = selectedGame && (
        <MinigameScreen
          gameId={selectedGame.id}
          muted={state.prefs.muted}
          onContext={setSlotContext}
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
      action = (
        <button type="button" className="btn btn-key btn-danger" onClick={endChain}>
          Выйти
        </button>
      );
      break;

    case 'victory':
      workarea = <VictoryScreen />;
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
        <span className="terminal-title">DISPATCH</span>
        <span>{clock}</span>
        <span className="terminal-bar-spacer" />
        <span>{state.profile.name || 'ГОСТЬ'}</span>
        <span className={`status ${online ? 'status-active' : 'status-offline'}`}>
          <i className="marker" />
          {online ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>

      <div className="workarea">{workarea}</div>

      {/* The camera slot comes alive as soon as onboarding gets the stream. */}
      <BottomBar
        cameraOn={state.onboarded || camera.status === 'live'}
        context={context}
        action={action}
      />

      <CrtOverlay />
    </div>
  );
}
