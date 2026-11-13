/**
 * Role definitions for multi-tenant access control.
 *
 * These constants document the intended permission model.
 * Organization creation forces role = 'owner' inside the
 * database function. Business-record DELETE is enforced by RLS
 * (Migration 011) via private.user_can_delete_business_data.
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
 * Expected permissions (product intent).
 *
 * owner  — full control of the organization, members, and settings;
 *          may delete business records in the own active organization
 * admin  — manage members and organization data (cannot delete the org);
 *          may delete business records in the own active organization
 * agent  — work with properties, clients, needs, follow-ups within the org
 *          (SELECT / INSERT / UPDATE); MUST NOT delete business records
 *
 * canManageBusinessData covers SELECT/INSERT/UPDATE for business tables.
 * canDeleteBusinessData is a separate capability enforced by RLS for DELETE.
 * canDeleteOrganization remains owner-only and is unrelated to business rows.
 */
export const ROLE_PERMISSIONS: Record<
  Role,
  {
    canManageMembers: boolean;
    canDeleteOrganization: boolean;
    canManageOrgSettings: boolean;
    canManageBusinessData: boolean;
    canDeleteBusinessData: boolean;
  }
> = {
  owner: {
    canManageMembers: true,
    canDeleteOrganization: true,
    canManageOrgSettings: true,
    canManageBusinessData: true,
    canDeleteBusinessData: true,
  },
  admin: {
    canManageMembers: true,
    canDeleteOrganization: false,
    canManageOrgSettings: true,
    canManageBusinessData: true,
    canDeleteBusinessData: true,
  },
  agent: {
    canManageMembers: false,
    canDeleteOrganization: false,
    canManageOrgSettings: false,
    canManageBusinessData: true,
    canDeleteBusinessData: false,
  },
};

export function isValidRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
