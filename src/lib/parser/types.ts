import type { PropertyDraft } from '../../types';

export interface ParseResult {
  draft: PropertyDraft;
  /** Fields the parser actually found in the text (everything else stays unknown). */
  extracted: Array<keyof PropertyDraft>;
  /** Interpretations the user must be able to see and correct (e.g. money units). */
  assumptions: string[];
}

/** Swap-in point: LocalPersianParser today, an LLM-backed parser later. */
export interface SmartParser {
  parsePropertyText(text: string): Promise<ParseResult>;
}

export function emptyDraft(): PropertyDraft {
  return {
    title: '', transactionType: null, propertyType: null, area: null, bedrooms: null,
    location: '', neighborhood: '', price: null, deposit: null, rent: null,
    floor: null, totalFloors: null, parking: null, elevator: null, storage: null,
    description: '', contactName: '', contactPhone: '',
  };
}
