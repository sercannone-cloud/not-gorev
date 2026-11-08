// Master prompt'taki kabul senaryoları (ses gerektirenler hariç) veri ve komut
// katmanında, gerçek SQLite (better-sqlite3) ile doğrulanır.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { makeRepo } from './helpers';
import { parseInput } from '../src/domain/commands';
import { runIntent, answerDate, confirmTrash, continueCommand } from '../src/app/commandFlow';
import { Repo } from '../src/db/repo';

async function catId(repo: Repo, area: 'is' | 'ozel', name: string) {
  const c = (await repo.categories(area)).find((x) => x.name === name);
  if (!c) throw new Error('kategori yok: ' + name);
  return c.id;
}

test('başlangıç kategorileri; Medikal yok', async () => {
  const { repo } = await makeRepo();
  const is = (await repo.categories('is')).map((c) => c.name);
  expect(is).toHaveLength(8);
  expect(is.some((n) => /medikal/i.test(n))).toBe(false);
  expect((await repo.categories('ozel')).map((c) => c.name)).toContain('Aile');
});

test('1) Kızıma ayakkabı: Özel/Aile, tarihsiz açık iş, Bugün’de görünmez', async () => {
  const { repo } = await makeRepo();
  const text = 'Kızıma ayakkabı alınacak';
  expect(parseInput(text, repo.today()).kind).toBe('note');
  const res = await repo.createRecord({
    area: 'ozel',
    categoryId: await catId(repo, 'ozel', 'Aile'),
    kind: 'task',
    body: text,
    source: 'text',
  });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.record).toMatchObject({ status: 'open', follow_up_date: null, title: text, category_name: 'Aile' });
  const today = await repo.listToday('ozel');
  expect([...today.today, ...today.overdue].length).toBe(0);
  expect((await repo.listOpen('ozel')).map((r) => r.id)).toContain(res.record.id);
  // İş alanında görünmez
  expect((await repo.listOpen('is')).length).toBe(0);
});

test('2) Kategorisiz kayıt Sınıflandırılacak’a düşer, sonra kategori atanır', async () => {
  const { repo } = await makeRepo();
  const res = await repo.createRecord({ area: 'is', categoryId: null, kind: 'note', body: 'Hızlı not', source: 'text' });
  if (!res.ok) throw new Error(res.reason);
  expect((await repo.listUnclassified('is')).map((r) => r.id)).toEqual([res.record.id]);
  const edit = await repo.editRecord(res.record.id, { categoryId: await catId(repo, 'is', 'İade ve Mutabakat') }, 'button');
  expect(edit.ok).toBe(true);
  expect(await repo.listUnclassified('is')).toHaveLength(0);
});

test('3) Kategori tahmini yok; kullanıcı Stok, Sayım ve SKT seçer', async () => {
  const { repo } = await makeRepo();
  const text = 'İstanbul sayımında tester farkı çıktı';
  expect(parseInput(text, repo.today())).toEqual({ kind: 'note', text });
  const res = await repo.createRecord({
    area: 'is',
    categoryId: await catId(repo, 'is', 'Stok, Sayım ve SKT'),
    kind: 'task',
    body: text,
    source: 'text',
  });
  if (!res.ok) throw new Error(res.reason);
  expect(res.record.category_name).toBe('Stok, Sayım ve SKT');
  expect((await repo.search('is', 'TESTER')).map((h) => h.record.id)).toEqual([res.record.id]);
  expect((await repo.search('is', 'istanbul')).length).toBe(1);
  expect((await repo.search('is', 'İSTANBUL')).length).toBe(1);
});

