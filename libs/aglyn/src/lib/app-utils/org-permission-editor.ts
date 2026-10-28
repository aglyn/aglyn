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

import { filterPluginsByReleaseFlags, resolveEnabledPlugins } from '../plugin-manager/enabled-plugins'
import type { AglynOrgMember, OrgRole } from '../foundation'
import {
  DEFAULT_ROLE_PERMISSIONS,
  ORG_PERMISSION_GROUPS,
  ORG_PERMISSIONS,
  resolveOrgPermissions,
  type AglynOrgCustomRole,
  type OrgPermissionDefinition,
  type OrgPermissionGroup,
} from './org-permissions'

/**
 * What a permission editor offers, as logic (AGL-4047): which catalog keys a
 * workspace is shown, filed under which group, narrowed by a search, and the
 * three states a custom role or a per-member override stores for each.
 * Every editor (the custom role dialog, a member's Permissions section, the
 * roster's quick view) reads these, so they cannot offer different keys.
 */

/** Whose keys are offered: the workspace's plugins, after their release flags. */
export interface OfferedPermissionsSubject {
  /** The workspace document; its `enabledPlugins` decides which plugins' keys show. */
  org?: { enabledPlugins?: string[] } | null
  /** A release flag's verdict for the workspace; absent: no plugin is held back by a flag. */
  isFlagOn?: (flagKey: string) => boolean
  /** Staff preview: every enabled plugin's keys, flags or not. */
  staffBypass?: boolean
}

/**
 * The catalog keys a workspace is offered: every core key, and a plugin's
 * keys while the plugin is on for the workspace and released to it. A key a
 * stored role or override already carries for a plugin that is now off is
 * not offered and not dropped: the editors write back the stored map.
 */
export function offeredOrgPermissions(
  subject: OfferedPermissionsSubject = {},
  definitions: readonly OrgPermissionDefinition[] = ORG_PERMISSIONS,
): OrgPermissionDefinition[] {
  const enabled = resolveEnabledPlugins(subject.org ?? null)
  const on = new Set(
    subject.isFlagOn
      ? filterPluginsByReleaseFlags(enabled, subject.isFlagOn, { staffBypass: subject.staffBypass })
      : enabled,
  )
  return definitions.filter((definition) => !definition.pluginId || on.has(definition.pluginId))
}

/** One group of an editor's list: its heading and its keys, in catalog order. */
export interface OrgPermissionSection {
  group: OrgPermissionGroup
  permissions: OrgPermissionDefinition[]
}

/**
 * The keys filed under their groups, in the groups' display order; a group
 * with no key among `definitions` is left out, and a key whose group the
 * list does not name is filed under a group of its own id.
 */
export function groupOrgPermissions(
  definitions: readonly OrgPermissionDefinition[],
  groups: readonly OrgPermissionGroup[] = ORG_PERMISSION_GROUPS,
): OrgPermissionSection[] {
  const known = new Map(groups.map((group) => [group.id, group]))
  const sections = new Map<string, OrgPermissionSection>()
  for (const group of groups) sections.set(group.id, { group, permissions: [] })
  for (const definition of definitions) {
    let section = sections.get(definition.group)
    if (!section) {
      section = {
        group: known.get(definition.group) ?? { id: definition.group, label: definition.group },
        permissions: [],
      }
      sections.set(definition.group, section)
    }
    section.permissions.push(definition)
  }
  return [...sections.values()].filter((section) => section.permissions.length > 0)
}

/**
 * The keys a search keeps: every word of the query found, ignoring case, in
 * the key's label, description, key or group heading. An empty query keeps
 * everything.
 */
