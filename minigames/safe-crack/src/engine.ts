/**
 * safe-crack — чистая логика. Ни DOM, ни таймеров, ни Date.now().
 * Спецификация: docs/minigames/05-safe-crack.md
 */

export type WidgetId =
  | 'mega-slider'
  | 'haystack-dropdown'
  | 'rotary-dial'
  | 'shuffle-keyboard'
  | 'number-as-words'
  | 'plus-minus'
  | 'safe-drum'
  | 'hold-button'
  | 'checkbox-wall';

export const WIDGET_IDS: readonly WidgetId[] = [
  'mega-slider',
  'haystack-dropdown',
  'rotary-dial',
  'shuffle-keyboard',
  'number-as-words',
  'plus-minus',
  'safe-drum',
  'hold-button',
  'checkbox-wall',
];

export type WidgetParams = Record<string, unknown>;

export interface Lock {
  question: string;
  widget: WidgetId;
  answer: string;
  points: number;
  params: WidgetParams;
}

export interface Config {
  title: string;
  timeLimitSeconds: number;
  maxAttempts: number;
  errorPenalty: number;
  locks: Lock[];
}

export type Phase = 'intro' | 'lock' | 'checking' | 'lockOpen' | 'lockFail' | 'victory' | 'defeat';

export interface State {
  phase: Phase;
  currentLock: number;
  score: number;
  mistakes: number;
  /** Infinity при maxAttempts === 0 */
  attemptsLeft: number;
  /** Infinity при timeLimitSeconds === 0 */
  timeLeft: number;
  locksOpened: number;
  /** Накопленное игровое время, секунды (для details.timeSpentSeconds) */
  elapsed: number;
  /** Результат последнего SUBMIT, применяется на CHECK_DONE */
  answerCorrect: boolean;
  /** Таймер обнулился во время checking — добивает на CHECK_DONE (§6.6) */
  timeExpired: boolean;
}

export type Event =
  | { type: 'START' }
  | { type: 'SUBMIT'; value: string }
  | { type: 'CHECK_DONE' }
  | { type: 'REVEAL_DONE' }
  | { type: 'TICK'; deltaSeconds: number };

export interface CompleteResult {
  score: number;
  won: boolean;
  details: Record<string, number | string>;
}

// ---------------------------------------------------------------------------
// Нормализация конфига
// ---------------------------------------------------------------------------

function int(value: unknown, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function normalizeLocks(raw: unknown): Lock[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const lock = (item ?? {}) as Record<string, unknown>;
    const widget = lock.widget as WidgetId;
    const params = lock.params;
    return {
      question: text(lock.question),
      widget: WIDGET_IDS.includes(widget) ? widget : 'mega-slider',
      answer: text(lock.answer),
      // §6.8: отрицательные и отсутствующие очки — это 0
      points: Math.max(0, int(lock.points, 50)),
      params: params && typeof params === 'object' ? (params as WidgetParams) : {},
    };
  });
}

export function normalizeConfig(raw: unknown): Config {
  const cfg = (raw ?? {}) as Record<string, unknown>;
  return {
    title: text(cfg.title) || 'СЕЙФ',
    timeLimitSeconds: Math.max(0, int(cfg.timeLimitSeconds, 0)),
    maxAttempts: Math.max(0, int(cfg.maxAttempts, 0)),
    errorPenalty: Math.max(0, int(cfg.errorPenalty, 10)),
    locks: normalizeLocks(cfg.locks),
  };
}

// ---------------------------------------------------------------------------
// Сравнение ответов (§5.3)
// ---------------------------------------------------------------------------

export function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/ё/g, 'е');
}

export function compareAnswer(input: string, answer: string): boolean {
  return normalize(input) === normalize(answer);
}

/** Эталон ригеля: hold-button и checkbox-wall сравниваются не с `answer` (§5.3). */
export function resolveExpected(lock: Lock): string {
  if (lock.widget === 'hold-button') return 'hit';
  if (lock.widget === 'checkbox-wall') {
    return normalizePattern(text(lock.params.pattern), int(lock.params.gridSize, 6));
  }
  return lock.answer;
}

// ---------------------------------------------------------------------------
// FSM
// ---------------------------------------------------------------------------

