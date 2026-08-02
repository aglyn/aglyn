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

import { pluginPermissionDefaults } from '../plugin-manager/plugin-permissions'

/**
 * Org roles (AGL-120): named permission sets assigned to team members,
 * with per-user overrides an admin can apply on top. Shared between the
 * console UI and the server permission resolver so both read one table.
 */

/** Keys are persisted in custom role docs — add new ones, never rename. */
export const ORG_ROLE_PERMISSION_KEYS = [
  'createHosts',
  'editHosts',
  'editBilling',
  'publishToMarketplace',
  'installPlugins',
  'manageMembers',
] as const

export type OrgPermissionKey = (typeof ORG_ROLE_PERMISSION_KEYS)[number]

export type OrgPermissionSet = Record<OrgPermissionKey, boolean>

export type OrgRoleTier = 'admin' | 'editor' | 'viewer'

/** Owner-defined role at `orgs/{orgId}/roles/{id}` (AGL-133/243). */
export interface OrgCustomRole {
  name: string
  permissions?: Partial<OrgPermissionSet>
}

export const ORG_ROLE_TIER_LABELS: Record<OrgRoleTier, string> = {
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
}

/** Built-in role permission sets; overrides win key-by-key. */
export const ORG_ROLE_TIER_PERMISSIONS: Record<OrgRoleTier, OrgPermissionSet> =
  {
    admin: {
      createHosts: true,
      editHosts: true,
      editBilling: true,
      publishToMarketplace: true,
      installPlugins: true,
      manageMembers: true,
    },
    editor: {
      createHosts: false,
      editHosts: true,
      editBilling: false,
      publishToMarketplace: true,
      installPlugins: true,
      manageMembers: false,
    },
    viewer: {
      createHosts: false,
      editHosts: false,
      editBilling: false,
      publishToMarketplace: false,
      installPlugins: false,
      manageMembers: false,
    },
  }

/**
 * Effective permissions: the role's defaults (unknown/missing roles resolve
 * as `viewer` — least privilege) with per-user overrides applied key-by-key.
 * Only boolean override values count; anything else keeps the role default.
 */
export function resolveRolePermissions(
  role: string | null | undefined,
  overrides?: Partial<Record<OrgPermissionKey, unknown>> | null,
  /**
   * Custom roles (AGL-133), keyed by role id (`orgs/{orgId}/roles`). A
   * non-built-in role id resolves against this map — viewer base with the
   * custom role's permissions applied; unknown ids stay plain viewer.
   */
  customRoles?: Record<string, OrgCustomRole | undefined> | null,
): OrgPermissionSet {
  const builtIn = ORG_ROLE_TIER_PERMISSIONS[(role ?? '') as OrgRoleTier]
  // Plugin-declared keys (AGL-435): tier defaults ride under the built-in
  // set; custom-role overrides below win key-by-key like any other key.
  const tier: OrgRoleTier = builtIn ? ((role ?? 'viewer') as OrgRoleTier) : 'viewer'
  let base = {
    ...pluginPermissionDefaults(tier),
    ...(builtIn ?? ORG_ROLE_TIER_PERMISSIONS.viewer),
  }
  if (!builtIn) {
    const custom = customRoles?.[role ?? '']
    if (custom) {
      base = { ...ORG_ROLE_TIER_PERMISSIONS.viewer }
      for (const key of ORG_ROLE_PERMISSION_KEYS) {
        const value = custom.permissions?.[key]
        if (typeof value === 'boolean') base[key] = value
      }
    }
  }
  const permissions = { ...base }
  for (const key of ORG_ROLE_PERMISSION_KEYS) {
    const value = overrides?.[key]
    if (typeof value === 'boolean') permissions[key] = value
  }
  return permissions
}

/** True for the fixed admin/editor/viewer ids. */
export function isBuiltInRole(role: string | null | undefined): boolean {
  return (role ?? '') in ORG_ROLE_TIER_PERMISSIONS
}
