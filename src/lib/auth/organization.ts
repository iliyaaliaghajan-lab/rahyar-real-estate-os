import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

export type MemberRole = 'owner' | 'admin' | 'agent';

export interface CurrentMembership {
  organizationId: string;
  organizationName: string;
  role: MemberRole;
  userId: string;
}

/**
 * Resolves the current user's active organization membership.
 *
 * Phase 1 enforces at most one active organization per user.
 * If multiple active rows exist, returns null (does not pick arbitrarily).
 *
 * Optional `supabase` injects a client (e.g. JWT session under test).
 * When omitted, behavior is identical to the previous browser-client default.
 */
export async function getCurrentMembership(
  supabase?: SupabaseClient,
): Promise<CurrentMembership | null> {
  const client = supabase ?? createClient();

  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) return null;

  const { data, error } = await client
    .from('organization_members')
    .select(
      `
      role,
      organization_id,
      organizations (
        id,
        name
      )
    `,
    )
    .eq('user_id', user.id)
    .eq('status', 'active');

  if (error || !data || data.length === 0) {
    return null;
  }

  if (data.length > 1) {
    console.warn(
      '[getCurrentMembership] multiple active memberships; refusing arbitrary selection',
    );
    return null;
  }

  const row = data[0];
  if (!row.organizations) return null;

  const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
  if (!org) return null;

  return {
    organizationId: org.id,
    organizationName: org.name,
    role: row.role as MemberRole,
    userId: user.id,
  };
}