export function searchOrgPermissions(
  definitions: readonly OrgPermissionDefinition[],
  query: string,
  groups: readonly OrgPermissionGroup[] = ORG_PERMISSION_GROUPS,
): OrgPermissionDefinition[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return [...definitions]
  const headings = new Map(groups.map((group) => [group.id, group.label]))
  return definitions.filter((definition) => {
    const haystack = [
      definition.label,
      definition.description,
      definition.key,
      headings.get(definition.group) ?? definition.group,
    ]
      .join(' ')
      .toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

/**
 * What a custom role or a per-member override stores for one key: nothing
 * (`inherit`, the layer below decides), `grant` (true) or `deny` (false).
 */
export type PermissionChoice = 'inherit' | 'grant' | 'deny'

export const PERMISSION_CHOICES: readonly PermissionChoice[] = ['inherit', 'grant', 'deny']

/** The stored choice for a key; anything but a boolean reads as inherit. */
export function permissionChoice(
  stored: Readonly<Partial<Record<string, unknown>>> | null | undefined,
  key: string,
): PermissionChoice {
  const value = stored?.[key]
  return value === true ? 'grant' : value === false ? 'deny' : 'inherit'
}

/**
 * The stored map with one or more keys set to a choice: `inherit` deletes
 * the key, so the document stores only real decisions. Keys not named are
 * kept as they were, whether or not the editor offers them.
 */
export function withPermissionChoice(
  stored: Readonly<Partial<Record<string, boolean>>> | null | undefined,
  keys: string | readonly string[],
  choice: PermissionChoice,
): Record<string, boolean> {
  const next: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(stored ?? {})) {
    if (typeof value === 'boolean') next[key] = value
  }
  for (const key of typeof keys === 'string' ? [keys] : keys) {
    if (choice === 'inherit') delete next[key]
    else next[key] = choice === 'grant'
  }
  return next
}

/** How many keys of a list a stored map grants and denies. */
export function permissionChoiceCounts(
  stored: Readonly<Partial<Record<string, unknown>>> | null | undefined,
  keys: readonly string[],
): Record<PermissionChoice, number> {
  const counts: Record<PermissionChoice, number> = { inherit: 0, grant: 0, deny: 0 }
  for (const key of keys) counts[permissionChoice(stored, key)] += 1
  return counts
}

/**
 * Which layer decided a member's verdict for a key: their org role's default,
 * their custom role, their own override, (`refines`) the broader key a key
 * refines, which it follows where nothing sets it, or (`follows`) the key a
 * key follows without needing it (AGL-4047).
 */
export type PermissionSource = 'role' | 'customRole' | 'override' | 'refines' | 'follows'

/** One key's verdict for a member, and where it came from. */
export interface ExplainedPermission {
  granted: boolean
  source: PermissionSource
  /** The org role's default, what remains when every layer above is cleared. */
  roleDefault: boolean
  /** The custom role's stored value, when the member carries one that sets the key. */
  customRole?: boolean
  /** The member's own stored override, when set. */
  override?: boolean
  /** The broader key this one refines, when it does. */
  refines?: string
  /** The key this one follows without needing it, when it does. */
  follows?: string
  /**
   * The broader key that holds this one back: set when a custom role or an
   * override allows the key but the key it refines is not granted.
   */
  heldBy?: string
}

/**
 * A member's verdict for every catalog key with the layer that produced it
 * (AGL-4047): the org role's default, then the custom role (when the member
 * carries its id and it was supplied), then the member's own override — the
 * precedence `resolveOrgPermissions` applies, which decides `granted`.
 */
export function explainOrgPermissions(
  member: (Partial<AglynOrgMember> & { roleId?: string | null; permissions?: Partial<Record<string, boolean>> }) | null | undefined,
  customRole?: AglynOrgCustomRole | null,
  definitions: readonly OrgPermissionDefinition[] = ORG_PERMISSIONS,
): Record<string, ExplainedPermission> {
  const role = ((member?.role as OrgRole | undefined) ?? 'viewer') as OrgRole
  const granted = resolveOrgPermissions(member as never, customRole ?? null)
  const out: Record<string, ExplainedPermission> = {}
  for (const definition of definitions) {
    const key = definition.key
    const roleDefault = DEFAULT_ROLE_PERMISSIONS[role]?.[key] === true
    const fromRole = member?.roleId ? customRole?.permissions?.[key] : undefined
    const fromOverride = member?.permissions?.[key]
    const isGranted = member ? granted[key] === true : false
    const stored = typeof fromOverride === 'boolean' ? fromOverride : typeof fromRole === 'boolean' ? fromRole : undefined
    out[key] = {
      granted: isGranted,
      source:
        typeof fromOverride === 'boolean'
          ? 'override'
          : typeof fromRole === 'boolean'
            ? 'customRole'
            : definition.refines
              ? 'refines'
              : definition.follows
                ? 'follows'
                : 'role',
      roleDefault,
      ...(typeof fromRole === 'boolean' ? { customRole: fromRole } : {}),
      ...(typeof fromOverride === 'boolean' ? { override: fromOverride } : {}),
      ...(definition.refines ? { refines: definition.refines } : {}),
      ...(definition.follows ? { follows: definition.follows } : {}),
      ...(definition.refines && stored === true && !isGranted ? { heldBy: definition.refines } : {}),
    }
  }
  return out
}

/*
 * THE NARROWING CONTROL (AGL-4047). Each key a site can narrow
 * (`narrowsPerSite`) carries a second choice beside allow/deny: on a site
 * where the member's access is narrower than their workspace role, does the
 * key follow that site role, or do they keep it? A custom role and a member
 * store it in `siteNarrowing`, `true` following the site role and `false`
 * keeping the permission, and a key left out inherits.
 */

/** What a custom role or a member stores for one key's narrowing: nothing, follow the site role (`true`), or keep it (`false`). */
export type NarrowingChoice = 'inherit' | 'narrow' | 'keep'

export const NARROWING_CHOICES: readonly NarrowingChoice[] = ['inherit', 'narrow', 'keep']

/** The keys of a list a site can narrow, in its order. */
export function narrowableOrgPermissions(
  definitions: readonly OrgPermissionDefinition[] = ORG_PERMISSIONS,
): OrgPermissionDefinition[] {
  return definitions.filter((definition) => Boolean(definition.narrowsPerSite))
}

/** The stored narrowing choice for a key; anything but a boolean reads as inherit. */
export function narrowingChoice(
  stored: Readonly<Partial<Record<string, unknown>>> | null | undefined,
  key: string,
): NarrowingChoice {
  const value = stored?.[key]
  return value === true ? 'narrow' : value === false ? 'keep' : 'inherit'
}

/** The stored narrowing map with keys set to a choice: `inherit` deletes the key. */
export function withNarrowingChoice(
  stored: Readonly<Partial<Record<string, boolean>>> | null | undefined,
  keys: string | readonly string[],
  choice: NarrowingChoice,
): Record<string, boolean> {
  return withPermissionChoice(stored, keys, choice === 'inherit' ? 'inherit' : choice === 'narrow' ? 'grant' : 'deny')
}

/** Which layer decided whether a key follows a narrower site role for a member. */
export type NarrowingSource = 'role' | 'customRole' | 'override'

/** One key's narrowing for a member, and where it came from. */
export interface ExplainedNarrowing {
  /** It follows the site role where their access is narrower (`false`: they keep it). */
  narrows: boolean
  source: NarrowingSource
  /** The built-in role's default, what remains when every layer above is cleared. */
  roleDefault: boolean
  /** The custom role's stored choice, when the member carries one that sets it. */
  customRole?: boolean
  /** The member's own stored choice, when set. */
  override?: boolean
}

/**
 * A member's narrowing for every key a site can narrow, with the layer that
 * produced it: their own choice, then their custom role's, then the built-in
 * role's default, the precedence `siteNarrowingChoices` applies.
 */
export function explainSiteNarrowing(
  member:
    | (Partial<AglynOrgMember> & { roleId?: string | null; siteNarrowing?: Partial<Record<string, boolean>> })
    | null
    | undefined,
  customRole?: Pick<AglynOrgCustomRole, 'siteNarrowing'> | null,
  definitions: readonly OrgPermissionDefinition[] = ORG_PERMISSIONS,
): Record<string, ExplainedNarrowing> {
  const role = ((member?.role as OrgRole | undefined) ?? 'viewer') as OrgRole
  const out: Record<string, ExplainedNarrowing> = {}
  for (const definition of narrowableOrgPermissions(definitions)) {
    const key = definition.key
    const roleDefault = definition.narrowsPerSite?.[role] === true
    const fromRole = member?.roleId ? customRole?.siteNarrowing?.[key] : undefined
    const fromOverride = member?.siteNarrowing?.[key]
    out[key] = {
      narrows:
        typeof fromOverride === 'boolean' ? fromOverride : typeof fromRole === 'boolean' ? fromRole : roleDefault,
      source: typeof fromOverride === 'boolean' ? 'override' : typeof fromRole === 'boolean' ? 'customRole' : 'role',
      roleDefault,
      ...(typeof fromRole === 'boolean' ? { customRole: fromRole } : {}),
      ...(typeof fromOverride === 'boolean' ? { override: fromOverride } : {}),
    }
  }
  return out
}

/**
 * A narrowing write as the grant check reads it: choosing to KEEP a key on
 * narrower sites hands the member that key where they would not otherwise
 * hold it, so it is a grant of the key (`true`); following the site role, or
 * clearing the choice, takes nothing the actor must hold (`false`). Feed it
 * to `overrideWriteRefusal` beside the permission changes.
 */
export function narrowingChangesAsGrants(changes: PermissionOverrideChanges): PermissionOverrideChanges {
  return Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, value === false]))
}

