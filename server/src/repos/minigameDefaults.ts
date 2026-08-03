import type { Database } from 'better-sqlite3';

/** id → parsed default config object. Missing rows are simply absent. */
export function getAllDefaults(db: Database): Record<string, unknown> {
  const rows = db.prepare('SELECT minigame_id, config_json FROM minigame_defaults').all() as {
    minigame_id: string;
    config_json: string;
  }[];
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      out[row.minigame_id] = JSON.parse(row.config_json);
    } catch {
      out[row.minigame_id] = {};
    }
  }
  return out;
}

export function setDefaults(db: Database, id: string, config: unknown): void {
  db.prepare(
    `INSERT INTO minigame_defaults (minigame_id, config_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(minigame_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at`,
  ).run(id, JSON.stringify(config ?? {}), Date.now());
}
