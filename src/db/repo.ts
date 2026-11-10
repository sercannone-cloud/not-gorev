// Uygulama katmanının veri deposu. Tüm değişiklikler bir işlem (transaction)
// içinde yapılır, kayıt geçmişine eklenir ve geri alınabilir.

import { Db, Param } from './Db';
import { MIGRATIONS } from './schema';
import {
  Area,
  Category,
  DEFAULT_CATEGORIES,
  Entry,
  EntryType,
  HistoryAction,
  HistoryRow,
  Priority,
  PRIORITY_LABEL,
  RecordKind,
  RecordRow,
  Recurrence,
  Source,
  TaskStatus,
} from '../domain/types';
import { DayString, istanbulToday, istanbulDayStartIso, mondayOf, weekdayOf, addDays } from '../domain/dates';
import { escapeLike, firstLineTitle, searchNorm, searchTokens } from '../domain/turkish';

export interface RepoOptions {
  now?: () => Date;
  newId?: () => string;
}

/** Geri alma için saklanan alanlar. */
interface Snapshot {
  area: Area;
  category_id: number | null;
  kind: RecordKind;
  title: string;
  status: TaskStatus | null;
  priority: Priority;
  next_step: string | null;
  follow_up_date: string | null;
  completed_at: string | null;
  deleted_at: string | null;
}

const SNAPSHOT_KEYS: (keyof Snapshot)[] = [
  'area',
  'category_id',
  'kind',
  'title',
  'status',
  'priority',
  'next_step',
  'follow_up_date',
  'completed_at',
  'deleted_at',
];

export type ChangeResult =
  | { ok: true; historyId: number; record: RecordRow }
  | { ok: false; reason: string; duplicate?: boolean };

export interface TodayView {
  overdue: RecordRow[];
  today: RecordRow[];
  /** Aynı tekrar serisinin açık örnekleri: en yenisi ve geride kalanların sayısı. */
  recurring: { latest: RecordRow; olderOpen: RecordRow[] }[];
}

export interface SearchHit {
  record: RecordRow;
  entries: Entry[];
}

const RECORD_SELECT = `
  SELECT r.*, c.name AS category_name,
    (SELECT e.body FROM entries e WHERE e.record_id = r.id AND e.deleted_at IS NULL
       ORDER BY e.created_at DESC, e.rowid DESC LIMIT 1) AS last_entry_body,
    (SELECT e.created_at FROM entries e WHERE e.record_id = r.id AND e.deleted_at IS NULL
       ORDER BY e.created_at DESC, e.rowid DESC LIMIT 1) AS last_entry_at,
    (SELECT COUNT(*) FROM entries e WHERE e.record_id = r.id AND e.deleted_at IS NULL) AS entry_count
  FROM records r LEFT JOIN categories c ON c.id = r.category_id`;

// Adla verilen komutlarda eşleştirmeye katılmayan genel sözcükler (katlanmış).
const GENERIC_WORDS = new Set([
  'is', 'isi', 'isini', 'isine', 'isinin',
  'kayit', 'kaydi', 'kaydini', 'kaydina', 'kaydinin',
  'gorev', 'gorevi', 'gorevini', 'gorevine',
  'not', 'notu', 'notunu', 'notuna',
  'takip', 'tarihi', 'tarihini',
  've', 'ile', 'icin', 'olan', 'su', 'o',
]);

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** Ekli bir sözcüğün (araştırmasını) başlıktaki sözcükle (araştırması) eşleşip eşleşmediği. */
export function wordMatches(token: string, word: string): boolean {
  if (token === word) return true;
  if (word.length >= 3 && token.startsWith(word)) return true;
  if (token.length >= 3 && word.startsWith(token)) return true;
  const cp = commonPrefix(token, word);
  return cp >= Math.max(4, Math.min(token.length, word.length) - 2);
}

export function nameTokens(name: string): string[] {
  return searchTokens(name).filter((t) => !GENERIC_WORDS.has(t));
}

