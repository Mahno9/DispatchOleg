import type { Game } from '../api';
import type { GameResult } from '../state/localState';
import { finaleGame, isWon } from './flow';
import { pickRandomGame } from './MetaScreen';

// ---------------------------------------------------------------------------
// Рычаг тестировщика: Shift по кнопке — операция засчитывается выигранной без
// диалогов и мини-игры. Решение вынесено сюда чистой функцией: App только
// спрашивает «какую игру закрыть», а условия (тест-режим, Shift, есть ли что
// закрывать) разбираются здесь и проверяются тестами.
// ---------------------------------------------------------------------------

/** Результат записывается как обычная победа — нулём очков, с первой попытки. */
export const INSTANT_WIN_RESULT = { score: 0, won: true } as const;

export interface InstantWinInput {
  /** Плеер открыт из админки (`testTarget !== null`). Вне теста Shift не значит ничего. */
  testMode: boolean;
  /** Клик пришёл с зажатым Shift. */
  shift: boolean;
  games: Game[];
  results: Record<string, GameResult>;
}

/**
 * Какую операцию закрыть по Shift+START: ту же, что выдал бы жребий режима без
 * QR, — разблокированную и ещё не выигранную. Вне тест-режима, без Shift и
 * когда закрывать нечего — null, и кнопка ведёт себя как обычно.
 *
 * Жребий детерминированный (первый кандидат): тестировщику нужен предсказуемый
 * порядок обхода, а не случайный, иначе одну и ту же ветку не переоткрыть.
 */
export function instantWinTarget({ testMode, shift, games, results }: InstantWinInput): Game | null {
  if (!testMode || !shift) return null;
  const next = pickRandomGame(games, results, () => 0);
  // Жребий умеет отдавать уже выигранную на переигровку — закрывать её незачем.
  return next && !isWon(next, results) ? next : null;
}

/**
 * То же для кнопки «Закрыть смену»: финал засчитывается выигранным без
 * «Разбора» — стадия «После смены» к тому моменту уже открыта победами
 * ростера. Уже выигранный финал — null, закрывать нечего.
 */
export function instantFinaleTarget({
  testMode,
  shift,
  games,
  results,
}: InstantWinInput): Game | null {
  if (!testMode || !shift) return null;
  const finale = finaleGame(games);
  return finale && !isWon(finale, results) ? finale : null;
}
