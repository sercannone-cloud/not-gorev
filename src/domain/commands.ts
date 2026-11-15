// Yerel ve açık kurallarla çalışan komut yorumlayıcısı.
// Yalnızca tipli bir işlem önerisi üretir; kayıt seçimi, onay, veritabanı
// güncellemesi ve geri alma uygulama katmanındadır (src/logic/commandFlow.ts).
// Konuşma dökümü ve yazılı metin aynı fonksiyondan geçer.

import { DayString, findDateExpression, findTimeExpression, WEEKDAY_NAMES } from './dates';
import { capitalizeTr, fold } from './turkish';
import { Priority } from './types';

export type CommandAction =
  | 'complete'
  | 'hold'
  | 'reopen'
  | 'postpone'
  | 'add_note'
  | 'add_step'
  | 'open'
  | 'trash'
  | 'set_priority';

export const ACTION_LABEL: Record<CommandAction, string> = {
  complete: 'Tamamla',
  hold: 'Beklet',
  reopen: 'Yeniden aç',
  postpone: 'Takip tarihini değiştir',
  add_note: 'Not ekle',
  add_step: 'Adım ekle',
  open: 'Kaydı aç',
  trash: 'Çöp kutusuna taşı',
  set_priority: 'Önem derecesini değiştir',
};

/** "this": "bunu", "bu görevi" gibi; "none": hedef söylenmedi; "name": kayıt adı. */
export type CommandTarget = { type: 'this' } | { type: 'none' } | { type: 'name'; name: string };

export type CommandDate =
  | { type: 'date'; date: DayString }
  | { type: 'ask'; question: string }
  | { type: 'missing' };

/** Takip saati: kesin saat ya da "Saat kaç?" sorusu. Söylenmezse komutta yer almaz. */
export type CommandTime = { type: 'time'; time: string } | { type: 'ask'; question: string };

export type Intent =
  | {
      kind: 'command';
      action: CommandAction;
      target: CommandTarget;
      date?: CommandDate;
      time?: CommandTime;
      noteText?: string;
      priority?: Priority;
    }
  | { kind: 'recurrence'; title: string; weekday: number }
  | { kind: 'note'; text: string };

const WEEKDAY_FOLDED: [string, number][] = [
  ['cumartesi', 6],
  ['pazartesi', 1],
  ['carsamba', 3],
  ['persembe', 4],
  ['sali', 2],
  ['cuma', 5],
  ['pazar', 0],
];

const THIS_RE = /^(bunu|buna|bunun|bu|bu (?:gorev|is|kayit|kayd|not)(?:i|ini|in|ine|u|unu|un|una)?)$/;

interface VerbRule {
  action: CommandAction;
  re: RegExp;
  needsDateWord?: boolean;
}

// Sıra önemli: "yeniden aç", "aç"tan önce gelmeli.
const VERBS: VerbRule[] = [
  { action: 'reopen', re: /(?:^|\s)(?:yeniden|tekrar) ac$/ },
  { action: 'complete', re: /(?:^|\s)(?:tamamlandi olarak isaretle|tamamla|bitir|kapat)$/ },
  { action: 'hold', re: /(?:^|\s)(?:beklemeye al|beklet)$/ },
  { action: 'trash', re: /(?:^|\s)(?:cop kutusuna tasi|cop kutusuna at|cope tasi|cope at|sil)$/ },
  { action: 'postpone', re: /(?:^|\s)(?:ertele|ileri al|hatirlat)$/ },
  { action: 'postpone', re: /(?:^|\s)(?:olarak degistir|olarak ayarla|degistir|ayarla|yap)$/, needsDateWord: true },
  { action: 'open', re: /(?:^|\s)(?:kaydini ac|kaydi ac|ac)$/ },
];

const MAX_TARGET_WORDS = 7;

// "Bunu kritik yap", "Calibra'yı acil olarak işaretle", "X'in önceliğini düşük yap"
const PRIORITY_VERB =
  /(?:^|\s)(?:(?:onceligini|onemini|onem derecesini)\s+)?(kritik|acil|yuksek|onemli|orta|normal|dusuk|onemsiz)(?:\s+oncelik(?:li)?)?(?:\s+olarak)?\s+(?:yap|isaretle)$/;
const PRIORITY_WORD: Record<string, Priority> = {
  kritik: 4,
  acil: 4,
  yuksek: 3,
  onemli: 3,
  orta: 2,
  normal: 2,
  dusuk: 1,
  onemsiz: 1,
};

function stripTrailingPunct(text: string): string {
  return text.replace(/[\s.!?,;:]+$/u, '');
}

