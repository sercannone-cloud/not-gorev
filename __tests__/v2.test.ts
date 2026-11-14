// Sürüm 2: kategori yönetimi, günlük özet bildirimi, yedekleme ve şema geçişi.
import { makeRepo, memoryDb } from './helpers';
import { Repo } from '../src/db/repo';
import { MIGRATIONS } from '../src/db/schema';
import { istanbulAt, parseTime, planReminders, summarizeDay, summaryText } from '../src/domain/reminders';

async function catId(repo: Repo, area: 'is' | 'ozel', name: string) {
  const c = (await repo.categories(area)).find((x) => x.name === name);
  if (!c) throw new Error('kategori yok: ' + name);
  return c.id;
}

describe('kategori yönetimi', () => {
  test('S1: Özel alanına Sağlık ekle, kayıt ata, sil: kayıt Sınıflandırılacak’a düşer', async () => {
    const { repo } = await makeRepo();
    const add = await repo.addCategory('ozel', '  Sağlık ');
    if (!add.ok) throw new Error(add.reason);
    expect(add.category.name).toBe('Sağlık');
    expect((await repo.categories('ozel')).map((c) => c.name).at(-1)).toBe('Sağlık');

    const rec = await repo.createRecord({ area: 'ozel', categoryId: add.category.id, kind: 'task', body: 'Diş randevusu al', source: 'text' });
    if (!rec.ok) throw new Error(rec.reason);
    const counts = await repo.categoriesWithCounts('ozel');
    expect(counts.find((c) => c.id === add.category.id)?.record_count).toBe(1);

    const del = await repo.deleteCategory(add.category.id);
    expect(del).toEqual({ ok: true, moved: 1 });
    expect((await repo.categories('ozel')).map((c) => c.name)).not.toContain('Sağlık');
    const unclassified = await repo.listUnclassified('ozel');
    expect(unclassified.map((r) => r.id)).toEqual([rec.record.id]);
    // Kayıt ve geçmişi duruyor
    expect(await repo.getRecord(rec.record.id)).toMatchObject({ category_id: null, deleted_at: null });
    expect((await repo.history(rec.record.id)).length).toBeGreaterThan(0);
  });

  test('S2: aynı ad küçük harfle ya da ç/ı farkıyla yeniden eklenemez', async () => {
    const { repo } = await makeRepo();
    const before = (await repo.categories('is')).length;
    for (const name of ['kargo, araç ve 3pl', 'KARGO, ARAÇ VE 3PL', 'Kargo,  Arac ve 3PL']) {
      const r = await repo.addCategory('is', name);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain('Kargo, Araç ve 3PL');
    }
    expect((await repo.categories('is')).length).toBe(before);
    // Aynı ad diğer alanda serbest
    expect((await repo.addCategory('ozel', 'Kargo, Araç ve 3PL')).ok).toBe(true);
    // Boş ad
    expect((await repo.addCategory('is', '   ')).ok).toBe(false);
  });

  test('ad değiştirme: başka kategorinin adı alınamaz, kendi adının harf düzeltmesi serbest', async () => {
    const { repo } = await makeRepo();
    const id = await catId(repo, 'ozel', 'Araç');
    const clash = await repo.renameCategory(id, 'aile');
    expect(clash.ok).toBe(false);
    expect((await repo.renameCategory(id, 'ARAÇ')).ok).toBe(true);
    const ok = await repo.renameCategory(id, 'Araç ve Bakım');
    expect(ok.ok).toBe(true);
    const rec = await repo.createRecord({ area: 'ozel', categoryId: id, kind: 'task', body: 'Lastik değişimi', source: 'text' });
    if (!rec.ok) throw new Error(rec.reason);
    expect(rec.record.category_name).toBe('Araç ve Bakım');
    // Aramada yeni ad bulunur
    expect((await repo.search('ozel', 'bakım')).map((h) => h.record.id)).toContain(rec.record.id);
  });

  test('sıralama: yukarı/aşağı taşıma, uçlarda bir şey olmaz', async () => {
    const { repo } = await makeRepo();
    const names = async () => (await repo.categories('ozel')).map((c) => c.name);
    const start = await names();
    await repo.moveCategory(await catId(repo, 'ozel', 'Aile'), -1);
    expect((await names()).slice(0, 2)).toEqual(['Aile', 'Ev ve Faturalar']);
    await repo.moveCategory(await catId(repo, 'ozel', 'Aile'), -1); // zaten en üstte
    expect((await names())[0]).toBe('Aile');
    await repo.moveCategory(await catId(repo, 'ozel', start.at(-1)!), 1); // zaten en altta
    expect((await names()).at(-1)).toBe(start.at(-1));
    // Diğer alan etkilenmez
    expect((await repo.categories('is'))[0].name).toBe('Mal Kabul ve İthalat');
  });

  test('silinen kategoriye geri alma kaydı kategorisiz bırakır', async () => {
    const { repo } = await makeRepo();
    const a = await repo.addCategory('is', 'Geçici');
    if (!a.ok) throw new Error(a.reason);
    const rec = await repo.createRecord({ area: 'is', categoryId: a.category.id, kind: 'task', body: 'Deneme', source: 'text' });
    if (!rec.ok) throw new Error(rec.reason);
    const edit = await repo.editRecord(rec.record.id, { categoryId: await catId(repo, 'is', 'İade ve Mutabakat') }, 'button');
    if (!edit.ok) throw new Error(edit.reason);
    await repo.deleteCategory(a.category.id);
    const undo = await repo.undo(edit.historyId);
    expect(undo.ok).toBe(true);
    expect((await repo.getRecord(rec.record.id))?.category_id).toBeNull();
  });

  test('silinen kategorideki tekrar kategorisiz devam eder', async () => {
    const { repo } = await makeRepo();
    const evId = await catId(repo, 'ozel', 'Ev ve Faturalar');
    const r = await repo.createRecurrence({ area: 'ozel', categoryId: evId, title: 'Faturaları kontrol et', weekday: 0, source: 'text' });
    if (!r.ok) throw new Error(r.reason);
    await repo.deleteCategory(evId);
    expect((await repo.getRecurrence(r.recurrence.id))?.category_id).toBeNull();
  });
});

