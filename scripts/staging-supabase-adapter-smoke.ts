/**
 * Opt-in Staging smoke entrypoint: real createSupabaseRepositories() with JWT sessions.
 */
import { runAdapterSmoke } from './staging-supabase-adapter-smoke-lib';

runAdapterSmoke().catch((e) => {
  console.error('FATAL', e instanceof Error ? e.message : e);
  process.exit(1);
});
