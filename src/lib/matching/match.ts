import type { Need, Property } from '../../types';
import { formatNumberFa, formatToman, normalizeText } from '../utils/persian';
import { PROPERTY_TYPE_LABELS, TRANSACTION_LABELS } from '../utils/labels';

/**
 * Rule-based, explainable matching (algorithm v1). No ML, no embeddings.
 * 1. Hard constraints → reject.
 * 2. Weighted soft score over ONLY the criteria the client actually specified.
 * UNKNOWN property data never counts as a match: it earns 0 points but stays in the denominator.
 * The percentage is a rule score, NOT a probability of success.
 */
export const MATCH_ALGORITHM_VERSION = 'rules-v1';
export const SUGGEST_MIN_SCORE = 60;

export type ReasonFactor = 'type' | 'location' | 'area' | 'bedrooms' | 'budget';
export type ReasonStatus = 'match' | 'partial' | 'unknown' | 'mismatch';

export interface MatchReason {
  factor: ReasonFactor;
  status: ReasonStatus;
  text: string;
  points: number;
  maxPoints: number;
}

export interface MatchResult {
  propertyId: string;
  needId: string;
  rejected: boolean;
  rejectReasons: string[];
  /** 0–100 rule-based score (0 when rejected) */
  score: number;
  reasons: MatchReason[];
  /** Criteria the client asked for but the property record does not state. */
  unknownFactors: string[];
  algorithm: string;
}

const W = { type: 10, location: 25, area: 20, bedrooms: 20, budget: 25 } as const;
const fa = formatNumberFa;
const norm = (s: string) => normalizeText(s).toLowerCase();

/** Cheaper-than-cap is slightly better: 70%..100% of the weight. */
function budgetFraction(value: number, cap: number): number {
  const headroom = cap > 0 ? Math.max(0, 1 - value / cap) : 0;
  return Math.min(1, 0.7 + 0.3 * headroom);
}

function locationMatches(propertyPlace: string, wanted: string): boolean {
  const a = norm(propertyPlace);
  const b = norm(wanted);
  return !!a && !!b && (a.includes(b) || b.includes(a));
}

