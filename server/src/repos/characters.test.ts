import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from '../db/migrate.js';
import { createCharacter, getCharacter, listCharacters, updateCharacter } from './characters.js';

function freshDb() {
  const db = new Database(':memory:');
  migrate(db, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations'));
  return db;
}

describe('character description', () => {
  it('round-trips through create and list', () => {
    const db = freshDb();
    const created = createCharacter(db, {
      name: 'Замзам',
      description: 'Не выезжает. Уточняет формулировки.',
    });
    expect(created.description).toBe('Не выезжает. Уточняет формулировки.');
    expect(getCharacter(db, created.id)?.description).toBe(created.description);
    expect(listCharacters(db)[0].description).toBe(created.description);
  });

  it('defaults to an empty string when not given', () => {
    // Персонажи, заведённые до миграции 0003, читаются как «без описания», а не как null.
    const db = freshDb();
    const created = createCharacter(db, { name: 'Просто Гален' });
    expect(created.description).toBe('');
  });

  it('updates on its own without touching the other fields', () => {
    const db = freshDb();
    const created = createCharacter(db, {
      name: 'Громила Жёсткий',
      portraitAsset: '/assets-store/x.svg',
      metaPosition: 'right',
      description: 'Суперсила.',
    });

    const updated = updateCharacter(db, created.id, { description: 'Извиняется больше, чем воюет.' });
    expect(updated).toMatchObject({
      name: 'Громила Жёсткий',
      portraitAsset: '/assets-store/x.svg',
      metaPosition: 'right',
      description: 'Извиняется больше, чем воюет.',
    });

    // И наоборот: правка соседнего поля не стирает описание.
    expect(updateCharacter(db, created.id, { metaPosition: 'left' })?.description).toBe(
      'Извиняется больше, чем воюет.',
    );
  });
});
