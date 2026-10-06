import type { Client, FollowUp, Need, Property } from '../../types';
import type { ParseResult } from '../parser';

export interface FollowUpSuggestion {
  title: string;
  reason: string;
  propertyId: string | null;
}

/**
 * The only door through which AI features enter the app.
 * Today: RuleBasedProvider (no network, no key). Later: LLM providers called via a SERVER route
 * (API keys must never reach the browser). AI output is always a draft the user reviews.
 */
export interface AIProvider {
  readonly name: string;
  parsePropertyText(text: string): Promise<ParseResult>;
  generateClientMessage(input: { client: Client; property: Property; need?: Need | null }): Promise<string>;
  summarizeClient(input: { client: Client; needs: Need[]; followUps: FollowUp[] }): Promise<string>;
  suggestFollowUps(input: { client: Client; needs: Need[]; properties: Property[]; followUps: FollowUp[] }): Promise<FollowUpSuggestion[]>;
}
