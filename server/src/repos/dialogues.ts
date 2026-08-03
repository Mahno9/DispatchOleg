import type { Database } from 'better-sqlite3';

interface DialogueRow {
  id: number;
  title: string;
  nodes_json: string;
}

/** { start: 'n1', nodes: { n1: { speaker, side, text, next, choices } } } — validated client-side. */
export interface DialogueDto {
  id: number;
  title: string;
  nodes: unknown;
}

export function listDialogues(db: Database): { id: number; title: string }[] {
  return db.prepare('SELECT id, title FROM dialogues ORDER BY id').all() as {
    id: number;
    title: string;
  }[];
}

export function getDialogue(db: Database, id: number): DialogueDto | null {
  const row = db.prepare('SELECT * FROM dialogues WHERE id = ?').get(id) as DialogueRow | undefined;
  if (!row) return null;
  let nodes: unknown = {};
  try {
    nodes = JSON.parse(row.nodes_json);
  } catch {
    // malformed JSON in the DB → empty dialogue rather than a 500
  }
  return { id: row.id, title: row.title, nodes };
}

export function createDialogue(db: Database, title: string, nodes: unknown): DialogueDto {
  const info = db
    .prepare('INSERT INTO dialogues (title, nodes_json) VALUES (?, ?)')
    .run(title, JSON.stringify(nodes ?? {}));
  return getDialogue(db, Number(info.lastInsertRowid))!;
}

export function updateDialogue(
  db: Database,
  id: number,
  input: { title?: string; nodes?: unknown },
): DialogueDto | null {
  const cols: [string, string][] = [];
  if (input.title !== undefined) cols.push(['title', input.title]);
  if (input.nodes !== undefined) cols.push(['nodes_json', JSON.stringify(input.nodes)]);
  if (cols.length > 0) {
    const result = db
      .prepare(`UPDATE dialogues SET ${cols.map((c) => `${c[0]} = ?`).join(', ')} WHERE id = ?`)
      .run(...cols.map((c) => c[1]), id);
    if (result.changes === 0) return null;
  }
  return getDialogue(db, id);
}

export function deleteDialogue(db: Database, id: number): boolean {
  return db.prepare('DELETE FROM dialogues WHERE id = ?').run(id).changes > 0;
}
