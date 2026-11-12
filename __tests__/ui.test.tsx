// Arayüz duman testleri: gerçek ekranlar, better-sqlite3 üzerinde gerçek veri katmanı.
// Ses ve Android tarih seçicisi burada çalışmaz; yazılı akış denenir.
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { AppRoot } from '../App';
import { makeRepo } from './helpers';

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaProvider: View, SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

jest.mock('@react-native-community/datetimepicker', () => ({ DateTimePickerAndroid: { open: jest.fn() } }));

const mockSpeech = {
  requestPermissionsAsync: jest.fn(async () => ({ granted: false })),
  isRecognitionAvailable: jest.fn(() => true),
  supportsOnDeviceRecognition: jest.fn(() => true),
  getSpeechRecognitionServices: jest.fn(() => ['com.google.android.as']),
  getSupportedLocales: jest.fn(async () => ({ locales: ['tr-TR', 'en-US'], installedLocales: ['en-US'] })),
  listeners: {} as Record<string, (ev: unknown) => void>,
  addListener: jest.fn((name: string, fn: (ev: unknown) => void) => {
    mockSpeech.listeners[name] = fn;
    return { remove: jest.fn() };
  }),
  start: jest.fn(),
  stop: jest.fn(),
  abort: jest.fn(),
  androidTriggerOfflineModelDownload: jest.fn(),
};
let mockQuickAction: ((a: { id: string; title: string }) => void) | null = null;
jest.mock('expo-quick-actions', () => ({ setItems: jest.fn(async () => undefined) }));
jest.mock('expo-quick-actions/hooks', () => ({
  useQuickActionCallback: (cb: (a: { id: string; title: string }) => void) => {
    mockQuickAction = cb;
  },
}));
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  NotificationFeedbackType: { Success: 'success' },
}));

jest.mock("expo-speech-recognition", () => ({ get ExpoSpeechRecognitionModule() { return mockSpeech; } }));

async function setup() {
  const ctx = await makeRepo('2026-11-09');
  await render(<AppRoot repo={ctx.repo} />);
  return ctx;
}

test('Senaryo 1: yaz, Özel + Aile seç, kaydet; Bugün’de yok, Açık İşler’de var', async () => {
  const { repo } = await setup();
  // Üstteki alan geçişi (kart boşken yeni kayıt da Özel olur)
  await fireEvent.press(screen.getAllByText('Özel')[0]);
  await fireEvent.changeText(screen.getByPlaceholderText('Aklına geleni yaz ya da Konuş’a dokun'), 'Kızıma ayakkabı alınacak');
  await fireEvent.press(await screen.findByText('Aile'));
  await fireEvent.press(screen.getByText('Kaydet'));
  await screen.findByText(/Kaydedildi: "Kızıma ayakkabı alınacak" · Özel · Aile/);
  expect(screen.getByText(/Bugün için takip ya da tekrar yok/)).toBeTruthy();
  await fireEvent.press(screen.getByText('Açık İşler'));
  await screen.findByText('Kızıma ayakkabı alınacak');
  const open = await repo.listOpen('ozel');
  expect(open[0]).toMatchObject({ status: 'open', follow_up_date: null, category_name: 'Aile' });
});

test('Senaryo 5: detayda "Bunu cumaya ertele" ve Geri Al; listede "Hangi kayıt?"', async () => {
  const { repo } = await setup();
  await repo.createRecord({ area: 'is', categoryId: null, kind: 'task', title: 'Calibra farkı', body: 'Depodan rapor istendi', source: 'text' });
  await act(async () => {
    await fireEvent.press(screen.getByText("Açık İşler"));
  });
  await fireEvent.press(await screen.findByText('Calibra farkı'));
  await screen.findByText('Tarihli geçmiş');
  await fireEvent.changeText(screen.getByPlaceholderText(/Bu kayda not, sonraki adım ya da komut/), 'Bunu cumaya ertele');
  await fireEvent.press(screen.getByText('Kaydet'));
  await screen.findByText(/takip tarihi: 13 Kasım 2026 Cuma/);
  await screen.findByText('13 Kasım 2026 Cuma');
  await fireEvent.press(screen.getByText('Geri Al'));
  await screen.findByText('Geri alındı.');
  await screen.findByText('Yok (tarihsiz)');

  // Ana ekrana dön ve aynı komutu dene
  await fireEvent.press(screen.getByText('‹ Geri'));
  await fireEvent.changeText(await screen.findByPlaceholderText('Aklına geleni yaz ya da Konuş’a dokun'), 'Bunu cumaya ertele');
  await fireEvent.press(screen.getByText('Kaydet'));
  await screen.findByText('Hangi kayıt?');
  await fireEvent.press((await screen.findAllByText('Calibra farkı'))[0]); // seçici, listeden önce gelir
  await screen.findByText(/takip tarihi: 13 Kasım 2026 Cuma/);
});

