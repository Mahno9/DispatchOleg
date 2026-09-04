import {
  buildResult,
  createState,
  normalizeConfig,
  panelLine,
  reduce,
  type Config,
  type Event,
  type Lock,
  type State,
} from './engine.js';
import { STYLES } from './styles.js';
import { el, P } from './widgets/common.js';
import { createWidget, SELF_SUBMIT, type LockWidget } from './widgets/index.js';

type WeightedAudio = { url: string; weight: number; volume?: number };
type AudioValue = string | WeightedAudio[];

interface RawConfig {
  prizeImage?: string;
  sounds?: Record<string, AudioValue | undefined>;
  muted?: boolean;
  /** 0…100 из общего регулятора плеера; живьём приходит через setVolume. Музыки тут нет — только SFX. */
  musicVolume?: number;
  sfxVolume?: number;
  [key: string]: unknown;
}

interface Callbacks {
  onComplete: (result: { score: number; won: boolean; details?: Record<string, number | string> }) => void;
  onExit: () => void;
  onProgress?: (text: string, percent?: number) => void;
  onLine?: (text: string | null, onDismiss?: () => void) => void;
}

const FADE_MS = 300;
/** §3.1: ровно 600 мс проворота лимба. */
const CHECK_MS = 600;
/** §1.3: показательные фазы lockOpen / lockFail. */
const REVEAL_MS = 500;
const TICK_MS = 1000;
const OUTRO_MS = 900;

