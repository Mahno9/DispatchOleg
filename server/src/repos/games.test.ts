import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from '../db/migrate.js';
import { ensureTutorialGame, listGames } from './games.js';

function freshDb() {
  const db = new Database(':memory:');
  migrate(db, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations'));
  return db;
}

describe('ensureTutorialGame', () => {
  it('seeds the tutorial once', () => {
    const db = freshDb();
    const created = ensureTutorialGame(db);
    expect(created).toMatchObject({ minigameId: 'onboarding', isTutorial: true, config: {} });

    // Second start must not add a duplicate.
    expect(ensureTutorialGame(db)).toBeNull();
    expect(listGames(db).filter((g) => g.isTutorial)).toHaveLength(1);
  });

  it('leaves an edited tutorial alone', () => {
    const db = freshDb();
    const created = ensureTutorialGame(db)!;
    db.prepare('UPDATE games SET title = ?, config_json = ? WHERE id = ?').run(
      'Вводная',
      '{"allowSkipScan":true}',
      created.id,
    );

    expect(ensureTutorialGame(db)).toBeNull();
    const games = listGames(db);
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ title: 'Вводная', config: { allowSkipScan: true } });
  });
});
