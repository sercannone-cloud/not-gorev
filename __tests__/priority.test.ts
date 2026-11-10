// Önem derecesi ve günlük tamamlananlar: veri katmanı, komutlar ve sürüm yükseltme.
import { makeRepo, memoryDb } from './helpers';
import { parseInput } from '../src/domain/commands';
import { detectPriority, stripPriorityShortcuts } from '../src/domain/priority';
import { runIntent } from '../src/logic/commandFlow';
import { MIGRATIONS } from '../src/db/schema';
import { Repo } from '../src/db/repo';
import { formatTime, istanbulDayOf, istanbulDayStartIso } from '../src/domain/dates';

describe('Önem algılama', () => {
  test('anahtar sözcükler ve kısayollar', () => {
    expect(detectPriority('Faturayı acil öde')).toEqual({ priority: 4, match: 'acil' });
    expect(detectPriority('KRİTİK: sevkiyat durdu')?.priority).toBe(4);
    expect(detectPriority('Çok önemli toplantı notu')?.priority).toBe(3);
    expect(detectPriority('Önemli değil, boş vakitte bak')?.priority).toBe(1);
    expect(detectPriority('Raf düzeni !d')).toEqual({ priority: 1, match: '!d' });
    expect(detectPriority('İrsaliye kontrol !!!')?.priority).toBe(4);
    expect(detectPriority('İrsaliye kontrol !!')?.priority).toBe(3);
    expect(detectPriority('Kızıma ayakkabı alınacak')).toBeNull();
    // Sözcük içinde geçen "acil" sayılmaz
    expect(detectPriority('Racil firması aradı')).toBeNull();
  });

  test('kısayollar metinden temizlenir', () => {
    expect(stripPriorityShortcuts('İrsaliye kontrol !!!')).toBe('İrsaliye kontrol');
    expect(stripPriorityShortcuts('!! Depo sayımı\nikinci satır !d')).toBe('Depo sayımı\nikinci satır');
    expect(stripPriorityShortcuts('Merhaba!')).toBe('Merhaba!');
  });

  test('komut: "<hedef> kritik yap"', () => {
    const t = '2026-11-09';
    expect(parseInput('Bunu kritik yap', t)).toEqual({ kind: 'command', action: 'set_priority', target: { type: 'this' }, priority: 4 });
    expect(parseInput('Calibra farkını acil olarak işaretle', t)).toMatchObject({ action: 'set_priority', target: { type: 'name', name: 'Calibra farkını' }, priority: 4 });
    expect(parseInput('Raf düzeninin önceliğini düşük yap', t)).toMatchObject({ action: 'set_priority', priority: 1 });
    expect(parseInput('Bunu orta öncelikli yap', t)).toMatchObject({ action: 'set_priority', priority: 2 });
    // Tarih değiştirme komutu bozulmaz
    expect(parseInput('Takip tarihini cuma yap', t)).toMatchObject({ action: 'postpone' });
  });
});

describe('Önem derecesi veri katmanı', () => {
  test('varsayılan Orta; oluştururken verilebilir; değiştirilir ve geri alınır', async () => {
    const { repo } = await makeRepo();
    const a = await repo.createRecord({ area: 'is', categoryId: null, kind: 'task', body: 'Normal iş', source: 'text' });
    const b = await repo.createRecord({ area: 'is', categoryId: null, kind: 'task', body: 'Kritik iş', priority: 4, source: 'text' });
    if (!a.ok || !b.ok) throw new Error();
    expect(a.record.priority).toBe(2);
    expect(b.record.priority).toBe(4);

    const set = await repo.setPriority(a.record.id, 3, 'button');
    if (!set.ok) throw new Error(set.reason);
    expect(set.record.priority).toBe(3);
    expect((await repo.history(a.record.id)).pop()).toMatchObject({ action: 'set_priority', detail: 'Önem: Orta → Yüksek' });

    expect(await repo.setPriority(a.record.id, 3, 'button')).toMatchObject({ ok: false });

    const undo = await repo.undo(set.historyId);
    expect(undo.ok && undo.record.priority).toBe(2);

    const note = await repo.createRecord({ area: 'is', categoryId: null, kind: 'note', body: 'Not', source: 'text' });
    if (!note.ok) throw new Error();
    expect(await repo.setPriority(note.record.id, 4, 'button')).toMatchObject({ ok: false });
  });

  test('Açık İşler’de aynı kategoride önce yüksek önem; Bugün’de de', async () => {
    const { repo } = await makeRepo();
    const today = repo.today();
    for (const [body, priority] of [['Düşük', 1], ['Kritik', 4], ['Orta', 2]] as const) {
      await repo.createRecord({ area: 'is', categoryId: null, kind: 'task', body, priority, followUpDate: today, source: 'text' });
    }
    expect((await repo.listOpen('is')).map((r) => r.title)).toEqual(['Kritik', 'Orta', 'Düşük']);
    expect((await repo.listToday('is')).today.map((r) => r.title)).toEqual(['Kritik', 'Orta', 'Düşük']);
  });

  test('komut akışı: adla önem değiştirir', async () => {
    const { repo } = await makeRepo();
    await repo.createRecord({ area: 'is', categoryId: null, kind: 'task', title: 'Calibra farkı', body: 'x', source: 'text' });
    const out = await runIntent(repo, parseInput('Calibra farkını kritik yap', repo.today()), { area: 'is', currentRecordId: null, source: 'voice' });
    expect(out).toMatchObject({ type: 'applied', message: '"Calibra farkı" önem derecesi: Kritik.' });
  });
});

