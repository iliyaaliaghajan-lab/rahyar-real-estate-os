import type { AIProvider } from './provider';
import { RuleBasedProvider } from './ruleBased';

export type { AIProvider, FollowUpSuggestion } from './provider';

let provider: AIProvider | null = null;
/** Single place to swap in a real LLM provider later. */
export function getAIProvider(): AIProvider {
  return (provider ??= new RuleBasedProvider());
}
