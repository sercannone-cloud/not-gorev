// Sürüm 3: saatli hatırlatma, kontrol listesi (adımlar), şema 4 ve yedek uyumu.
import { makeRepo, memoryDb } from './helpers';
import { Repo } from '../src/db/repo';
import { MIGRATIONS } from '../src/db/schema';
import { findTimeExpression, parseTimeAnswer } from '../src/domain/dates';
import { parseInput } from '../src/domain/commands';
import { answerTime, continueCommand, runIntent } from '../src/logic/commandFlow';
import { planAlarms } from '../src/domain/reminders';

const TODAY = '2026-11-09'; // Pazartesi

async function task(repo: Repo, body: string, extra: Partial<Parameters<Repo['createRecord']>[0]> = {}) {
  const r = await repo.createRecord({ area: 'is', categoryId: null, kind: 'task', body, source: 'text', ...extra });
  if (!r.ok) throw new Error(r.reason);
  return r.record;
}

describe('saat ifadeleri', () => {
  test('kesin saatler', () => {
    expect(findTimeExpression('yarın 14:30a ertele')).toMatchObject({ type: 'time', time: '14:30' });
    expect(findTimeExpression("yarın 14:30'a ertele")).toMatchObject({ type: 'time', time: '14:30' });
    expect(findTimeExpression("cuma saat 9'da hatırlat")).toMatchObject({ type: 'time', time: '09:00' });
    expect(findTimeExpression('saat 8.15te')).toMatchObject({ type: 'time', time: '08:15' });
    expect(findTimeExpression('saat 21')).toMatchObject({ type: 'time', time: '21:00' });
  });
  test('belirsiz saatler sorulur, geçersiz saat sorulur', () => {
    expect(findTimeExpression('yarın akşam ertele')).toMatchObject({ type: 'ask', question: 'Saat kaç?' });
    expect(findTimeExpression('cuma sabah')).toMatchObject({ type: 'ask' });
    expect(findTimeExpression('öğleden sonra')).toMatchObject({ type: 'ask' });
    expect(findTimeExpression('saat 25:10')).toMatchObject({ type: 'ask' });
  });
  test('saat yoksa null; tarih biçimleri saat sayılmaz', () => {
    expect(findTimeExpression('yarın ertele')).toBeNull();
    expect(findTimeExpression('15.11 ertele')).toBeNull();
    expect(findTimeExpression('3 gün sonra')).toBeNull();
  });
  test('"Saat kaç?" yanıtı', () => {
    expect(parseTimeAnswer('14:30')).toBe('14:30');
    expect(parseTimeAnswer('9')).toBe('09:00');
    expect(parseTimeAnswer('saat 18.45')).toBe('18:45');
    expect(parseTimeAnswer('akşam')).toBeNull();
    expect(parseTimeAnswer('30')).toBeNull();
  });
});

