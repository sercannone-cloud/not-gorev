// Tarih yardımcıları. Uygulama Europe/Istanbul saatini kullanır.
// Türkiye 2016'dan beri yaz saati uygulamıyor ve sürekli UTC+3'te; bu yüzden
// Hermes'in Intl saat dilimi desteğine bağlı kalmamak için sabit fark kullanılır.
// Günler 'YYYY-MM-DD' metni olarak saklanır (saat yoksa yalnızca gün).

import { fold } from './turkish';

export const ISTANBUL_OFFSET_MINUTES = 180;

export type DayString = string; // 'YYYY-MM-DD'

const pad = (n: number) => String(n).padStart(2, '0');

/** Verilen andaki İstanbul takvim günü. */
export function istanbulToday(now: Date): DayString {
  const t = new Date(now.getTime() + ISTANBUL_OFFSET_MINUTES * 60_000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

function toUtcDate(day: DayString): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtcDate(d: Date): DayString {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(day: DayString, n: number): DayString {
  const d = toUtcDate(day);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtcDate(d);
}

/** 0 = Pazar, 1 = Pazartesi … 6 = Cumartesi */
export function weekdayOf(day: DayString): number {
  return toUtcDate(day).getUTCDay();
}

/** Günün içinde bulunduğu haftanın pazartesisi. */
export function mondayOf(day: DayString): DayString {
  const wd = weekdayOf(day);
  const diff = wd === 0 ? -6 : 1 - wd;
  return addDays(day, diff);
}

/** Pazartesi ile başlayan haftada verilen hafta gününe denk gelen tarih. */
export function dayInWeek(monday: DayString, weekday: number): DayString {
  const offset = weekday === 0 ? 6 : weekday - 1;
  return addDays(monday, offset);
}

export function isValidDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return fromUtcDate(toUtcDate(day)) === day;
}

export const WEEKDAY_NAMES = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
export const MONTH_NAMES = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

/** "13 Kasım 2026 Cuma" */
export function formatDayLong(day: DayString): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1]} ${y} ${WEEKDAY_NAMES[weekdayOf(day)]}`;
}

/** "13 Kas" */
export function formatDayShort(day: DayString): string {
  const [, m, d] = day.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)}`;
}

/** ISO zaman damgasını İstanbul saatine göre "8 Kas 2026 21:47" biçiminde yazar. */
export function formatTimestamp(iso: string): string {
  const t = new Date(new Date(iso).getTime() + ISTANBUL_OFFSET_MINUTES * 60_000);
  const day = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)} ${y} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

// ---------------------------------------------------------------------------
// Yerel tarih ifadesi çözümleyici
// ---------------------------------------------------------------------------

export type DateResolution =
  | { type: 'date'; date: DayString; matched: string; start: number; end: number }
  | { type: 'ask'; question: string; matched: string; start: number; end: number };

// Katlanmış (ç→c, ş→s …) biçimde gün adları. Uzun adlar önce gelmeli.
const WEEKDAY_FOLDED: [string, number][] = [
  ['cumartesi', 6],
  ['pazartesi', 1],
  ['carsamba', 3],
  ['persembe', 4],
  ['sali', 2],
  ['cuma', 5],
  ['pazar', 0],
];

const MONTH_FOLDED = [
  'ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran',
  'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik',
];

// Yönelme ve benzeri ekler: cumaya, pazartesiye, salıya, cuma günü, cuma gününe, cuma'ya
const DAY_SUFFIX = "(?:'?(?:ya|ye|a|e|ye kadar|ya kadar))?(?:\\s+gunu(?:ne)?)?";
const WORD_END = '(?![a-z0-9])';
const WORD_START = '(?<![a-z0-9])';

type Rule = {
  re: RegExp;
  resolve: (m: RegExpExecArray, today: DayString) => { date?: DayString; ask?: string };
};

const NUM_WORDS: Record<string, number> = {
  bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10,
};

function nextWeekday(today: DayString, weekday: number): DayString {
  const diff = (weekday - weekdayOf(today) + 7) % 7;
  return addDays(today, diff === 0 ? 7 : diff);
}

function monthDay(today: DayString, month: number, dayNum: number, year?: number): { date?: DayString; ask?: string } {
  const [ty] = today.split('-').map(Number);
  let y = year ?? ty;
  if (y < 100) y += 2000;
  let candidate = `${y}-${pad(month)}-${pad(dayNum)}`;
  if (!isValidDay(candidate)) return { ask: 'Bu tarih geçerli değil. Hangi gün?' };
  if (year === undefined && candidate < today) {
    candidate = `${y + 1}-${pad(month)}-${pad(dayNum)}`;
    if (!isValidDay(candidate)) return { ask: 'Hangi gün?' };
  }
  return { date: candidate };
}