/** A request's override changes, read: each named key to `true`, `false` or `null` (clear). */
export type PermissionOverrideChanges = Record<string, boolean | null>

/**
 * Reads a body's `permissions` as override changes over the keys a scope
 * may store, or the reason it cannot: a key outside `allowedKeys`, or a
 * value that is not a boolean or null. Nothing is coerced.
 */
export function parsePermissionOverrides(
  raw: unknown,
  allowedKeys: readonly string[],
): { changes: PermissionOverrideChanges; error?: undefined } | { changes?: undefined; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'permissions must map permission keys to true, false or null' }
  }
  const allowed = new Set(allowedKeys)
  const changes: PermissionOverrideChanges = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(key)) return { error: `Unknown permission "${key}"` }
    // Two branches, not one `=== null` union: the core compiles without
    // strictNullChecks, where that comparison does not narrow `unknown`.
    if (typeof value === 'boolean') changes[key] = value
    else if (value === null) changes[key] = null
    else return { error: `"${key}" must be true, false or null` }
  }
  if (!Object.keys(changes).length) return { error: 'No permission to change' }
  return { changes }
}

/**
 * Why a per-member override write is refused, or null when it may go ahead
 * (AGL-4047). The route has already checked the actor may manage members;
 * these are the three things that permission alone does not settle:
 *
 * - the workspace's owner keeps every permission, so no override is stored
 *   on them in either direction;
 * - nobody but staff changes their own overrides, which would let a member
 *   who manages people widen their own access;
 * - nobody but staff and the owner grants a key they do not hold
 *   themselves, so managing people is not a back door to billing or the
 *   register.
 */