test('4) Calibra farkı: ikinci gün elle seçilen kayda gelişme; aramada iki gelişme', async () => {
  const { repo, clock } = await makeRepo('2026-11-09');
  const res = await repo.createRecord({
    area: 'is',
    categoryId: await catId(repo, 'is', 'Mal Kabul ve İthalat'),
    kind: 'task',
    title: 'Calibra konteyner miktar farkı',
    body: 'Depodan mal kabul raporu istendi.',
    source: 'text',
  });
  if (!res.ok) throw new Error(res.reason);
  clock.set('2026-11-10');
  const pick = await repo.search('is', 'calibra');
  expect(pick).toHaveLength(1);
  const add = await repo.addEntry({ recordId: pick[0].record.id, body: 'Satın almaya iletildi.', source: 'text' });
  expect(add.ok).toBe(true);
  if (!add.ok) return;
  expect(add.record.status).toBe('open'); // not eklemek işi kapatmaz
  const hits = await repo.search('is', 'Calibra');
  expect(hits).toHaveLength(1);
  const entries = await repo.entries(hits[0].record.id);
  expect(entries.map((e) => e.body)).toEqual(['Depodan mal kabul raporu istendi.', 'Satın almaya iletildi.']);
  expect(entries[0].created_at.slice(0, 10)).toBe('2026-11-09');
  expect(entries[1].created_at.slice(0, 10)).toBe('2026-11-10');
  // Arama gelişme metninde de çalışır
  expect((await repo.search('is', 'satin almaya'))[0].entries.map((e) => e.body)).toEqual(['Satın almaya iletildi.']);
});

test('5) Detayda "Bunu cumaya ertele": tarih değişir, geri alınır; listede hedef sorulur', async () => {
  const { repo } = await makeRepo('2026-11-09');
  const res = await repo.createRecord({ area: 'ozel', categoryId: null, kind: 'task', title: 'Kombi bakımı', body: 'Kombi bakımı yaptırılacak', source: 'text' });
  if (!res.ok) throw new Error(res.reason);
  const intent = parseInput('Bunu cumaya ertele', repo.today());

  const inDetail = await runIntent(repo, intent, { area: 'ozel', currentRecordId: res.record.id, source: 'text' });
  expect(inDetail.type).toBe('applied');
  if (inDetail.type !== 'applied') return;
  expect(inDetail.record.follow_up_date).toBe('2026-11-13');
  expect(inDetail.message).toContain('13 Kasım 2026 Cuma');

  const undo = await repo.undo(inDetail.historyId);
  expect(undo.ok).toBe(true);
  expect((await repo.getRecord(res.record.id))!.follow_up_date).toBeNull();

  const inList = await runIntent(repo, intent, { area: 'ozel', currentRecordId: null, source: 'text' });
  expect(inList).toMatchObject({ type: 'ask_target', question: 'Hangi kayıt?' });
});

test('5b) Eksik tarih sorulur, "cuma" yanıtıyla tamamlanır; beklet yalnızca durumu değiştirir', async () => {
  const { repo } = await makeRepo('2026-11-09');
  const res = await repo.createRecord({ area: 'ozel', categoryId: null, kind: 'task', title: 'Araç bakımı', body: 'Araç bakımı', source: 'text' });
  if (!res.ok) throw new Error(res.reason);
  const ask = await runIntent(repo, parseInput('Bakım işini ertele', repo.today()), { area: 'ozel', currentRecordId: null, source: 'voice' });
  expect(ask.type).toBe('ask_date');
  if (ask.type !== 'ask_date') return;
  const done = await answerDate(repo, ask.pending, 'cuma', repo.today());
  expect(done).toMatchObject({ type: 'applied' });
  const r = (await repo.getRecord(res.record.id))!;
  expect(r.follow_up_date).toBe('2026-11-13');
  expect(r.status).toBe('open');
  const hold = await runIntent(repo, parseInput('Bakım işini beklet', repo.today()), { area: 'ozel', currentRecordId: null, source: 'text' });
  expect(hold.type).toBe('applied');
  const r2 = (await repo.getRecord(res.record.id))!;
  expect(r2.status).toBe('waiting');
  expect(r2.follow_up_date).toBe('2026-11-13');
  // Sesli kaynak geçmişte ayrı tutulur
  const hist = await repo.history(res.record.id);
  expect(hist.find((h) => h.action === 'set_follow_up')!.source).toBe('voice');
});

test('5c) Geri alma sonraki değişikliği ezmez', async () => {
  const { repo } = await makeRepo();
  const res = await repo.createRecord({ area: 'is', categoryId: null, kind: 'task', body: 'Sayım planı', source: 'text' });
  if (!res.ok) throw new Error(res.reason);
  const a = await repo.setFollowUp(res.record.id, '2026-11-13', 'text');
  await repo.setStatus(res.record.id, 'waiting', 'button');
  if (!a.ok) throw new Error();
  const u = await repo.undo(a.historyId);
  expect(u.ok).toBe(false);
  expect((await repo.getRecord(res.record.id))!.follow_up_date).toBe('2026-11-13');
});