export function createState(config: Config): State {
  return {
    phase: 'intro',
    currentLock: 0,
    score: 0,
    mistakes: 0,
    attemptsLeft: config.maxAttempts > 0 ? config.maxAttempts : Infinity,
    timeLeft: config.timeLimitSeconds > 0 ? config.timeLimitSeconds : Infinity,
    locksOpened: 0,
    elapsed: 0,
    answerCorrect: false,
    timeExpired: false,
  };
}

export function reduce(state: State, event: Event, config: Config): State {
  const locks = config.locks;

  switch (event.type) {
    case 'START': {
      if (state.phase !== 'intro') return state;
      // §6.1: сейф без ригелей уже открыт
      if (locks.length === 0) return { ...state, phase: 'victory' };
      return { ...state, phase: 'lock', currentLock: 0 };
    }

    case 'SUBMIT': {
      // §6.4: сабмит во время проверки не существует
      if (state.phase !== 'lock') return state;
      const lock = locks[state.currentLock];
      if (!lock) return state;
      return {
        ...state,
        phase: 'checking',
        answerCorrect: compareAnswer(event.value, resolveExpected(lock)),
      };
    }

    case 'CHECK_DONE': {
      if (state.phase !== 'checking') return state;
      const lock = locks[state.currentLock];
      if (!lock) return state;

      if (state.answerCorrect) {
        const opened = state.locksOpened + 1;
        const next = { ...state, score: state.score + lock.points, locksOpened: opened };
        // §3.5: победа приоритетнее истёкшего таймера
        if (opened >= locks.length) return { ...next, phase: 'victory' };
        // §6.6: время вышло, а ригели ещё остались — продолжать нечего
        if (state.timeExpired) return { ...next, phase: 'defeat' };
        return { ...next, phase: 'lockOpen' };
      }

      const next = {
        ...state,
        mistakes: state.mistakes + 1,
        score: state.score - config.errorPenalty,
        attemptsLeft: state.attemptsLeft - 1,
      };
      if (state.timeExpired) return { ...next, phase: 'defeat' };
      return { ...next, phase: 'lockFail' };
    }

    case 'REVEAL_DONE': {
      if (state.phase === 'lockOpen') {
        return { ...state, phase: 'lock', currentLock: state.currentLock + 1 };
      }
      if (state.phase === 'lockFail') {
        // §6.7: пул попыток общий, исчерпан — defeat сразу после показа
        if (state.attemptsLeft <= 0) return { ...state, phase: 'defeat' };
        return { ...state, phase: 'lock' };
      }
      return state;
    }

    case 'TICK': {
      // §3.5/§6.3: терминальные фазы к таймеру невосприимчивы
      if (state.phase === 'intro' || state.phase === 'victory' || state.phase === 'defeat') return state;
      const elapsed = state.elapsed + event.deltaSeconds;
      const timeLeft = Math.max(0, state.timeLeft - event.deltaSeconds);
      if (timeLeft > 0) return { ...state, elapsed, timeLeft };
      if (state.phase === 'lock') return { ...state, elapsed, timeLeft, timeExpired: true, phase: 'defeat' };
      if (state.phase === 'checking') return { ...state, elapsed, timeLeft, timeExpired: true };
      // lockOpen / lockFail: время запомнили, добьёт следующий TICK уже в lock
      return { ...state, elapsed, timeLeft };
    }

    default:
      return state;
  }
}

export function buildResult(state: State, config: Config): CompleteResult {
  const locksTotal = config.locks.length;
  const won = state.phase === 'victory';
  const details: Record<string, number | string> = {
    locksOpened: state.locksOpened,
    locksTotal,
    mistakes: state.mistakes,
    timeSpentSeconds: Math.round(state.elapsed),
  };
  if (won) {
    details.styleTag =
      state.mistakes === 0 ? 'medvezhatnik' : state.mistakes > locksTotal ? 'grubaya-sila' : 'vzlomshchik';
  }
  return { score: Math.max(0, state.score), won, details };
}

// ---------------------------------------------------------------------------
// Чистые генераторы содержимого виджетов
// ---------------------------------------------------------------------------

export type Rnd = () => number;

