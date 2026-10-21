/**
 * Role definitions for multi-tenant access control.
 *
 * These constants document the intended permission model.
 * In this stage they are NOT fully enforced on the server for every
 * operation. Organization creation forces role = 'owner' inside the
 * database function. Broader role-based authorization is a later stage.
 *
 * Database enum (member_role): 'owner' | 'admin' | 'agent'
 */

export const ROLES = ['owner', 'admin', 'agent'] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'مالک',
  admin: 'مدیر',
  agent: 'مشاور',
};

/**
 * Expected permissions (product intent — not fully enforced yet).
 *
 * owner  — full control of the organization, members, and settings
 * admin  — manage members and organization data (cannot delete the org)
 * agent  — work with properties, clients, needs, follow-ups within the org
 */
export const ROLE_PERMISSIONS: Record<
  Role,
  {
    canManageMembers: boolean;
    canDeleteOrganization: boolean;
    canManageOrgSettings: boolean;
    canManageBusinessData: boolean;
  }
> = {
  owner: {
    canManageMembers: true,
    canDeleteOrganization: true,
    canManageOrgSettings: true,
    canManageBusinessData: true,
  },
  admin: {
    canManageMembers: true,
    canDeleteOrganization: false,
    canManageOrgSettings: true,
    canManageBusinessData: true,
  },
  agent: {
    canManageMembers: false,
    canDeleteOrganization: false,
    canManageOrgSettings: false,
    canManageBusinessData: true,
  },
};

export function isValidRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
