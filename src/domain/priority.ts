// Önem derecesi yardımcıları: metinden (yazı ya da konuşma dökümü) önem
// derecesi önerisi çıkarır ve yazı içi kısayolları temizler.
// Öneri yalnızca kaydetmeden önce seçili gelir; kullanıcı değiştirebilir.

import { fold } from './turkish';
import { Priority } from './types';

export interface PriorityHint {
  priority: Priority;
  /** Kullanıcıya gösterilecek gerekçe, ör. "acil" ya da "!!!". */
  match: string;
}

const SHORTCUTS: [RegExp, Priority, string][] = [
  [/(?:^|\s)!!!(?=\s|$)/, 4, '!!!'],
  [/(?:^|\s)!!(?=\s|$)/, 3, '!!'],
  [/(?:^|\s)!d(?=\s|$)/i, 1, '!d'],
];

// Katlanmış (ç→c, ı→i …) metin üzerinde aranır. Sıra önemli: "önemli değil", "önemli"den önce.
const WORDS: [RegExp, Priority][] = [
  [/(?:^|[^a-z])(kritik|acil|acilen|ivedi|ivedilikle)(?=[^a-z]|$)/, 4],
  [/(?:^|[^a-z])(onemli degil|onemsiz|dusuk oncelik(?:li)?|acelesi yok|acele yok)(?=[^a-z]|$)/, 1],
  [/(?:^|[^a-z])(cok onemli|onemli|oncelikli|yuksek oncelik(?:li)?)(?=[^a-z]|$)/, 3],
];

/** Metinde önem derecesi işareti varsa öneri döndürür; yoksa null (varsayılan Orta kalır). */
export function detectPriority(text: string): PriorityHint | null {
  for (const [re, p, label] of SHORTCUTS) if (re.test(text)) return { priority: p, match: label };
  const f = fold(text);
  for (const [re, p] of WORDS) {
    const m = re.exec(f);
    if (m) {
      // Orijinal yazımı göstermek için aynı konumdan al (fold uzunluğu korur).
      const start = m.index + m[0].length - m[1].length;
      return { priority: p, match: text.slice(start, start + m[1].length) };
    }
  }
  return null;
}

/** "!!!", "!!", "!d" kısayollarını metinden çıkarır. */
export function stripPriorityShortcuts(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/(^|\s)(?:!!!|!!|![dD])(?=\s|$)/g, '$1').replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n')
    .trim();
}