describe('günlük özet bildirimi', () => {
  test('saat ayrıştırma ve İstanbul anı', () => {
    expect(parseTime('07:30')).toEqual([7, 30]);
    expect(parseTime('25:00')).toEqual([9, 0]);
    expect(parseTime(null)).toEqual([9, 0]);
    expect(istanbulAt('2026-11-15', 9, 0).toISOString()).toBe('2026-11-15T06:00:00.000Z');
  });

  test('özet metni', () => {
    expect(summaryText({ due: 3, recurring: 0, overdue: 1 })).toBe('Bugün 3 takip, 1 gecikmiş');
    expect(summaryText({ due: 0, recurring: 1, overdue: 0 })).toBe('Bugün 1 tekrar');
    expect(summaryText({ due: 0, recurring: 0, overdue: 0 })).toBeNull();
  });

  test('S3: yarına takip verilen iş için ertesi gün tek özet; tamamlanınca özet kalkar', async () => {
    const { repo, clock } = await makeRepo('2026-11-14'); // cumartesi 10:00
    const mk = async (body: string, date: string | null) => {
      const r = await repo.createRecord({ area: 'is', categoryId: null, kind: 'task', body, followUpDate: date, source: 'text' });
      if (!r.ok) throw new Error(r.reason);
      return r.record;
    };
    const a = await mk('Calibra farkı', '2026-11-15');
    await mk('İrsaliye kontrol', '2026-11-15');
    await mk('Eski takip', '2026-11-10');
    await mk('Tarihsiz iş', null);
    const ozel = await repo.createRecord({ area: 'ozel', categoryId: null, kind: 'task', body: 'Servisi ara', followUpDate: '2026-11-15', source: 'text' });
    if (!ozel.ok) throw new Error(ozel.reason);

    const plan = planReminders(await repo.reminderInput(), clock.current, repo.today(), '09:00', 3);
    // Bugünün 09:00'u geçti: ilk bildirim yarın
    expect(plan[0].day).toBe('2026-11-15');
    expect(plan[0].at.toISOString()).toBe('2026-11-15T06:00:00.000Z');
    expect(plan[0].body).toBe('Bugün 3 takip, 1 gecikmiş');
    // Her gün için en fazla bir bildirim
    expect(new Set(plan.map((p) => p.day)).size).toBe(plan.length);
    // Ertesi gün yarınki takipler gecikmiş sayılır
    expect(plan[1].summary).toEqual({ due: 0, recurring: 0, overdue: 4 });

    await repo.setStatus(a.id, 'done', 'button');
    const after = planReminders(await repo.reminderInput(), clock.current, repo.today(), '09:00', 2);
    expect(after[0].body).toBe('Bugün 2 takip, 1 gecikmiş');
  });

  test('çöpe taşınan ve ertelenen işler özete göre güncellenir', async () => {
    const { repo } = await makeRepo('2026-11-14');
    const r = await repo.createRecord({ area: 'is', categoryId: null, kind: 'task', body: 'X', followUpDate: '2026-11-15', source: 'text' });
    if (!r.ok) throw new Error(r.reason);
    expect(summarizeDay(await repo.reminderInput(), '2026-11-15').due).toBe(1);
    await repo.setFollowUp(r.record.id, '2026-11-20', 'button');
    expect(summarizeDay(await repo.reminderInput(), '2026-11-15').due).toBe(0);
    expect(summarizeDay(await repo.reminderInput(), '2026-11-20').due).toBe(1);
    await repo.trash(r.record.id, 'button');
    expect(summarizeDay(await repo.reminderInput(), '2026-11-20').due).toBe(0);
  });

  test('haftalık tekrar: henüz oluşmamış hafta o gün tekrar olarak sayılır, oluşmuşsa iki kez sayılmaz', async () => {
    const { repo, clock } = await makeRepo('2026-11-14'); // cumartesi
    const r = await repo.createRecurrence({ area: 'ozel', categoryId: null, title: 'Faturalar', weekday: 0, source: 'text' });
    if (!r.ok) throw new Error(r.reason);
    // Pazar 15.11 örneği henüz yok
    expect(summarizeDay(await repo.reminderInput(), '2026-11-15')).toEqual({ due: 0, recurring: 1, overdue: 0 });
    clock.set('2026-11-15');
    await repo.ensureRecurrences();
    expect(summarizeDay(await repo.reminderInput(), '2026-11-15')).toEqual({ due: 0, recurring: 1, overdue: 0 });
    // Bir hafta sonra: eski hafta gecikmiş, yeni hafta tekrar
    expect(summarizeDay(await repo.reminderInput(), '2026-11-22')).toEqual({ due: 0, recurring: 1, overdue: 1 });
    // Durdurulan seri yeni hafta üretmez
    await repo.setRecurrenceActive(r.recurrence.id, false);
    expect(summarizeDay(await repo.reminderInput(), '2026-11-22')).toEqual({ due: 0, recurring: 0, overdue: 1 });
  });

  test('gösterecek bir şey yoksa bildirim kurulmaz', async () => {
    const { repo, clock } = await makeRepo('2026-11-14');
    expect(planReminders(await repo.reminderInput(), clock.current, repo.today(), '09:00')).toEqual([]);
  });

  test('ayarlar saklanır', async () => {
    const { repo } = await makeRepo();
    expect(await repo.getSetting('reminder_time')).toBeNull();
    await repo.setSetting('reminder_time', '07:45');
    await repo.setSetting('reminder_time', '08:15');
    expect(await repo.getSetting('reminder_time')).toBe('08:15');
  });
});

