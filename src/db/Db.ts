// Uygulamanın kullandığı küçük veritabanı arayüzü. Telefonda expo-sqlite,
// testlerde better-sqlite3 bu arayüzün arkasında çalışır.

export type Param = string | number | null;

export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: Param[]): Promise<{ changes: number; lastInsertRowId: number }>;
  all<T>(sql: string, params?: Param[]): Promise<T[]>;
  get<T>(sql: string, params?: Param[]): Promise<T | null>;
  /** İşlevi tek bir işlem (transaction) içinde çalıştırır; hata olursa geri sarar. */
  transaction<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

/** İşlemleri sıraya koyan yardımcı: aynı anda tek bir veritabanı işi çalışır. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(job: () => Promise<T>): Promise<T> {
    const result = this.tail.then(job, job);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
