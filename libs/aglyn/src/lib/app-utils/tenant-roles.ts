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

/**
 * Tenant roles (AGL-120): named permission sets assigned to team members,
 * with per-user overrides an admin can apply on top. Shared between the
 * console UI and the server permission resolver so both read one table.
 */

export const TENANT_PERMISSION_KEYS = [
  'createHosts',
  'editHosts',
  'editBilling',
  'publishToCommunity',
  'installPlugins',
  'manageMembers',
] as const

export type TenantPermissionKey = (typeof TENANT_PERMISSION_KEYS)[number]

export type TenantPermissionSet = Record<TenantPermissionKey, boolean>

export type TenantRoleId = 'admin' | 'editor' | 'viewer'

/** Owner-defined role at `tenants/{uid}/roles/{id}` (AGL-133). */
export interface TenantCustomRole {
  name: string
  permissions?: Partial<TenantPermissionSet>
}

export const TENANT_ROLE_LABELS: Record<TenantRoleId, string> = {
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
}

/** Built-in role permission sets; overrides win key-by-key. */
export const TENANT_ROLE_PERMISSIONS: Record<TenantRoleId, TenantPermissionSet> =
  {
    admin: {
      createHosts: true,
      editHosts: true,
      editBilling: true,
      publishToCommunity: true,
      installPlugins: true,
      manageMembers: true,
    },
    editor: {
      createHosts: false,
      editHosts: true,
      editBilling: false,
      publishToCommunity: true,
      installPlugins: true,
      manageMembers: false,
    },
    viewer: {
      createHosts: false,
      editHosts: false,
      editBilling: false,
      publishToCommunity: false,
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
  overrides?: Partial<Record<TenantPermissionKey, unknown>> | null,
  /**
   * Custom roles (AGL-133), keyed by role id (`tenants/{uid}/roles`). A
   * non-built-in role id resolves against this map — viewer base with the
   * custom role's permissions applied; unknown ids stay plain viewer.
   */
  customRoles?: Record<string, TenantCustomRole | undefined> | null,
): TenantPermissionSet {
  const builtIn = TENANT_ROLE_PERMISSIONS[(role ?? '') as TenantRoleId]
  let base = builtIn ?? TENANT_ROLE_PERMISSIONS.viewer
  if (!builtIn) {
    const custom = customRoles?.[role ?? '']
    if (custom) {
      base = { ...TENANT_ROLE_PERMISSIONS.viewer }
      for (const key of TENANT_PERMISSION_KEYS) {
        const value = custom.permissions?.[key]
        if (typeof value === 'boolean') base[key] = value
      }
    }
  }
  const permissions = { ...base }
  for (const key of TENANT_PERMISSION_KEYS) {
    const value = overrides?.[key]
    if (typeof value === 'boolean') permissions[key] = value
  }
  return permissions
}

/** True for the fixed admin/editor/viewer ids. */
export function isBuiltInRole(role: string | null | undefined): boolean {
  return (role ?? '') in TENANT_ROLE_PERMISSIONS
}