describe('yedekleme', () => {
  async function fill(repo: Repo) {
    const cat = await repo.addCategory('ozel', 'Sağlık');
    if (!cat.ok) throw new Error(cat.reason);
    const r = await repo.createRecord({ area: 'ozel', categoryId: cat.category.id, kind: 'task', body: 'Diş randevusu', followUpDate: '2026-11-20', priority: 4, source: 'voice' });
    if (!r.ok) throw new Error(r.reason);
    await repo.addEntry({ recordId: r.record.id, body: 'Klinik cuma dönecek', entryType: 'progress', source: 'text' });
    const t = await repo.createRecord({ area: 'is', categoryId: null, kind: 'note', body: 'Silinecek not', source: 'text' });
    if (!t.ok) throw new Error(t.reason);
    await repo.trash(t.record.id, 'button');
    await repo.createRecurrence({ area: 'ozel', categoryId: null, title: 'Faturalar', weekday: 0, source: 'text' });
    await repo.moveCategory(cat.category.id, -1);
    return r.record.id;
  }

  test('dışa aktar → başka telefona içe aktar: veriler aynı', async () => {
    const a = await makeRepo('2026-11-14');
    const id = await fill(a.repo);
    const backup = JSON.parse(JSON.stringify(await a.repo.exportData()));
    expect(backup.app).toBe('not-gorev');
    expect(backup.schemaVersion).toBe(MIGRATIONS.length);

    const b = await makeRepo('2026-11-14');
    await b.repo.createRecord({ area: 'is', categoryId: null, kind: 'task', body: 'Yeni telefondaki eski kayıt', source: 'text' });
    const res = await b.repo.importData(backup);
    expect(res).toEqual({ ok: true, records: backup.tables.records.length });

    const again = await b.repo.exportData();
    expect(again.tables).toEqual(backup.tables);
    // Uygulama görünümleri de aynı
    expect(await b.repo.categories('ozel')).toEqual(await a.repo.categories('ozel'));
    expect(await b.repo.entries(id)).toEqual(await a.repo.entries(id));
    expect(await b.repo.history(id)).toEqual(await a.repo.history(id));
    expect((await b.repo.listTrash()).map((r) => r.title)).toEqual(['Silinecek not']);
    expect((await b.repo.search('is', 'yeni telefondaki'))).toHaveLength(0);
  });

  test('bozuk ya da yabancı dosya reddedilir ve mevcut veri değişmez', async () => {
    const { repo } = await makeRepo();
    await fill(repo);
    const before = await repo.exportData();
    expect((await repo.importData({ foo: 1 })).ok).toBe(false);
    expect((await repo.importData(null)).ok).toBe(false);
    expect((await repo.importData({ ...before, schemaVersion: 99 })).ok).toBe(false);
    // Yarıda bozulan yedek: işlem geri sarılır
    const broken = JSON.parse(JSON.stringify(before));
    broken.tables.entries.push({ id: 'x', record_id: 'olmayan-kayit', body: 'b', body_norm: 'b', entry_type: 'progress', source: 'text', created_at: 'now' });
    const res = await repo.importData(broken);
    expect(res.ok).toBe(false);
    expect((await repo.exportData()).tables).toEqual(before.tables);
  });

  test('eski sürüm (önem derecesi öncesi) yedeği varsayılanlarla yüklenir', async () => {
    const { repo } = await makeRepo();
    const old = {
      app: 'not-gorev',
      schemaVersion: 1,
      exportedAt: '2026-11-08T10:00:00.000Z',
      tables: {
        categories: [{ id: 1, area: 'is', name: 'Kargo', name_norm: 'kargo', sort_order: 0, archived_at: null }],
        records: [
          {
            id: 'r1', area: 'is', category_id: 1, kind: 'task', title: 'Eski iş', title_norm: 'eski is', status: 'open',
            next_step: null, follow_up_date: null, recurrence_id: null, week_start: null,
            created_at: '2026-11-08T10:00:00.000Z', updated_at: '2026-11-08T10:00:00.000Z', completed_at: null, deleted_at: null, version: 1,
          },
        ],
      },
    };
    const res = await repo.importData(old);
    expect(res.ok).toBe(true);
    expect(await repo.getRecord('r1')).toMatchObject({ title: 'Eski iş', priority: 2, category_name: 'Kargo' });
  });
});

