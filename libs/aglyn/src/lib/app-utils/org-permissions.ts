/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { AglynOrgMember, OrgRole } from '../foundation'

/**
 * Granular org permissions (AGL-243) layered on the 4 org roles: each
 * role maps to a default permission set; custom roles
 * (`orgs/{orgId}/roles/{roleId}`) and per-member overrides refine it, so
 * e.g. an editor restricted to one host can also be granted billing
 * visibility — or an admin stripped of it — without inventing new roles.
 * The console hides unpermitted surfaces; the org API routes are the
 * enforcement point.
 */
export type OrgPermission =
  | 'org.settings'
  | 'org.auditLog'
  | 'billing.view'
  | 'billing.manage'
  | 'members.manage'
  | 'hosts.create'
  | 'hosts.delete'
  | 'data.manage'
  | 'marketing.manage'
  | 'marketplace.publish'
  | 'plugins.install'

/**
 * Legacy boolean permission map derived from the granular `OrgPermission`
 * set (AGL-243). Kept for the console surfaces that predate the granular
 * model; lives here so relocated feature plugins can accept it as a prop
 * (AGL-395).
 */
export interface OrgPermissions {
  createHosts: boolean
  editHosts: boolean
  editBilling: boolean
  publishToMarketplace: boolean
  installPlugins: boolean
  manageMembers: boolean
}

export interface OrgPermissionDefinition {
  key: OrgPermission
  label: string
  description: string
}

/** Every permission, in display order for role editors. */
export const ORG_PERMISSIONS: readonly OrgPermissionDefinition[] = [
  {
    key: 'org.settings',
    label: 'Organization settings',
    description: 'Rename the organization, change its slug, transfer it.',
  },
  {
    key: 'org.auditLog',
    label: 'Activity & audit log',
    description: 'See the organization activity feed.',
  },
  {
    key: 'billing.view',
    label: 'View billing',
    description: 'See the plan, usage meters, and invoices.',
  },
  {
    key: 'billing.manage',
    label: 'Manage billing',
    description: 'Change plans, buy add-ons, update payment details.',
  },
  {
    key: 'members.manage',
    label: 'Manage members',
    description: 'Invite, remove, and re-role organization members.',
  },
  {
    key: 'hosts.create',
    label: 'Create sites',
    description: 'Create new sites in the organization.',
  },
  {
    key: 'hosts.delete',
    label: 'Delete sites',
    description: 'Delete sites the member can access.',
  },
  {
    key: 'data.manage',
    label: 'Manage data',
    description: 'Create, edit, and delete organization datasets.',
  },
  {
    key: 'marketing.manage',
    label: 'Manage marketing',
    description: 'Edit announcement bars, popups, and campaigns.',
  },
  {
    key: 'marketplace.publish',
    label: 'Publish to marketplace',
    description: 'Publish listings under the organization profile.',
  },
  {
    key: 'plugins.install',
    label: 'Install plugins',
    description: 'Install or remove marketplace plugins.',
  },
]

export const ORG_PERMISSION_KEYS = ORG_PERMISSIONS.map(
  (definition) => definition.key,
) as readonly OrgPermission[]

const ALL_PERMISSIONS = Object.fromEntries(
  ORG_PERMISSION_KEYS.map((key) => [key, true]),
) as Record<OrgPermission, boolean>

const NO_PERMISSIONS = Object.fromEntries(
  ORG_PERMISSION_KEYS.map((key) => [key, false]),
) as Record<OrgPermission, boolean>

/**
 * Role → default permission set. Owner/admin hold everything (owner-only
 * actions like org deletion stay role-checked, not permission-checked);
 * editors work on content but see no money or roster controls; viewers
 * read only.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<
  OrgRole,
  Record<OrgPermission, boolean>
> = {
  owner: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS,
  editor: {
    ...NO_PERMISSIONS,
    'data.manage': true,
    'marketing.manage': true,
    'marketplace.publish': true,
    'plugins.install': true,
  },
  viewer: NO_PERMISSIONS,
}

/** `orgs/{orgId}/roles/{roleId}` — a named custom permission set. */
export interface AglynOrgCustomRole {
  $id?: string
  name?: string
  description?: string
  /** Full permission map; missing keys read as false. */
  permissions?: Partial<Record<OrgPermission, boolean>>
}

/**
 * Effective permission map for a member: the org role's defaults, then
 * the custom role's map (when the member has `roleId` and the role doc
 * is supplied), then per-member overrides — later layers win key-by-key.
 */
export function resolveOrgPermissions(
  member:
    | (Partial<AglynOrgMember> & {
        roleId?: string
        permissions?: Partial<Record<OrgPermission, boolean>>
      })
    | null
    | undefined,
  customRole?: AglynOrgCustomRole | null,
): Record<OrgPermission, boolean> {
  if (!member) return NO_PERMISSIONS
  const role = (member.role ?? 'viewer') as OrgRole
  const base = DEFAULT_ROLE_PERMISSIONS[role] ?? NO_PERMISSIONS
  const merged: Record<OrgPermission, boolean> = { ...base }
  if (member.roleId && customRole?.permissions) {
    for (const key of ORG_PERMISSION_KEYS) {
      const value = customRole.permissions[key]
      if (typeof value === 'boolean') merged[key] = value
    }
  }
  if (member.permissions) {
    for (const key of ORG_PERMISSION_KEYS) {
      const value = member.permissions[key]
      if (typeof value === 'boolean') merged[key] = value
    }
  }
  return merged
}

/** Single-permission convenience over `resolveOrgPermissions`. */
export function hasOrgPermission(
  member: Parameters<typeof resolveOrgPermissions>[0],
  permission: OrgPermission,
  customRole?: AglynOrgCustomRole | null,
): boolean {
  return resolveOrgPermissions(member, customRole)[permission]
}
