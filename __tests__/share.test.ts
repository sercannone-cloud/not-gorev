// Sürüm 3: Android "Paylaş" ile gelen metnin kayıt taslağına çevrilmesi.
import { sharedText } from '../src/domain/share';

const base = { files: null, type: 'text' as const, webUrl: null, meta: null };

describe('paylaşılan metin', () => {
  test('düz metin olduğu gibi, kenar boşlukları kırpılarak gelir', () => {
    expect(sharedText({ ...base, text: '  Depo yarın 10:00 sayım yapacak \n' })).toBe('Depo yarın 10:00 sayım yapacak');
  });
  test('başlıklı bağlantı: başlık ilk satır, bağlantı ikinci satır', () => {
    expect(
      sharedText({ ...base, type: 'weburl', text: 'https://ornek.com/kargo', webUrl: 'https://ornek.com/kargo', meta: { title: 'Kargo fiyatları 2027' } }),
    ).toBe('Kargo fiyatları 2027\nhttps://ornek.com/kargo');
  });
  test('başlık metinde zaten varsa tekrarlanmaz', () => {
    expect(sharedText({ ...base, text: 'Kargo fiyatları https://ornek.com', webUrl: 'https://ornek.com', meta: { title: 'Kargo fiyatları' } })).toBe(
      'Kargo fiyatları https://ornek.com',
    );
  });
  test('metin yoksa bağlantı; hiçbiri yoksa ya da dosya ise null', () => {
    expect(sharedText({ ...base, text: null, webUrl: 'https://a.com' })).toBe('https://a.com');
    expect(sharedText({ ...base, text: '   ' })).toBeNull();
    expect(sharedText({ ...base, type: 'media', text: null, files: [] })).toBeNull();
  });
});
