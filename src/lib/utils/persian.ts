const FA = '۰۱۲۳۴۵۶۷۸۹';
const AR = '٠١٢٣٤٥٦٧٨٩';

/** Persian/Arabic-Indic digits → ASCII digits. */
export function toLatinDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)));
}

/** Digits (and numbers) → Persian digits for display. */
export function toPersianDigits(v: string | number): string {
  return String(v).replace(/\d/g, (d) => FA[Number(d)]);
}

/** Unify Arabic letter variants and strip diacritics/kashida. */
export function normalizeLetters(s: string): string {
  return s
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ۀ/g, 'ه')
    .replace(/ة/g, 'ه')
    .replace(/[\u064B-\u065F\u0640]/g, '');
}

/**
 * Normalization used by the parser and by search:
 * latin digits, unified letters, ZWNJ → space, decimal/thousand separators cleaned.
 */
export function normalizeText(s: string): string {
  let t = normalizeLetters(toLatinDigits(s));
  t = t.replace(/[\u200c\u200e\u200f]/g, ' ');
  t = t.replace(/٫/g, '.').replace(/٬/g, ',').replace(/،/g, ',');
  // ۲/۵ → 2.5 (short decimal only; "۵۰۰/۱۵" stays a slash-separated pair)
  t = t.replace(/(^|[^\d])(\d{1,2})\/(\d)(?!\d)/g, '$1$2.$3');
  t = t.replace(/(\d),(?=\d{3}(?!\d))/g, '$1'); // 1,500,000 → 1500000
  return t.replace(/\s+/g, ' ').trim();
}

/** Number with Persian digits and Persian decimal separator, e.g. 12.5 → ۱۲٫۵ */
export function formatNumberFa(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  const [i, f] = String(rounded).split('.');
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
  return toPersianDigits(f ? `${grouped}٫${f}` : grouped);
}

/** Integer toman → "۲ میلیارد و ۵۰۰ میلیون تومان". null → "—" */
export function formatToman(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n === 0) return '۰ تومان';
  if (n >= 1e9) {
    const b = Math.floor(n / 1e9);
    const restM = (n - b * 1e9) / 1e6;
    const head = `${formatNumberFa(b)} میلیارد`;
    return restM > 0 ? `${head} و ${formatNumberFa(restM)} میلیون تومان` : `${head} تومان`;
  }
  if (n >= 1e6) return `${formatNumberFa(n / 1e6)} میلیون تومان`;
  if (n >= 1e3) return `${formatNumberFa(n / 1e3)} هزار تومان`;
  return `${formatNumberFa(n)} تومان`;
}

/** Returns normalized Iranian mobile "09xxxxxxxxx" or null if not a valid mobile. */
export function normalizeIranMobile(input: string): string | null {
  const digits = toLatinDigits(input).replace(/[^\d+]/g, '');
  let d = digits.replace(/^\+/, '');
  if (d.startsWith('0098')) d = d.slice(4);
  else if (d.startsWith('98') && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith('9')) d = '0' + d;
  return /^09\d{9}$/.test(d) ? d : null;
}
