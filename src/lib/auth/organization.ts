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
 * Returns null if:
 * - user is not authenticated
 * - user has no active membership
 *
 * For Phase 1 we assume a user belongs to at most one active organization.
 * Multi-organization support can be added later without breaking this API.
 */
export async function getCurrentMembership(): Promise<CurrentMembership | null> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from('organization_members')
    .select(
      `
      role,
      organization_id,
      organizations (
        id,
        name
      )
    `
    )
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (error || !data || !data.organizations) {
    return null;
  }

  // Supabase returns the related organization as an object (or array in some cases)
  const org = Array.isArray(data.organizations)
    ? data.organizations[0]
    : data.organizations;

  if (!org) return null;

  return {
    organizationId: org.id,
    organizationName: org.name,
    role: data.role as MemberRole,
    userId: user.id,
  };
}
