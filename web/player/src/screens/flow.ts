import type { Game } from '../api';
import type { GameResult } from '../state/localState';

// ---------------------------------------------------------------------------
// Ход смены: из чего состоит ростер операций, когда смена считается закрытой и
// когда игроку показывают финал. Чистая логика без React — её видят и мета, и
// экран победы, и сканер, и она обязана быть одна на всех.
// ---------------------------------------------------------------------------

/**
 * Операции смены: всё, кроме коробочного обучения и финала. Финал («Разбор
 * ночной смены») не стоит в ряду заданий — он запускается кнопкой с экрана
 * победы, поэтому в прогрессе, жребии и списке меты его нет.
 */
export function rosterGames(games: Game[]): Game[] {
  return games.filter((g) => !g.isTutorial && !g.isFinale);
}

/** Финальная операция смены; её нет — смена заканчивается как раньше, метой. */
export function finaleGame(games: Game[]): Game | null {
  return games.find((g) => g.isFinale) ?? null;
}

/** Выиграна ли игра. Одна мерка для ростера и для финала. */
export function isWon(game: Game, results: Record<string, GameResult>): boolean {
  return results[String(game.id)]?.won === true;
}

/** Все операции ростера закрыты. Пустой ростер (игры не доехали) — не победа. */
export function allRosterWon(games: Game[], results: Record<string, GameResult>): boolean {
  const roster = rosterGames(games);
  return roster.length > 0 && roster.every((g) => isWon(g, results));
}

/** Что решает показ финала: разбирается в тестах по одному полю за раз. */
export interface VictoryInput {
  games: Game[];
  results: Record<string, GameResult>;
  /** Флаг «финал этому игроку уже показывали» (localState). */
  victorySeen: boolean;
}

/**
 * Пора ли показать экран победы (решение принимается на мете).
 *
 * Без финальной операции всё как раньше: один показ на прохождение, дальше
 * держит флаг `victory_seen`. С финальной операцией флаг не при чём — победа
 * висит воротами к ней: игрок вышел из «Разбора» на середине, вернулся на мету
 * и снова видит «Закрыть смену». Гаснет она только когда финал выигран.
 */
export function shouldShowVictory({ games, results, victorySeen }: VictoryInput): boolean {
  if (!allRosterWon(games, results)) return false;
  const finale = finaleGame(games);
  if (!finale) return !victorySeen;
  return !isWon(finale, results);
}