test('Senaryo 7: "Araba araştırmasını sil" onay ister ve çöpe taşır', async () => {
  const { repo } = await setup();
  await repo.createRecord({ area: 'ozel', categoryId: null, kind: 'task', title: 'Araba araştırması', body: 'İki model', source: 'text' });
  const spy = jest.spyOn(Alert, 'alert');
  await fireEvent.press(screen.getAllByText('Özel')[0]);
  await fireEvent.changeText(screen.getByPlaceholderText('Aklına geleni yaz ya da Konuş’a dokun'), 'Araba araştırmasını sil');
  await fireEvent.press(screen.getByText('Kaydet'));
  await waitFor(() => expect(spy).toHaveBeenCalled());
  const [title, msg, buttons] = spy.mock.calls[0] as [string, string, { text: string; onPress?: () => Promise<void> }[]];
  expect(title).toBe('Çöp kutusuna taşınsın mı?');
  expect(msg).toContain('Araba araştırması');
  await act(async () => {
    await buttons.find((b) => b.text === 'Çöpe taşı')!.onPress!();
  });
  await screen.findByText(/çöp kutusuna taşındı/);
  expect(await repo.listTrash()).toHaveLength(1);
});

test('Komut olmayan eşleşmesiz metin taslak olarak kalır', async () => {
  await setup();
  await fireEvent.changeText(screen.getByPlaceholderText('Aklına geleni yaz ya da Konuş’a dokun'), 'Raporu tamamla');
  await fireEvent.press(screen.getByText('Kaydet'));
  await screen.findByText(/adlı bir kayıt bulunamadı/);
  expect(screen.getAllByDisplayValue('Raporu tamamla').length).toBe(2); // metin ve başlık korunur
  await fireEvent.press(screen.getByText('Kaydet'));
  await screen.findByText(/Kaydedildi: "Raporu tamamla"/);
});

test('Senaryo 9: mikrofon izni yoksa yazıya geçiş önerilir, metin korunur', async () => {
  await setup();
  mockSpeech.requestPermissionsAsync.mockResolvedValueOnce({ granted: false });
  await fireEvent.changeText(screen.getByPlaceholderText('Aklına geleni yaz ya da Konuş’a dokun'), 'Elde kalan metin');
  await fireEvent.press(screen.getByText('🎙 Konuş'));
  await screen.findByText(/Mikrofon izni verilmedi/);
  expect(mockSpeech.start).not.toHaveBeenCalled();
  expect(screen.getAllByDisplayValue('Elde kalan metin').length).toBeGreaterThan(0);
  await fireEvent.press(screen.getByText('Kaydet'));
  await screen.findByText(/Kaydedildi: "Elde kalan metin"/);
});

test('Senaryo 9: çevrimdışı Türkçe paket yoksa ses başlatılmaz (dış servise gönderilmez)', async () => {
  await setup();
  mockSpeech.requestPermissionsAsync.mockResolvedValueOnce({ granted: true });
  await fireEvent.press(screen.getByText('🎙 Konuş'));
  await screen.findByText(/Çevrimdışı Türkçe ses paketi bulunamadı/);
  expect(screen.getByText('Türkçe paketi indir')).toBeTruthy();
  expect(mockSpeech.start).not.toHaveBeenCalled();
});

test('Ses: Türkçe paket varsa cihaz içi tanıma istenir', async () => {
  await setup();
  mockSpeech.requestPermissionsAsync.mockResolvedValueOnce({ granted: true });
  mockSpeech.getSupportedLocales.mockResolvedValueOnce({ locales: ['tr-TR'], installedLocales: ['tr-TR'] });
  await fireEvent.press(screen.getByText('🎙 Konuş'));
  await screen.findByText(/Dinliyorum/);
  expect(mockSpeech.start).toHaveBeenCalledWith(expect.objectContaining({ lang: 'tr-TR', requiresOnDeviceRecognition: true, interimResults: true }));
});

