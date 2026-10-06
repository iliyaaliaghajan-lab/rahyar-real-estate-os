import { normalizeText } from './persian';

/** All whitespace-separated tokens of the query must appear in at least one field. */
export function matchesQuery(fields: Array<string | number | null | undefined>, query: string): boolean {
  const q = normalizeText(query).toLowerCase();
  if (!q) return true;
  const hay = fields
    .filter((f) => f != null && f !== '')
    .map((f) => normalizeText(String(f)).toLowerCase())
    .join(' | ');
  return q.split(' ').every((tok) => hay.includes(tok));
}
