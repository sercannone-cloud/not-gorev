import { fold, trLower, searchTokens } from '../src/domain/turkish';
import { findDateExpression, istanbulToday, mondayOf, formatDayLong } from '../src/domain/dates';
import { parseInput } from '../src/domain/commands';

const MON = '2026-11-09'; // Pazartesi

describe('Türkçe metin', () => {
  test('I/İ kuralları', () => {
    expect(trLower('IŞIK İSTANBUL')).toBe('ışık istanbul');
    expect(fold('KIZIMA AYAKKABI')).toBe(fold('kızıma ayakkabı'));
    expect(fold('Çarşamba')).toBe('carsamba');
  });
  test('uzunluk korunur', () => {
    const s = 'İstanbul sayımında TESTER farkı çıktı';
    expect(fold(s).length).toBe(s.length);
  });
  test('arama sözcükleri', () => {
    expect(searchTokens('  Calibra, İRS-2024/77 ')).toEqual(['calibra', 'irs-2024/77']);
  });
});

describe('Tarih çözümleyici (Europe/Istanbul)', () => {
  test('İstanbul günü UTC gece yarısını doğru çevirir', () => {
    expect(istanbulToday(new Date('2026-11-08T22:30:00Z'))).toBe('2026-11-09');
    expect(istanbulToday(new Date('2026-11-08T20:30:00Z'))).toBe('2026-11-08');
  });
  test('bugün, yarın, gün adları', () => {
    expect(findDateExpression('bugün', MON)).toMatchObject({ type: 'date', date: MON });
    expect(findDateExpression('yarına', MON)).toMatchObject({ type: 'date', date: '2026-11-10' });
    expect(findDateExpression('cumaya', MON)).toMatchObject({ type: 'date', date: '2026-11-13' });
    expect(findDateExpression('cuma günü', MON)).toMatchObject({ type: 'date', date: '2026-11-13' });
    expect(findDateExpression('cumartesiye', MON)).toMatchObject({ type: 'date', date: '2026-11-14' });
    // Aynı gün söylenirse bir sonraki hafta
    expect(findDateExpression('pazartesi', MON)).toMatchObject({ type: 'date', date: '2026-11-16' });
    expect(findDateExpression('haftaya salı', MON)).toMatchObject({ type: 'date', date: '2026-11-17' });
  });
  test('kesin tarihler', () => {
    expect(findDateExpression('15.11', MON)).toMatchObject({ date: '2026-11-15' });
    expect(findDateExpression('3 ocak', MON)).toMatchObject({ date: '2027-01-03' });
    expect(findDateExpression('20 kasıma', MON)).toMatchObject({ date: '2026-11-20' });
    expect(findDateExpression('3 gün sonra', MON)).toMatchObject({ date: '2026-11-12' });
  });
  test('gün belirtmeyen ifade için "Hangi gün?"', () => {
    expect(findDateExpression('gelecek ay', MON)).toMatchObject({ type: 'ask', question: 'Hangi gün?' });
    expect(findDateExpression('haftaya', MON)).toMatchObject({ type: 'ask' });
  });
  test('biçim ve hafta başı', () => {
    expect(formatDayLong('2026-11-13')).toBe('13 Kasım 2026 Cuma');
    expect(mondayOf('2026-11-15')).toBe(MON);
  });
});

describe('Komut yorumlayıcısı', () => {
  test('notlar komut sayılmaz', () => {
    expect(parseInput('Servisi cuma arayacağım', MON).kind).toBe('note');
    expect(parseInput('Cuma servisi arayacağım', MON).kind).toBe('note');
    expect(parseInput('Bu koliden iki kampanyalı ürün çıkıyor', MON).kind).toBe('note');
    expect(parseInput('Kızıma ayakkabı alınacak', MON).kind).toBe('note');
    expect(parseInput('Servisten fiyat aldım', MON).kind).toBe('note');
  });
  test('Bunu cumaya ertele', () => {
    expect(parseInput('Bunu cumaya ertele', MON)).toEqual({
      kind: 'command',
      action: 'postpone',
      target: { type: 'this' },
      date: { type: 'date', date: '2026-11-13' },
    });
  });
  test('Bakım işini cumaya ertele (adla, tarih değiştirme)', () => {
    expect(parseInput('Bakım işini cumaya ertele.', MON)).toEqual({
      kind: 'command',
      action: 'postpone',
      target: { type: 'name', name: 'Bakım işini' },
      date: { type: 'date', date: '2026-11-13' },
    });
  });
  test('tarih eksikse missing, belirsizse ask', () => {
    expect(parseInput('bunu ertele', MON)).toMatchObject({ date: { type: 'missing' } });
    expect(parseInput('bunu gelecek aya ertele', MON)).toMatchObject({ date: { type: 'ask' } });
  });
  test('beklet yalnızca durum, sil, tamamla, yeniden aç, aç', () => {
    expect(parseInput('Bunu beklet', MON)).toMatchObject({ action: 'hold', target: { type: 'this' } });
    expect(parseInput('Araba araştırmasını sil', MON)).toMatchObject({ action: 'trash', target: { type: 'name', name: 'Araba araştırmasını' } });
    expect(parseInput('Bu görevi tamamla', MON)).toMatchObject({ action: 'complete', target: { type: 'this' } });
    expect(parseInput('Yatak araştırmasını yeniden aç', MON)).toMatchObject({ action: 'reopen' });
    expect(parseInput('Calibra kaydını aç', MON)).toMatchObject({ action: 'open', target: { type: 'name', name: 'Calibra' } });
    expect(parseInput('Tamamla', MON)).toMatchObject({ action: 'complete', target: { type: 'none' } });
  });
  test('takip tarihini değiştir', () => {
    expect(parseInput('Bakım işinin takip tarihini yarın yap', MON)).toMatchObject({
      action: 'postpone',
      date: { type: 'date', date: '2026-11-10' },
      target: { type: 'name', name: 'Bakım işinin' },
    });
  });
  test('not ekle', () => {
    expect(parseInput('Not ekle: Depo eksik miktarı teyit etti', MON)).toEqual({
      kind: 'command',
      action: 'add_note',
      target: { type: 'none' },
      noteText: 'Depo eksik miktarı teyit etti',
    });
    expect(parseInput('Calibra kaydına not ekle: satın almaya iletildi', MON)).toMatchObject({
      target: { type: 'name', name: 'Calibra kaydına' },
      noteText: 'satın almaya iletildi',
    });
  });
  test('haftalık tekrar taslağı', () => {
    expect(parseInput('Her pazar faturalar ödendi mi kontrol et', MON)).toEqual({
      kind: 'recurrence',
      weekday: 0,
      title: 'Faturalar ödendi mi kontrol et',
    });
  });
  test('ses ve yazı aynı metinde aynı öneriyi üretir (senaryo 8)', () => {
    const typed = parseInput('Bunu cumaya ertele', MON);
    const spoken = parseInput('bunu cumaya ertele', MON); // tanıyıcı küçük harf verebilir
    expect(spoken).toEqual(typed);
  });
});