const RULES: Rule[] = [
  {
    re: new RegExp(`${WORD_START}(haftaya|gelecek hafta|onumuzdeki hafta)\\s+(${WEEKDAY_FOLDED.map((w) => w[0]).join('|')})${DAY_SUFFIX}${WORD_END}`),
    resolve: (m, today) => {
      const wd = WEEKDAY_FOLDED.find((w) => w[0] === m[2])![1];
      return { date: dayInWeek(addDays(mondayOf(today), 7), wd) };
    },
  },
  {
    re: new RegExp(`${WORD_START}(bugun(?:e|den)?|bu aksam)${WORD_END}`),
    resolve: (_m, today) => ({ date: today }),
  },
  {
    re: new RegExp(`${WORD_START}(yarin(?:a|dan)?)${WORD_END}`),
    resolve: (_m, today) => ({ date: addDays(today, 1) }),
  },
  {
    re: new RegExp(`${WORD_START}(obur gun(?:e)?|ertesi gun(?:e)?|yarindan sonra)${WORD_END}`),
    resolve: (_m, today) => ({ date: addDays(today, 2) }),
  },
  {
    re: new RegExp(`${WORD_START}(\\d{1,2})[./](\\d{1,2})(?:[./](\\d{2,4}))?(?:'?(?:ye|ya|e|a|de|da|te|ta))?${WORD_END}`),
    resolve: (m, today) => monthDay(today, Number(m[2]), Number(m[1]), m[3] ? Number(m[3]) : undefined),
  },
  {
    re: new RegExp(`${WORD_START}(\\d{1,2})\\s+(${MONTH_FOLDED.join('|')})(?:[a-z']*)?(?:\\s+(\\d{4}))?${WORD_END}`),
    resolve: (m, today) => monthDay(today, MONTH_FOLDED.indexOf(m[2]) + 1, Number(m[1]), m[3] ? Number(m[3]) : undefined),
  },
  {
    re: new RegExp(`${WORD_START}(\\d{1,2}|${Object.keys(NUM_WORDS).join('|')})\\s+(gun|hafta)\\s+sonra(?:ya)?${WORD_END}`),
    resolve: (m, today) => {
      const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM_WORDS[m[1]];
      return { date: addDays(today, m[2] === 'gun' ? n : n * 7) };
    },
  },
  {
    re: new RegExp(`${WORD_START}(${WEEKDAY_FOLDED.map((w) => w[0]).join('|')})${DAY_SUFFIX}${WORD_END}`),
    resolve: (m, today) => {
      const wd = WEEKDAY_FOLDED.find((w) => w[0] === m[1])![1];
      return { date: nextWeekday(today, wd) };
    },
  },
  {
    // Gün belirtmeyen ifadeler: kesin tarih gerekiyorsa sorulur.
    re: new RegExp(`${WORD_START}(gelecek ay(?:a)?|onumuzdeki ay(?:a)?|ay sonu(?:na)?|ay basi(?:na)?|haftaya|gelecek hafta(?:ya)?|onumuzdeki hafta(?:ya)?|hafta sonu(?:na)?|ileride|sonra(?:ya)?|daha sonra(?:ya)?)${WORD_END}`),
    resolve: () => ({ ask: 'Hangi gün?' }),
  },
];

/**
 * Metindeki ilk tarih ifadesini bulur ve bugüne göre kesin tarihe çevirir.
 * Konumlar orijinal metne göredir (katlama uzunluğu korur).
 */
export function findDateExpression(text: string, today: DayString): DateResolution | null {
  const folded = fold(text);
  let best: { m: RegExpExecArray; rule: Rule } | null = null;
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    const m = rule.re.exec(folded);
    if (m && (best === null || m.index < best.m.index)) best = { m, rule };
  }
  if (!best) return null;
  const { m, rule } = best;
  const r = rule.resolve(m, today);
  const start = m.index;
  const end = m.index + m[0].length;
  const matched = text.slice(start, end);
  if (r.date) return { type: 'date', date: r.date, matched, start, end };
  return { type: 'ask', question: r.ask ?? 'Hangi gün?', matched, start, end };
}

/** "Hangi gün?" sorusuna verilen kısa yanıtı çözümler ("cuma", "yarın", "15.11"). */
export function resolveDateAnswer(text: string, today: DayString): DateResolution | null {
  return findDateExpression(text, today);
}
