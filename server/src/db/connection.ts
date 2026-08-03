import Database from 'better-sqlite3';
import { paths } from '../config.js';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = openDb(paths.db());
  }
  return db;
}

export function openDb(file: string): Database.Database {
  const conn = new Database(file);
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  conn.pragma('synchronous = NORMAL');
  return conn;
}

export function closeDb(): void {
  db?.close();
  db = null;
}
