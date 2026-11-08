import * as SQLite from 'expo-sqlite';
import { Db, Param, SerialQueue } from './Db';

type Raw = SQLite.SQLiteDatabase;

function direct(raw: Raw, inTx: (fn: (db: Db) => Promise<unknown>) => Promise<unknown>): Db {
  const db: Db = {
    exec: (sql) => raw.execAsync(sql),
    run: async (sql, params: Param[] = []) => {
      const r = await raw.runAsync(sql, params);
      return { changes: r.changes, lastInsertRowId: r.lastInsertRowId };
    },
    all: <T,>(sql: string, params: Param[] = []) => raw.getAllAsync<T>(sql, params),
    get: <T,>(sql: string, params: Param[] = []) => raw.getFirstAsync<T>(sql, params),
    transaction: <T,>(fn: (db: Db) => Promise<T>) => inTx(fn as (db: Db) => Promise<unknown>) as Promise<T>,
  };
  return db;
}

/** expo-sqlite bağdaştırıcısı: tüm işler sıraya alınır, böylece işlemler iç içe geçmez. */
export async function openExpoDb(name = 'not-gorev.db'): Promise<Db> {
  const raw = await SQLite.openDatabaseAsync(name);
  await raw.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const queue = new SerialQueue();

  // İşlem içindeki çağrılar zaten kuyruğun içinde çalışır; iç içe işlem, dıştakine katılır.
  const inner: Db = direct(raw, (fn) => fn(inner));

  const runTx = <T,>(fn: (db: Db) => Promise<T>) =>
    queue.run(async () => {
      await raw.execAsync('BEGIN IMMEDIATE');
      try {
        const result = await fn(inner);
        await raw.execAsync('COMMIT');
        return result;
      } catch (e) {
        await raw.execAsync('ROLLBACK');
        throw e;
      }
    });

  return {
    exec: (sql) => queue.run(() => inner.exec(sql)),
    run: (sql, params) => queue.run(() => inner.run(sql, params)),
    all: <T,>(sql: string, params?: Param[]) => queue.run(() => inner.all<T>(sql, params)),
    get: <T,>(sql: string, params?: Param[]) => queue.run(() => inner.get<T>(sql, params)),
    transaction: runTx,
  };
}
