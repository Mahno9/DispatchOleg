import type { Database } from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Row / DTO types
// ---------------------------------------------------------------------------

interface GameRow {
  id: number;
  title: string;
  minigame_id: string;
  config_json: string;
  character_id: number | null;
  pre_dialogue_id: number | null;
  post_win_dialogue_id: number | null;
  post_lose_dialogue_id: number | null;
  style_dialogues_json: string;
  required_game_ids_json: string;
  sort_order: number;
  is_tutorial: number;
}

export interface GameDto {
  id: number;
  title: string;
  minigameId: string;
  config: unknown;
  characterId: number | null;
  preDialogueId: number | null;
  postWinDialogueId: number | null;
  postLoseDialogueId: number | null;
  /** styleTag → dialogue id, used to branch the post-win dialogue on details.styleTag */
  styleDialogues: Record<string, number>;
  requiredGameIds: number[];
  sortOrder: number;
  isTutorial: boolean;
}

export interface GameInput {
  title?: string;
  minigameId?: string;
  config?: unknown;
  characterId?: number | null;
  preDialogueId?: number | null;
  postWinDialogueId?: number | null;
  postLoseDialogueId?: number | null;
  styleDialogues?: Record<string, number>;
  requiredGameIds?: number[];
  sortOrder?: number;
  isTutorial?: boolean;
}

function parse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function rowToDto(row: GameRow): GameDto {
  return {
    id: row.id,
    title: row.title,
    minigameId: row.minigame_id,
    config: parse<unknown>(row.config_json, {}),
    characterId: row.character_id,
    preDialogueId: row.pre_dialogue_id,
    postWinDialogueId: row.post_win_dialogue_id,
    postLoseDialogueId: row.post_lose_dialogue_id,
    styleDialogues: parse<Record<string, number>>(row.style_dialogues_json, {}),
    requiredGameIds: parse<number[]>(row.required_game_ids_json, []),
    sortOrder: row.sort_order,
    isTutorial: row.is_tutorial !== 0,
  };
}

/** Only the columns explicitly present in `input` — lets create fall back to SQL defaults
 *  and lets update set a column to NULL without an "omitted vs null" flag column dance. */
function toColumns(input: GameInput): [string, unknown][] {
  const out: [string, unknown][] = [];
  const push = (col: string, value: unknown) => out.push([col, value]);
  if (input.title !== undefined) push('title', input.title);
  if (input.minigameId !== undefined) push('minigame_id', input.minigameId);
  if (input.config !== undefined) push('config_json', JSON.stringify(input.config));
  if (input.characterId !== undefined) push('character_id', input.characterId);
  if (input.preDialogueId !== undefined) push('pre_dialogue_id', input.preDialogueId);
  if (input.postWinDialogueId !== undefined) push('post_win_dialogue_id', input.postWinDialogueId);
  if (input.postLoseDialogueId !== undefined)
    push('post_lose_dialogue_id', input.postLoseDialogueId);
  if (input.styleDialogues !== undefined)
    push('style_dialogues_json', JSON.stringify(input.styleDialogues));
  if (input.requiredGameIds !== undefined)
    push('required_game_ids_json', JSON.stringify(input.requiredGameIds));
  if (input.sortOrder !== undefined) push('sort_order', input.sortOrder);
  if (input.isTutorial !== undefined) push('is_tutorial', input.isTutorial ? 1 : 0);
  return out;
}

// ---------------------------------------------------------------------------
// Repo functions
// ---------------------------------------------------------------------------

export function listGames(db: Database): GameDto[] {
  const rows = db.prepare('SELECT * FROM games ORDER BY sort_order, id').all() as GameRow[];
  return rows.map(rowToDto);
}

export function getGame(db: Database, id: number): GameDto | null {
  const row = db.prepare('SELECT * FROM games WHERE id = ?').get(id) as GameRow | undefined;
  return row ? rowToDto(row) : null;
}

export function createGame(db: Database, input: GameInput & { title: string; minigameId: string }): GameDto {
  const cols = toColumns(input);
  const info = db
    .prepare(
      `INSERT INTO games (${cols.map((c) => c[0]).join(', ')})
       VALUES (${cols.map(() => '?').join(', ')})`,
    )
    .run(...cols.map((c) => c[1] as string | number | null));
  return getGame(db, Number(info.lastInsertRowid))!;
}

export function updateGame(db: Database, id: number, input: GameInput): GameDto | null {
  const cols = toColumns(input);
  if (cols.length > 0) {
    const result = db
      .prepare(`UPDATE games SET ${cols.map((c) => `${c[0]} = ?`).join(', ')} WHERE id = ?`)
      .run(...cols.map((c) => c[1] as string | number | null), id);
    if (result.changes === 0) return null;
  }
  return getGame(db, id);
}

/** Deletes the game and drops it from every other game's unlock requirements,
 *  so nothing stays permanently locked behind a game that no longer exists. */
export function deleteGame(db: Database, id: number): boolean {
  let deleted = false;
  db.transaction(() => {
    deleted = db.prepare('DELETE FROM games WHERE id = ?').run(id).changes > 0;
    if (!deleted) return;
    const update = db.prepare('UPDATE games SET required_game_ids_json = ? WHERE id = ?');
    for (const game of listGames(db)) {
      if (!game.requiredGameIds.includes(id)) continue;
      update.run(JSON.stringify(game.requiredGameIds.filter((r) => r !== id)), game.id);
    }
  })();
  return deleted;
}