function clock(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function init(
  container: HTMLElement,
  rawConfig: RawConfig,
  callbacks: Callbacks,
): {
  destroy: () => void;
  setPaused: (paused: boolean) => void;
  setVolume: (v: { muted: boolean; musicVolume: number; sfxVolume: number }) => void;
} {
  const config: Config = normalizeConfig(rawConfig);
  const total = config.locks.length;
  let state: State = createState(config);

  // --- каркас ---------------------------------------------------------------
  const styleEl = el('style');
  styleEl.textContent = STYLES;
  container.append(styleEl);
  const root = el('div', `${P}root`);
  container.append(root);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add(`${P}visible`)));

  const timers = new Set<ReturnType<typeof setTimeout>>();
  let ticker: ReturnType<typeof setInterval> | undefined;
  let widget: LockWidget | undefined;
  let muted = rawConfig.muted === true;
  let finished = false;
  let held = false; // заморозка платформой на время инструктажа
  const gainOf = (v: unknown, fallback: number): number =>
    Math.max(0, Math.min(100, typeof v === 'number' && Number.isFinite(v) ? v : fallback)) / 100;
  // Музыки в этой игре нет — только SFX, поэтому используется только sfxGain.
  let sfxGain = gainOf(rawConfig.sfxVolume, 100);

  function later(fn: () => void, ms: number): void {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  }

  // --- звук -----------------------------------------------------------------
  const audioCache = new Map<string, HTMLAudioElement>();

  function pickSound(value: AudioValue | undefined): { url: string; volume: number } | undefined {
    if (!value) return undefined;
    if (typeof value === 'string') return { url: value, volume: 100 };
    if (!value.length) return undefined;
    let r = Math.random() * value.reduce((sum, v) => sum + (Number(v.weight) || 0), 0);
    for (const v of value) {
      r -= Number(v.weight) || 0;
      if (r <= 0) return { url: v.url, volume: Number(v.volume) || 100 };
    }
    const last = value[value.length - 1]!;
    return { url: last.url, volume: Number(last.volume) || 100 };
  }

  function play(name: string): void {
    if (muted) return;
    const sound = pickSound(rawConfig.sounds?.[name]);
    if (!sound) return;
    let base = audioCache.get(sound.url);
    if (!base) {
      base = new Audio(sound.url);
      base.preload = 'auto';
      audioCache.set(sound.url, base);
    }
    const node = base.cloneNode() as HTMLAudioElement;
    node.volume = Math.max(0, Math.min(1, (sound.volume / 100) * sfxGain));
    node.play().catch(() => {});
  }

  // --- HUD ------------------------------------------------------------------
  const hud = el('div', `${P}hud`);
  const hudTitle = el('div', `${P}hud__title`, config.title);
  const hudLock = el('div', `${P}hud__cell ${P}mono`);
  const hudScore = el('div', `${P}hud__cell ${P}mono`);
  const hudAttempts = el('div', `${P}hud__cell ${P}mono`);
  const hudTime = el('div', `${P}hud__cell ${P}mono`);
  const muteBtn = el('button', `${P}sq`, muted ? '🔇' : '🔊');
  muteBtn.type = 'button';
  muteBtn.setAttribute('aria-label', 'Звук');
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    muteBtn.textContent = muted ? '🔇' : '🔊';
  });
  hud.append(hudTitle, hudLock, hudScore, hudAttempts, hudTime, el('div', `${P}hud__spacer`), muteBtn);

  // --- сцена ----------------------------------------------------------------
  const body = el('div', `${P}body`);
  const stage = el('div', `${P}stage`);
  const progressRow = el('div', `${P}progress`);
  const progressLabel = el('div', `${P}progress__label ${P}mono`);
  const progressBar = el('div', `${P}progress__bar`);
  const progressFill = el('div', `${P}progress__fill`);
  progressBar.append(progressFill);
  progressRow.append(progressLabel, progressBar);
  const slot = el('div', `${P}slot`);
  const statusRow = el('div', `${P}status`);
  const statusBar = el('div', `${P}statusbar ${P}mono`);
  const enterBtn = el('button', `${P}btn ${P}btn--enter`, 'ВВОД');
  enterBtn.type = 'button';
  enterBtn.addEventListener('click', () => dispatch({ type: 'SUBMIT', value: widget?.getValue() ?? '' }));
  statusRow.append(statusBar, enterBtn);
  stage.append(progressRow, slot, statusRow);

  const bolts = el('div', `${P}bolts`);
  const boltNodes = config.locks.map((_, i) => {
    const node = el('div', `${P}bolt ${P}mono`);
    node.append(el('span', undefined, String(i + 1).padStart(2, '0')), el('span', undefined, '—'));
    bolts.append(node);
    return node;
  });
  body.append(stage, bolts);
  root.append(hud, body);

  // --- экраны ---------------------------------------------------------------
  let screen: HTMLElement | undefined;

  function makeDoor(open: boolean, spin: boolean): HTMLElement {
    const door = el('div', `${P}door${open ? ` ${P}door--open` : ''}${spin ? ` ${P}door--spin` : ''}`);
    door.append(el('div', `${P}door__ring`), el('div', `${P}door__spokes`));
    return door;
  }

  function showScreen(nodes: HTMLElement[]): void {
    hideScreen();
    screen = el('div', `${P}screen`);
    screen.append(...nodes);
    root.append(screen);
  }

  function hideScreen(): void {
    screen?.remove();
    screen = undefined;
  }

  function endScreen(won: boolean): void {
    const nodes: HTMLElement[] = [makeDoor(won, false)];
    if (won && rawConfig.prizeImage) {
      const prize = el('img', `${P}screen__prize`) as HTMLImageElement;
      prize.src = rawConfig.prizeImage;
      prize.alt = '';
      nodes.push(prize);
    }
    const title = el('div', `${P}screen__title${won ? '' : ` ${P}screen__title--alert`}`);
    title.textContent = won ? 'СЕЙФ ВСКРЫТ' : state.timeLeft <= 0 ? 'ВРЕМЯ ВЫШЛО' : 'ТРЕВОГА';
    const rows = el('div', `${P}screen__rows ${P}mono`);
    rows.append(
      el('div', `${P}hint`, `ОЧКИ: ${Math.max(0, state.score)}`),
      el('div', `${P}hint`, `РИГЕЛЕЙ ВСКРЫТО: ${state.locksOpened} / ${total}`),
      el('div', `${P}hint`, `ОШИБОК: ${state.mistakes}`),
    );
    nodes.push(title, rows);
    showScreen(nodes);
  }

  // --- отрисовка ------------------------------------------------------------
  function render(): void {
    const playing = state.phase !== 'intro' && state.phase !== 'victory' && state.phase !== 'defeat';
    hudLock.textContent = playing ? `РИГЕЛЬ ${Math.min(state.currentLock + 1, total)}/${total}` : '';
    hudScore.textContent = `ОЧКИ ${Math.max(0, state.score)}`;
    hudAttempts.textContent =
      config.maxAttempts > 0 ? `ПОПЫТКИ ${Math.max(0, state.attemptsLeft)}/${config.maxAttempts}` : '';
    hudAttempts.classList.toggle(`${P}hud__cell--alert`, config.maxAttempts > 0 && state.attemptsLeft <= 1);
    hudTime.textContent = config.timeLimitSeconds > 0 ? clock(state.timeLeft) : '';

    boltNodes.forEach((node, i) => {
      const open = i < state.locksOpened;
      const active = i === state.currentLock && playing;
      node.className = `${P}bolt ${P}mono${open ? ` ${P}bolt--open` : active ? ` ${P}bolt--active` : ''}${
        active && state.phase === 'lockFail' ? ` ${P}bolt--fail` : ''
      }`;
      node.lastElementChild!.textContent = open ? 'OPEN' : active ? '···' : '—';
    });

    statusBar.className = `${P}statusbar ${P}mono`;
    if (state.phase === 'checking') {
      statusBar.classList.add(`${P}statusbar--check`);
      statusBar.textContent = 'ПРОВЕРКА…';
    } else if (state.phase === 'lockOpen') {
      statusBar.classList.add(`${P}statusbar--open`);
      statusBar.textContent = `РИГЕЛЬ ПОДДАЛСЯ · +${config.locks[state.currentLock]?.points ?? 0}`;
    } else if (state.phase === 'lockFail') {
      statusBar.classList.add(`${P}statusbar--fail`);
      statusBar.textContent = `ОТКАЗ · −${config.errorPenalty}${
        config.maxAttempts > 0 ? ` · ОСТАЛОСЬ ПОПЫТОК: ${Math.max(0, state.attemptsLeft)}` : ''
      }`;
    } else {
      statusBar.textContent = lockHint;
    }
    progressLabel.textContent = `ВСКРЫТО ${state.locksOpened}/${total}`;
    progressFill.style.width = `${total === 0 ? 100 : Math.round((state.locksOpened / total) * 100)}%`;

    slot.classList.toggle(`${P}slot--off`, state.phase !== 'lock');
    enterBtn.disabled = state.phase !== 'lock';
    pushLine();
  }

  // Подсказка Малеволы висит в слоте 2 нижней панели весь взлом: без onDismiss
  // платформа сама её не гасит (minigame_contract.md). Толкаем только на смене
  // текста — render() зовётся и на каждый тик таймера.
  let lineShown: string | null = null;
  function pushLine(): void {
    const text = panelLine(config, state);
    if (text === lineShown) return;
    lineShown = text;
    callbacks.onLine?.(text);
  }

  // --- виджеты --------------------------------------------------------------
  let lockHint = 'ВВЕДИТЕ ЗНАЧЕНИЕ';

  function mountLock(lock: Lock): void {
    widget?.destroy();
    slot.textContent = '';
    widget = createWidget(lock.widget, {
      answer: lock.answer,
      // §5.2: пока FSM в checking, самоподтверждение игнорируется редьюсером
      selfSubmit: (value: string) => dispatch({ type: 'SUBMIT', value }),
      playSound: play,
    });
    widget.mount(slot, lock.params, () => {
      /* onChange: щелчки виджеты играют сами через playSound */
    });
    // §5.2: для selfSubmit-виджета кнопка «ВВОД» не создаётся вовсе
    const self = SELF_SUBMIT.has(lock.widget);
    if (self) enterBtn.remove();
    else statusRow.append(enterBtn);
    lockHint = self ? 'ОТПУСКАНИЕ = ПОДТВЕРЖДЕНИЕ' : 'ВВЕДИТЕ ЗНАЧЕНИЕ';
  }

  function progress(): void {
    const percent = total === 0 ? 100 : Math.round((state.locksOpened / total) * 100);
    callbacks.onProgress?.(`Замок ${Math.min(state.currentLock + 1, total)}/${total}`, percent);
  }

  // --- завершение -----------------------------------------------------------
  function finish(won: boolean): void {
    if (finished) return;
    finished = true;
    stopTicker();
    widget?.destroy();
    widget = undefined;
    play(won ? 'victory' : 'lockFail');
    // Пока реплика висит, платформа прячет прогресс — снимаем её под итог.
    pushLine();
    const percent = won ? 100 : Math.round((state.locksOpened / Math.max(1, total)) * 100);
    callbacks.onProgress?.(won ? 'Сейф вскрыт' : 'Взлом сорван', percent);
    endScreen(won);
    const result = buildResult(state, config);
    later(() => {
      root.classList.remove(`${P}visible`);
      later(() => callbacks.onComplete(result), FADE_MS);
    }, OUTRO_MS);
  }

  // --- таймер ---------------------------------------------------------------
  function startTicker(): void {
    stopTicker();
    if (held) return; // лимит времени не течёт под инструктажем
    ticker = setInterval(() => dispatch({ type: 'TICK', deltaSeconds: TICK_MS / 1000 }), TICK_MS);
  }

  function stopTicker(): void {
    if (ticker) clearInterval(ticker);
    ticker = undefined;
  }

  // --- мост FSM ↔ DOM -------------------------------------------------------
  function dispatch(event: Event): void {
    if (finished || held) return;
    const before = state;
    state = reduce(state, event, config);
    if (state === before) return;
    if (state.phase !== before.phase || state.currentLock !== before.currentLock) applyPhase(before);
    render();
  }

  function applyPhase(before: State): void {
    switch (state.phase) {
      case 'lock': {
        const lock = config.locks[state.currentLock];
        if (!lock) return;
        if (before.phase === 'intro') startTicker();
        if (before.phase === 'lockFail') {
          widget?.reset(); // §3.2: тот же ригель, новое случайное состояние
        } else {
          hideScreen();
          mountLock(lock);
        }
        progress();
        break;
      }
      case 'checking':
        widget?.freeze?.(); // §3.1: дрейф и инерция замирают
        play('dialClick');
        later(() => dispatch({ type: 'CHECK_DONE' }), CHECK_MS);
        break;
      case 'lockOpen':
        play('lockOpen');
        later(() => dispatch({ type: 'REVEAL_DONE' }), REVEAL_MS);
        break;
      case 'lockFail':
        play('lockFail');
        later(() => dispatch({ type: 'REVEAL_DONE' }), REVEAL_MS);
        break;
      case 'victory':
        finish(true);
        break;
      case 'defeat':
        // §6.7: игрок должен увидеть последнюю ошибку — defeat приходит после lockFail
        finish(false);
        break;
      default:
        break;
    }
  }

  // Своего экрана «НАЧАТЬ ВЗЛОМ» больше нет: платформа показывает инструктаж
  // перед каждой игрой, и второй гейт мешал ему — под ним должен быть виден
  // рабочий стол сейфа (вопрос, виджет, ВВОД), а не дверь с кнопкой.
  // Лимит/попытки/штраф видны в HUD и в статус-баре при отказе.
  dispatch({ type: 'START' });
  render();
  callbacks.onProgress?.(`Замок 0/${total}`, 0);

  return {
    /**
     * Инструктаж платформы: таймер стоит, ввод не доходит до FSM, физика
     * виджета замерла. `reset()` на разморозке — это то же, что делает виджет
     * при монтировании: пауза бывает только до первого хода игрока, терять
     * нечего (minigame_contract.md, «Пауза»).
     */
    setPaused(value: boolean): void {
      if (held === value) return;
      held = value;
      if (held) {
        stopTicker();
        widget?.freeze?.();
      } else {
        widget?.reset();
        if (state.phase === 'lock') startTicker();
      }
    },

    // Общий регулятор в шапке плеера; локальная кнопка 🔊 остаётся быстрым
    // переключателем, но глобальная настройка её перебивает.
    setVolume(v): void {
      sfxGain = gainOf(v.sfxVolume, 100);
      muted = v.muted === true;
      muteBtn.textContent = muted ? '🔇' : '🔊';
    },

    destroy(): void {
      stopTicker();
      for (const id of timers) clearTimeout(id);
      timers.clear();
      widget?.destroy();
      widget = undefined;
      for (const audio of audioCache.values()) {
        audio.pause();
        audio.src = '';
      }
      audioCache.clear();
      container.innerHTML = '';
    },
  };
}
