// SQLite şeması ve sürüm yükseltmeleri. Her sürüm yalnızca bir kez çalışır
// (PRAGMA user_version ile izlenir).

export const MIGRATIONS: string[] = [
  // 1: ilk sürüm
  `
  CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    area TEXT NOT NULL CHECK (area IN ('is','ozel')),
    name TEXT NOT NULL,
    name_norm TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    archived_at TEXT,
    UNIQUE (area, name)
  );

  CREATE TABLE recurrences (
    id TEXT PRIMARY KEY,
    area TEXT NOT NULL CHECK (area IN ('is','ozel')),
    category_id INTEGER REFERENCES categories(id),
    title TEXT NOT NULL,
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start_date TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE records (
    id TEXT PRIMARY KEY,
    area TEXT NOT NULL CHECK (area IN ('is','ozel')),
    category_id INTEGER REFERENCES categories(id),   -- NULL = Sınıflandırılacak
    kind TEXT NOT NULL CHECK (kind IN ('task','note')),
    title TEXT NOT NULL,
    title_norm TEXT NOT NULL,
    status TEXT CHECK (status IN ('open','waiting','done')), -- bağımsız notta NULL
    next_step TEXT,
    follow_up_date TEXT,                             -- 'YYYY-MM-DD', yalnız gün
    recurrence_id TEXT REFERENCES recurrences(id),
    week_start TEXT,                                 -- tekrarın haftası (pazartesi)
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    deleted_at TEXT,                                 -- dolu ise çöp kutusunda
    version INTEGER NOT NULL DEFAULT 1,              -- geri alma çakışma kontrolü
    UNIQUE (recurrence_id, week_start)               -- aynı seri ve hafta için tek örnek
  );
  CREATE INDEX records_area_status ON records (area, status, deleted_at);
  CREATE INDEX records_follow_up ON records (follow_up_date);

  CREATE TABLE entries (
    id TEXT PRIMARY KEY,
    record_id TEXT NOT NULL REFERENCES records(id),
    body TEXT NOT NULL,
    body_norm TEXT NOT NULL,
    entry_type TEXT NOT NULL CHECK (entry_type IN ('progress','next_step','closing')),
    source TEXT NOT NULL CHECK (source IN ('voice','text','button')),
    created_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX entries_record ON entries (record_id, created_at);

  -- Her gönderimin kimliği: aynı gönderim ikinci kez işlenmez.
  CREATE TABLE submissions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );

  CREATE TABLE history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id TEXT NOT NULL REFERENCES records(id),
    action TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('voice','text','button')),
    detail TEXT,
    before_json TEXT,
    after_json TEXT,
    entry_id TEXT,
    version_after INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    undone_at TEXT
  );
  CREATE INDEX history_record ON history (record_id, created_at);
  `,
  // 2: önem derecesi ve tamamlanma tarihine göre listeleme
  `
  ALTER TABLE records ADD COLUMN priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 4);
  CREATE INDEX records_completed ON records (area, completed_at);
  `,
];
