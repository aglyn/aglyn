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
import {
  listPluginCatalogPermissions,
  subscribePluginEntitlements,
} from '../plugin-manager/plugin-entitlements'
import { subscribePluginPermissions } from '../plugin-manager/plugin-permissions'
import { ORG_ROLE_PERMISSION_KEYS } from './org-roles'
import {
  CORE_ORG_PERMISSION_ENTRIES,
  CORE_ORG_PERMISSION_GROUPS,
  CORE_ORG_ROLE_GRANTS,
  type OrgPermissionGroup,
  type OrgPermissionScope,
} from './org-role-grants'

export type { OrgPermissionGroup, OrgPermissionScope }

/**
 * Granular org permissions (AGL-243) layered on the 4 org roles: each
 * role maps to a default permission set; custom roles
 * (`orgs/{orgId}/roles/{roleId}`) and per-member overrides refine it, so
 * e.g. an editor restricted to one host can also be granted billing
 * visibility — or an admin stripped of it — without inventing new roles.
 * The console hides unpermitted surfaces; the org API routes are the
 * enforcement point.
 */
export type CoreOrgPermission =
  | 'org.settings'
  | 'org.auditLog'
  | 'billing.view'
  | 'billing.manage'
  | 'members.manage'
  | 'hosts.create'
  | 'hosts.delete'
  | 'data.manage'
  | 'marketplace.publish'
  | 'plugins.install'

/**
 * A key of the catalog: a core key above, or a key a plugin declares into
 * the catalog through `registerPluginEntitlements` (AGL-2984). A declared key
 * is stored on custom roles and member overrides, layered and resolved
 * exactly like a core key.
 */
export type OrgPermission = CoreOrgPermission | (string & {})

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
  /** The plugin that declared the key; absent for a core key. */
  pluginId?: string
  /** The `ORG_PERMISSION_GROUPS` id the role editor files it under (AGL-4047). */
  group: string
  /** Where it is decided: `org`, or `site` for a key a site collaborator holds per site. */
  scope: OrgPermissionScope
  /** Each org role's verdict when nothing refines it (`DEFAULT_ROLE_PERMISSIONS`). */
  roleDefaults: Readonly<Record<OrgRole, boolean>>
  /** Each host role's verdict, for a `site` key. */
  hostRoleDefaults?: Readonly<Record<string, boolean>>
}

/**
 * The core keys, in display order for role editors.
 *
 * ⚠️ **EVERY KEY HERE MUST BE ENFORCED SERVER-SIDE.** A permission a customer
 * can tick that changes nothing is worse than its absence, because it implies
 * a control that does not exist — an owner unticks "delete sites", hands the
 * role out, and the member deletes sites while the console does not even dim
 * the button. Three of the eleven were in exactly that state (AGL-2444).
 *
 * `marketing.manage` was removed rather than wired, and the reason is worth
 * keeping: announcement bars, popups and campaigns live at
 * `hosts/{hostId}/overlays|campaigns|experiments` and are written
 * client-direct against the security rules, which gate on the HOST role.
 * There is no org-level boundary for it to sit on, and the action it named is
 * not org-scoped at all. Wiring it would have meant inventing one and
 * producing a second permission that looks enforced and is not. If a granular
 * marketing permission is wanted it belongs in the plugin-declared mechanism
 * (AGL-435), scoped to a host — a product decision, not this repair.
 *
 * `apps/console/specs/org-permissions-are-enforced.spec.ts` fails the build if
 * a key here, or a key a plugin declares, gains no server-side consumer.
 */
const CORE_ORG_PERMISSIONS: readonly OrgPermissionDefinition[] =
  // One table, shared with the native apps through the contracts (AGL-3950).
  CORE_ORG_PERMISSION_ENTRIES.map((entry) => ({
    ...entry,
    key: entry.key as CoreOrgPermission,
    group: entry.group ?? 'organization',
    scope: 'org' as const,
    roleDefaults: {
      owner: CORE_ORG_ROLE_GRANTS.owner.includes(entry.key),
      admin: CORE_ORG_ROLE_GRANTS.admin.includes(entry.key),
      editor: CORE_ORG_ROLE_GRANTS.editor.includes(entry.key),
      viewer: CORE_ORG_ROLE_GRANTS.viewer.includes(entry.key),
    },
  }))

/** The core keys: a plugin may add keys beside them and never redefine one. */
const CORE_ORG_PERMISSION_KEYS: ReadonlySet<string> = new Set(
  CORE_ORG_PERMISSIONS.map((definition) => definition.key),
)

