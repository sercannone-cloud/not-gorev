// Testler için better-sqlite3 tabanlı Db bağdaştırıcısı ve ayarlanabilir saat.
import Database from 'better-sqlite3';
import { Db, Param } from '../src/db/Db';
import { Repo } from '../src/db/repo';

export function memoryDb(file = ':memory:'): { db: Db; raw: Database.Database } {
  const raw = new Database(file);
  raw.pragma('foreign_keys = ON');
  let depth = 0;
  const db: Db = {
    exec: async (sql) => {
      raw.exec(sql);
    },
    run: async (sql, params: Param[] = []) => {
      const r = raw.prepare(sql).run(...params);
      return { changes: r.changes, lastInsertRowId: Number(r.lastInsertRowid) };
    },
    all: async <T,>(sql: string, params: Param[] = []) => raw.prepare(sql).all(...params) as T[],
    get: async <T,>(sql: string, params: Param[] = []) => {
      const stmt = raw.prepare(sql);
      const row = stmt.reader ? stmt.get(...params) : (stmt.run(...params), undefined);
      return (row as T) ?? null;
    },
    transaction: async <T,>(fn: (db: Db) => Promise<T>) => {
      if (depth > 0) return fn(db);
      depth++;
      raw.exec('BEGIN IMMEDIATE');
      try {
        const r = await fn(db);
        raw.exec('COMMIT');
        return r;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
  };
  return { db, raw };
}

export class Clock {
  constructor(public current: Date) {}
  now = () => this.current;
  /** İstanbul saatiyle verilen güne ve saate ayarla (UTC+3). */
  set(day: string, hhmm = '10:00') {
    this.current = new Date(`${day}T${hhmm}:00+03:00`);
  }
  tick(ms = 1000) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export async function makeRepo(day = '2026-11-09', file?: string) {
  const clock = new Clock(new Date(`${day}T10:00:00+03:00`));
  const { db, raw } = memoryDb(file);
  const repo = new Repo(db, { now: () => { clock.tick(1); return clock.current; } });
  await repo.init();
  return { repo, clock, raw, db };
}
