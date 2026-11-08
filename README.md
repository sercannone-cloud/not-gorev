# Notlar ve İşler

İş ve özel hayat için sesli ve yazılı not / görev uygulaması. Android, Expo + React Native + TypeScript.
Her şey telefonda yerel SQLite veritabanında durur; hesap, sunucu, bulut ya da yapay zekâ servisi yoktur.

## Ne yapar

- **Konuş / Yaz**: İkisi de aynı düzenlenebilir alana yazar. Ses yalnızca cihaz içi (çevrimdışı) Türkçe tanımayla çalışır; ses dışarı gönderilmez, ham ses saklanmaz.
- **Kaydet**: İş / Özel alanını ve kategoriyi sen seçersin. Kategori seçmezsen kayıt *Sınıflandırılacak* bölümüne düşer.
  Üç seçim: *Yeni iş aç*, *Bağımsız not*, *Mevcut kayda ekle* (ayrıca *Haftalık tekrar*).
- **Kayıt detayı**: Durum, en son gelişme, sonraki adım, takip tarihi ve tarihli geçmiş. Not eklemek işi kapatmaz.
- **Bugün**: Takip tarihi gelen ya da geçen işler ve haftalık tekrarlar. Tarihsiz işler burada görünmez.
- **Açık İşler**: Tamamlanmamış işler; *Tarihsiz* ve *Beklemede* süzgeçleri.
- **Geçmiş ve Ara**: Tamamlananlar, bağımsız notlar, son gelişmeler ve çevrimdışı arama (başlık, kategori, not metni; Türkçe harf farkları yok sayılır).
- **Komutlar** (sesle ya da yazıyla, aynı motor): *Tamamla, Beklet, Yeniden aç, … ertele / takip tarihini … yap, Not ekle: …, … kaydını aç, … sil*.
  - “Bunu …” yalnızca açık kayıt detayında çalışır; başka yerde “Hangi kayıt?” diye sorar.
  - Birden fazla eşleşmede en fazla üç aday gösterir; kendiliğinden seçmez.
  - Tarih eksikse “Hangi gün?” diye sorar; “cuma” yanıtıyla tamamlanır.
  - Uygulanan her değişiklikte **Geri Al** çıkar. Geri alma, sonradan yapılan bir değişikliği ezmez.
  - Silme her zaman onay ister ve kaydı geçmişiyle birlikte geri yüklenebilir çöp kutusuna taşır.
- **Haftalık tekrar**: “Her pazar faturalar ödendi mi kontrol et” yazınca taslak çıkar. Her hafta ayrı izlenir; kaçan haftalar açık kalır.

## Telefona kurulum

Her `main` güncellemesinde GitHub Actions bir APK derler ve depodaki **Releases → Son sürüm** sayfasına koyar.

1. Telefonda depo sayfasını aç: `https://github.com/sercannone-cloud/not-gorev/releases/tag/son-surum`
2. `notlar-ve-isler.apk` dosyasını indir ve aç.
3. Android “bilinmeyen uygulamaları yükle” izni isterse, indirdiğin tarayıcı ya da Dosyalar uygulaması için izin ver.
4. Uygulamayı aç. İlk “Konuş”ta mikrofon izni ister.

Yeni sürümü aynı yoldan kurduğunda veriler korunur (aynı imza). Uygulamayı kaldırırsan veriler silinir.

**Sesli giriş için:** Telefonda çevrimdışı Türkçe ses tanıma paketi gerekir (Android 13 ve üstü). Paket yoksa uygulama
“Türkçe paketi indir” düğmesi gösterir; yoksa *Ayarlar → Google → Ses → Çevrimdışı konuşma tanıma* (menü adları telefona göre değişir) bölümünden Türkçe’yi indirebilirsin.
Paket yoksa ya da izin verilmezse yazılı giriş, arama ve komutlar aynen çalışır.

## Geliştirme

```bash
npm install
npm test            # veri katmanı, komut motoru ve arayüz testleri
npx tsc --noEmit    # tip kontrolü
```

Konuşma tanıma ve tarih seçici yerel modül olduğu için uygulama Expo Go’da çalışmaz; bir development build ya da
yukarıdaki APK gerekir. Yerelde derlemek için Android SDK ile `npx expo run:android`, ya da EAS ile
`npx eas-cli build -p android --profile preview` kullanılabilir.

## Bilinen sınırlamalar (ilk sürüm)

- Otomatik alan / kategori / kayıt önerisi yok (bilinçli olarak sonraki sürüme bırakıldı).
- Yeni kategori ekleme ve kategori adlarını düzenleme ekranı yok; başlangıç kategorileri kullanılır.
- Takip tarihinde saat yok, yalnızca gün. Hatırlatma bildirimi yok.
- Yalnızca haftalık tekrar var.
- Metni ayrı kayıtlara bölme satır satır çalışır (“Satırlara böl”).
- Ses davranışı fiziksel cihazda henüz denenmedi.