test('Birden fazla eşleşmede en fazla üç aday, kendiliğinden seçim yok', async () => {
  const { repo } = await makeRepo();
  for (const t of ['Bakım servis', 'Bakım kombi', 'Bakım araç', 'Bakım klima']) {
    await repo.createRecord({ area: 'ozel', categoryId: null, kind: 'task', title: t, body: t, source: 'text' });
  }
  const out = await runIntent(repo, parseInput('Bakım işini tamamla', repo.today()), { area: 'ozel', currentRecordId: null, source: 'text' });
  expect(out.type).toBe('ask_target');
  if (out.type !== 'ask_target') return;
  expect(out.candidates).toHaveLength(3);
  const chosen = await continueCommand(repo, { ...out.pending, recordId: out.candidates[1].id });
  expect(chosen.type).toBe('applied');
  const open = await repo.listOpen('ozel');
  expect(open).toHaveLength(3);
});

test('Eşleşmeyen komut metni not taslağı olarak kalır', async () => {
  const { repo } = await makeRepo();
  const out = await runIntent(repo, parseInput('Raporu tamamla', repo.today()), { area: 'is', currentRecordId: null, source: 'text' });
  expect(out.type).toBe('not_command');
});

test('6) Her pazar fatura kontrolü: haftalar ayrı izlenir, kaçanlar açık kalır, ikinci örnek yok', async () => {
  const { repo, clock } = await makeRepo('2026-11-08'); // Pazar
  const intent = parseInput('Her pazar faturalar ödendi mi kontrol et', repo.today());
  expect(intent.kind).toBe('recurrence');
  if (intent.kind !== 'recurrence') return;
  const rec = await repo.createRecurrence({ area: 'ozel', categoryId: await catId(repo, 'ozel', 'Ev ve Faturalar'), title: intent.title, weekday: intent.weekday, source: 'text' });
  expect(rec.ok).toBe(true);
  let today = await repo.listToday('ozel');
  expect(today.recurring).toHaveLength(1);
  const week1 = today.recurring[0].latest;
  expect(week1.follow_up_date).toBe('2026-11-08');

  // İki hafta sonra: üç hafta oluşur, ilk hafta tamamlanır
  clock.set('2026-11-22');
  await repo.ensureRecurrences();
  await repo.ensureRecurrences(); // tekrar çağrı ikinci örnek oluşturmaz
  const done = await repo.setStatus(week1.id, 'done', 'button');
  expect(done.ok).toBe(true);
  today = await repo.listToday('ozel');
  expect(today.recurring).toHaveLength(1); // tek satırda özet
  expect(today.recurring[0].latest.follow_up_date).toBe('2026-11-22');
  expect(today.recurring[0].olderOpen.map((r) => r.follow_up_date)).toEqual(['2026-11-15']);
  // Bu haftayı çöpe taşımak diğerlerini etkilemez ve yeniden oluşmaz
  await repo.trash(today.recurring[0].latest.id, 'button');
  await repo.ensureRecurrences();
  today = await repo.listToday('ozel');
  expect(today.recurring[0].latest.follow_up_date).toBe('2026-11-15');
  expect(today.recurring[0].olderOpen).toHaveLength(0);
  expect((await repo.getRecord(week1.id))!.status).toBe('done');
});

test('7) "Araba araştırmasını sil": hedef ve onay, geçmişiyle çöpe, geri yükleme', async () => {
  const { repo } = await makeRepo();
  const res = await repo.createRecord({ area: 'ozel', categoryId: await catId(repo, 'ozel', 'Araç'), kind: 'task', title: 'Araba araştırması', body: 'İki model bulundu', source: 'text' });
  if (!res.ok) throw new Error(res.reason);
  await repo.addEntry({ recordId: res.record.id, body: 'Test sürüşü randevusu alındı', source: 'text' });
  const out = await runIntent(repo, parseInput('Araba araştırmasını sil', repo.today()), { area: 'ozel', currentRecordId: null, source: 'voice' });
  expect(out.type).toBe('confirm_trash');
  if (out.type !== 'confirm_trash') return;
  expect(out.record.title).toBe('Araba araştırması');
  expect((await repo.getRecord(res.record.id))!.deleted_at).toBeNull(); // onaysız silinmez
  const t = await confirmTrash(repo, out.pending);
  expect(t.type).toBe('applied');
  expect((await repo.listTrash()).map((r) => r.id)).toEqual([res.record.id]);
  expect(await repo.listOpen('ozel')).toHaveLength(0);
  expect(await repo.search('ozel', 'araba')).toHaveLength(0);
  await repo.restore(res.record.id, 'button');
  expect(await repo.entries(res.record.id)).toHaveLength(2);
  expect((await repo.listOpen('ozel')).map((r) => r.id)).toEqual([res.record.id]);
});

