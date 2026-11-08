// Türkçe metin yardımcıları. Android'deki JS motorunun yerel ayar desteğine
// güvenmemek için büyük/küçük harf dönüşümü elle yapılır.
// Her iki fonksiyon da karakter karakter çalışır ve uzunluğu korur; böylece
// normalize edilmiş metindeki bir konum, orijinal metinde aynı konuma denk gelir.

const LOWER_MAP: Record<string, string> = {
  I: 'ı',
  İ: 'i',
  Ç: 'ç',
  Ğ: 'ğ',
  Ö: 'ö',
  Ş: 'ş',
  Ü: 'ü',
  Â: 'â',
  Î: 'î',
  Û: 'û',
};

const FOLD_MAP: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
  â: 'a',
  î: 'i',
  û: 'u',
};

/** Türkçe kurallarla küçük harfe çevirir (I → ı, İ → i). Uzunluğu korur. */
export function trLower(text: string): string {
  let out = '';
  for (const ch of text) {
    const mapped = LOWER_MAP[ch];
    if (mapped) {
      out += mapped;
    } else {
      const lower = ch.toLowerCase();
      out += lower.length === ch.length ? lower : ch;
    }
  }
  return out;
}

/**
 * Arama ve komut eşleştirmesi için katlanmış biçim: Türkçe küçük harf,
 * ardından ç→c, ğ→g, ı→i, ö→o, ş→s, ü→u. Uzunluğu korur.
 * Böylece "KIZIMA", "kızıma" ve "kizima" aynı biçime iner.
 */
export function fold(text: string): string {
  let out = '';
  for (const ch of trLower(text)) {
    out += FOLD_MAP[ch] ?? ch;
  }
  return out;
}

/** Arama için kaydedilen metin: katlanmış ve boşlukları sadeleştirilmiş. */
export function searchNorm(text: string): string {
  return fold(text).replace(/\s+/g, ' ').trim();
}

/** Sorguyu boşluklara göre parçalar ve her parçayı katlar. */
export function searchTokens(query: string): string[] {
  return searchNorm(query)
    .split(' ')
    .map((t) => t.replace(/^[.,;:!?"'()]+|[.,;:!?"'()]+$/g, ''))
    .filter((t) => t.length > 0);
}

/** SQLite LIKE için % ve _ karakterlerini kaçırır (ESCAPE '\'). */
export function escapeLike(token: string): string {
  return token.replace(/[\\%_]/g, (m) => '\\' + m);
}

/** Türkçe kurala göre ilk harfi büyütür. */
export function capitalizeTr(text: string): string {
  const t = text.trim();
  if (!t) return t;
  const first = t[0];
  const upper = first === 'i' ? 'İ' : first === 'ı' ? 'I' : first.toUpperCase();
  return upper + t.slice(1);
}

/** Metnin ilk dolu satırını başlık olarak döndürür (en çok 80 karakter). */
export function firstLineTitle(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return line.length > 80 ? line.slice(0, 77).trimEnd() + '…' : line;
}