/** The legacy camelCase projection's keys, which no declaration may take either. */
const LEGACY_PERMISSION_KEYS: ReadonlySet<string> = new Set<string>(
  ORG_ROLE_PERMISSION_KEYS,
)

/** The org roles, in the order `DEFAULT_ROLE_PERMISSIONS` lists them. */
const ORG_ROLES: readonly OrgRole[] = ['owner', 'admin', 'editor', 'viewer']

/**
 * Every permission, in display order for role editors: the core keys, then
 * the keys plugins declare through `registerPluginEntitlements`, in the
 * plugins' catalog order (AGL-2984).
 *
 * LIVE, and kept in step in place. A plugin's declarations register at
 * module scope — at boot on the server, before the first paint in the
 * console — which can be after a module holding this binding was evaluated.
 * So this array, the key list, the role defaults and the empty map below are
 * rewritten in place on every registration instead of being computed once
 * when this module loads, and whoever holds the binding reads the declared
 * keys with the core ones.
 */
export const ORG_PERMISSIONS: readonly OrgPermissionDefinition[] = []

export const ORG_PERMISSION_KEYS: readonly OrgPermission[] = []

/**
 * The groups the catalog's keys are filed under, in display order (AGL-4047):
 * the core groups, then one per plugin group a declaration names. Live, like
 * `ORG_PERMISSIONS`; a group with no key is left out.
 */
export const ORG_PERMISSION_GROUPS: readonly OrgPermissionGroup[] = []

/**
 * The catalog keys that came through `registerPluginPermissions` (AGL-4047):
 * the keys the per-tier resolver (`resolveRolePermissions`) also answers,
 * which a caller holding a catalog-resolved map lays over that resolver's
 * answer so a custom role reaches them. Live.
 */
export const TIER_PERMISSION_KEYS: readonly OrgPermission[] = []

const NO_PERMISSIONS = {} as Record<OrgPermission, boolean>

/**
 * Role → default permission set. Owner/admin hold everything (owner-only
 * actions like org deletion stay role-checked, not permission-checked);
 * editors work on content but see no money or roster controls; viewers read
 * only. A declared key's default for each role is the one its declaration
 * names.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<
  OrgRole,
  Record<OrgPermission, boolean>
> = {
  owner: {} as Record<OrgPermission, boolean>,
  admin: {} as Record<OrgPermission, boolean>,
  editor: {} as Record<OrgPermission, boolean>,
  viewer: {} as Record<OrgPermission, boolean>,
}

/** Refused declarations already logged, so a refusal is reported once. */
const reportedRefusals = new Set<string>()

function replaceItems<T>(target: readonly T[], items: readonly T[]): void {
  const list = target as T[]
  list.length = 0
  list.push(...items)
}

function replaceEntries(
  target: Record<string, boolean>,
  entries: Record<string, boolean>,
): void {
  for (const key of Object.keys(target)) delete target[key]
  Object.assign(target, entries)
}

/**
 * Rebuilds the live catalog: the core keys, then every key a plugin declared
 * through either declaration API (`listPluginCatalogPermissions`, AGL-4047).
 * A declaration naming a core or legacy key is refused — that key keeps its
 * own meaning and defaults — and logged once.
 */
function syncCatalog(): void {
  const definitions: OrgPermissionDefinition[] = [...CORE_ORG_PERMISSIONS]
  const tierKeys: string[] = []
  const groups: OrgPermissionGroup[] = CORE_ORG_PERMISSION_GROUPS.map((group) => ({ ...group }))
  for (const declared of listPluginCatalogPermissions()) {
    if (
      CORE_ORG_PERMISSION_KEYS.has(declared.key) ||
      LEGACY_PERMISSION_KEYS.has(declared.key)
    ) {
      const refusal = `${declared.pluginId}\x00${declared.key}`
      if (!reportedRefusals.has(refusal)) {
        reportedRefusals.add(refusal)
        console.error(
          `[plugins] refused catalog permission "${declared.key}" to ` +
            `"${declared.pluginId}": the key belongs to the core catalog`,
        )
      }
      continue
    }
    definitions.push({
      key: declared.key,
      label: declared.label,
      description: declared.description,
      pluginId: declared.pluginId,
      group: declared.group,
      scope: declared.hostRoleDefaults ? 'site' : 'org',
      roleDefaults: declared.roleDefaults,
      ...(declared.hostRoleDefaults ? { hostRoleDefaults: declared.hostRoleDefaults } : {}),
    })
    if (declared.source === 'tier') tierKeys.push(declared.key)
    if (!groups.some((group) => group.id === declared.group)) {
      groups.push({ id: declared.group, label: declared.groupLabel, pluginId: declared.pluginId })
    }
  }
  const keys = definitions.map((definition) => definition.key)
  replaceItems(ORG_PERMISSIONS, definitions)
  replaceItems(ORG_PERMISSION_KEYS, keys)
  replaceItems(
    ORG_PERMISSION_GROUPS,
    groups.filter((group) => definitions.some((definition) => definition.group === group.id)),
  )
  replaceItems(TIER_PERMISSION_KEYS, tierKeys)
  replaceEntries(NO_PERMISSIONS, Object.fromEntries(keys.map((key) => [key, false])))
  for (const role of ORG_ROLES) {
    replaceEntries(
      DEFAULT_ROLE_PERMISSIONS[role],
      Object.fromEntries(
        definitions.map((definition) => [definition.key, definition.roleDefaults[role] === true]),
      ),
    )
  }
  CATALOG_AND_LEGACY_KEYS.clear()
  for (const key of [...keys, ...LEGACY_PERMISSION_KEYS]) {
    CATALOG_AND_LEGACY_KEYS.add(key)
  }
}