export function evaluateMatch(p: Property, n: Need): MatchResult {
  const base = { propertyId: p.id, needId: n.id, algorithm: MATCH_ALGORITHM_VERSION };
  const rejectReasons: string[] = [];

  // ── hard constraints ──────────────────────────────────
  if (p.transactionType !== n.transactionType) {
    rejectReasons.push(`نوع معامله متفاوت است (ملک: ${TRANSACTION_LABELS[p.transactionType]}، نیاز: ${TRANSACTION_LABELS[n.transactionType]})`);
  }
  if (n.propertyType && p.propertyType !== n.propertyType) {
    rejectReasons.push(`نوع ملک متفاوت است (ملک: ${PROPERTY_TYPE_LABELS[p.propertyType]}، نیاز: ${PROPERTY_TYPE_LABELS[n.propertyType]})`);
  }
  if (p.area != null) {
    if (n.minArea != null && p.area < n.minArea) rejectReasons.push(`متراژ ${fa(p.area)} کمتر از حداقل ${fa(n.minArea)} متر است`);
    if (n.maxArea != null && p.area > n.maxArea) rejectReasons.push(`متراژ ${fa(p.area)} بیشتر از حداکثر ${fa(n.maxArea)} متر است`);
  }
  if (n.transactionType === 'sale') {
    if (n.maxPrice != null && p.price != null && p.price > n.maxPrice) {
      rejectReasons.push(`قیمت ${formatToman(p.price)} از سقف بودجه (${formatToman(n.maxPrice)}) بیشتر است`);
    }
  } else {
    if (n.maxDeposit != null && p.deposit != null && p.deposit > n.maxDeposit) {
      rejectReasons.push(`رهن ${formatToman(p.deposit)} از سقف (${formatToman(n.maxDeposit)}) بیشتر است`);
    }
    if (n.maxRent != null && p.rent != null && p.rent > n.maxRent) {
      rejectReasons.push(`اجاره ${formatToman(p.rent)} از سقف (${formatToman(n.maxRent)}) بیشتر است`);
    }
  }
  if (rejectReasons.length > 0) {
    return { ...base, rejected: true, rejectReasons, score: 0, reasons: [], unknownFactors: [] };
  }

  // ── soft scoring ──────────────────────────────────────
  const reasons: MatchReason[] = [];
  const add = (r: MatchReason) => reasons.push(r);

  if (n.propertyType) {
    add({ factor: 'type', status: 'match', text: `نوع ملک مطابق نیاز (${PROPERTY_TYPE_LABELS[p.propertyType]})`, points: W.type, maxPoints: W.type });
  }

  if (n.location.trim()) {
    const placeKnown = p.location.trim() || p.neighborhood.trim();
    if (!placeKnown) {
      add({ factor: 'location', status: 'unknown', text: 'منطقه ملک ثبت نشده است', points: 0, maxPoints: W.location });
    } else if (locationMatches(p.location, n.location) || locationMatches(p.neighborhood, n.location)) {
      add({ factor: 'location', status: 'match', text: `منطقه مطابق درخواست (${p.location || p.neighborhood})`, points: W.location, maxPoints: W.location });
    } else {
      add({ factor: 'location', status: 'mismatch', text: `منطقه ملک (${p.location || p.neighborhood}) با درخواست (${n.location}) متفاوت است`, points: 0, maxPoints: W.location });
    }
  }

  if (n.minArea != null || n.maxArea != null) {
    const range = `${n.minArea != null ? fa(n.minArea) : '…'} تا ${n.maxArea != null ? fa(n.maxArea) : '…'} متر`;
    if (p.area == null) {
      add({ factor: 'area', status: 'unknown', text: 'متراژ ملک ثبت نشده است', points: 0, maxPoints: W.area });
    } else {
      let frac = 1;
      if (n.minArea != null && n.maxArea != null && n.maxArea > n.minArea) {
        const mid = (n.minArea + n.maxArea) / 2;
        const half = (n.maxArea - n.minArea) / 2;
        frac = 1 - 0.3 * Math.min(1, Math.abs(p.area - mid) / half);
      }
      add({ factor: 'area', status: 'match', text: `متراژ مناسب: ${fa(p.area)} متر (بازه خواسته‌شده ${range})`, points: W.area * frac, maxPoints: W.area });
    }
  }

  if (n.bedrooms != null) {
    if (p.bedrooms == null) {
      add({ factor: 'bedrooms', status: 'unknown', text: 'تعداد خواب ملک ثبت نشده است', points: 0, maxPoints: W.bedrooms });
    } else if (p.bedrooms === n.bedrooms) {
      add({ factor: 'bedrooms', status: 'match', text: `${fa(p.bedrooms)} خواب، مطابق نیاز`, points: W.bedrooms, maxPoints: W.bedrooms });
    } else if (Math.abs(p.bedrooms - n.bedrooms) === 1) {
      add({ factor: 'bedrooms', status: 'partial', text: `${fa(p.bedrooms)} خواب (نیاز: ${fa(n.bedrooms)} خواب)`, points: W.bedrooms / 2, maxPoints: W.bedrooms });
    } else {
      add({ factor: 'bedrooms', status: 'mismatch', text: `${fa(p.bedrooms)} خواب با نیاز ${fa(n.bedrooms)} خواب فاصله دارد`, points: 0, maxPoints: W.bedrooms });
    }
  }

  // budget criteria (sale: price; rent: deposit and/or rent)
  const budgetItems: Array<{ label: string; value: number | null; cap: number | null }> =
    n.transactionType === 'sale'
      ? [{ label: 'قیمت', value: p.price, cap: n.maxPrice }]
      : [
          { label: 'رهن', value: p.deposit, cap: n.maxDeposit },
          { label: 'اجاره', value: p.rent, cap: n.maxRent },
        ];
  const active = budgetItems.filter((b) => b.cap != null);
  for (const b of active) {
    const max = W.budget / active.length;
    if (b.value == null) {
      add({ factor: 'budget', status: 'unknown', text: `${b.label} ملک ثبت نشده است`, points: 0, maxPoints: max });
    } else {
      add({
        factor: 'budget',
        status: 'match',
        text: `${b.label} ${formatToman(b.value)} در سقف بودجه (${formatToman(b.cap)})`,
        points: max * budgetFraction(b.value, b.cap as number),
        maxPoints: max,
      });
    }
  }

  const earned = reasons.reduce((s, r) => s + r.points, 0);
  const possible = reasons.reduce((s, r) => s + r.maxPoints, 0);
  const score = possible > 0 ? Math.round((earned / possible) * 100) : 0;
  const factorLabel: Record<ReasonFactor, string> = { type: 'نوع ملک', location: 'منطقه', area: 'متراژ', bedrooms: 'تعداد خواب', budget: 'بودجه' };
  const unknownFactors = Array.from(new Set(reasons.filter((r) => r.status === 'unknown').map((r) => factorLabel[r.factor])));

  return { ...base, rejected: false, rejectReasons: [], score, reasons, unknownFactors };
}

/** Non-rejected matches for one need, best first. */
export function findMatchesForNeed(need: Need, properties: Property[], minScore = 0): MatchResult[] {
  return properties
    .map((p) => evaluateMatch(p, need))
    .filter((r) => !r.rejected && r.score >= minScore)
    .sort((a, b) => b.score - a.score);
}

/** Non-rejected needs for one property, best first. */
export function findMatchesForProperty(property: Property, needs: Need[], minScore = 0): MatchResult[] {
  return needs
    .map((n) => evaluateMatch(property, n))
    .filter((r) => !r.rejected && r.score >= minScore)
    .sort((a, b) => b.score - a.score);
}

export interface Suggestion { need: Need; property: Property; result: MatchResult }

/** Best (need, property) pairs across everything; used by the dashboard. */
export function suggestTopMatches(needs: Need[], properties: Property[], minScore = SUGGEST_MIN_SCORE): Suggestion[] {
  const out: Suggestion[] = [];
  for (const need of needs) {
    for (const property of properties) {
      const result = evaluateMatch(property, need);
      if (!result.rejected && result.score >= minScore) out.push({ need, property, result });
    }
  }
  return out.sort((a, b) => b.result.score - a.result.score);
}
