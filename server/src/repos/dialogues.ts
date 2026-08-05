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

/** Одна точка использования диалога — админка показывает их перед удалением. */
export interface DialogueUsage {
  kind: 'game' | 'character' | 'metaStage';
  id: number;
  title: string;
  /** Человекочитаемое место ссылки: «диалог перед игрой», «стилевой диалог «ghost»». */
  field: string;
}

function parse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
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
  // malformed JSON in the DB → empty dialogue rather than a 500
  return { id: row.id, title: row.title, nodes: parse<unknown>(row.nodes_json, {}) };
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

/** Колонки games со ссылкой на диалог и их подписи для админки. */
const GAME_DIALOGUE_COLS: Record<string, string> = {
  pre_dialogue_id: 'диалог перед игрой',
  post_win_dialogue_id: 'диалог после победы',
  post_lose_dialogue_id: 'диалог после поражения',
};

interface GameRefRow {
  id: number;
  title: string;
  pre_dialogue_id: number | null;
  post_win_dialogue_id: number | null;
  post_lose_dialogue_id: number | null;
  style_dialogues_json: string;
}

interface StageRefRow {
  id: number;
  title: string;
  characters_json: string;
}

/**
 * Кто ссылается на диалог. Пять точек: три колонки игры, её стилевые диалоги,
 * мета-диалог персонажа и диалог персонажа на этапе меты
 * (docs/dialogue-system.md §5 «Где живут ссылки на диалоги»).
 */
export function dialogueUsage(db: Database, id: number): DialogueUsage[] {
  const usage: DialogueUsage[] = [];

  for (const game of db.prepare('SELECT * FROM games ORDER BY id').all() as GameRefRow[]) {
    const where = { kind: 'game' as const, id: game.id, title: game.title };
    for (const [col, field] of Object.entries(GAME_DIALOGUE_COLS)) {
      if (game[col as keyof GameRefRow] === id) usage.push({ ...where, field });
    }
    const styles = parse<Record<string, number>>(game.style_dialogues_json, {});
    for (const [tag, dialogueId] of Object.entries(styles)) {
      if (dialogueId === id) usage.push({ ...where, field: `стилевой диалог «${tag}»` });
    }
  }

  const characters = db
    .prepare('SELECT id, name FROM characters WHERE meta_dialogue_id = ? ORDER BY id')
    .all(id) as { id: number; name: string }[];
  for (const character of characters) {
    usage.push({
      kind: 'character',
      id: character.id,
      title: character.name,
      field: 'мета-диалог персонажа',
    });
  }

  for (const stage of db.prepare('SELECT * FROM meta_stages ORDER BY id').all() as StageRefRow[]) {
    const placed = parse<{ characterId: number; dialogueId?: number | null }[]>(
      stage.characters_json,
      [],
    );
    for (const character of placed) {
      if (character.dialogueId !== id) continue;
      usage.push({
        kind: 'metaStage',
        id: stage.id,
        title: stage.title,
        field: `персонаж #${character.characterId} на мете`,
      });
    }
  }

  return usage;
}

/**
 * Удаляет диалог и снимает все ссылки на него. Колонки-внешние ключи гасит сама
 * SQLite (ON DELETE SET NULL), а json-ссылки — стилевые диалоги игр и диалоги
 * персонажей на мете — чистим здесь: иначе они остаются битыми и всплывают уже
 * в check-content, после выгрузки в гит (ср. deleteGame).
 */
export function deleteDialogue(db: Database, id: number): boolean {
  let deleted = false;
  db.transaction(() => {
    deleted = db.prepare('DELETE FROM dialogues WHERE id = ?').run(id).changes > 0;
    if (!deleted) return;

    const setStyles = db.prepare('UPDATE games SET style_dialogues_json = ? WHERE id = ?');
    for (const game of db
      .prepare('SELECT id, style_dialogues_json FROM games')
      .all() as GameRefRow[]) {
      const styles = parse<Record<string, number>>(game.style_dialogues_json, {});
      const kept = Object.entries(styles).filter(([, dialogueId]) => dialogueId !== id);
      if (kept.length === Object.keys(styles).length) continue;
      setStyles.run(JSON.stringify(Object.fromEntries(kept)), game.id);
    }

    const setPlaced = db.prepare('UPDATE meta_stages SET characters_json = ? WHERE id = ?');
    for (const stage of db
      .prepare('SELECT id, characters_json FROM meta_stages')
      .all() as StageRefRow[]) {
      const placed = parse<{ dialogueId?: number | null }[]>(stage.characters_json, []);
      if (!placed.some((c) => c.dialogueId === id)) continue;
      // Персонаж остаётся на сцене, просто перестаёт быть кликабельным.
      const cleaned = placed.map((c) => (c.dialogueId === id ? { ...c, dialogueId: null } : c));
      setPlaced.run(JSON.stringify(cleaned), stage.id);
    }
  })();
  return deleted;
}
