import type { PropertyDraft, PropertyType } from '../../types';
import { formatToman, normalizeIranMobile, normalizeLetters, normalizeText, toPersianDigits } from '../utils/persian';
import { PROPERTY_TYPE_LABELS } from '../utils/labels';
import { NEIGHBORHOODS } from './neighborhoods';
import { parseMoneyAt } from './money';
import { emptyDraft, type ParseResult, type SmartParser } from './types';

const B = '(?:^|[^آ-ی])'; // left boundary
const E = '(?![آ-ی])'; // right boundary
const WORD_NUM: Record<string, number> = { یک: 1, یه: 1, دو: 2, سه: 3, چهار: 4, پنج: 5, شش: 6, هفت: 7, هشت: 8 };
const ORDINAL: Record<string, number> = { همکف: 0, اول: 1, دوم: 2, سوم: 3, چهارم: 4, پنجم: 5, ششم: 6, هفتم: 7, هشتم: 8, نهم: 9, دهم: 10 };
const STOP = new Set([
  'طبقه', 'خواب', 'اتاق', 'متر', 'متری', 'پارکینگ', 'آسانسور', 'انباری', 'رهن', 'اجاره', 'فروش', 'قیمت',
  'آپارتمان', 'خانه', 'زمین', 'مغازه', 'دفتر', 'و', 'با', 'در', 'از', 'به', 'برای', 'تومان', 'میلیون', 'میلیارد',
  ...Object.keys(WORD_NUM),
]);

const TYPE_RULES: Array<[PropertyType, string]> = [
  ['apartment', 'آپارتمان|آپارتمانی|واحد|برج'],
  ['house', 'خانه|ویلا|ویلایی|باغ|کلنگی|دوبلکس'],
  ['land', 'زمین'],
  ['shop', 'مغازه|تجاری'],
  ['office', 'دفتر|اداری'],
];

const KNOWN_LOCATIONS = NEIGHBORHOODS.map((display) => ({
  display,
  key: normalizeLetters(display).replace(/\u200c/g, ' '),
})).sort((a, b) => b.key.length - a.key.length);

const isLetter = (ch: string | undefined) => !!ch && /[آ-ی]/.test(ch);

function toNum(s: string): number | null {
  if (/^\d/.test(s)) return Number(s);
  return WORD_NUM[s] ?? null;
}

export function makeTitle(d: Pick<PropertyDraft, 'propertyType' | 'area' | 'bedrooms' | 'location' | 'transactionType'>): string {
  const parts: string[] = [];
  parts.push(d.propertyType ? PROPERTY_TYPE_LABELS[d.propertyType] : 'فایل');
  if (d.area != null) parts.push(`${toPersianDigits(d.area)} متری`);
  if (d.bedrooms != null) parts.push(`${toPersianDigits(d.bedrooms)} خوابه`);
  if (d.location) parts.push(d.location);
  return parts.join(' ');
}