describe('Günlük tamamlananlar', () => {
  test('İstanbul gününe göre bugün tamamlananlar, en son biten önce', async () => {
    const { repo, clock } = await makeRepo('2026-11-09');
    const ids: string[] = [];
    for (const t of ['Dün biten', 'Sabah biten', 'Öğlen biten', 'Açık kalan']) {
      const r = await repo.createRecord({ area: 'is', categoryId: null, kind: 'task', body: t, source: 'text' });
      if (!r.ok) throw new Error();
      ids.push(r.record.id);
    }
    clock.set('2026-11-08', '23:30');
    await repo.setStatus(ids[0], 'done', 'button');
    clock.set('2026-11-09', '00:10'); // UTC'de hâlâ 8 Kasım
    await repo.setStatus(ids[1], 'done', 'button');
    clock.set('2026-11-09', '12:00');
    await repo.setStatus(ids[2], 'done', 'button');
    expect((await repo.listCompletedToday('is')).map((r) => r.title)).toEqual(['Öğlen biten', 'Sabah biten']);
    expect(await repo.listCompletedToday('ozel')).toHaveLength(0);
  });

  test('tarih yardımcıları', () => {
    expect(istanbulDayStartIso('2026-11-09')).toBe('2026-11-08T21:00:00.000Z');
    expect(istanbulDayOf('2026-11-08T21:10:00.000Z')).toBe('2026-11-09');
    expect(formatTime('2026-11-09T06:12:00.000Z')).toBe('09:12');
  });
});

test('sürüm yükseltme: eski veritabanı önem alanını Orta olarak alır, eski geçmiş geri alınabilir', async () => {
  const { db, raw } = memoryDb();
  raw.exec(MIGRATIONS[0]);
  raw.exec('PRAGMA user_version = 1');
  const old = new Repo(db);
  // Eski sürümün yazdığı kayıt ve geçmiş (priority alanı olmadan)
  raw.prepare(
    `INSERT INTO records (id, area, kind, title, title_norm, status, created_at, updated_at, version)
     VALUES ('r1','is','task','Eski iş','eski is','done','2026-11-01T10:00:00Z','2026-11-01T10:00:00Z',2)`,
  ).run();
  const before = { area: 'is', category_id: null, kind: 'task', title: 'Eski iş', status: 'open', next_step: null, follow_up_date: null, completed_at: null, deleted_at: null };
  raw.prepare(
    `INSERT INTO history (record_id, action, source, before_json, after_json, version_after, created_at)
     VALUES ('r1','complete','button',?, '{}', 2, '2026-11-01T10:00:00Z')`,
  ).run(JSON.stringify(before));
  await old.init();
  expect(raw.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
  const rec = await old.getRecord('r1');
  expect(rec?.priority).toBe(2);
  const h = (await old.history('r1'))[0];
  const undo = await old.undo(h.id);
  expect(undo.ok && undo.record).toMatchObject({ status: 'open', priority: 2 });
});