describe('saatli komutlar', () => {
  test('"yarın 14:30\'a ertele": tarih ve saat ayrılır, hedef temiz kalır', () => {
    const i = parseInput("Calibra yarın 14:30'a ertele", TODAY);
    expect(i).toMatchObject({
      kind: 'command',
      action: 'postpone',
      target: { type: 'name', name: 'Calibra' },
      date: { type: 'date', date: '2026-11-10' },
      time: { type: 'time', time: '14:30' },
    });
  });
  test('"cuma saat 9\'da hatırlat"', () => {
    const i = parseInput("Bunu cuma saat 9'da hatırlat", TODAY);
    expect(i).toMatchObject({ action: 'postpone', target: { type: 'this' }, date: { date: '2026-11-13' }, time: { time: '09:00' } });
  });
  test('"yarın akşam ertele": saat sorulur, "akşam" hedefe karışmaz', () => {
    const i = parseInput('Calibra yarın akşam ertele', TODAY);
    expect(i).toMatchObject({ action: 'postpone', target: { type: 'name', name: 'Calibra' }, time: { type: 'ask', question: 'Saat kaç?' } });
  });
  test('başlıktaki gün bölümü saat sayılmaz', () => {
    expect(parseInput('Sabah koşusu yarına ertele', TODAY)).toMatchObject({ target: { type: 'name', name: 'Sabah koşusu' }, date: { date: '2026-11-10' } });
    expect(parseInput('Akşam yemeği cumaya ertele', TODAY)).not.toHaveProperty('time');
  });
  test('saatsiz erteleme eskisi gibi', () => {
    const i = parseInput('Calibra cumaya ertele', TODAY);
    expect(i).toMatchObject({ action: 'postpone', date: { date: '2026-11-13' } });
    expect((i as { time?: unknown }).time).toBeUndefined();
  });

  test('komut akışı: belirsiz saat → "Saat kaç?" → yanıtla uygulanır', async () => {
    const { repo } = await makeRepo(TODAY);
    const r = await task(repo, 'Calibra fiyat teklifi');
    const out = await runIntent(repo, parseInput('Calibra yarın akşam ertele', repo.today()), {
      area: 'is',
      currentRecordId: null,
      source: 'text',
    });
    expect(out.type).toBe('ask_time');
    if (out.type !== 'ask_time') return;
    expect(out.question).toBe('Saat kaç?');
    // Henüz hiçbir şey değişmedi
    expect((await repo.getRecord(r.id))!.follow_up_date).toBeNull();
    const bad = await answerTime(repo, out.pending, 'akşam');
    expect(bad.type).toBe('ask_time');
    const done = await answerTime(repo, out.pending, '19:30');
    expect(done.type).toBe('applied');
    expect(await repo.getRecord(r.id)).toMatchObject({ follow_up_date: '2026-11-10', follow_up_time: '19:30' });
    if (done.type === 'applied') expect(done.message).toContain('19:30');
  });

  test('saatli komut; sonra saatsiz erteleme saati korur, tarihi kaldırmak saati de kaldırır', async () => {
    const { repo } = await makeRepo(TODAY);
    const r = await task(repo, 'Depo sayımı');
    const out = await runIntent(repo, parseInput("Depo sayımı yarın 14:30'a ertele", repo.today()), {
      area: 'is',
      currentRecordId: null,
      source: 'voice',
    });
    expect(out.type).toBe('applied');
    expect(await repo.getRecord(r.id)).toMatchObject({ follow_up_date: '2026-11-10', follow_up_time: '14:30' });
    await continueCommand(repo, { action: 'postpone', recordId: r.id, date: { type: 'date', date: '2026-11-12' }, source: 'text' });
    expect(await repo.getRecord(r.id)).toMatchObject({ follow_up_date: '2026-11-12', follow_up_time: '14:30' });
    await repo.setFollowUp(r.id, null, 'button');
    expect(await repo.getRecord(r.id)).toMatchObject({ follow_up_date: null, follow_up_time: null });
  });

  test('saat ayarı: tarih yoksa reddedilir; geri alma eski saati getirir', async () => {
    const { repo } = await makeRepo(TODAY);
    const r = await task(repo, 'Kargo firmasını ara');
    expect((await repo.setFollowUpTime(r.id, '10:00', 'button')).ok).toBe(false);
    await repo.setFollowUp(r.id, '2026-11-10', 'button');
    const a = await repo.setFollowUpTime(r.id, '10:00', 'button');
    if (!a.ok) throw new Error(a.reason);
    const b = await repo.setFollowUpTime(r.id, '16:45', 'button');
    if (!b.ok) throw new Error(b.reason);
    expect((await repo.undo(b.historyId)).ok).toBe(true);
    expect((await repo.getRecord(r.id))!.follow_up_time).toBe('10:00');
    expect((await repo.setFollowUpTime(r.id, '24:00', 'button')).ok).toBe(false);
  });
});

describe('saatli bildirim planı', () => {
  test('yalnızca açık, çöpte olmayan ve saati gelecekte olan işler planlanır', async () => {
    const { repo, clock } = await makeRepo(TODAY);
    const a = await task(repo, 'Saatli iş');
    const b = await task(repo, 'Beklemedeki iş');
    const c = await task(repo, 'Biten iş');
    const d = await task(repo, 'Çöpteki iş');
    const e = await task(repo, 'Saatsiz iş');
    const f = await task(repo, 'Saati geçmiş iş');
    for (const r of [a, b, c, d]) {
      await repo.setFollowUp(r.id, '2026-11-10', 'button', undefined, '14:30');
    }
    await repo.setFollowUp(e.id, '2026-11-10', 'button');
    await repo.setFollowUp(f.id, TODAY, 'button', undefined, '08:00');
    await repo.setStatus(b.id, 'waiting', 'button');
    await repo.setStatus(c.id, 'done', 'button');
    await repo.trash(d.id, 'button');

    const plan = planAlarms(await repo.alarmInput(), clock.current);
    expect(plan.map((p) => p.recordId)).toEqual([a.id]);
    expect(plan[0].at.toISOString()).toBe(new Date('2026-11-10T14:30:00+03:00').toISOString());
    expect(plan[0].title).toBe('Saatli iş');
  });

  test('S2: tamamlanınca plandan düşer, Geri Al ile geri gelir', async () => {
    const { repo, clock } = await makeRepo(TODAY);
    const a = await task(repo, 'Teklif gönder');
    await repo.setFollowUp(a.id, '2026-11-10', 'button', undefined, '14:30');
    const done = await repo.setStatus(a.id, 'done', 'button');
    if (!done.ok) throw new Error(done.reason);
    expect(planAlarms(await repo.alarmInput(), clock.current)).toHaveLength(0);
    await repo.undo(done.historyId);
    expect(planAlarms(await repo.alarmInput(), clock.current).map((p) => p.recordId)).toEqual([a.id]);
  });
});

