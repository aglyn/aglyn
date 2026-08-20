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

import {
  listPluginPermissionKeys,
  pluginPermissionDefaults,
} from '../plugin-manager/plugin-permissions'

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

/**
 * What `resolveRolePermissions` actually returns (AGL-2474): the legacy six
 * PLUS whatever plugin-declared keys are registered. The six stay named so
 * `permissions.createHosts` keeps its type; the index signature is what lets
 * a caller read `permissions.managePos` at all. Consumers that only care
 * about the built-in keys can keep using `OrgPermissionSet`.
 */
export type ResolvedOrgPermissionSet = OrgPermissionSet &
  Record<string, boolean>

export type OrgRoleTier = 'admin' | 'editor' | 'viewer'

/** Owner-defined role at `orgs/{orgId}/roles/{id}` (AGL-133/243). */
export interface OrgCustomRole {
  name: string
  /**
   * Keyed by the legacy six OR any plugin-declared key (AGL-2474) — the
   * override loops below read both spaces out of this one map.
   */
  permissions?: Partial<Record<string, boolean>>
}

/**
 * Which built-in tier an ORG role resolves onto (AGL-2474).
 *
 * `owner` is NOT a tier, so `resolveRolePermissions('owner')` falls through to
 * the viewer default — correct for an unknown string, catastrophic for the one
 * role that owns the workspace. The server had its own copy of this table;
 * sharing it is what lets the console resolve the same plugin-key defaults the
 * API will enforce, instead of a second table that can drift from it.
 */
export const ORG_ROLE_TIER: Record<string, OrgRoleTier> = {
  owner: 'admin',
  admin: 'admin',
  editor: 'editor',
  viewer: 'viewer',
}

/** `ORG_ROLE_TIER` with least-privilege fallback for an unknown role. */
export function orgRoleTier(role: string | null | undefined): OrgRoleTier {
  return ORG_ROLE_TIER[role ?? ''] ?? 'viewer'
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
  overrides?: Partial<Record<string, unknown>> | null,
  /**
   * Custom roles (AGL-133), keyed by role id (`orgs/{orgId}/roles`). A
   * non-built-in role id resolves against this map — viewer base with the
   * custom role's permissions applied; unknown ids stay plain viewer.
   */
  customRoles?: Record<string, OrgCustomRole | undefined> | null,
): ResolvedOrgPermissionSet {
  const builtIn = ORG_ROLE_TIER_PERMISSIONS[(role ?? '') as OrgRoleTier]
  // Plugin-declared keys (AGL-435): tier defaults ride under the built-in
  // set; custom-role overrides below win key-by-key like any other key.
  const tier: OrgRoleTier = builtIn ? ((role ?? 'viewer') as OrgRoleTier) : 'viewer'
  let base: ResolvedOrgPermissionSet = {
    ...pluginPermissionDefaults(tier),
    ...(builtIn ?? ORG_ROLE_TIER_PERMISSIONS.viewer),
  }
  // EVERY GRANTABLE KEY, not just the legacy six (AGL-2474). Iterating
  // `ORG_ROLE_PERMISSION_KEYS` alone is what made every plugin-declared
  // permission unenforceable: the key materialised into the resolved map from
  // `pluginPermissionDefaults` above and then no override and no custom role
  // could move it, so `managePos` could only ever be its tier default. Read
  // per call — plugins register at module scope and a snapshot taken here
  // could be empty depending on import order.
  const grantableKeys: string[] = [
    ...ORG_ROLE_PERMISSION_KEYS,
    ...listPluginPermissionKeys(),
  ]
  if (!builtIn) {
    const custom = customRoles?.[role ?? '']
    if (custom) {
      // Plugin tier defaults are re-laid under the viewer base (AGL-2474).
      // Rebuilding from `ORG_ROLE_TIER_PERMISSIONS.viewer` alone dropped every
      // plugin key off a custom-role member's map entirely — `managePos` came
      // back `undefined`, not `false`, which reads as denied but is not the
      // same thing, and contradicted this function's own docblock.
      base = {
        ...pluginPermissionDefaults('viewer'),
        ...ORG_ROLE_TIER_PERMISSIONS.viewer,
      }
      for (const key of grantableKeys) {
        const value = custom.permissions?.[key]
        if (typeof value === 'boolean') base[key] = value
      }
    }
  }
  const permissions = { ...base }
  for (const key of grantableKeys) {
    const value = overrides?.[key]
    if (typeof value === 'boolean') permissions[key] = value
  }
  return permissions
}

/** True for the fixed admin/editor/viewer ids. */
export function isBuiltInRole(role: string | null | undefined): boolean {
  return (role ?? '') in ORG_ROLE_TIER_PERMISSIONS
}