function cleanTargetFolded(prefixFolded: string): string {
  return prefixFolded
    .replace(/(?:^|\s)(?:takip tarihini|takip tarihi|tarihini|tarihi)(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function targetFrom(prefixOriginal: string): CommandTarget {
  const cleanedFolded = cleanTargetFolded(fold(prefixOriginal));
  if (!cleanedFolded) return { type: 'none' };
  if (THIS_RE.test(cleanedFolded)) return { type: 'this' };
  // Orijinal yazımı korumak için aynı temizliği orijinal metne konumla uygula.
  const name = prefixOriginal
    .split(/\s+/)
    .filter((w) => !/^(takip|tarihini|tarihi)$/.test(fold(w)))
    .join(' ')
    .replace(/['’]$/, '')
    .trim();
  return { type: 'name', name };
}

/** Metni yorumlar. Komut değilse { kind: 'note' } döner ve metin not taslağı olarak kalır. */
export function parseInput(rawText: string, today: DayString): Intent {
  const text = stripTrailingPunct(rawText.trim());
  if (!text) return { kind: 'note', text: rawText };
  const f = fold(text);

  // 1) Haftalık tekrar: "Her pazar faturalar ödendi mi kontrol et"
  const rec = /^her (?:hafta )?(cumartesi|pazartesi|carsamba|persembe|sali|cuma|pazar)(?: gunu| gunleri|leri|lari)?[\s,:-]+(.+)$/.exec(f);
  if (rec) {
    const weekday = WEEKDAY_FOLDED.find((w) => w[0] === rec[1])![1];
    const restStart = f.length - rec[2].length;
    return { kind: 'recurrence', weekday, title: capitalizeTr(text.slice(restStart)) };
  }

  // 2) Not ekle / Adım ekle: "Not ekle: depo aradı", "Calibra kaydına adım ekle: ..."
  for (const [word, action] of [
    ['not', 'add_note'],
    ['adim', 'add_step'],
  ] as const) {
    const note = new RegExp(`^(.*?)\\s*(?:^|\\s)${word} ekle(?:\\s*[:\\-–]\\s*|\\s+)(.+)$`, 's').exec(f);
    if (note) {
      const noteStart = f.length - note[2].length;
      const prefixFolded = note[1]
        .replace(/(?:kaydina|kaydine|na|ne|ya|ye|a|e)$/, '')
        .trim();
      const prefixOriginal = text.slice(0, note[1].length).trim();
      let target: CommandTarget;
      if (!prefixFolded) target = { type: 'none' };
      else if (THIS_RE.test(prefixFolded)) target = { type: 'this' };
      else target = { type: 'name', name: prefixOriginal };
      return { kind: 'command', action, target, noteText: text.slice(noteStart).trim() };
    }
    if (new RegExp(`^${word} ekle$`).test(f)) {
      return { kind: 'command', action, target: { type: 'none' }, noteText: '' };
    }
  }

  // 3) Önem derecesi: "<hedef> kritik yap"
  const pr = PRIORITY_VERB.exec(f);
  if (pr) {
    const prefixOriginal = text.slice(0, pr.index).trim();
    if (prefixOriginal.split(/\s+/).filter(Boolean).length <= MAX_TARGET_WORDS) {
      return { kind: 'command', action: 'set_priority', target: targetFrom(prefixOriginal), priority: PRIORITY_WORD[pr[1]] };
    }
    return { kind: 'note', text: rawText };
  }

  // 4) Fiil sonda: "<hedef> [tarih] <fiil>"
  for (const v of VERBS) {
    const m = v.re.exec(f);
    if (!m) continue;
    if (v.needsDateWord && !/(?:^|\s)(?:takip )?tarih/.test(f)) continue;
    let prefixOriginal = text.slice(0, m.index).trim();
    if (prefixOriginal.split(/\s+/).filter(Boolean).length > MAX_TARGET_WORDS) {
      return { kind: 'note', text: rawText };
    }
    let date: CommandDate | undefined;
    let time: CommandTime | undefined;
    if (v.action === 'postpone') {
      const cut = (start: number, end: number) =>
        (prefixOriginal.slice(0, start) + ' ' + prefixOriginal.slice(end)).replace(/\s+/g, ' ').trim();
      // Önce kesin saat ("14:30", "saat 9"): "14.30" gibi tarihe benzeyen biçimler tarih kuralına kalır.
      const t1 = findTimeExpression(prefixOriginal);
      if (t1?.type === 'time') {
        time = { type: 'time', time: t1.time };
        prefixOriginal = cut(t1.start, t1.end);
      }
      const d = findDateExpression(prefixOriginal, today);
      if (d) {
        date = d.type === 'date' ? { type: 'date', date: d.date } : { type: 'ask', question: d.question };
        // "bu akşam": gün bugün, saat belirsiz.
        if (!time && findTimeExpression(d.matched)?.type === 'ask') time = { type: 'ask', question: 'Saat kaç?' };
        prefixOriginal = cut(d.start, d.end);
      } else {
        date = { type: 'missing' };
      }
      // Kalan belirsiz ya da geçersiz saat ("akşam", "saat 25"): sorulur ve hedeften çıkarılır.
      const t2 = findTimeExpression(prefixOriginal);
      if (t2) {
        if (!time) time = t2.type === 'time' ? { type: 'time', time: t2.time } : { type: 'ask', question: t2.question };
        prefixOriginal = cut(t2.start, t2.end);
      }
    }
    return { kind: 'command', action: v.action, target: targetFrom(prefixOriginal), date, ...(time ? { time } : {}) };
  }

  return { kind: 'note', text: rawText };
}

export function describeWeekday(weekday: number): string {
  return WEEKDAY_NAMES[weekday];
}
