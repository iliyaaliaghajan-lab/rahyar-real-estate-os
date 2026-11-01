'use client';
import { useLiveQuery } from 'dexie-react-hooks';

/** Live (auto-updating) read through the repositories. `undefined` = still loading. */
export function useQuery<T>(query: () => Promise<T>, deps: unknown[] = []): T | undefined {
  return useLiveQuery(query, deps);
}
