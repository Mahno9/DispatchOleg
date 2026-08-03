import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from '../db/migrate.js';
import {
  createMetaStage,
  deleteMetaStage,
  getMetaStage,
  listMetaStages,
  updateMetaStage,
} from './metaStages.js';
import { getAllSettings } from './settings.js';

function freshDb() {
  const db = new Database(':memory:');
  migrate(db, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations'));
  return db;
}

describe('migration 0002_meta', () => {
  it('applies and creates the meta_stages table plus the final_victory_text setting', () => {
    const db = new Database(':memory:');
    const migrationsDir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'db',
      'migrations',
    );
    const ran = migrate(db, migrationsDir);
    expect(ran).toContain('0002_meta.sql');

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain('meta_stages');

    const settings = getAllSettings(db);
    expect(settings.final_victory_text).toBe(
      'ВСЕ ОПЕРАЦИИ ЗАВЕРШЕНЫ. СМЕНА ЗАКРЫТА. СПАСИБО, ОПЕРАТОР.',
    );
  });

  it('is idempotent on re-run', () => {
    const db = new Database(':memory:');
    const migrationsDir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'db',
      'migrations',
    );
    migrate(db, migrationsDir);
    const second = migrate(db, migrationsDir);
    expect(second).toEqual([]);
  });
});

describe('metaStages repo', () => {
  it('creates stages with defaults and lists them ordered by sortOrder', () => {
    const db = freshDb();
    createMetaStage(db, { title: 'Third', sortOrder: 3 });
    createMetaStage(db, { title: 'First', sortOrder: 1 });
    createMetaStage(db, { title: 'Second', sortOrder: 2 });

    const stages = listMetaStages(db);
    expect(stages.map((s) => s.title)).toEqual(['First', 'Second', 'Third']);
    expect(stages.map((s) => s.sortOrder)).toEqual([1, 2, 3]);
  });

  it('defaults background/characters/trigger when omitted', () => {
    const db = freshDb();
    const stage = createMetaStage(db, {});
    expect(stage.title).toBe('');
    expect(stage.sortOrder).toBe(0);
    expect(stage.background).toEqual({});
    expect(stage.characters).toEqual([]);
    expect(stage.trigger).toEqual({ type: 'wonCount', value: 0 });
  });

  it('round-trips background/characters/trigger JSON', () => {
    const db = freshDb();
    const background = { image: '/assets-store/bg.png', fit: 'cover' as const, scale: 1.5, offset: { x: 10, y: -5 } };
    const characters = [
      { characterId: 1, x: 0.2, y: 0.5, scale: 1, dialogueId: 7 },
      { characterId: 2, x: 0.8, y: 0.5, dialogueId: null },
    ];
    const trigger = { type: 'games' as const, ids: [1, 2, 3] };

    const created = createMetaStage(db, { title: 'Stage', background, characters, trigger });
    expect(created.background).toEqual(background);
    expect(created.characters).toEqual(characters);
    expect(created.trigger).toEqual(trigger);

    const fetched = getMetaStage(db, created.id);
    expect(fetched).toEqual(created);
  });

  it('applies a partial update, leaving other fields untouched', () => {
    const db = freshDb();
    const created = createMetaStage(db, {
      title: 'Original',
      sortOrder: 5,
      trigger: { type: 'wonCount', value: 2 },
    });

    const updated = updateMetaStage(db, created.id, { title: 'Renamed' });
    expect(updated).toMatchObject({
      title: 'Renamed',
      sortOrder: 5,
      trigger: { type: 'wonCount', value: 2 },
    });

    const updatedTrigger = updateMetaStage(db, created.id, {
      trigger: { type: 'games', ids: [9] },
    });
    expect(updatedTrigger).toMatchObject({
      title: 'Renamed',
      trigger: { type: 'games', ids: [9] },
    });
  });

  it('returns null from update/get for a missing id', () => {
    const db = freshDb();
    expect(getMetaStage(db, 999)).toBeNull();
    expect(updateMetaStage(db, 999, { title: 'x' })).toBeNull();
  });

  it('falls back leniently when JSON columns are corrupt', () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO meta_stages (title, sort_order, background_json, characters_json, trigger_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('Corrupt', 0, 'not json', 'also not json {', '{broken');

    const stage = getMetaStage(db, 1);
    expect(stage).not.toBeNull();
    expect(stage!.background).toEqual({});
    expect(stage!.characters).toEqual([]);
    expect(stage!.trigger).toEqual({ type: 'wonCount', value: 0 });
  });

  it('deletes a stage', () => {
    const db = freshDb();
    const created = createMetaStage(db, { title: 'ToDelete' });
    expect(deleteMetaStage(db, created.id)).toBe(true);
    expect(getMetaStage(db, created.id)).toBeNull();
    expect(deleteMetaStage(db, created.id)).toBe(false);
  });
});