export function overrideWriteRefusal(options: {
  targetUid: string
  targetIsOwner: boolean
  actorUid: string
  isStaff: boolean
  /** The actor owns the workspace, and may grant anything the catalog holds. */
  actorIsOwner?: boolean
  /** The actor's own resolved verdicts. */
  actorGranted: Readonly<Record<string, boolean>>
  changes: PermissionOverrideChanges
  /** Labels for the refusal's words; absent: the keys. */
  labelOf?: (key: string) => string
}): { status: number; error: string } | null {
  if (options.targetIsOwner) {
    return { status: 400, error: 'The owner keeps every permission' }
  }
  if (options.isStaff) return null
  if (options.targetUid === options.actorUid) {
    return { status: 403, error: 'Ask another admin to change your own permissions' }
  }
  if (options.actorIsOwner) return null
  const beyond = Object.entries(options.changes)
    .filter(([key, value]) => value === true && options.actorGranted[key] !== true)
    .map(([key]) => (options.labelOf ? options.labelOf(key) : key))
  if (beyond.length) {
    return {
      status: 403,
      error: `You can only grant permissions you hold yourself: ${beyond.join(', ')}`,
    }
  }
  return null
}

/**
 * The override changes that turn `stored` into `draft`: each key whose
 * choice differs, to `true` / `false`, or to `null` where the draft clears
 * it. What an editor sends, so a save writes only what was changed.
 */
export function overrideChangesBetween(
  stored: Readonly<Partial<Record<string, unknown>>> | null | undefined,
  draft: Readonly<Partial<Record<string, unknown>>> | null | undefined,
): PermissionOverrideChanges {
  const changes: PermissionOverrideChanges = {}
  const keys = new Set([...Object.keys(stored ?? {}), ...Object.keys(draft ?? {})])
  for (const key of keys) {
    const before = permissionChoice(stored, key)
    const after = permissionChoice(draft, key)
    if (before === after) continue
    changes[key] = after === 'inherit' ? null : after === 'grant'
  }
  return changes
}
