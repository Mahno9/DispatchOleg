import type { Database } from 'better-sqlite3';

interface CharacterRow {
  id: number;
  name: string;
  portrait_asset: string | null;
  meta_dialogue_id: number | null;
  meta_position: string;
  description: string;
}

export interface CharacterDto {
  id: number;
  name: string;
  portraitAsset: string | null;
  /** Set → the character stands on the meta screen and is clickable */
  metaDialogueId: number | null;
  metaPosition: string;
  /** Сводка для игрока: показывается по наведению на портрет. Пустая — не показывается. */
  description: string;
}

export interface CharacterInput {
  name?: string;
  portraitAsset?: string | null;
  metaDialogueId?: number | null;
  metaPosition?: string;
  description?: string;
}

function rowToDto(row: CharacterRow): CharacterDto {
  return {
    id: row.id,
    name: row.name,
    portraitAsset: row.portrait_asset,
    metaDialogueId: row.meta_dialogue_id,
    metaPosition: row.meta_position,
    description: row.description,
  };
}

function toColumns(input: CharacterInput): [string, unknown][] {
  const out: [string, unknown][] = [];
  if (input.name !== undefined) out.push(['name', input.name]);
  if (input.portraitAsset !== undefined) out.push(['portrait_asset', input.portraitAsset]);
  if (input.metaDialogueId !== undefined) out.push(['meta_dialogue_id', input.metaDialogueId]);
  if (input.metaPosition !== undefined) out.push(['meta_position', input.metaPosition]);
  if (input.description !== undefined) out.push(['description', input.description]);
  return out;
}

export function listCharacters(db: Database): CharacterDto[] {
  const rows = db.prepare('SELECT * FROM characters ORDER BY id').all() as CharacterRow[];
  return rows.map(rowToDto);
}

export function getCharacter(db: Database, id: number): CharacterDto | null {
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(id) as
    | CharacterRow
    | undefined;
  return row ? rowToDto(row) : null;
}

export function createCharacter(
  db: Database,
  input: CharacterInput & { name: string },
): CharacterDto {
  const cols = toColumns(input);
  const info = db
    .prepare(
      `INSERT INTO characters (${cols.map((c) => c[0]).join(', ')})
       VALUES (${cols.map(() => '?').join(', ')})`,
    )
    .run(...cols.map((c) => c[1] as string | number | null));
  return getCharacter(db, Number(info.lastInsertRowid))!;
}

export function updateCharacter(
  db: Database,
  id: number,
  input: CharacterInput,
): CharacterDto | null {
  const cols = toColumns(input);
  if (cols.length > 0) {
    const result = db
      .prepare(`UPDATE characters SET ${cols.map((c) => `${c[0]} = ?`).join(', ')} WHERE id = ?`)
      .run(...cols.map((c) => c[1] as string | number | null), id);
    if (result.changes === 0) return null;
  }
  return getCharacter(db, id);
}

export function deleteCharacter(db: Database, id: number): boolean {
  return db.prepare('DELETE FROM characters WHERE id = ?').run(id).changes > 0;
}