describe('kontrol listesi', () => {
  test('S3: üç adım, ikisi işaretli "2/3"; hepsi işaretlenince iş kendiliğinden kapanmaz', async () => {
    const { repo } = await makeRepo(TODAY);
    const r = await task(repo, 'Yıl sonu sayımı');
    const ids: string[] = [];
    for (const body of ['Sayım ekibini belirle', 'Etiketleri bas', 'Farkları raporla']) {
      const res = await repo.addStep(r.id, body, 'text');
      if (!res.ok) throw new Error(res.reason);
      ids.push((await repo.steps(r.id)).at(-1)!.id);
    }
    expect((await repo.steps(r.id)).map((s) => s.body)).toEqual(['Sayım ekibini belirle', 'Etiketleri bas', 'Farkları raporla']);
    await repo.toggleStep(ids[0], 'button');
    const two = await repo.toggleStep(ids[1], 'button');
    if (!two.ok) throw new Error(two.reason);
    expect(two.record).toMatchObject({ steps_total: 3, steps_done: 2 });
    // Liste sorgularında da sayılar gelir
    expect((await repo.listOpen('is')).find((x) => x.id === r.id)).toMatchObject({ steps_total: 3, steps_done: 2 });
    const all = await repo.toggleStep(ids[2], 'button');
    if (!all.ok) throw new Error(all.reason);
    expect(all.record).toMatchObject({ steps_total: 3, steps_done: 3, status: 'open' });
  });

  test('işaret, ad değişikliği, silme ve sıra değişikliği Geri Al ile geri alınır', async () => {
    const { repo } = await makeRepo(TODAY);
    const r = await task(repo, 'Araç bakımı');
    await repo.addStep(r.id, 'Randevu al', 'text');
    await repo.addStep(r.id, 'Lastikleri sor', 'text');
    const [s1, s2] = await repo.steps(r.id);

    const t = await repo.toggleStep(s1.id, 'button');
    if (!t.ok) throw new Error(t.reason);
    expect((await repo.steps(r.id))[0].done_at).not.toBeNull();
    await repo.undo(t.historyId);
    expect((await repo.steps(r.id))[0].done_at).toBeNull();

    const n = await repo.renameStep(s2.id, 'Kış lastiği sor', 'button');
    if (!n.ok) throw new Error(n.reason);
    expect((await repo.steps(r.id))[1].body).toBe('Kış lastiği sor');
    await repo.undo(n.historyId);
    expect((await repo.steps(r.id))[1].body).toBe('Lastikleri sor');

    const m = await repo.moveStep(s2.id, -1, 'button');
    if (!m.ok) throw new Error(m.reason);
    expect((await repo.steps(r.id)).map((s) => s.id)).toEqual([s2.id, s1.id]);
    await repo.undo(m.historyId);
    expect((await repo.steps(r.id)).map((s) => s.id)).toEqual([s1.id, s2.id]);

    const d = await repo.deleteStep(s1.id, 'button');
    if (!d.ok) throw new Error(d.reason);
    expect((await repo.steps(r.id)).map((s) => s.id)).toEqual([s2.id]);
    expect(d.record.steps_total).toBe(1);
    await repo.undo(d.historyId);
    expect((await repo.steps(r.id)).map((s) => s.id)).toEqual([s1.id, s2.id]);

    // Eklemeyi geri almak adımı kaldırır
    const a = await repo.addStep(r.id, 'Faturayı sakla', 'text');
    if (!a.ok) throw new Error(a.reason);
    expect(await repo.steps(r.id)).toHaveLength(3);
    await repo.undo(a.historyId);
    expect(await repo.steps(r.id)).toHaveLength(2);
    // Geçmişte görünür
    expect((await repo.history(r.id)).some((h) => h.action === 'step' && h.detail?.includes('Faturayı sakla'))).toBe(true);
  });

  test('bağımsız notta, çöpteki kayıtta ve boş metinle adım eklenmez', async () => {
    const { repo } = await makeRepo(TODAY);
    const note = await repo.createRecord({ area: 'is', categoryId: null, kind: 'note', body: 'Toplantı notu', source: 'text' });
    if (!note.ok) throw new Error(note.reason);
    expect((await repo.addStep(note.record.id, 'Adım', 'text')).ok).toBe(false);
    const r = await task(repo, 'Bir iş');
    expect((await repo.addStep(r.id, '   ', 'text')).ok).toBe(false);
    await repo.trash(r.id, 'button');
    expect((await repo.addStep(r.id, 'Adım', 'text')).ok).toBe(false);
  });

  test('"Adım ekle:" komutu', async () => {
    const { repo } = await makeRepo(TODAY);
    const r = await task(repo, 'Calibra teklifi');
    expect(parseInput('Adım ekle: fiyatları karşılaştır', TODAY)).toMatchObject({
      action: 'add_step',
      target: { type: 'none' },
      noteText: 'fiyatları karşılaştır',
    });
    expect(parseInput('Calibra kaydına adım ekle: müşteriyi ara', TODAY)).toMatchObject({
      action: 'add_step',
      target: { type: 'name', name: 'Calibra kaydına' },
      noteText: 'müşteriyi ara',
    });
    const out = await runIntent(repo, parseInput('Adım ekle: fiyatları karşılaştır', TODAY), {
      area: 'is',
      currentRecordId: r.id,
      source: 'voice',
    });
    expect(out.type).toBe('applied');
    expect((await repo.steps(r.id)).map((s) => s.body)).toEqual(['fiyatları karşılaştır']);
  });
});