let idCounter = 0;
function defaultId(): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10) + '-' + idCounter.toString(36);
}

export class Repo {
  private now: () => Date;
  private newId: () => string;

  constructor(private db: Db, opts: RepoOptions = {}) {
    this.now = opts.now ?? (() => new Date());
    this.newId = opts.newId ?? defaultId;
  }

  private ts(): string {
    return this.now().toISOString();
  }

  today(): DayString {
    return istanbulToday(this.now());
  }

  // -------------------------------------------------------------------------
  // Kurulum
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    const row = await this.db.get<{ user_version: number }>('PRAGMA user_version');
    const current = row?.user_version ?? 0;
    for (let v = current; v < MIGRATIONS.length; v++) {
      await this.db.transaction(async (db) => {
        await db.exec(MIGRATIONS[v]);
        await db.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
    await this.seedCategories();
    await this.ensureRecurrences();
  }

  private async seedCategories(): Promise<void> {
    const count = await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM categories');
    if ((count?.n ?? 0) > 0) return;
    await this.db.transaction(async (db) => {
      for (const area of ['is', 'ozel'] as Area[]) {
        let i = 0;
        for (const name of DEFAULT_CATEGORIES[area]) {
          await db.run('INSERT INTO categories (area, name, name_norm, sort_order) VALUES (?,?,?,?)', [
            area,
            name,
            searchNorm(name),
            i++,
          ]);
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // Okuma
  // -------------------------------------------------------------------------

  categories(area: Area): Promise<Category[]> {
    return this.db.all<Category>(
      'SELECT id, area, name, sort_order FROM categories WHERE area = ? AND archived_at IS NULL ORDER BY sort_order, name',
      [area],
    );
  }

  async addCategory(area: Area, name: string): Promise<Category> {
    const clean = name.trim();
    const existing = await this.db.get<Category>('SELECT id, area, name, sort_order FROM categories WHERE area = ? AND name = ?', [area, clean]);
    if (existing) return existing;
    const max = await this.db.get<{ m: number }>('SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories WHERE area = ?', [area]);
    const r = await this.db.run('INSERT INTO categories (area, name, name_norm, sort_order) VALUES (?,?,?,?)', [
      area,
      clean,
      searchNorm(clean),
      (max?.m ?? 0) + 1,
    ]);
    return { id: r.lastInsertRowId, area, name: clean, sort_order: (max?.m ?? 0) + 1 };
  }

  getRecord(id: string, db: Db = this.db): Promise<RecordRow | null> {
    return db.get<RecordRow>(`${RECORD_SELECT} WHERE r.id = ?`, [id]);
  }

  entries(recordId: string): Promise<Entry[]> {
    return this.db.all<Entry>(
      'SELECT id, record_id, body, entry_type, source, created_at FROM entries WHERE record_id = ? AND deleted_at IS NULL ORDER BY created_at ASC, rowid ASC',
      [recordId],
    );
  }

  history(recordId: string): Promise<HistoryRow[]> {
    return this.db.all<HistoryRow>(
      'SELECT id, record_id, action, source, detail, created_at, undone_at FROM history WHERE record_id = ? ORDER BY id ASC',
      [recordId],
    );
  }

  async listToday(area: Area): Promise<TodayView> {
    const today = this.today();
    const rows = await this.db.all<RecordRow>(
      `${RECORD_SELECT}
       WHERE r.area = ? AND r.deleted_at IS NULL AND r.kind = 'task'
         AND r.status IN ('open','waiting') AND r.follow_up_date IS NOT NULL AND r.follow_up_date <= ?
       ORDER BY r.follow_up_date ASC, r.updated_at DESC`,
      [area, today],
    );
    const view: TodayView = { overdue: [], today: [], recurring: [] };
    const groups = new Map<string, RecordRow[]>();
    for (const r of rows) {
      if (r.recurrence_id) {
        const g = groups.get(r.recurrence_id) ?? [];
        g.push(r);
        groups.set(r.recurrence_id, g);
      } else if (r.follow_up_date! < today) {
        view.overdue.push(r);
      } else {
        view.today.push(r);
      }
    }
    for (const g of groups.values()) {
      g.sort((a, b) => (a.follow_up_date! < b.follow_up_date! ? 1 : -1));
      view.recurring.push({ latest: g[0], olderOpen: g.slice(1) });
    }
    // Aynı gün içinde önce yüksek önem derecesi (sıralama kararlıdır, tarih sırası korunur).
    const byPriority = (a: RecordRow, b: RecordRow) => b.priority - a.priority;
    view.overdue.sort(byPriority);
    view.today.sort(byPriority);
    view.recurring.sort((a, b) => byPriority(a.latest, b.latest));
    return view;
  }

  /** Tamamlanmamış işler (tarihsiz ve beklemedekiler dahil). */
  listOpen(area: Area): Promise<RecordRow[]> {
    return this.db.all<RecordRow>(
      `${RECORD_SELECT}
       WHERE r.area = ? AND r.deleted_at IS NULL AND r.kind = 'task' AND r.status IN ('open','waiting')
       ORDER BY (r.category_id IS NULL) DESC, c.sort_order, r.priority DESC, r.follow_up_date IS NULL, r.follow_up_date, r.updated_at DESC`,
      [area],
    );
  }

  /** Kategorisi seçilmemiş, çöpte olmayan ve tamamlanmamış kayıtlar ile notlar. */
  listUnclassified(area: Area): Promise<RecordRow[]> {
    return this.db.all<RecordRow>(
      `${RECORD_SELECT}
       WHERE r.area = ? AND r.deleted_at IS NULL AND r.category_id IS NULL
         AND (r.kind = 'note' OR r.status <> 'done')
       ORDER BY r.updated_at DESC`,
      [area],
    );
  }

  /** Seçili alanda bugün (İstanbul saatiyle) tamamlanan işler, en son biten önce. */
  listCompletedToday(area: Area): Promise<RecordRow[]> {
    return this.db.all<RecordRow>(
      `${RECORD_SELECT} WHERE r.area = ? AND r.deleted_at IS NULL AND r.status = 'done' AND r.completed_at >= ?
       ORDER BY r.completed_at DESC`,
      [area, istanbulDayStartIso(this.today())],
    );
  }

  async listHistoryView(area: Area): Promise<{ done: RecordRow[]; notes: RecordRow[]; recentEntries: (Entry & { title: string })[] }> {
    const done = await this.db.all<RecordRow>(
      `${RECORD_SELECT} WHERE r.area = ? AND r.deleted_at IS NULL AND r.status = 'done'
       ORDER BY r.completed_at DESC LIMIT 100`,
      [area],
    );
    const notes = await this.db.all<RecordRow>(
      `${RECORD_SELECT} WHERE r.area = ? AND r.deleted_at IS NULL AND r.kind = 'note'
       ORDER BY r.updated_at DESC LIMIT 100`,
      [area],
    );
    const recentEntries = await this.db.all<Entry & { title: string }>(
      `SELECT e.id, e.record_id, e.body, e.entry_type, e.source, e.created_at, r.title
       FROM entries e JOIN records r ON r.id = e.record_id
       WHERE r.area = ? AND r.deleted_at IS NULL AND e.deleted_at IS NULL
       ORDER BY e.created_at DESC, e.rowid DESC LIMIT 50`,
      [area],
    );
    return { done, notes, recentEntries };
  }

  listTrash(): Promise<RecordRow[]> {
    return this.db.all<RecordRow>(`${RECORD_SELECT} WHERE r.deleted_at IS NOT NULL ORDER BY r.deleted_at DESC`);
  }

  /**
   * Çevrimdışı arama: başlık, kategori ve not metninde. Sorgudaki her sözcük
   * bu alanlardan birinde geçmelidir. Türkçe büyük/küçük harf ve ç/ş/ı farkları yok sayılır.
   */
  async search(area: Area, query: string, limit = 50): Promise<SearchHit[]> {
    const tokens = searchTokens(query);
    if (tokens.length === 0) return [];
    const where: string[] = [];
    const params: Param[] = [area];
    for (const t of tokens) {
      const like = `%${escapeLike(t)}%`;
      where.push(`(r.title_norm LIKE ? ESCAPE '\\' OR COALESCE(c.name_norm,'') LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM entries e2 WHERE e2.record_id = r.id AND e2.deleted_at IS NULL AND e2.body_norm LIKE ? ESCAPE '\\'))`);
      params.push(like, like, like);
    }
    params.push(limit);
    const records = await this.db.all<RecordRow>(
      `${RECORD_SELECT} WHERE r.area = ? AND r.deleted_at IS NULL AND ${where.join(' AND ')}
       ORDER BY r.updated_at DESC LIMIT ?`,
      params,
    );
    const hits: SearchHit[] = [];
    for (const record of records) {
      const all = await this.entries(record.id);
      const matching = all.filter((e) => {
        const n = searchNorm(e.body);
        return tokens.some((t) => n.includes(t));
      });
      hits.push({ record, entries: matching });
    }
    return hits;
  }

  /** Adla verilen komutlar için seçili alanda aday kayıtları bulur. */
  async findByName(area: Area, name: string): Promise<RecordRow[]> {
    const tokens = nameTokens(name);
    if (tokens.length === 0) return [];
    const rows = await this.db.all<RecordRow>(
      `${RECORD_SELECT} WHERE r.area = ? AND r.deleted_at IS NULL ORDER BY r.updated_at DESC`,
      [area],
    );
    return rows.filter((r) => {
      const words = searchTokens(r.title);
      return tokens.every((t) => words.some((w) => wordMatches(t, w)));
    });
  }

  // -------------------------------------------------------------------------
  // Yazma
  // -------------------------------------------------------------------------

  /** Gönderim kimliğini kaydeder; daha önce işlendiyse false döner. */
  private async claimSubmission(db: Db, submissionId?: string): Promise<boolean> {
    if (!submissionId) return true;
    const exists = await db.get<{ id: string }>('SELECT id FROM submissions WHERE id = ?', [submissionId]);
    if (exists) return false;
    await db.run('INSERT INTO submissions (id, created_at) VALUES (?, ?)', [submissionId, this.ts()]);
    return true;
  }

  private snapshot(r: RecordRow): Snapshot {
    const s = {} as Record<string, unknown>;
    for (const k of SNAPSHOT_KEYS) s[k] = r[k as keyof RecordRow] ?? null;
    return s as unknown as Snapshot;
  }

  private async writeSnapshot(db: Db, id: string, s: Snapshot): Promise<void> {
    await db.run(
      `UPDATE records SET area = ?, category_id = ?, kind = ?, title = ?, title_norm = ?, status = ?, priority = ?, next_step = ?,
         follow_up_date = ?, completed_at = ?, deleted_at = ?, version = version + 1, updated_at = ?
       WHERE id = ?`,
      [
        s.area,
        s.category_id,
        s.kind,
        s.title,
        searchNorm(s.title),
        s.status,
        s.priority ?? 2,
        s.next_step,
        s.follow_up_date,
        s.completed_at,
        s.deleted_at,
        this.ts(),
        id,
      ],
    );
  }

  private async addHistory(
    db: Db,
    recordId: string,
    action: HistoryAction,
    source: Source,
    detail: string | null,
    before: Snapshot | null,
    after: Snapshot | null,
    versionAfter: number,
    entryId: string | null = null,
  ): Promise<number> {
    const r = await db.run(
      `INSERT INTO history (record_id, action, source, detail, before_json, after_json, entry_id, version_after, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        recordId,
        action,
        source,
        detail,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        entryId,
        versionAfter,
        this.ts(),
      ],
    );
    return r.lastInsertRowId;
  }

  /** Kaydın alanlarını değiştirir, geçmişe yazar ve güncel kaydı döndürür. */
  private async change(
    recordId: string,
    action: HistoryAction,
    source: Source,
    patch: (r: RecordRow) => Partial<Snapshot> | string,
    detail: (r: RecordRow) => string | null,
    submissionId?: string,
  ): Promise<ChangeResult> {
    return this.db.transaction(async (db) => {
      if (!(await this.claimSubmission(db, submissionId))) {
        return { ok: false, reason: 'Bu gönderim zaten işlendi.', duplicate: true } as ChangeResult;
      }
      const rec = await this.getRecord(recordId, db);
      if (!rec) return { ok: false, reason: 'Kayıt bulunamadı.' } as ChangeResult;
      const p = patch(rec);
      if (typeof p === 'string') return { ok: false, reason: p } as ChangeResult;
      const before = this.snapshot(rec);
      const after: Snapshot = { ...before, ...p };
      await this.writeSnapshot(db, recordId, after);
      const historyId = await this.addHistory(db, recordId, action, source, detail(rec), before, after, rec.version + 1);
      const record = (await this.getRecord(recordId, db))!;
      return { ok: true, historyId, record } as ChangeResult;
    });
  }

  async createRecord(input: {
    area: Area;
    categoryId: number | null;
    kind: RecordKind;
    title?: string;
    body: string;
    nextStep?: string | null;
    followUpDate?: DayString | null;
    priority?: Priority;
    source: Source;
    submissionId?: string;
  }): Promise<ChangeResult> {
    const body = input.body.trim();
    const title = (input.title?.trim() || firstLineTitle(body)).trim();
    if (!title) return { ok: false, reason: 'Boş kayıt kaydedilemez.' };
    return this.db.transaction(async (db) => {
      if (!(await this.claimSubmission(db, input.submissionId))) {
        return { ok: false, reason: 'Bu gönderim zaten işlendi.', duplicate: true } as ChangeResult;
      }
      const id = this.newId();
      const now = this.ts();
      const status: TaskStatus | null = input.kind === 'task' ? 'open' : null;
      await db.run(
        `INSERT INTO records (id, area, category_id, kind, title, title_norm, status, priority, next_step, follow_up_date,
           created_at, updated_at, version)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`,
        [
          id,
          input.area,
          input.categoryId,
          input.kind,
          title,
          searchNorm(title),
          status,
          input.priority ?? 2,
          input.nextStep?.trim() || null,
          input.kind === 'task' ? input.followUpDate ?? null : null,
          now,
          now,
        ],
      );
      let entryId: string | null = null;
      if (body) {
        entryId = this.newId();
        await db.run(
          'INSERT INTO entries (id, record_id, body, body_norm, entry_type, source, created_at) VALUES (?,?,?,?,?,?,?)',
          [entryId, id, body, searchNorm(body), 'progress', input.source, now],
        );
      }
      const rec = (await this.getRecord(id, db))!;
      const historyId = await this.addHistory(
        db,
        id,
        'create',
        input.source,
        input.kind === 'task' ? 'Yeni iş açıldı' : 'Bağımsız not kaydedildi',
        null,
        this.snapshot(rec),
        1,
        entryId,
      );
      return { ok: true, historyId, record: rec } as ChangeResult;
    });
  }

  /** Kayda tarihli gelişme (ya da sonraki adım) ekler. Ana işi kapatmaz. */
  async addEntry(input: {
    recordId: string;
    body: string;
    entryType?: EntryType;
    followUpDate?: DayString | null;
    source: Source;
    submissionId?: string;
  }): Promise<ChangeResult> {
    const body = input.body.trim();
    if (!body) return { ok: false, reason: 'Boş not eklenemez.' };
    const entryType = input.entryType ?? 'progress';
    return this.db.transaction(async (db) => {
      if (!(await this.claimSubmission(db, input.submissionId))) {
        return { ok: false, reason: 'Bu gönderim zaten işlendi.', duplicate: true } as ChangeResult;
      }
      const rec = await this.getRecord(input.recordId, db);
      if (!rec) return { ok: false, reason: 'Kayıt bulunamadı.' } as ChangeResult;
      if (rec.deleted_at) return { ok: false, reason: 'Kayıt çöp kutusunda.' } as ChangeResult;
      const entryId = this.newId();
      await db.run(
        'INSERT INTO entries (id, record_id, body, body_norm, entry_type, source, created_at) VALUES (?,?,?,?,?,?,?)',
        [entryId, rec.id, body, searchNorm(body), entryType, input.source, this.ts()],
      );
      const before = this.snapshot(rec);
      const after: Snapshot = { ...before };
      if (entryType === 'next_step') after.next_step = body;
      if (input.followUpDate !== undefined && rec.kind === 'task') after.follow_up_date = input.followUpDate;
      await this.writeSnapshot(db, rec.id, after);
      const label = entryType === 'next_step' ? 'Sonraki adım eklendi' : entryType === 'closing' ? 'Kapanış notu eklendi' : 'Gelişme eklendi';
      const historyId = await this.addHistory(db, rec.id, 'add_note', input.source, label, before, after, rec.version + 1, entryId);
      const record = (await this.getRecord(rec.id, db))!;
      return { ok: true, historyId, record } as ChangeResult;
    });
  }

  setStatus(recordId: string, status: TaskStatus, source: Source, submissionId?: string): Promise<ChangeResult> {
    const action: HistoryAction = status === 'done' ? 'complete' : status === 'waiting' ? 'hold' : 'reopen';
    return this.change(
      recordId,
      action,
      source,
      (r) => {
        if (r.deleted_at) return 'Kayıt çöp kutusunda.';
        if (r.kind === 'note') return 'Bu bir bağımsız not; önce işe çevir.';
        if (r.status === status) {
          return status === 'done' ? 'Kayıt zaten tamamlanmış.' : status === 'waiting' ? 'Kayıt zaten beklemede.' : 'Kayıt zaten açık.';
        }
        return {
          status,
          completed_at: status === 'done' ? this.ts() : null,
        };
      },
      () => (status === 'done' ? 'Tamamlandı' : status === 'waiting' ? 'Beklemeye alındı' : 'Yeniden açıldı'),
      submissionId,
    );
  }

  setFollowUp(recordId: string, date: DayString | null, source: Source, submissionId?: string): Promise<ChangeResult> {
    return this.change(
      recordId,
      'set_follow_up',
      source,
      (r) => {
        if (r.deleted_at) return 'Kayıt çöp kutusunda.';
        if (r.kind === 'note') return 'Bağımsız notlara takip tarihi verilemez; önce işe çevir.';
        return { follow_up_date: date };
      },
      (r) => `Takip tarihi: ${r.follow_up_date ?? 'yok'} → ${date ?? 'yok'}`,
      submissionId,
    );
  }

  setNextStep(recordId: string, text: string | null, source: Source): Promise<ChangeResult> {
    return this.change(
      recordId,
      'set_next_step',
      source,
      () => ({ next_step: text?.trim() || null }),
      () => (text?.trim() ? `Sonraki adım: ${text.trim()}` : 'Sonraki adım temizlendi'),
    );
  }

  setPriority(recordId: string, priority: Priority, source: Source, submissionId?: string): Promise<ChangeResult> {
    return this.change(
      recordId,
      'set_priority',
      source,
      (r) => {
        if (r.deleted_at) return 'Kayıt çöp kutusunda.';
        if (r.kind === 'note') return 'Bağımsız notlara önem derecesi verilmez; önce işe çevir.';
        if (r.priority === priority) return `Önem derecesi zaten ${PRIORITY_LABEL[priority]}.`;
        return { priority };
      },
      (r) => `Önem: ${PRIORITY_LABEL[r.priority]} → ${PRIORITY_LABEL[priority]}`,
      submissionId,
    );
  }

  /** Başlık, alan, kategori ya da tür (not ↔ iş) değişikliği. */
  editRecord(
    recordId: string,
    patch: { title?: string; area?: Area; categoryId?: number | null; kind?: RecordKind },
    source: Source,
  ): Promise<ChangeResult> {
    return this.change(
      recordId,
      'edit',
      source,
      (r) => {
        const p: Partial<Snapshot> = {};
        if (patch.title !== undefined) {
          if (!patch.title.trim()) return 'Başlık boş olamaz.';
          p.title = patch.title.trim();
        }
        if (patch.area !== undefined && patch.area !== r.area) {
          p.area = patch.area;
          if (patch.categoryId === undefined) p.category_id = null;
        }
        if (patch.categoryId !== undefined) p.category_id = patch.categoryId;
        if (patch.kind !== undefined && patch.kind !== r.kind) {
          p.kind = patch.kind;
          p.status = patch.kind === 'task' ? 'open' : null;
          p.completed_at = null;
          if (patch.kind === 'note') p.follow_up_date = null;
        }
        return p;
      },
      () => {
        const parts: string[] = [];
        if (patch.title !== undefined) parts.push('başlık');
        if (patch.area !== undefined) parts.push('alan');
        if (patch.categoryId !== undefined) parts.push('kategori');
        if (patch.kind !== undefined) parts.push(patch.kind === 'task' ? 'işe çevrildi' : 'nota çevrildi');
        return `Düzenlendi: ${parts.join(', ')}`;
      },
    );
  }

  trash(recordId: string, source: Source, submissionId?: string): Promise<ChangeResult> {
    return this.change(
      recordId,
      'trash',
      source,
      (r) => (r.deleted_at ? 'Kayıt zaten çöp kutusunda.' : { deleted_at: this.ts() }),
      () => 'Çöp kutusuna taşındı',
      submissionId,
    );
  }

  restore(recordId: string, source: Source): Promise<ChangeResult> {
    return this.change(
      recordId,
      'restore',
      source,
      (r) => (r.deleted_at ? { deleted_at: null } : 'Kayıt çöp kutusunda değil.'),
      () => 'Çöp kutusundan geri yüklendi',
    );
  }

  /**
   * Bir işlemi geri alır. Kayıt o işlemden sonra değiştiyse (sürüm farklıysa)
   * sonraki değişikliği ezmemek için geri alma yapılmaz.
   */
  async undo(historyId: number, source: Source = 'button'): Promise<ChangeResult> {
    return this.db.transaction(async (db) => {
      const h = await db.get<{
        id: number;
        record_id: string;
        action: HistoryAction;
        before_json: string | null;
        entry_id: string | null;
        version_after: number;
        undone_at: string | null;
      }>('SELECT * FROM history WHERE id = ?', [historyId]);
      if (!h) return { ok: false, reason: 'İşlem bulunamadı.' } as ChangeResult;
      if (h.undone_at) return { ok: false, reason: 'Bu işlem zaten geri alındı.' } as ChangeResult;
      const rec = await this.getRecord(h.record_id, db);
      if (!rec) return { ok: false, reason: 'Kayıt bulunamadı.' } as ChangeResult;
      if (rec.version !== h.version_after) {
        return {
          ok: false,
          reason: 'Kayıt bu işlemden sonra değişti. Sonraki değişikliği ezmemek için geri alınmadı.',
        } as ChangeResult;
      }
      const current = this.snapshot(rec);
      let target: Snapshot;
      if (h.action === 'create') {
        target = { ...current, deleted_at: this.ts() };
      } else if (h.before_json) {
        // Eski sürümde yazılmış anlık görüntülerde olmayan alanlar mevcut değerini korur.
        target = { ...current, ...(JSON.parse(h.before_json) as Partial<Snapshot>) };
      } else {
        return { ok: false, reason: 'Bu işlem geri alınamaz.' } as ChangeResult;
      }
      if (h.entry_id && h.action === 'add_note') {
        await db.run('UPDATE entries SET deleted_at = ? WHERE id = ?', [this.ts(), h.entry_id]);
      }
      await this.writeSnapshot(db, rec.id, target);
      await db.run('UPDATE history SET undone_at = ? WHERE id = ?', [this.ts(), h.id]);
      const newId = await this.addHistory(db, rec.id, 'undo', source, `Geri alındı: ${h.action}`, current, target, rec.version + 1);
      const record = (await this.getRecord(rec.id, db))!;
      return { ok: true, historyId: newId, record } as ChangeResult;
    });
  }

  // -------------------------------------------------------------------------
  // Haftalık tekrarlar
  // -------------------------------------------------------------------------

  async createRecurrence(input: {
    area: Area;
    categoryId: number | null;
    title: string;
    weekday: number;
    source: Source;
    submissionId?: string;
  }): Promise<{ ok: true; recurrence: Recurrence } | { ok: false; reason: string; duplicate?: boolean }> {
    const title = input.title.trim();
    if (!title) return { ok: false, reason: 'Tekrar başlığı boş olamaz.' };
    const result = await this.db.transaction(async (db) => {
      if (!(await this.claimSubmission(db, input.submissionId))) return null;
      const id = this.newId();
      const now = this.ts();
      const rec: Recurrence = {
        id,
        area: input.area,
        category_id: input.categoryId,
        title,
        weekday: input.weekday,
        start_date: this.today(),
        active: 1,
      };
      await db.run(
        'INSERT INTO recurrences (id, area, category_id, title, weekday, start_date, active, created_at, updated_at) VALUES (?,?,?,?,?,?,1,?,?)',
        [id, rec.area, rec.category_id, rec.title, rec.weekday, rec.start_date, now, now],
      );
      return rec;
    });
    if (!result) return { ok: false, reason: 'Bu gönderim zaten işlendi.', duplicate: true };
    await this.ensureRecurrences();
    return { ok: true, recurrence: result };
  }

  getRecurrence(id: string): Promise<Recurrence | null> {
    return this.db.get<Recurrence>('SELECT * FROM recurrences WHERE id = ?', [id]);
  }

  listRecurrences(area: Area): Promise<Recurrence[]> {
    return this.db.all<Recurrence>('SELECT * FROM recurrences WHERE area = ? ORDER BY active DESC, weekday, title', [area]);
  }

  /** Tüm seriyi durdurur: yeni haftalar oluşmaz, mevcut haftalar olduğu gibi kalır. */
  async setRecurrenceActive(id: string, active: boolean): Promise<void> {
    await this.db.run('UPDATE recurrences SET active = ?, updated_at = ? WHERE id = ?', [active ? 1 : 0, this.ts(), id]);
    if (active) await this.ensureRecurrences();
  }

  /**
   * Zamanı gelen haftalık örnekleri oluşturur. Her seri ve hafta için en fazla
   * bir örnek olur (UNIQUE kısıtı); çöpe taşınan bir hafta yeniden oluşmaz.
   */
  async ensureRecurrences(): Promise<number> {
    const today = this.today();
    const recs = await this.db.all<Recurrence>('SELECT * FROM recurrences WHERE active = 1');
    let created = 0;
    for (const rec of recs) {
      let due = rec.start_date;
      while (weekdayOf(due) !== rec.weekday) due = addDays(due, 1);
      while (due <= today) {
        const weekStart = mondayOf(due);
        const dueDate = due;
        await this.db.transaction(async (db) => {
          const id = this.newId();
          const now = this.ts();
          const r = await db.run(
            `INSERT OR IGNORE INTO records (id, area, category_id, kind, title, title_norm, status, follow_up_date,
               recurrence_id, week_start, created_at, updated_at, version)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`,
            [id, rec.area, rec.category_id, 'task', rec.title, searchNorm(rec.title), 'open', dueDate, rec.id, weekStart, now, now],
          );
          if (r.changes > 0) {
            created++;
            const row = (await this.getRecord(id, db))!;
            await this.addHistory(db, id, 'create', 'button', 'Haftalık tekrardan oluşturuldu', null, this.snapshot(row), 1);
          }
        });
        due = addDays(due, 7);
      }
    }
    return created;
  }
}

