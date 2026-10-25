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
import {
  ORG_PERMISSION_GROUPS,
  ORG_PERMISSIONS,
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
