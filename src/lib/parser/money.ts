const E = '(?![آ-ی])'; // "not followed by a Persian letter" (JS \b does not work for Persian)
const UNIT: Record<string, number> = { میلیارد: 1e9, میلیون: 1e6, ملیون: 1e6, هزار: 1e3, م: 1e6 };

export interface MoneyParse {
  /** integer toman */
  value: number;
  /** true when the unit had to be assumed (e.g. «۵۰۰» → ۵۰۰ میلیون تومان) */
  assumed: boolean;
  raw: string;
  /** index in the source text where the money expression ends */
  end: number;
}

/**
 * Parses a Persian money expression starting at `start` of an already-normalized text.
 * Supports: ۵۰۰ | ۵۰۰ میلیون | ۲.۵ میلیارد | ۲ میلیارد و ۵۰۰ (میلیون) | ۵۰۰م | ۱۵۰۰۰۰۰ (raw toman).
 * Unitless numbers < 100000 are read as million toman and flagged `assumed`.
 */
export function parseMoneyAt(text: string, start: number): MoneyParse | null {
  const m = new RegExp(`^\\s*(\\d+(?:\\.\\d+)?)\\s*(?:(میلیارد|میلیون|ملیون|هزار|م)${E})?`).exec(text.slice(start));
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (!Number.isFinite(num)) return null;
  const unit = m[2];
  let end = start + m[0].length;
  let value: number;
  let assumed = false;

  if (unit) {
    value = num * UNIT[unit];
    if (unit === 'میلیارد' || unit === 'میلیون' || unit === 'ملیون') {
      const tail = new RegExp(
        `^\\s*و\\s*(\\d+(?:\\.\\d+)?)\\s*(?:(میلیون|ملیون|هزار)${E})?`,
      ).exec(text.slice(end));
      if (tail) {
        const n2 = parseFloat(tail[1]);
        const u2 = tail[2];
        if (u2) {
          value += n2 * UNIT[u2];
          end += tail[0].length;
        } else if (n2 < 1000 && !new RegExp('^\\s*(?:خواب|اتاق|متر|طبقه|سال|واحد|پارکینگ)').test(text.slice(end + tail[0].length))) {
          // "۲ میلیارد و ۵۰۰" → 500 million ; "۱۲ میلیون و ۵۰۰" → 500 thousand
          value += n2 * (unit === 'میلیارد' ? 1e6 : 1e3);
          assumed = true;
          end += tail[0].length;
        }
      }
    }
  } else if (num >= 100000) {
    value = num; // explicit large number → toman as written
  } else {
    value = num * 1e6; // «۵۰۰» → ۵۰۰ میلیون تومان (shown to the user as an assumption)
    assumed = true;
  }
  return { value: Math.round(value), assumed, raw: text.slice(start, end).trim(), end };
}