/**
 * The `registerPluginPermissions` keys of a catalog-resolved map (AGL-4047).
 *
 * Those keys are answered twice: by the per-tier resolver
 * (`resolveRolePermissions`, the role's tier default and the member's
 * override) and, now that they are catalog keys, by `resolveOrgPermissions`
 * with every layer — the custom role's included. A caller that builds its
 * map from the first spreads this over it, so the custom role a member
 * carries reaches `managePos` the way it reaches `hosts.create`.
 */
export function tierPermissionsOf(
  granted: Readonly<Record<string, boolean>> | null | undefined,
): Record<string, boolean> {
  const picked: Record<string, boolean> = {}
  if (!granted) return picked
  for (const key of TIER_PERMISSION_KEYS) {
    if (typeof granted[key] === 'boolean') picked[key] = granted[key]
  }
  return picked
}

/** One catalog key by name, or undefined. */
export function orgPermissionDefinition(
  permission: OrgPermission,
): OrgPermissionDefinition | undefined {
  return ORG_PERMISSIONS.find((definition) => definition.key === permission)
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

/**
 * The values a custom role and a per-member override set EXPLICITLY for
 * permission keys outside this catalog — the keys plugins declare through
 * `registerPluginPermissions` (AGL-2974).
 *
 * `resolveOrgPermissions` walks the catalog alone, so a plugin key stored on
 * a custom role or a member document never reached the `resolvedPermissions`
 * stamp the Firestore rules read. A rule gating on one could then honor
 * neither a grant to an editor nor a revocation from an admin. This carries
 * exactly those stored decisions, custom role first and the per-member
 * override over it, which is the precedence the resolver applies.
 *
 * Tier DEFAULTS are deliberately absent. They live in the plugin registry,
 * which is populated per process by whichever plugin bundles that process
 * loaded, and a stamp computed from it would differ by which route happened
 * to write it. A rule supplies the default itself from the member's role,
 * the way `memberResolves` is always conjoined with a role gate.
 *
 * The legacy six camelCase keys are excluded as well: they are the catalog's
 * older projection, not plugin keys, and no rule reads them.
 */
export function explicitPluginPermissionValues(
  member:
    | {
        roleId?: string
        permissions?: Partial<Record<string, unknown>> | null
      }
    | null
    | undefined,
  customRole?: { permissions?: Partial<Record<string, unknown>> | null } | null,
): Record<string, boolean> {
  const values: Record<string, boolean> = {}
  if (!member) return values
  const layers = [
    member.roleId ? customRole?.permissions : undefined,
    member.permissions,
  ]
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer ?? {})) {
      if (typeof value !== 'boolean') continue
      if (CATALOG_AND_LEGACY_KEYS.has(key)) continue
      values[key] = value
    }
  }
  return values
}

/**
 * Keys {@link explicitPluginPermissionValues} leaves to the catalog: every
 * catalog key, declared ones included, and the legacy six. Kept in step by
 * `syncCatalog`.
 */
const CATALOG_AND_LEGACY_KEYS = new Set<string>()

/**
 * The `resolvedPermissions` map stamped on a member document for the
 * Firestore rules: the catalog verdict with every layer applied, and beside
 * it the plugin keys a custom role or an override set explicitly.
 *
 * One function for every writer of the stamp, so the org-create transaction
 * and `syncOrgAuthProjections` cannot project different maps. The catalog
 * spreads last; the two key spaces do not overlap, and the order keeps it
 * true that nothing but the resolver decides a catalog key.
 */