/** Deterministic Persian property-text extractor. Never guesses: unknown stays empty. */
export function parsePropertyTextSync(raw: string): ParseResult {
  const draft = emptyDraft();
  const extracted = new Set<keyof PropertyDraft>();
  const assumptions: string[] = [];
  const text = normalizeText(raw);
  let work = text;
  const mask = (i: number, len: number) => {
    work = work.slice(0, i) + ' '.repeat(len) + work.slice(i + len);
  };
  const set = <K extends keyof PropertyDraft>(k: K, v: PropertyDraft[K]) => {
    draft[k] = v;
    extracted.add(k);
  };

  if (!text) return { draft, extracted: [], assumptions };

  // ── phone ─────────────────────────────────────────────
  const pm = /(^|[^\d])((?:\+98|0098)?0?9\d{2}[\s-]?\d{3}[\s-]?\d{4})(?!\d)/.exec(work);
  if (pm) {
    const phone = normalizeIranMobile(pm[2]);
    if (phone) {
      set('contactPhone', phone);
      mask(pm.index + pm[1].length, pm[2].length);
    }
  }
  // ── contact name ──────────────────────────────────────
  const nm = new RegExp(`${B}((?:آقای|اقای|خانم|دکتر|مهندس)\\s+[آ-ی]+)`).exec(work);
  if (nm) {
    set('contactName', nm[1]);
    mask(nm.index + nm[0].length - nm[1].length, nm[1].length);
  }

  // ── money (keyword-driven) ────────────────────────────
  const findMoney = (keywords: string, label: string, key: 'deposit' | 'rent' | 'price') => {
    const re = new RegExp(`${B}(${keywords})${E}\\s*[:=]?`, 'g');
    for (const m of work.matchAll(re)) {
      const kwStart = (m.index ?? 0) + m[0].indexOf(m[1]);
      const money = parseMoneyAt(work, (m.index ?? 0) + m[0].length);
      if (money) {
        set(key, money.value);
        if (money.assumed) {
          assumptions.push(
            `${label} «${toPersianDigits(money.raw)}» بدون واحد کامل نوشته شده بود؛ ${formatToman(money.value)} در نظر گرفته شد.`,
          );
        }
        mask(kwStart, money.end - kwStart);
        return true;
      }
    }
    return false;
  };
  // "رهن و اجاره ۵۰۰ / ۱۵" (two numbers after a combined keyword)
  const combo = new RegExp(`${B}رهن\\s*و\\s*اجاره${E}\\s*[:=]?`).exec(work);
  if (combo) {
    const kwStart = combo.index + combo[0].indexOf('رهن');
    const first = parseMoneyAt(work, combo.index + combo[0].length);
    if (first) {
      const sep = /^\s*(?:\/|-|و|،|,)?/.exec(work.slice(first.end));
      const second = parseMoneyAt(work, first.end + (sep ? sep[0].length : 0));
      if (second) {
        set('deposit', first.value);
        set('rent', second.value);
        for (const [lab, mm] of [['رهن', first], ['اجاره', second]] as const) {
          if (mm.assumed) assumptions.push(`${lab} «${toPersianDigits(mm.raw)}» بدون واحد کامل نوشته شده بود؛ ${formatToman(mm.value)} در نظر گرفته شد.`);
        }
        mask(kwStart, second.end - kwStart);
      }
    }
  }
  if (draft.deposit == null) findMoney('رهن|ودیعه', 'رهن', 'deposit');
  if (draft.rent == null) findMoney('اجاره|کرایه', 'اجاره', 'rent');
  findMoney('قیمت کل|قیمت|فروش|مبلغ|ارزش', 'قیمت', 'price');

  // ── area ──────────────────────────────────────────────
  const am =
    new RegExp(`(?:^|[^\\d.])(\\d+(?:\\.\\d+)?)\\s*(?:متر\\s*مربع|متری|متر|m2|م²)${E}`).exec(work) ??
    /متراژ\s*[:=]?\s*(\d+(?:\.\d+)?)()/.exec(work);
  if (am) {
    const v = parseFloat(am[1]);
    if (v > 0 && v < 1e6) {
      set('area', v);
      mask(am.index, am[0].length);
    }
  }

  // ── bedrooms ──────────────────────────────────────────
  const bm =
    new RegExp(`${B}(\\d+|یک|یه|دو|سه|چهار|پنج|شش)\\s*(?:خوابه|خواب|اتاق\\s*خواب|اتاقه|اتاق)${E}`).exec(work) ??
    new RegExp(`${B}خواب\\s*[:=]?\\s*(\\d+)`).exec(work);
  if (bm) {
    const n = toNum(bm[1]);
    if (n != null && n >= 0 && n <= 15) set('bedrooms', n);
  } else if (new RegExp(`${B}تک\\s*خواب(?:ه)?${E}`).test(work)) {
    set('bedrooms', 1);
  }

  // ── floors ────────────────────────────────────────────
  const ordAlt = Object.keys(ORDINAL).join('|');
  const f2 = new RegExp(`طبقه\\s*(\\d+)\\s*از\\s*(\\d+)`).exec(work);
  if (f2) {
    set('floor', Number(f2[1]));
    set('totalFloors', Number(f2[2]));
  } else {
    const f1 = new RegExp(`طبقه(?:\\s*ی)?\\s*(\\d+|${ordAlt})${E}`).exec(work);
    if (f1) set('floor', /^\d/.test(f1[1]) ? Number(f1[1]) : ORDINAL[f1[1]]);
    else if (new RegExp(`${B}همکف${E}`).test(work)) set('floor', 0);
    const ft = /از\s*(\d+)\s*طبقه/.exec(work);
    if (ft) set('totalFloors', Number(ft[1]));
  }

  // ── amenities (true / false / unknown) ────────────────
  const flag = (word: string, key: 'parking' | 'elevator' | 'storage') => {
    if (new RegExp(`${B}(?:بدون|فاقد)\\s*${word}|${word}\\s*(?:ندارد|نداره)`).test(text)) set(key, false);
    else if (new RegExp(`${word}`).test(text)) set(key, true);
  };
  flag('پارکینگ', 'parking');
  flag('آسانسور', 'elevator');
  flag('انباری', 'storage');

  // ── property type ─────────────────────────────────────
  for (const [type, words] of TYPE_RULES) {
    if (new RegExp(`${B}(?:${words})${E}`).test(text)) {
      set('propertyType', type);
      break;
    }
  }

  // ── transaction type ──────────────────────────────────
  const hasRentWord = /رهن|ودیعه|اجاره|کرایه/.test(text);
  const hasSaleWord = new RegExp(`${B}(?:فروش|فروشی|فروشم)${E}`).test(text);
  if (draft.deposit != null || draft.rent != null || (hasRentWord && !hasSaleWord)) set('transactionType', 'rent');
  else if (hasSaleWord || draft.price != null) set('transactionType', 'sale');

  // Sale price written without a keyword: "... ۳ میلیارد"
  if (draft.price == null && draft.deposit == null && draft.rent == null && !hasRentWord) {
    const lm = /(\d+(?:\.\d+)?)\s*(?:میلیارد|میلیون|ملیون)/.exec(work);
    if (lm) {
      const money = parseMoneyAt(work, lm.index);
      if (money) {
        set('price', money.value);
        if (draft.transactionType == null) {
          set('transactionType', 'sale');
          assumptions.push('نوع معامله «فروش» در نظر گرفته شد، چون فقط یک قیمت نوشته شده بود.');
        }
        if (money.assumed) assumptions.push(`قیمت «${toPersianDigits(money.raw)}» با واحد حدسی خوانده شد: ${formatToman(money.value)}.`);
        mask(lm.index, money.end - lm.index);
      }
    }
  }

  // ── location ──────────────────────────────────────────
  let loc = '';
  for (const k of KNOWN_LOCATIONS) {
    let from = 0;
    while (from <= work.length) {
      const idx = work.indexOf(k.key, from);
      if (idx < 0) break;
      if (!isLetter(work[idx - 1]) && !isLetter(work[idx + k.key.length])) {
        loc = k.display;
        break;
      }
      from = idx + 1;
    }
    if (loc) break;
  }
  if (!loc) {
    const dm = /منطقه\s*(\d{1,2})(?!\d)/.exec(work);
    if (dm) loc = `منطقه ${toPersianDigits(dm[1])}`;
  }
  if (!loc) {
    const fm = new RegExp(`${B}(?:در|منطقه|محله|خیابان|بلوار|میدان|نزدیک)\\s+([آ-ی]+)(?:\\s+([آ-ی]+))?`).exec(work);
    if (fm && !STOP.has(fm[1])) {
      loc = fm[1];
      if (fm[2] && !STOP.has(fm[2])) loc += ' ' + fm[2];
    }
  }
  if (loc) set('location', loc);

  // The original text is kept as the description: nothing the user wrote is lost or invented.
  set('description', raw.trim());
  extracted.delete('description');
  draft.title = makeTitle(draft);
  if (extracted.size > 0) extracted.add('title');

  return { draft, extracted: Array.from(extracted), assumptions };
}

export class LocalPersianParser implements SmartParser {
  async parsePropertyText(text: string): Promise<ParseResult> {
    return parsePropertyTextSync(text);
  }
}