test('S5: önceki sürümün veritabanı yeni şemaya geçerken kayıtlar ve geçmiş korunur', async () => {
  const { db } = memoryDb();
  // Sürüm 2'deki uygulama: yalnızca ilk iki geçiş çalışmış
  const oldRepoMigrations = MIGRATIONS.slice(0, 2);
  for (let v = 0; v < oldRepoMigrations.length; v++) {
    await db.exec(oldRepoMigrations[v]);
    await db.exec(`PRAGMA user_version = ${v + 1}`);
  }
  await db.run("INSERT INTO categories (area, name, name_norm, sort_order) VALUES ('is','Kargo, Araç ve 3PL','kargo, arac ve 3pl',0)");
  await db.run(
    `INSERT INTO records (id, area, category_id, kind, title, title_norm, status, priority, created_at, updated_at, version)
     VALUES ('eski', 'is', 1, 'task', 'Eski kargo işi', 'eski kargo isi', 'open', 4, '2026-11-08T10:00:00Z', '2026-11-08T10:00:00Z', 1)`,
  );
  await db.run(
    `INSERT INTO history (record_id, action, source, version_after, created_at) VALUES ('eski', 'create', 'text', 1, '2026-11-08T10:00:00Z')`,
  );

  const repo = new Repo(db, { now: () => new Date('2026-11-14T10:00:00+03:00') });
  await repo.init();
  expect((await db.get<{ user_version: number }>('PRAGMA user_version'))?.user_version).toBe(MIGRATIONS.length);
  expect(await repo.getRecord('eski')).toMatchObject({ title: 'Eski kargo işi', priority: 4, category_name: 'Kargo, Araç ve 3PL' });
  expect(await repo.history('eski')).toHaveLength(1);
  // Var olan kategoriler korunur, başlangıç kategorileri yeniden eklenmez
  expect((await repo.categories('is')).map((c) => c.name)).toEqual(['Kargo, Araç ve 3PL']);
  await repo.setSetting('reminder_time', '08:00');
  expect(await repo.getSetting('reminder_time')).toBe('08:00');
});
