/**
 * Static contract checks for the Staging Supabase adapter smoke runner.
 * No network. Ensures the runner and workflow stay opt-in and pinned.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

describe('staging supabase adapter smoke contract', () => {
  it('runner pins Staging origin and refuses Production ref', () => {
    const src = readFileSync(join(root, 'scripts/staging-supabase-adapter-smoke.ts'), 'utf8');
    assert.match(src, /dezonafotwyvvghbccko\.supabase\.co/);
    assert.match(src, /gguvmewknanhzukugvpj/);
    assert.match(src, /STAGING_MIGRATION_011_CONFIRMED/);
    assert.match(src, /createSupabaseRepositories/);
    assert.match(src, /getCurrentMembership/);
    assert.match(src, /reposFor/);
    assert.match(src, /SUPABASE_LIST_PAGE_SIZE/);
    // Business authorization asserts go through adapter remove/list/get, not raw JWT table deletes.
    assert.match(src, /expectDeleteDenied/);
  });

  it('workflow is workflow_dispatch only with dual confirms and branch guard', () => {
    const yml = readFileSync(
      join(root, '.github/workflows/staging-supabase-adapter-smoke.yml'),
      'utf8',
    );
    assert.match(yml, /workflow_dispatch/);
    assert.doesNotMatch(yml, /\bpull_request\b/);
    assert.doesNotMatch(yml, /\bpush\b:/);
    assert.match(yml, /confirm_staging_run/);
    assert.match(yml, /confirm_migration_011_already_applied/);
    assert.match(yml, /feat\/etehad-supabase-adapter-staging-smoke-20261116/);
    assert.match(yml, /etehad-staging-security/);
    assert.match(yml, /test:staging-supabase-adapter/);
    assert.doesNotMatch(yml, /supabase db push|migration up|migrate/i);
  });

  it('package script uses tsx without new dependency declaration drift', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts['test:staging-supabase-adapter'], 'tsx scripts/staging-supabase-adapter-smoke.ts');
    assert.ok(pkg.devDependencies?.tsx);
  });

  it('Dexie remains the default repositories export', () => {
    const idx = readFileSync(join(root, 'src/lib/repositories/index.ts'), 'utf8');
    assert.match(idx, /dexieRepositories/);
    assert.doesNotMatch(idx, /createSupabaseRepositories\(\)/);
  });
});