describe('şema 4 ve yedek', () => {
  test('şema 3 veritabanı 4\'e yükselir, eski kayıtlar ve geçmiş korunur', async () => {
    const { db, raw } = memoryDb();
    // Eski uygulama: yalnızca ilk üç geçiş
    const old = new Repo(db);
    for (let v = 0; v < 3; v++) {
      raw.exec(MIGRATIONS[v]);
      raw.exec(`PRAGMA user_version = ${v + 1}`);
    }
    raw.exec(`INSERT INTO records (id, area, kind, title, title_norm, status, follow_up_date, created_at, updated_at, version, priority)
              VALUES ('eski1','is','task','Eski iş','eski is','open','2026-11-10','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z',1,3)`);
    raw.exec(`INSERT INTO history (record_id, action, source, version_after, created_at) VALUES ('eski1','create','text',1,'2026-11-01T00:00:00Z')`);
    raw.exec(`INSERT INTO settings (key, value) VALUES ('reminder_time','08:30')`);
    await old.init();
    expect(raw.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
    expect(MIGRATIONS.length).toBe(4);
    expect(await old.getRecord('eski1')).toMatchObject({ title: 'Eski iş', priority: 3, follow_up_date: '2026-11-10', follow_up_time: null });
    expect(await old.history('eski1')).toHaveLength(1);
    expect(await old.getSetting('reminder_time')).toBe('08:30');
    expect(await old.steps('eski1')).toEqual([]);
  });

  test('yedek saat ve adımları taşır', async () => {
    const a = await makeRepo(TODAY);
    const r = await task(a.repo, 'Sevkiyat planı');
    await a.repo.setFollowUp(r.id, '2026-11-10', 'button', undefined, '09:15');
    await a.repo.addStep(r.id, 'Araçları ayarla', 'text');
    const [st] = await a.repo.steps(r.id);
    await a.repo.toggleStep(st.id, 'button');
    const backup = JSON.parse(JSON.stringify(await a.repo.exportData()));
    expect(backup.schemaVersion).toBe(4);

    const b = await makeRepo(TODAY);
    const res = await b.repo.importData(backup);
    expect(res.ok).toBe(true);
    expect(await b.repo.getRecord(r.id)).toMatchObject({ follow_up_time: '09:15', steps_total: 1, steps_done: 1 });
    expect((await b.repo.steps(r.id)).map((s) => s.body)).toEqual(['Araçları ayarla']);
  });

  test('şema 3 yedeği (adım tablosu ve saat sütunu yok) içe aktarılır', async () => {
    const a = await makeRepo(TODAY);
    const r = await task(a.repo, 'Eski yedekteki iş');
    await a.repo.setFollowUp(r.id, '2026-11-10', 'button');
    const backup = JSON.parse(JSON.stringify(await a.repo.exportData()));
    // Şema 3 biçimine çevir
    backup.schemaVersion = 3;
    delete backup.tables.checklist_items;
    for (const row of backup.tables.records) delete row.follow_up_time;

    const b = await makeRepo(TODAY);
    await task(b.repo, 'Silinecek mevcut kayıt');
    const res = await b.repo.importData(backup);
    expect(res).toEqual({ ok: true, records: 1 });
    expect(await b.repo.getRecord(r.id)).toMatchObject({ follow_up_date: '2026-11-10', follow_up_time: null, steps_total: 0 });
    expect((await b.repo.listOpen('is')).map((x) => x.title)).toEqual(['Eski yedekteki iş']);
  });
});
