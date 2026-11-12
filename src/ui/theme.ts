// Tasarım sistemi: renk paletleri (açık + koyu), boşluk, köşe ve yazı ölçeği.
// Uygulama telefonun açık/koyu ayarını izler. `C`, `PRIORITY_COLOR` ve `s`
// canlı bağlarla dışa aktarılır: tema değişince `applyScheme` bunları yeniden
// kurar ve ağaç yeniden çizilince her bileşen yeni renkleri okur.
import { StyleSheet, useColorScheme } from 'react-native';

export type Scheme = 'light' | 'dark';

const LIGHT = {
  bg: '#F3F4F6',
  card: '#FFFFFF',
  /** Kart içindeki ikincil yüzey (giriş alanları, seçici zeminleri). */
  sunken: '#F6F7F9',
  text: '#16181D',
  muted: '#5C6270',
  border: '#E0E3E8',
  is: '#1F5FA8',
  isSoft: '#E7EFF9',
  ozel: '#2E7D4F',
  ozelSoft: '#E5F3EA',
  danger: '#B3261E',
  dangerSoft: '#FCEBE9',
  warn: '#8A5D00',
  warnSoft: '#FFF4D6',
  done: '#6B7080',
  accent: '#2B2E36',
  /** Renkli zemin üstündeki yazı (birincil düğme, dolu rozet, kaydırma). */
  onColor: '#FFFFFF',
  toastBg: '#23252B',
  toastText: '#FFFFFF',
  toastAction: '#9CC3FF',
  scrim: 'rgba(10,12,16,0.45)',
};

export type Palette = typeof LIGHT;

/** Koyu tema: Material 3 yaklaşımı; vurgu renkleri açık, üstlerindeki yazı koyu. Hepsi en az 4.5:1. */
const DARK: Palette = {
  bg: '#101114',
  card: '#1B1C21',
  sunken: '#23252B',
  text: '#ECEDF0',
  muted: '#A3A8B3',
  border: '#2F3239',
  is: '#8AB4F8',
  isSoft: '#1C2A3E',
  ozel: '#7DD3A0',
  ozelSoft: '#16301F',
  danger: '#F2B8B5',
  dangerSoft: '#3B1E1C',
  warn: '#F0C35E',
  warnSoft: '#33290F',
  done: '#8E929C',
  accent: '#E4E5E9',
  onColor: '#0E1013',
  toastBg: '#E8E9EC',
  toastText: '#16171A',
  toastAction: '#1F5FA8',
  scrim: 'rgba(0,0,0,0.6)',
};

/**
 * Önem derecesi renkleri. Kart zemininde hepsi en az 4.5:1 kontrast verir (WCAG AA).
 * Renk tek başına bilgi taşımaz: her seviyede simge ve yazı da vardır.
 * İş/Özel alanlarının mavi ve yeşilinden uzak tutuldu.
 */
const PRIORITY_LIGHT = { 1: '#5C6270', 2: '#5C6270', 3: '#A04A00', 4: '#B3261E' } as const;
const PRIORITY_DARK = { 1: '#A3A8B3', 2: '#A3A8B3', 3: '#FFB77A', 4: '#F2B8B5' } as const;
type PriorityPalette = { readonly 1: string; readonly 2: string; readonly 3: string; readonly 4: string };

/** Boşluk ölçeği (dp). */
export const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
/** Köşe yuvarlaklığı (dp). */
export const R = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
/** En küçük dokunma alanı (Material: 48dp). */
export const TOUCH = 48;

function makeStyles(c: Palette, scheme: Scheme) {
  const raised =
    scheme === 'light'
      ? { elevation: 1, shadowColor: '#0B1220', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 1 } }
      : {};
  return StyleSheet.create({
    card: {
      backgroundColor: c.card,
      borderRadius: R.md + 2,
      padding: SP.md + 2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      ...raised,
    },
    h1: { fontSize: 22, lineHeight: 28, fontWeight: '800', color: c.text, letterSpacing: -0.2 },
    h2: { fontSize: 17, lineHeight: 22, fontWeight: '700', color: c.text },
    section: {
      fontSize: 12,
      fontWeight: '800',
      color: c.muted,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginTop: SP.xl,
      marginBottom: SP.sm,
    },
    text: { fontSize: 15, lineHeight: 21, color: c.text },
    muted: { fontSize: 13, lineHeight: 18, color: c.muted },
    label: { fontSize: 12, fontWeight: '700', color: c.muted, letterSpacing: 0.3 },
    link: { fontSize: 14, fontWeight: '700', color: c.is },
    input: {
      backgroundColor: c.sunken,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: R.md,
      paddingHorizontal: SP.md,
      paddingVertical: SP.md - 2,
      minHeight: TOUCH,
      fontSize: 16,
      color: c.text,
    },
    row: { flexDirection: 'row', alignItems: 'center' },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.border },
  });
}

export let scheme: Scheme = 'light';
export let C: Palette = LIGHT;
export let PRIORITY_COLOR: PriorityPalette = PRIORITY_LIGHT;
export let s = makeStyles(LIGHT, 'light');

/** Temayı değiştirir. Aynı temada hiçbir şey yapmaz. */
export function applyScheme(next: Scheme) {
  if (next === scheme) return;
  scheme = next;
  C = next === 'dark' ? DARK : LIGHT;
  PRIORITY_COLOR = next === 'dark' ? PRIORITY_DARK : PRIORITY_LIGHT;
  s = makeStyles(C, next);
}

/** Telefonun açık/koyu ayarını izler ve temayı ona göre kurar. Kök bileşenlerde çağrılır. */
export function useThemeScheme(): Scheme {
  const sys = useColorScheme() === 'dark' ? 'dark' : 'light';
  applyScheme(sys);
  return sys;
}

export const areaColor = (area: 'is' | 'ozel') => (area === 'is' ? C.is : C.ozel);
export const areaSoft = (area: 'is' | 'ozel') => (area === 'is' ? C.isSoft : C.ozelSoft);
