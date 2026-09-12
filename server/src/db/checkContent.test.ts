import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Скрипт лежит вне tsconfig сервера и тестируется как CLI: гоняем его на
// подсунутом CONTENT_DIR и смотрим на код возврата и текст ошибки.
const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', '..', '..', 'scripts', 'check-content.mjs');
const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

type GameRow = Record<string, unknown>;

/** Минимальная игра: проверки ссылок на персонажей и диалоги её пропускают. */
function game(id: number, over: GameRow = {}): GameRow {
  return {
    id,
    title: `Игра ${id}`,
    minigame_id: 'noop',
    config_json: {},
    character_id: null,
    pre_dialogue_id: null,
    post_win_dialogue_id: null,
    post_lose_dialogue_id: null,
    style_dialogues_json: {},
    required_game_ids_json: [],
    sort_order: id * 10,
    is_tutorial: 0,
    is_finale: 0,
    ...over,
  };
}

/** Выгрузка из одних игр (+ пустые остальные таблицы) и прогон скрипта по ней. */
function run(games: GameRow[], stages: GameRow[] = []): { code: number; out: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-content-'));
  tmpDirs.push(dir);
  const write = (f: string, data: unknown) =>
    fs.writeFileSync(path.join(dir, f), JSON.stringify(data, null, 2), 'utf8');
  write('games.json', games);
  write('characters.json', []);
  write('assets.json', []);
  write('meta-stages.json', stages);
  write('settings.json', []);
  fs.mkdirSync(path.join(dir, 'dialogues'));
  fs.mkdirSync(path.join(dir, 'assets'));

  try {
    const out = execFileSync(process.execPath, [script, '--content'], {
      env: { ...process.env, CONTENT_DIR: dir },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, out: err.stdout + err.stderr };
  }
}

describe('check-content: финал смены', () => {
  it('пропускает выгрузку с одним корректным финалом', () => {
    expect(run([game(1, { is_tutorial: 1 }), game(2), game(3, { is_finale: 1 })]).code).toBe(0);
  });

  it('ругается на два финала', () => {
    const r = run([game(1, { is_finale: 1 }), game(2, { is_finale: 1 })]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('финалом смены помечено несколько игр');
  });

  it('ругается на игру, которая разом обучалка и финал', () => {
    const r = run([game(1, { is_tutorial: 1, is_finale: 1 })]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('помечена и обучалкой, и финалом смены');
  });

  it('ругается на предусловия у самого финала', () => {
    const r = run([game(1), game(2, { is_finale: 1, required_game_ids_json: [1] })]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('у финала смены не должно быть requiredGameIds');
  });

  it('ругается на игру, открывающуюся после финала', () => {
    const r = run([game(1, { is_finale: 1 }), game(2, { required_game_ids_json: [1] })]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('ждёт финала смены #1');
  });

  it('разрешает триггеру меты ждать финала — «После смены» на том и держится', () => {
    const stage = {
      id: 1,
      title: 'После смены',
      background_json: {},
      characters_json: [],
      trigger_json: { type: 'games', ids: [1, 2] },
      sort_order: 0,
    };
    expect(run([game(1), game(2, { is_finale: 1 })], [stage]).code).toBe(0);
  });
});
