/**
 * Static SQL contract tests for migration 008 only.
 * Does NOT connect to Supabase. Passing does NOT prove live RLS.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql008 = readFileSync(
  join(process.cwd(), 'supabase/migrations/008_rls_helper_schema_and_profile_policy_optimization.sql'),
  'utf8',
);

describe('migration 008 private RLS helper and profile policy optimization (static SQL contract)', () => {
  it('defines private.user_organization_ids as SECURITY DEFINER with empty search_path', () => {
    assert.match(sql008, /CREATE OR REPLACE FUNCTION private\.user_organization_ids\(\)/i);
    assert.match(sql008, /SECURITY DEFINER/i);
    assert.match(sql008, /SET search_path = ''/i);
    assert.match(sql008, /status = 'active'/);
    assert.match(sql008, /FROM public\.organization_members/i);
  });

  it('locks down private schema and grants only what RLS evaluation needs', () => {
    assert.match(sql008, /CREATE SCHEMA IF NOT EXISTS private/i);
    assert.match(sql008, /REVOKE ALL ON SCHEMA private FROM PUBLIC/i);
    assert.match(sql008, /REVOKE ALL ON SCHEMA private FROM anon/i);
    assert.match(sql008, /GRANT USAGE ON SCHEMA private TO authenticated/i);
    assert.match(sql008, /REVOKE ALL ON FUNCTION private\.user_organization_ids\(\) FROM PUBLIC/i);
    assert.match(sql008, /REVOKE ALL ON FUNCTION private\.user_organization_ids\(\) FROM anon/i);
    assert.match(sql008, /GRANT EXECUTE ON FUNCTION private\.user_organization_ids\(\) TO authenticated/i);
    assert.match(sql008, /Data API exposed schemas/i);
  });

  it('moves organizations and members SELECT policies to private.user_organization_ids', () => {
    assert.match(sql008, /CREATE POLICY "Users can view their organizations"/);
    assert.match(sql008, /CREATE POLICY "Members can view organization members"/);
    assert.match(sql008, /id IN \(SELECT private\.user_organization_ids\(\)\)/);
    assert.match(sql008, /organization_id IN \(SELECT private\.user_organization_ids\(\)\)/);
  });

  it('rewrites existing business-table tenant policies without broadening grants', () => {
    assert.match(sql008, /Tenant isolation for /);
    assert.match(sql008, /ARRAY\['clients', 'needs', 'follow_ups', 'activities', 'properties'\]/);
    assert.match(sql008, /organization_id IN \(SELECT private\.user_organization_ids\(\)\)/);
    assert.doesNotMatch(sql008, /GRANT ALL ON TABLE public\.(properties|clients)/i);
    assert.doesNotMatch(sql008, /GRANT\s+.*\s+TO anon/i);
  });

  it('consolidates profile SELECT into one policy and keeps UPDATE USING + WITH CHECK', () => {
    assert.match(sql008, /CREATE POLICY "Users can view accessible profiles"/);
    assert.match(sql008, /id = \(SELECT auth\.uid\(\)\)/);
    assert.match(sql008, /CREATE POLICY "Users can update own profile"/);
    assert.match(sql008, /USING \(id = \(SELECT auth\.uid\(\)\)\)/);
    assert.match(sql008, /WITH CHECK \(id = \(SELECT auth\.uid\(\)\)\)/);
    assert.match(sql008, /DROP POLICY IF EXISTS "Users can view own profile"/);
    assert.match(sql008, /DROP POLICY IF EXISTS "Users can view profiles in same organization"/);
  });

  it('drops public helper functions only after policy rewrites', () => {
    const privatePol = sql008.indexOf('SELECT private.user_organization_ids()');
    const dropPublic = sql008.indexOf('DROP FUNCTION IF EXISTS public.user_organization_ids()');
    assert.ok(privatePol > 0 && dropPublic > privatePol, 'drop public helpers after private policy references');
    assert.match(sql008, /DROP FUNCTION IF EXISTS public\.user_active_organization_ids\(\)/);
  });

  it('keeps organization_invitations locked without restoring direct SELECT', () => {
    assert.match(sql008, /REVOKE ALL ON TABLE public\.organization_invitations FROM PUBLIC/i);
    assert.match(sql008, /REVOKE ALL ON TABLE public\.organization_invitations FROM anon/i);
    assert.match(sql008, /REVOKE ALL ON TABLE public\.organization_invitations FROM authenticated/i);
    assert.doesNotMatch(sql008, /CREATE POLICY[\s\S]{0,80}organization_invitations/i);
    assert.doesNotMatch(sql008, /GRANT SELECT ON TABLE public\.organization_invitations/i);
  });

  it('does not alter product RPC signatures or grants', () => {
    assert.doesNotMatch(sql008, /CREATE OR REPLACE FUNCTION public\.create_organization_with_owner/i);
    assert.doesNotMatch(sql008, /CREATE OR REPLACE FUNCTION public\.create_organization_invitation/i);
    assert.doesNotMatch(sql008, /CREATE OR REPLACE FUNCTION public\.accept_organization_invitation/i);
  });
});