export function projectMemberResolvedPermissions(
  member: Parameters<typeof resolveOrgPermissions>[0],
  customRole?: AglynOrgCustomRole | null,
): Record<string, boolean> {
  return {
    ...explicitPluginPermissionValues(member, customRole),
    ...resolveOrgPermissions(member, customRole),
  }
}

/** Single-permission convenience over `resolveOrgPermissions`. */
export function hasOrgPermission(
  member: Parameters<typeof resolveOrgPermissions>[0],
  permission: OrgPermission,
  customRole?: AglynOrgCustomRole | null,
): boolean {
  return resolveOrgPermissions(member, customRole)[permission]
}

/** The catalog label for a key — the words a refusal names — or the key itself. */
export function orgPermissionLabel(permission: OrgPermission): string {
  return (
    ORG_PERMISSIONS.find((definition) => definition.key === permission)?.label ??
    permission
  )
}

/** The keys plugins declared into the catalog, in catalog order. */
export function pluginOrgPermissionKeys(): OrgPermission[] {
  return ORG_PERMISSIONS.filter((definition) => definition.pluginId).map(
    (definition) => definition.key,
  )
}

/** One declared catalog key that moved, and the direction it moved in. */
export interface PluginPermissionChange {
  permission: string
  granted: boolean
}

/**
 * The keys PLUGINS declared into the catalog whose value moved between two
 * maps, in the new map's order — what a member, role or collaborator write
 * raises `org.permissions.changed` for, once per key, so the plugin that owns
 * a key can record who moved it.
 *
 * A key the new map leaves unset is not a change: on a role it defers to the
 * base role, on a site toggle to the host role, and neither is a grant or a
 * revocation of its own. A key set for the first time is a change, because
 * the verdict it produces is no longer the default's. The core keys and the
 * legacy six raise nothing; their writes are recorded by the routes' own
 * activity sentences.
 */
export function pluginPermissionChanges(
  before: Partial<Record<string, unknown>> | null | undefined,
  after: Partial<Record<string, unknown>> | null | undefined,
): PluginPermissionChange[] {
  const changes: PluginPermissionChange[] = []
  for (const [key, next] of Object.entries(after ?? {})) {
    if (typeof next !== 'boolean') continue
    if (CORE_ORG_PERMISSION_KEYS.has(key) || LEGACY_PERMISSION_KEYS.has(key)) continue
    if (before?.[key] === next) continue
    changes.push({ permission: key, granted: next })
  }
  return changes
}

/**
 * The granular (dotted) set projected onto the legacy boolean map
 * (AGL-2350).
 *
 * ## Why this lives here rather than in the console hook
 *
 * It was a private function in `apps/console/hooks/use-org-permissions.ts`,
 * which meant the CLIENT translated the stored permission model into the
 * legacy flags and the SERVER did not translate at all — it derived the
 * legacy flags straight from the built-in role tier and dropped custom roles
 * and per-member overrides on the floor. The two disagreed exactly on the
 * feature `custom-roles.md` sells, in both directions: a permission granted
 * by a custom role showed in the UI and 403'd on POST, and one revoked by an
 * override was hidden in the UI and still succeeded on POST.
 *
 * One exported copy is what stops them drifting again.
 *
 * ## The key spaces are NOT interchangeable, and that is the trap
 *
 * Two permission vocabularies exist. The stored one is DOTTED
 * (`plugins.install`) — `apps/console/app/api/orgs/roles/route.ts` sanitizes
 * against `ORG_PERMISSION_KEYS` before writing, and `AglynOrgMember`
 * `permissions` is typed to it. The legacy one is camelCase
 * (`installPlugins`).
 *
 * `resolveRolePermissions` in `org-roles.ts` accepts `overrides` and
 * `customRoles` arguments keyed by the CAMELCASE space. Feeding it the real
 * stored documents therefore matches no key and changes nothing — it looks
 * like wiring the feature up while doing precisely nothing. Those two
 * parameters are used by nothing but that module's own spec. Translate
 * through here instead.
 *
 * `editHosts` is derived from the ROLE, not from a dotted key: it has no
 * counterpart in the granular catalog and never had one.
 */
export function toLegacyPermissions(
  granted: Record<OrgPermission, boolean>,
  role: OrgRole | null | undefined,
): OrgPermissions {
  return {
    createHosts: granted['hosts.create'],
    editHosts: role !== 'viewer',
    editBilling: granted['billing.manage'],
    publishToMarketplace: granted['marketplace.publish'],
    installPlugins: granted['plugins.install'],
    manageMembers: granted['members.manage'],
  }
}

syncCatalog()
subscribePluginEntitlements(syncCatalog)
// The second declaration API feeds the same catalog (AGL-4047).
subscribePluginPermissions(syncCatalog)
