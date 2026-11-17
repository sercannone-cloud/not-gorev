// Başka bir uygulamadan Android "Paylaş" menüsüyle gelen içeriği kayıt
// taslağı metnine çevirir. Yalnızca düz metin ve bağlantı; dosyalar yok sayılır.
// Kayıt kendiliğinden yapılmaz: metin giriş alanına düşer, alanı ve kategoriyi kullanıcı seçer.

export interface SharedInput {
  text?: string | null;
  webUrl?: string | null;
  meta?: { title?: string } | null;
  type?: string | null;
  files?: unknown;
}

export function sharedText(input: SharedInput): string | null {
  const text = (input.text ?? '').trim() || (input.webUrl ?? '').trim();
  if (!text) return null;
  const title = input.meta?.title?.trim();
  if (title && !text.includes(title)) return `${title}\n${text}`;
  return text;
}
