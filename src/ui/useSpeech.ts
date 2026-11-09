// Kullanıcının başlattığı kısa Android konuşma tanıma oturumu.
// Yalnızca çevrimdışı Türkçe paketi yüklü olan tanıyıcılar kullanılır ve
// çevrimdışı tercih bayrağı gönderilir; ham ses saklanmaz.
//
// Sıra:
//  1) Android'in cihaz içi tanıyıcısı (Android System Intelligence), Türkçe yüklüyse.
//  2) Google uygulamasının tanıyıcısı, çevrimdışı Türkçe paketi yüklüyse
//     (EXTRA_PREFER_OFFLINE ile). Samsung gibi cihazlarda 1. yol Türkçe
//     desteklemeyip "network" hatası verebildiği için 1. yol hata verirse
//     bir kez 2. yola geçilir.

import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';

type SpeechModule = typeof import('expo-speech-recognition');
type Mod = SpeechModule['ExpoSpeechRecognitionModule'];

let mod: SpeechModule | null = null;
try {
  // Expo Go'da yerel modül yoktur; development build gerekir.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  mod = require('expo-speech-recognition') as SpeechModule;
} catch {
  mod = null;
}

export type SpeechState = 'idle' | 'checking' | 'listening' | 'unavailable';

const ASI = 'com.google.android.as';
const GOOGLE_APP = 'com.google.android.googlequicksearchbox';
const LANG = 'tr-TR';

/** Bir tanıma yolu: cihaz içi tanıyıcı ya da çevrimdışı paketli bir servis. */
export interface Route {
  kind: 'on_device' | 'service';
  pkg?: string;
  label: string;
}

function hasTurkish(locales: string[] | undefined): boolean {
  return (locales ?? []).some((l) => l.toLowerCase().replace('_', '-').startsWith('tr'));
}

/** Türkçe çevrimdışı paketi yüklü olan tanıma yollarını öncelik sırasıyla bulur. */
export async function findOfflineRoutes(M: Mod): Promise<{ routes: Route[]; canDownload: boolean; diag: string }> {
  const routes: Route[] = [];
  let canDownload = false;
  const diag: string[] = [];
  let services: string[] = [];
  try {
    services = M.getSpeechRecognitionServices();
  } catch {
    services = [];
  }
  diag.push(`servisler: ${services.join(', ') || 'yok'}`);

  const onDevice = (() => {
    try {
      return M.supportsOnDeviceRecognition();
    } catch {
      return false;
    }
  })();
  diag.push(`cihaz içi: ${onDevice ? 'var' : 'yok'}`);

  if (onDevice) {
    try {
      const loc = await M.getSupportedLocales(services.includes(ASI) ? { androidRecognitionServicePackage: ASI } : {});
      diag.push(`cihaz içi yüklü: ${loc.installedLocales.slice(0, 6).join(', ') || '-'}`);
      if (hasTurkish(loc.installedLocales)) routes.push({ kind: 'on_device', label: 'cihaz içi' });
      else if (hasTurkish(loc.locales)) canDownload = true;
    } catch (e) {
      diag.push('cihaz içi dil listesi alınamadı');
    }
  }

  if (services.includes(GOOGLE_APP)) {
    try {
      const loc = await M.getSupportedLocales({ androidRecognitionServicePackage: GOOGLE_APP });
      diag.push(`Google yüklü: ${loc.installedLocales.slice(0, 6).join(', ') || '-'}`);
      if (hasTurkish(loc.installedLocales)) routes.push({ kind: 'service', pkg: GOOGLE_APP, label: 'Google çevrimdışı' });
    } catch {
      diag.push('Google dil listesi alınamadı');
    }
  }

  return { routes, canDownload, diag: diag.join(' · ') };
}

export function useSpeech(onFinal: (text: string) => void) {
  const [state, setState] = useState<SpeechState>('idle');
  const [partial, setPartial] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [canDownload, setCanDownload] = useState(false);
  const [routeLabel, setRouteLabel] = useState('');
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;
  const subs = useRef<{ remove: () => void }[]>([]);
  const gotResult = useRef(false);

  const cleanup = () => {
    subs.current.forEach((s) => s.remove());
    subs.current = [];
  };

  const runRoute = useCallback((M: Mod, routes: Route[], index: number) => {
    const route = routes[index];
    cleanup();
    gotResult.current = false;
    setRouteLabel(route.label);
    subs.current.push(
      M.addListener('result', (ev) => {
        const transcript = ev.results[0]?.transcript ?? '';
        if (ev.isFinal) {
          gotResult.current = true;
          setPartial('');
          if (transcript.trim()) finalRef.current(transcript.trim());
        } else {
          setPartial(transcript);
        }
      }),
      M.addListener('error', (ev) => {
        // Cihaz içi yol desteklemiyorsa (bazı telefonlarda "network" döner) sıradaki çevrimdışı yola geç.
        const retryable = ev.error === 'network' || ev.error === 'language-not-supported' || ev.error === 'service-not-allowed' || (ev.error as string) === 'unknown' || (ev.error as string) === 'client';
        if (retryable && !gotResult.current && index + 1 < routes.length) {
          cleanup();
          setTimeout(() => runRoute(M, routes, index + 1), 150);
          return;
        }
        const msg =
          ev.error === 'no-speech' || ev.error === 'speech-timeout'
            ? 'Konuşma algılanmadı. Tekrar dene ya da yaz.'
            : ev.error === 'not-allowed'
              ? 'Mikrofon izni yok. Yazıyla devam et.'
              : ev.error === 'aborted'
                ? null
                : ev.error === 'network' || ev.error === 'language-not-supported'
                  ? 'Çevrimdışı Türkçe tanıma bu telefonda başlatılamadı. Yazıyla devam edebilirsin.'
                  : `Ses tanıma başarısız. Yazıyla devam edebilirsin.`;
        if (msg) {
          setError(msg);
          setDetails(`${route.label}: ${ev.error}${ev.code !== undefined ? ` (kod ${ev.code})` : ''}`);
        }
        setState('idle');
        setPartial('');
      }),
      M.addListener('end', () => {
        setState((s) => (s === 'listening' ? 'idle' : s));
        setPartial('');
      }),
    );
    M.start({
      lang: LANG,
      interimResults: true,
      continuous: false,
      maxAlternatives: 1,
      addsPunctuation: route.kind === 'on_device',
      requiresOnDeviceRecognition: route.kind === 'on_device',
      androidRecognitionServicePackage: route.kind === 'service' ? route.pkg : undefined,
      androidIntentOptions: { EXTRA_PREFER_OFFLINE: true },
    });
    setState('listening');
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setDetails(null);
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
      const found = await findOfflineRoutes(M);
      if (found.routes.length === 0) {
        setState('unavailable');
        setCanDownload(found.canDownload);
        setError(
          'Çevrimdışı Türkçe ses paketi bulunamadı. Google uygulamasında Ayarlar → Ses → Çevrimdışı konuşma tanıma bölümünden Türkçe’yi indirip tekrar dene, ya da yazıyla devam et.',
        );
        setDetails(found.diag);
        return;
      }
      runRoute(M, found.routes, 0);
    } catch (e) {
      setState('idle');
      setError('Ses tanıma başlatılamadı. Yazıyla devam edebilirsin.');
      setDetails(String(e));
    }
  }, [runRoute]);

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
      setError('Paket indirilemedi. Google uygulamasında Ayarlar → Ses → Çevrimdışı konuşma tanıma bölümünden Türkçe’yi indirebilirsin.');
    }
  }, []);

  return { state, partial, error, details, setError, canDownload, routeLabel, start, stop, abort, downloadTurkish };
}