test('Ses: cihaz içi yol "network" hatası verirse Google çevrimdışı tanıyıcıya geçer', async () => {
  await setup();
  mockSpeech.start.mockClear();
  mockSpeech.requestPermissionsAsync.mockResolvedValueOnce({ granted: true });
  mockSpeech.getSpeechRecognitionServices.mockReturnValueOnce(['com.google.android.as', 'com.google.android.googlequicksearchbox']);
  mockSpeech.getSupportedLocales
    .mockResolvedValueOnce({ locales: ['tr-TR'], installedLocales: ['tr-TR'] })
    .mockResolvedValueOnce({ locales: ['tr-TR'], installedLocales: ['tr-TR', 'en-US'] });
  await fireEvent.press(screen.getByText('🎙 Konuş'));
  await screen.findByText(/cihaz içi/);
  expect(mockSpeech.start).toHaveBeenLastCalledWith(expect.objectContaining({ requiresOnDeviceRecognition: true }));
  await act(async () => {
    mockSpeech.listeners.error({ error: 'network', message: 'x', code: 2 });
    await new Promise((r) => setTimeout(r, 200));
  });
  expect(mockSpeech.start).toHaveBeenCalledTimes(2);
  expect(mockSpeech.start).toHaveBeenLastCalledWith(
    expect.objectContaining({
      requiresOnDeviceRecognition: false,
      androidRecognitionServicePackage: 'com.google.android.googlequicksearchbox',
      androidIntentOptions: { EXTRA_PREFER_OFFLINE: true },
    }),
  );
  await screen.findByText(/Google çevrimdışı/);
  // Nihai metin aynı giriş alanına yazılır
  await act(async () => {
    mockSpeech.listeners.result({ isFinal: true, results: [{ transcript: 'Bunu cumaya ertele' }] });
  });
  expect(screen.getAllByDisplayValue('Bunu cumaya ertele').length).toBeGreaterThan(0);
});

test('Ses: iki yol da başarısız olursa hata ve ayrıntı gösterilir, yazı yolu açık kalır', async () => {
  await setup();
  mockSpeech.start.mockClear();
  mockSpeech.requestPermissionsAsync.mockResolvedValueOnce({ granted: true });
  mockSpeech.getSupportedLocales.mockResolvedValueOnce({ locales: ['tr-TR'], installedLocales: ['tr-TR'] });
  await fireEvent.press(screen.getByText('🎙 Konuş'));
  await screen.findByText(/Dinliyorum/);
  await act(async () => {
    mockSpeech.listeners.error({ error: 'network', message: 'x', code: 2 });
  });
  await screen.findByText(/Çevrimdışı Türkçe tanıma bu telefonda başlatılamadı/);
  await screen.findByText(/Ayrıntı: cihaz içi: network \(kod 2\)/);
  expect(mockSpeech.start).toHaveBeenCalledTimes(1);
});

test('Önem: metinden algılanır, seçici ile değişir; Önceliğe göre sıralama', async () => {
  const { repo } = await setup();
  await fireEvent.changeText(screen.getByPlaceholderText('Aklına geleni yaz ya da Konuş’a dokun'), 'Faturayı acil öde');
  await screen.findByText(/Metinden algılandı: “acil”/);
  await fireEvent.press(screen.getByText('Kaydet'));
  await screen.findByText(/Kaydedildi: "Faturayı acil öde" · İş · Sınıflandırılacak · Kritik/);

  await fireEvent.changeText(screen.getByPlaceholderText('Aklına geleni yaz ya da Konuş’a dokun'), 'Raf düzeni');
  await fireEvent.press(await screen.findByLabelText('Düşük öncelik'));
  await fireEvent.press(screen.getByText('Kaydet'));
  await screen.findByText(/Kaydedildi: "Raf düzeni" .* · Düşük/);
  const open = await repo.listOpen('is');
  expect(open.map((r) => [r.title, r.priority])).toEqual([
    ['Faturayı acil öde', 4],
    ['Raf düzeni', 1],
  ]);

  const cat = (await repo.categories('is'))[0].id;
  for (const r of open) await repo.editRecord(r.id, { categoryId: cat }, 'button');
  await act(async () => {
    await fireEvent.press(screen.getByText('Açık İşler'));
  });
  await fireEvent.press(await screen.findByText('Önceliğe göre'));
  await screen.findByLabelText('‼ Kritik (1)');
  await screen.findByLabelText('↓ Düşük (1)');
});

