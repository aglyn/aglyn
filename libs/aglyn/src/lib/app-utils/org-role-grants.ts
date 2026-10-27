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
 * WHAT EACH ORG ROLE MAY DO, AS DATA (AGL-243, AGL-3950).
 *
 * The core permission catalog and the core keys each org role holds when
 * nothing refines it. `org-permissions.ts` builds the console's live
 * catalog from these (adding the keys plugins declare, with their own role
 * defaults), and the native apps read the same grants through the generated
 * contracts, so a native gate (`hosts.create`, `data.manage`) answers as the
 * console does for a member row that carries no `resolvedPermissions` stamp.
 *
 * `ORG_ROLE_GRANTS` in the contracts is this table with every plugin's
 * declared catalog keys added (`assembleOrgRoleGrants`, run by
 * `generate:native-contracts` over each plugin's declarations), which is
 * exactly the set the console's `DEFAULT_ROLE_PERMISSIONS` holds once the
 * plugins have registered.
 *
 * NO IMPORTS, on purpose: the native apps read it through the generated
 * contracts.
 */

/** The four org roles. */
export type OrgRoleName = 'owner' | 'admin' | 'editor' | 'viewer'

/**
 * Where a key is decided (AGL-4047). `org`: by the member's org role, custom
 * role and overrides, the same on every site. `site`: as `org` for a member
 * who reaches the whole workspace, and per site for a site collaborator,
 * from the host role they hold there and that site's toggle.
 */
export type OrgPermissionScope = 'org' | 'site'

/** One key of the org permission catalog. */
export interface OrgPermissionEntry {
  key: string
  label: string
  description: string
  /** The plugin that declared it; absent for a core key. */
  pluginId?: string
  /** The group the role editor files it under (`ORG_PERMISSION_GROUPS`, or the declaring plugin's id). */
  group?: string
  /** Where it is decided; absent reads as `org`. */
  scope?: OrgPermissionScope
  /**
   * The broader key this one is a finer part of (AGL-4047): never granted
   * without it, and following it where no custom role or override sets this
   * key. Absent for a key that refines nothing.
   */
  refines?: string
  /**
   * The key this one follows where no custom role or override sets it,
   * without needing it (AGL-4047): granted on its own, it holds while that
   * key is refused. Absent for a key that follows nothing, and for one that
   * refines.
   */
  follows?: string
}

/** A heading the role editor groups keys under. */
export interface OrgPermissionGroup {
  id: string
  label: string
  /** The plugin whose keys it holds; absent for a core group. */
  pluginId?: string
}

/** The catalog and each role's default grants. */
export interface OrgRoleGrants {
  /** Every key, in the order the role editor lists them. */
  permissions: OrgPermissionEntry[]
  /** The keys each role holds when no custom role or per-member override sets them. */
  grants: Record<OrgRoleName, string[]>
  /** The groups the keys are filed under, in display order; absent in a catalog written before them. */
  groups?: OrgPermissionGroup[]
}

/**
 * A key a plugin declares into the catalog: `PluginOrgPermissionDeclaration`
 * with org-role defaults, or a `registerPluginPermissions` key (`managePos`),
 * whose `defaults` are per role tier, the owner holding the admin tier's.
 */
export interface OrgPermissionDeclaration {
  key: string
  label: string
  description?: string
  roleDefaults?: Record<OrgRoleName, boolean>
  /** The tier defaults of a `registerPluginPermissions` key, used when `roleDefaults` is absent. */
  defaults?: { admin: boolean; editor: boolean; viewer: boolean }
  /** The host-role defaults of a key a site collaborator holds per site. */
  hostRoleDefaults?: Record<string, boolean>
  /** The group it is filed under; absent: a group named by the declaring plugin's id. */
  group?: string
  /** That group's heading, for a group the core does not name. */
  groupLabel?: string
  pluginId?: string
  /** The broader key it refines (AGL-4047). */
  refines?: string
  /** The key it follows without needing it (AGL-4047). */
  follows?: string
}

/** A custom role (`orgs/{orgId}/roles/{roleId}`) or a member's overrides: explicit verdicts per key. */
export interface OrgPermissionLayer {
  permissions?: Record<string, boolean>
}

export const ORG_ROLE_NAMES: readonly OrgRoleName[] = ['owner', 'admin', 'editor', 'viewer']

/**
 * The core groups, in display order. A plugin's keys are filed under a group
 * named by the plugin's id unless its declaration names one of these, so no
 * core group id is a plugin id.
 */
export const CORE_ORG_PERMISSION_GROUPS: readonly OrgPermissionGroup[] = [
  { id: 'organization', label: 'Organization' },
  { id: 'billing', label: 'Billing' },
  { id: 'team', label: 'Team' },
  { id: 'sites', label: 'Sites' },
  { id: 'datasets', label: 'Data' },
  { id: 'extensions', label: 'Marketplace and plugins' },
]

/**
 * A declaration's verdict for each org role: its `roleDefaults`, or, for a
 * `registerPluginPermissions` key, its tier `defaults` with the owner on the
 * admin tier (the tier `ORG_ROLE_TIER` resolves the owner onto).
 */
export function declarationRoleDefaults(
  declaration: Pick<OrgPermissionDeclaration, 'roleDefaults' | 'defaults'>,
): Record<OrgRoleName, boolean> {
  if (declaration.roleDefaults) {
    return {
      owner: declaration.roleDefaults.owner === true,
      admin: declaration.roleDefaults.admin === true,
      editor: declaration.roleDefaults.editor === true,
      viewer: declaration.roleDefaults.viewer === true,
    }
  }
  const tiers = declaration.defaults
  return {
    owner: tiers?.admin === true,
    admin: tiers?.admin === true,
    editor: tiers?.editor === true,
    viewer: tiers?.viewer === true,
  }
}

/**
 * The core keys, in display order for role editors. Every key here is
 * enforced server-side (`apps/console/specs/org-permissions-are-enforced.spec.ts`).
 */
export const CORE_ORG_PERMISSION_ENTRIES: readonly OrgPermissionEntry[] = [
  {
    key: 'org.settings',
    group: 'organization',
    label: 'Organization settings',
    description: 'Rename the organization, change its slug, transfer it.',
  },
  {
    key: 'org.auditLog',
    group: 'organization',
    label: 'Activity & audit log',
    description: 'See the organization activity feed.',
  },
  {
    key: 'org.apiKeys',
    group: 'organization',
    label: 'Manage API keys',
    description: 'Create and revoke the workspace’s REST API keys.',
  },
  {
    key: 'org.privacy',
    group: 'organization',
    label: 'Privacy requests',
    description: 'Erase a person from every site in the workspace when they ask.',
  },
  {
    key: 'org.holds',
    group: 'organization',
    label: 'Holds and reviews',
    description: 'See what is held, flagged or locked on the workspace, and request a review.',
  },
  {
    key: 'billing.view',
    group: 'billing',
    label: 'View billing',
    description: 'See the plan, usage meters, and invoices.',
  },
  {
    key: 'billing.manage',
    group: 'billing',
    label: 'Manage billing',
    description: 'Change plans, buy add-ons, update payment details.',
  },
  {
    key: 'members.manage',
    group: 'team',
    label: 'Manage members',
    description: 'Invite, remove, and re-role organization members.',
  },
  {
    key: 'hosts.create',
    group: 'sites',
    label: 'Create sites',
    description: 'Create new sites in the organization.',
  },
  {
    key: 'hosts.delete',
    group: 'sites',
    label: 'Delete sites',
    description: 'Delete sites the member can access.',
  },
  {
    key: 'data.manage',
    group: 'datasets',
    label: 'Manage data',
    description: 'Create, edit, and delete organization datasets.',
  },
  {
    key: 'marketplace.publish',
    group: 'extensions',
    label: 'Publish to marketplace',
    description: 'Publish listings under the organization profile.',
  },
  {
    key: 'plugins.install',
    group: 'extensions',
    label: 'Install plugins',
    description: 'Install or remove marketplace plugins.',
  },
]

const CORE_KEYS = CORE_ORG_PERMISSION_ENTRIES.map((entry) => entry.key)

/**
 * The core keys each org role holds when nothing refines it: owners and
 * admins hold every core key (owner-only acts like deleting the
 * organization stay role-checked, not permission-checked); editors work on
 * content and see no money or roster controls; viewers read only.
 */
export const CORE_ORG_ROLE_GRANTS: Readonly<Record<OrgRoleName, readonly string[]>> = {
  owner: CORE_KEYS,
  admin: CORE_KEYS,
  editor: ['data.manage', 'marketplace.publish', 'plugins.install'],
  viewer: [],
}

/** The core's catalog and grants; the contracts' value adds the plugins' keys. */
export const ORG_ROLE_GRANTS: OrgRoleGrants = {
  permissions: CORE_ORG_PERMISSION_ENTRIES.map((entry) => ({ ...entry })),
  groups: CORE_ORG_PERMISSION_GROUPS.map((group) => ({ ...group })),
  grants: {
    owner: [...CORE_ORG_ROLE_GRANTS.owner],
    admin: [...CORE_ORG_ROLE_GRANTS.admin],
    editor: [...CORE_ORG_ROLE_GRANTS.editor],
    viewer: [...CORE_ORG_ROLE_GRANTS.viewer],
  },
}

/**
 * The catalog with plugins' declared keys after the core ones, each role
 * holding a declared key when its declaration's defaults say so. A
 * declaration naming a key already taken is refused, as the console's
 * catalog refuses it: the first declaration keeps its meaning and defaults.
 * Every declaration list after the first is folded in the same way, so the
 * org catalog keys (`PluginOrgPermissionDeclaration`) and the
 * `registerPluginPermissions` keys land in one catalog (AGL-4047).
 */
export function assembleOrgRoleGrants(
  core: OrgRoleGrants,
  ...declarationLists: ReadonlyArray<readonly OrgPermissionDeclaration[]>
): OrgRoleGrants {
  const permissions = [...core.permissions]
  const groups = [...(core.groups ?? [])]
  const grants = Object.fromEntries(ORG_ROLE_NAMES.map((role) => [role, [...core.grants[role]]])) as Record<
    OrgRoleName,
    string[]
  >
  const taken = new Set(permissions.map((entry) => entry.key))
  const groupIds = new Set(groups.map((group) => group.id))
  for (const declaration of declarationLists.flat()) {
    if (!declaration?.key || taken.has(declaration.key)) continue
    taken.add(declaration.key)
    const group = declaration.group ?? declaration.pluginId
    permissions.push({
      key: declaration.key,
      label: declaration.label,
      description: declaration.description ?? '',
      ...(declaration.pluginId ? { pluginId: declaration.pluginId } : {}),
      ...(group ? { group } : {}),
      scope: declaration.hostRoleDefaults ? 'site' : 'org',
      ...(declaration.refines && declaration.refines !== declaration.key ? { refines: declaration.refines } : {}),
      ...(declaration.follows && declaration.follows !== declaration.key && !declaration.refines
        ? { follows: declaration.follows }
        : {}),
    })
    if (group && !groupIds.has(group)) {
      groupIds.add(group)
      groups.push({
        id: group,
        label: declaration.groupLabel ?? group,
        ...(declaration.pluginId ? { pluginId: declaration.pluginId } : {}),
      })
    }
    const defaults = declarationRoleDefaults(declaration)
    for (const role of ORG_ROLE_NAMES) {
      if (defaults[role]) grants[role].push(declaration.key)
    }
  }
  return { permissions, grants, groups }
}

/**
 * A member's effective permissions, as the console's `resolveOrgPermissions`
 * answers them: the role's defaults, then the custom role's explicit
 * verdicts (when the member has one), then the member's own overrides,
 * later layers winning key by key, over the catalog's keys only. A missing
 * role reads as viewer; a role the catalog does not know holds nothing.
 */
export function rolePermissions(
  catalog: OrgRoleGrants,
  role: string | null | undefined,
  customRole?: OrgPermissionLayer | null,
  overrides?: OrgPermissionLayer | null,
): Record<string, boolean> {
  const keys = catalog.permissions.map((entry) => entry.key)
  const name = role ?? 'viewer'
  const held = new Set((catalog.grants as Record<string, string[] | undefined>)[name] ?? [])
  const out: Record<string, boolean> = Object.fromEntries(keys.map((key) => [key, held.has(key)]))
  for (const layer of [customRole, overrides]) {
    const values = layer?.permissions
    if (!values) continue
    for (const key of keys) {
      if (typeof values[key] === 'boolean') out[key] = values[key]
    }
  }
  // A key that refines a broader one (AGL-4047) is never held without it, and
  // follows it where neither layer set the key; a key that only follows one
  // takes its verdict where neither layer set the key, and nothing more.
  // Applied broader keys first, so a chain settles in one pass; a refinement
  // that loops is left alone.
  const broader = new Map<string, string>()
  const followsOnly = new Set<string>()
  for (const entry of catalog.permissions) {
    if (entry.refines && entry.refines in out) broader.set(entry.key, entry.refines)
    else if (entry.follows && entry.follows in out) {
      broader.set(entry.key, entry.follows)
      followsOnly.add(entry.key)
    }
  }
  const depth = (key: string): number => {
    const seen = new Set<string>()
    let steps = 0
    let current = key
    while (broader.has(current)) {
      if (seen.has(current)) return -1
      seen.add(current)
      current = broader.get(current) as string
      steps += 1
    }
    return steps
  }
  const ordered = [...broader.keys()]
    .map((key) => ({ key, steps: depth(key) }))
    .filter((entry) => entry.steps > 0)
    .sort((a, b) => a.steps - b.steps)
  for (const { key } of ordered) {
    let stored: boolean | undefined
    for (const layer of [customRole, overrides]) {
      const value = layer?.permissions?.[key]
      if (typeof value === 'boolean') stored = value
    }
    const held = out[broader.get(key) as string] === true
    out[key] = followsOnly.has(key) ? (stored === undefined ? held : stored) : held && (stored === undefined ? true : stored)
  }
  return out
}