/** Fisher-Yates, новый массив. */
export function shuffle<T>(items: readonly T[], rnd: Rnd = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function dedupe(items: readonly string[]): string[] {
  return [...new Set(items)];
}

const RU_LETTERS = 'абвгдежзийклмнопрстуфхцчшщыэюя';

/**
 * Пункты-шум для haystack-dropdown, когда `options` пуст.
 * Число — соседние числа; текст — опечатки исходного слова, потом случайные слова той же длины.
 * Возвращает ровно `count` уникальных строк, ни одна не равна `answer`.
 */
export function generateDecoys(answer: string, count: number, rnd: Rnd = Math.random): string[] {
  const total = Math.max(0, Math.round(count));
  if (total === 0) return [];
  const out: string[] = [];
  const seen = new Set([normalize(answer)]);
  const push = (candidate: string): void => {
    const key = normalize(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(candidate);
  };

  const target = Number(answer);
  if (answer.trim() !== '' && Number.isFinite(target)) {
    for (let step = 1; out.length < total && step <= total * 4; step++) {
      const low = target - step;
      if (low >= 0) push(String(low));
      if (out.length < total) push(String(target + step));
    }
    return out.slice(0, total);
  }

  const base = answer.trim() || 'вариант';
  // Опечатки: замена одной буквы в каждой позиции.
  for (let pos = 0; pos < base.length && out.length < total; pos++) {
    for (const ch of RU_LETTERS) {
      if (out.length >= total) break;
      push(base.slice(0, pos) + ch + base.slice(pos + 1));
    }
  }
  // Добор случайными словами той же длины.
  const len = Math.max(3, base.length);
  for (let guard = 0; out.length < total && guard < total * 50; guard++) {
    let word = '';
    for (let i = 0; i < len; i++) word += RU_LETTERS[Math.floor(rnd() * RU_LETTERS.length)]!;
    push(word);
  }
  return out.slice(0, total);
}

/** §6.8: pattern дополняется нулями / обрезается до gridSize². */
export function normalizePattern(pattern: string, gridSize: number): string {
  const side = Math.max(1, Math.round(gridSize) || 1);
  const size = side * side;
  return pattern.replace(/[^01]/g, '').slice(0, size).padEnd(size, '0');
}

// --- number-as-words ---------------------------------------------------------

const UNITS = ['один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = [
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать',
];
const TENS = ['двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = [
  'сто',
  'двести',
  'триста',
  'четыреста',
  'пятьсот',
  'шестьсот',
  'семьсот',
  'восемьсот',
  'девятьсот',
];

/** Пустой фрагмент барабана (§2.5) — обязателен, иначе «двести» не набрать. */
export const EMPTY_SLOT = '—';

/** Число прописью, 0…999. Нужен и тестам, и подсказке админу. */
export function numberToWords(n: number): string {
  if (n === 0) return 'ноль';
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h > 0) parts.push(HUNDREDS[h - 1]!);
  if (rest >= 10 && rest <= 19) parts.push(TEENS[rest - 10]!);
  else {
    const t = Math.floor(rest / 10);
    const u = rest % 10;
    if (t > 0) parts.push(TENS[t - 2]!);
    if (u > 0) parts.push(UNITS[u - 1]!);
  }
  return parts.join(' ');
}

/**
 * Барабаны числительных: сотни / десятки (с цельными «двенадцать») / единицы.
 * При `slots` < 3 берутся младшие разряды. Фрагменты выше `maxNumber` отбрасываются.
 */
export function buildWordReels(slots: number, maxNumber: number): string[][] {
  const limit = Math.max(0, Math.round(maxNumber) || 0);
  const hundreds = HUNDREDS.filter((_, i) => (i + 1) * 100 <= limit);
  const tens = [...TEENS.filter((_, i) => 10 + i <= limit), ...TENS.filter((_, i) => (i + 2) * 10 <= limit)];
  const units = ['ноль', ...UNITS.filter((_, i) => i + 1 <= limit)];
  const reels = [hundreds, tens, units].map((values) => [EMPTY_SLOT, ...values]);
  const count = Math.min(3, Math.max(1, Math.round(slots) || 1));
  return reels.slice(3 - count);
}

/** Значение виджета: непустые фрагменты через пробел (§2.5). */
export function composeWords(fragments: readonly string[]): string {
  return fragments.filter((f) => f && f !== EMPTY_SLOT).join(' ');
}