test('Bugün tamamlananlar bölümü ve günlere bölünmüş geçmiş', async () => {
  const { repo } = await setup();
  const res = await repo.createRecord({ area: 'is', categoryId: null, kind: 'task', body: 'İrsaliye kontrol', followUpDate: repo.today(), source: 'text' });
  if (!res.ok) throw new Error();
  await act(async () => {
    await fireEvent.press(screen.getByText('Açık İşler'));
  });
  await act(async () => {
    await fireEvent.press(screen.getByText('Bugün'));
  });
  await fireEvent.press(await screen.findByText('✓'));
  await screen.findByText('"İrsaliye kontrol" tamamlandı.');
  await fireEvent.press(await screen.findByText('✓ Bugün tamamlanan (1)'));
  await screen.findByText('Saate göre');
  expect(screen.getByText('İrsaliye kontrol')).toBeTruthy();

  await act(async () => {
    await fireEvent.press(screen.getByText('Geçmiş ve Ara'));
  });
  await screen.findByText('1 iş');
  expect(screen.getAllByText('Bugün').length).toBeGreaterThan(1);
});

test('Uzun basma menüsü: önem değiştir ve beklet; TalkBack eylemi ile tamamla', async () => {
  const { repo } = await setup();
  const a = await repo.createRecord({ area: 'is', categoryId: null, kind: 'task', body: 'Sayım farkı', followUpDate: repo.today(), source: 'text' });
  const b = await repo.createRecord({ area: 'is', categoryId: null, kind: 'task', body: 'Kargo iadesi', followUpDate: repo.today(), source: 'text' });
  if (!a.ok || !b.ok) throw new Error();
  await act(async () => {
    await fireEvent.press(screen.getByText('Açık İşler'));
  });
  await act(async () => {
    await fireEvent.press(screen.getByText('Bugün'));
  });
  await fireEvent(await screen.findByLabelText(/^(Kritik öncelik, )?(Açık|Beklemede), Sayım farkı/), 'longPress');
  await fireEvent.press(await screen.findByLabelText('Kritik öncelik'));
  await screen.findByText('"Sayım farkı" önem derecesi: Kritik.');
  expect((await repo.getRecord(a.record.id))?.priority).toBe(4);

  await fireEvent(await screen.findByLabelText(/^(Kritik öncelik, )?(Açık|Beklemede), Sayım farkı/), 'longPress');
  await fireEvent.press(await screen.findByText('⏸ Beklet'));
  await screen.findByText('"Sayım farkı" beklemeye alındı.');
  expect((await repo.getRecord(a.record.id))?.status).toBe('waiting');

  await fireEvent(await screen.findByLabelText(/^Açık, Kargo iadesi/), 'accessibilityAction', { nativeEvent: { actionName: 'complete' } });
  await screen.findByText('"Kargo iadesi" tamamlandı.');
  expect((await repo.getRecord(b.record.id))?.status).toBe('done');
});

test('Ana ekran kısayolu: "Yeni kritik iş" Kritik seçili taslak açar', async () => {
  await setup();
  await act(async () => {
    mockQuickAction?.({ id: 'critical', title: 'Yeni kritik iş' });
  });
  await fireEvent.changeText(screen.getByPlaceholderText('Aklına geleni yaz ya da Konuş’a dokun'), 'Depo yangın kapısı');
  await fireEvent.press(screen.getByText('Kaydet'));
  await screen.findByText(/Kaydedildi: "Depo yangın kapısı" .* · Kritik/);
});

test('Koyu tema: telefon koyu moddayken renkler değişir, ekranlar çizilir', async () => {
  const RN = jest.requireActual('react-native');
  const spy = jest.spyOn(RN, 'useColorScheme').mockReturnValue('dark');
  const theme = require('../src/ui/theme');
  try {
    const { repo } = await setup();
    expect(theme.scheme).toBe('dark');
    expect(theme.C.bg).toBe('#101114');
    await fireEvent.changeText(screen.getByPlaceholderText('Aklına geleni yaz ya da Konuş’a dokun'), 'Koyu temada kayıt');
    await fireEvent.press(screen.getByText('Kaydet'));
    await screen.findByText(/Kaydedildi: "Koyu temada kayıt"/);
    await fireEvent.press(screen.getByText('Açık İşler'));
    await fireEvent.press(await screen.findByText('Koyu temada kayıt'));
    await screen.findByText('Tarihli geçmiş');
    expect(repo).toBeTruthy();
  } finally {
    spy.mockRestore();
    theme.applyScheme('light');
  }
});