test('Aynı gönderim iki kez işlenmez', async () => {
  const { repo } = await makeRepo();
  const a = await repo.createRecord({ area: 'is', categoryId: null, kind: 'task', body: 'X', source: 'text', submissionId: 's1' });
  const b = await repo.createRecord({ area: 'is', categoryId: null, kind: 'task', body: 'X', source: 'text', submissionId: 's1' });
  expect(a.ok).toBe(true);
  expect(b).toMatchObject({ ok: false, duplicate: true });
  expect(await repo.listOpen('is')).toHaveLength(1);
});

test('Ara adımlar ve notlar ana işi kapatmaz; sonraki adım görünür', async () => {
  const { repo } = await makeRepo();
  const res = await repo.createRecord({ area: 'ozel', categoryId: null, kind: 'task', title: 'Yatak araştırması', body: 'Yatak alınacak', source: 'text' });
  if (!res.ok) throw new Error();
  await repo.addEntry({ recordId: res.record.id, body: 'Yatak için iki model buldum', source: 'voice' });
  const ns = await repo.addEntry({ recordId: res.record.id, body: 'Cuma mağazayı arayacağım', entryType: 'next_step', followUpDate: '2026-11-13', source: 'text' });
  if (!ns.ok) throw new Error();
  expect(ns.record).toMatchObject({ status: 'open', next_step: 'Cuma mağazayı arayacağım', follow_up_date: '2026-11-13', last_entry_body: 'Cuma mağazayı arayacağım' });
});

test('Beklemedeki işin takip tarihi gelince Bugün’de görünür', async () => {
  const { repo, clock } = await makeRepo('2026-11-09');
  const res = await repo.createRecord({ area: 'is', categoryId: null, kind: 'task', body: 'İade mutabakatı', source: 'text' });
  if (!res.ok) throw new Error();
  await repo.setStatus(res.record.id, 'waiting', 'button');
  await repo.setFollowUp(res.record.id, '2026-11-11', 'button');
  expect((await repo.listToday('is')).today).toHaveLength(0);
  clock.set('2026-11-11');
  expect((await repo.listToday('is')).today.map((r) => r.id)).toEqual([res.record.id]);
  clock.set('2026-11-12');
  expect((await repo.listToday('is')).overdue.map((r) => r.id)).toEqual([res.record.id]);
});

test('10) Uygulama kapatılıp açılınca veriler korunur', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notgorev-')), 'db.sqlite');
  const first = await makeRepo('2026-11-08', file);
  const r = await first.repo.createRecord({ area: 'is', categoryId: null, kind: 'task', body: 'Kalıcı iş', source: 'text' });
  if (!r.ok) throw new Error();
  await first.repo.addEntry({ recordId: r.record.id, body: 'İkinci gelişme', source: 'text' });
  await first.repo.createRecurrence({ area: 'ozel', categoryId: null, title: 'Fatura kontrolü', weekday: 0, source: 'text' });
  const week = (await first.repo.listToday('ozel')).recurring[0].latest;
  await first.repo.setStatus(week.id, 'done', 'button');
  first.raw.close();

  const second = await makeRepo('2026-11-08', file);
  expect((await second.repo.listOpen('is')).map((x) => x.title)).toEqual(['Kalıcı iş']);
  expect(await second.repo.entries(r.record.id)).toHaveLength(2);
  expect((await second.repo.getRecord(week.id))!.status).toBe('done');
  expect((await second.repo.history(r.record.id)).length).toBe(2);
  expect(await second.repo.categories('is')).toHaveLength(8); // tohumlama tekrarlanmaz
});
