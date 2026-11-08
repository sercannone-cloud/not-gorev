// Kullanıcının başlattığı kısa Android konuşma tanıma oturumu.
// Yalnızca cihaz içi (çevrimdışı) Türkçe tanıma kullanılır: ses bir dış
// servise gönderilmez ve ham ses saklanmaz. Destek yoksa yazıya geçilir.

import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';

type SpeechModule = typeof import('expo-speech-recognition');

let mod: SpeechModule | null = null;
try {
  // Expo Go'da yerel modül yoktur; development build gerekir.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  mod = require('expo-speech-recognition') as SpeechModule;
} catch {
  mod = null;
}

export type SpeechState = 'idle' | 'checking' | 'listening' | 'unavailable';

const ON_DEVICE_SERVICE = 'com.google.android.as';
const LANG = 'tr-TR';

function hasTurkish(locales: string[]): boolean {
  return locales.some((l) => l.toLowerCase().replace('_', '-').startsWith('tr'));
}

export function useSpeech(onFinal: (text: string) => void) {
  const [state, setState] = useState<SpeechState>('idle');
  const [partial, setPartial] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [canDownload, setCanDownload] = useState(false);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;
  const subs = useRef<{ remove: () => void }[]>([]);

  const cleanup = () => {
    subs.current.forEach((s) => s.remove());
    subs.current = [];
  };

  const start = useCallback(async () => {
    setError(null);
    setPartial('');
    setCanDownload(false);
    const M = mod?.ExpoSpeechRecognitionModule;
    if (!M || Platform.OS !== 'android') {
      setState('unavailable');
      setError('Ses tanıma bu kurulumda yok (development build gerekir). Yazıyla devam edebilirsin.');
      return;
    }
    setState('checking');
    try {
      const perm = await M.requestPermissionsAsync();
      if (!perm.granted) {
        setState('unavailable');
        setError('Mikrofon izni verilmedi. Yazıyla devam edebilirsin; izni Ayarlar’dan açabilirsin.');
        return;
      }
      if (!M.isRecognitionAvailable() || !M.supportsOnDeviceRecognition()) {
        setState('unavailable');
        setError('Bu cihazda çevrimdışı ses tanıma yok. Yazıyla devam edebilirsin.');
        return;
      }
      let turkishOffline = false;
      try {
        const services = M.getSpeechRecognitionServices();
        const pkg = services.includes(ON_DEVICE_SERVICE) ? ON_DEVICE_SERVICE : undefined;
        const loc = await M.getSupportedLocales({ androidRecognitionServicePackage: pkg });
        turkishOffline = hasTurkish(loc.installedLocales);
        if (!turkishOffline && hasTurkish(loc.locales)) setCanDownload(true);
      } catch {
        turkishOffline = false;
      }
      if (!turkishOffline) {
        setState('unavailable');
        setError('Çevrimdışı Türkçe ses paketi yüklü değil. Paketi indirebilir ya da yazıyla devam edebilirsin.');
        return;
      }

      cleanup();
      subs.current.push(
        M.addListener('result', (ev) => {
          const transcript = ev.results[0]?.transcript ?? '';
          if (ev.isFinal) {
            setPartial('');
            if (transcript.trim()) finalRef.current(transcript.trim());
          } else {
            setPartial(transcript);
          }
        }),
        M.addListener('error', (ev) => {
          const msg =
            ev.error === 'no-speech' || ev.error === 'speech-timeout'
              ? 'Konuşma algılanmadı. Tekrar dene ya da yaz.'
              : ev.error === 'language-not-supported'
                ? 'Çevrimdışı Türkçe tanıma kullanılamıyor. Yazıyla devam et.'
                : ev.error === 'not-allowed'
                  ? 'Mikrofon izni yok. Yazıyla devam et.'
                  : ev.error === 'aborted'
                    ? null
                    : `Ses tanıma başarısız (${ev.error}). Yazıyla devam edebilirsin.`;
          if (msg) setError(msg);
          setState('idle');
        }),
        M.addListener('end', () => {
          setState('idle');
          setPartial('');
          cleanup();
        }),
      );
      M.start({
        lang: LANG,
        interimResults: true,
        continuous: false,
        requiresOnDeviceRecognition: true,
        addsPunctuation: true,
        maxAlternatives: 1,
        androidIntentOptions: { EXTRA_PREFER_OFFLINE: true },
      });
      setState('listening');
    } catch (e) {
      setState('idle');
      setError('Ses tanıma başlatılamadı. Yazıyla devam edebilirsin.');
    }
  }, []);

  const stop = useCallback(() => {
    mod?.ExpoSpeechRecognitionModule.stop();
  }, []);

  const abort = useCallback(() => {
    mod?.ExpoSpeechRecognitionModule.abort();
    setState('idle');
    setPartial('');
  }, []);

  const downloadTurkish = useCallback(async () => {
    const M = mod?.ExpoSpeechRecognitionModule;
    if (!M) return;
    try {
      const r = await M.androidTriggerOfflineModelDownload({ locale: LANG });
      setError(
        r.status === 'download_success'
          ? 'Türkçe paket indirildi. Konuş’a tekrar dokun.'
          : 'İndirme başlatıldı. Bitince Konuş’a tekrar dokun.',
      );
    } catch {
      setError('Paket indirilemedi. Telefon ayarlarından Google ses tanıma dillerine Türkçe ekleyebilirsin.');
    }
  }, []);

  return { state, partial, error, setError, canDownload, start, stop, abort, downloadTurkish };
}
