import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser-side Supabase client.
 * Safe to use in Client Components.
 * Uses the public anon key only.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
