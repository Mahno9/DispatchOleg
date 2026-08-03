import type { Database } from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Row / DTO types
// ---------------------------------------------------------------------------

interface MetaStageRow {
  id: number;
  title: string;
  sort_order: number;
  background_json: string;
  characters_json: string;
  trigger_json: string;
}

export interface MetaStageBackground {
  image?: string;
  fit?: 'cover' | 'contain' | 'fill-x' | 'fill-y' | 'center' | 'tile';
  scale?: number;
  offset?: { x: number; y: number };
}

export interface MetaStageCharacter {
  characterId: number;
  x: number;
  y: number;
  scale?: number;
  dialogueId?: number | null;
}

export type MetaStageTrigger =
  | { type: 'wonCount'; value: number }
  | { type: 'games'; ids: number[] };

export interface MetaStageDto {
  id: number;
  title: string;
  sortOrder: number;
  background: MetaStageBackground;
  characters: MetaStageCharacter[];
  trigger: MetaStageTrigger;
}

export interface MetaStageInput {
  title?: string;
  sortOrder?: number;
  background?: MetaStageBackground;
  characters?: MetaStageCharacter[];
  trigger?: MetaStageTrigger;
}

function parse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function rowToDto(row: MetaStageRow): MetaStageDto {
  return {
    id: row.id,
    title: row.title,
    sortOrder: row.sort_order,
    background: parse<MetaStageBackground>(row.background_json, {}),
    characters: parse<MetaStageCharacter[]>(row.characters_json, []),
    trigger: parse<MetaStageTrigger>(row.trigger_json, { type: 'wonCount', value: 0 }),
  };
}

/** Only the columns explicitly present in `input` — lets create fall back to SQL defaults
 *  and lets update set a column to NULL without an "omitted vs null" flag column dance. */
function toColumns(input: MetaStageInput): [string, unknown][] {
  const out: [string, unknown][] = [];
  const push = (col: string, value: unknown) => out.push([col, value]);
  if (input.title !== undefined) push('title', input.title);
  if (input.sortOrder !== undefined) push('sort_order', input.sortOrder);
  if (input.background !== undefined) push('background_json', JSON.stringify(input.background));
  if (input.characters !== undefined) push('characters_json', JSON.stringify(input.characters));
  if (input.trigger !== undefined) push('trigger_json', JSON.stringify(input.trigger));
  return out;
}

// ---------------------------------------------------------------------------
// Repo functions
// ---------------------------------------------------------------------------

export function listMetaStages(db: Database): MetaStageDto[] {
  const rows = db
    .prepare('SELECT * FROM meta_stages ORDER BY sort_order, id')
    .all() as MetaStageRow[];
  return rows.map(rowToDto);
}

export function getMetaStage(db: Database, id: number): MetaStageDto | null {
  const row = db.prepare('SELECT * FROM meta_stages WHERE id = ?').get(id) as
    | MetaStageRow
    | undefined;
  return row ? rowToDto(row) : null;
}

export function createMetaStage(db: Database, input: MetaStageInput): MetaStageDto {
  const cols = toColumns(input);
  // Unlike characters/games there is no required field, so `input` may be
  // empty — fall back to DEFAULT VALUES rather than emitting `() VALUES ()`.
  const info =
    cols.length > 0
      ? db
          .prepare(
            `INSERT INTO meta_stages (${cols.map((c) => c[0]).join(', ')})
             VALUES (${cols.map(() => '?').join(', ')})`,
          )
          .run(...cols.map((c) => c[1] as string | number | null))
      : db.prepare('INSERT INTO meta_stages DEFAULT VALUES').run();
  return getMetaStage(db, Number(info.lastInsertRowid))!;
}

export function updateMetaStage(
  db: Database,
  id: number,
  input: MetaStageInput,
): MetaStageDto | null {
  const cols = toColumns(input);
  if (cols.length > 0) {
    const result = db
      .prepare(`UPDATE meta_stages SET ${cols.map((c) => `${c[0]} = ?`).join(', ')} WHERE id = ?`)
      .run(...cols.map((c) => c[1] as string | number | null), id);
    if (result.changes === 0) return null;
  }
  return getMetaStage(db, id);
}

export function deleteMetaStage(db: Database, id: number): boolean {
  return db.prepare('DELETE FROM meta_stages WHERE id = ?').run(id).changes > 0;
}
