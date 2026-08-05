import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from '../db/migrate.js';
import { createDialogue, dialogueUsage, deleteDialogue } from './dialogues.js';
import { createGame, getGame } from './games.js';
import { createCharacter, getCharacter } from './characters.js';
import { createMetaStage, getMetaStage } from './metaStages.js';

/** foreign_keys как в openDb: без него ON DELETE SET NULL не сработает. */
function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations'));
  return db;
}

/** Диалог, на который ссылаются все пять способов сразу. */
function seed(db: Database.Database) {
  const dialogue = createDialogue(db, 'Ночная смена', {});
  const other = createDialogue(db, 'Посторонний', {});
  const character = createCharacter(db, { name: 'Фантом', metaDialogueId: dialogue.id });
  const game = createGame(db, {
    title: 'Три уровня подземки',
    minigameId: 'three-mazes',
    preDialogueId: dialogue.id,
    postWinDialogueId: other.id,
    postLoseDialogueId: dialogue.id,
    styleDialogues: { ghost: dialogue.id, breaker: other.id },
  });
  const stage = createMetaStage(db, {
    title: 'Крыша',
    characters: [
      { characterId: character.id, x: 10, y: 20, dialogueId: dialogue.id },
      { characterId: character.id, x: 30, y: 40, dialogueId: other.id },
    ],
  });
  return { dialogue, other, character, game, stage };
}

describe('dialogueUsage', () => {
  it('finds every reference: game columns, style tags, character and meta stage', () => {
    const db = freshDb();
    const { dialogue, game, character, stage } = seed(db);

    expect(dialogueUsage(db, dialogue.id)).toEqual([
      { kind: 'game', id: game.id, title: game.title, field: 'диалог перед игрой' },
      { kind: 'game', id: game.id, title: game.title, field: 'диалог после поражения' },
      { kind: 'game', id: game.id, title: game.title, field: 'стилевой диалог «ghost»' },
      { kind: 'character', id: character.id, title: 'Фантом', field: 'мета-диалог персонажа' },
      {
        kind: 'metaStage',
        id: stage.id,
        title: 'Крыша',
        field: `персонаж #${character.id} на мете`,
      },
    ]);
  });

  it('is empty for an unused dialogue', () => {
    const db = freshDb();
    expect(dialogueUsage(db, createDialogue(db, 'Никем не нужный', {}).id)).toEqual([]);
  });
});

describe('deleteDialogue', () => {
  it('drops every reference and leaves the others alone', () => {
    const db = freshDb();
    const { dialogue, other, character, game, stage } = seed(db);

    expect(deleteDialogue(db, dialogue.id)).toBe(true);
    expect(dialogueUsage(db, dialogue.id)).toEqual([]);

    expect(getGame(db, game.id)).toMatchObject({
      preDialogueId: null,
      postLoseDialogueId: null,
      postWinDialogueId: other.id, // чужая ссылка не пострадала
      styleDialogues: { breaker: other.id },
    });
    expect(getCharacter(db, character.id)).toMatchObject({ metaDialogueId: null });
    expect(getMetaStage(db, stage.id)!.characters).toEqual([
      { characterId: character.id, x: 10, y: 20, dialogueId: null },
      { characterId: character.id, x: 30, y: 40, dialogueId: other.id },
    ]);
  });

  it('reports a missing dialogue', () => {
    expect(deleteDialogue(freshDb(), 999)).toBe(false);
  });
});
