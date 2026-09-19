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
 * Plugin-declared activity actions (AGL-2940).
 *
 * Most rows in `orgs/{orgId}/activity` and `hosts/{hostId}/activity` store
 * a prose action written at the call site. A plugin whose rows are read by
 * more than a person — a filter chip, a staff facet, an actor table — stores
 * a CODE (`ai.job.output`) and declares here what the code means: the label
 * a reader sees, the scope it is written at, and the group its filter chip
 * belongs to. The activity renderers read this catalog for labels and
 * filters, so a second plugin with coded rows gets a chip and a facet group
 * by registering, with no edit to the renderers.
 *
 * Declared at module scope from both the client barrel and the `/server`
 * entry (the AGL-428 pattern), with an explicit `pluginId`: module scope
 * runs before the loader's ownership marker is set.
 */

export type PluginActivityScope = 'org' | 'host' | 'staff'

/**
 * A resource a PLUGIN files an org activity row under (AGL-2978): the
 * plugin's id, a colon and the plugin's own noun — `outreach:mailbox`.
 *
 * Core's activity targets are a closed list of core's own resources. A
 * plugin's resource is not one of them and is never added to that list; the
 * org log's target type accepts any namespaced type instead, and the feed
 * reads the noun after the colon for a reader. The namespace keeps two
 * plugins' nouns from meaning one thing.
 */
export type PluginActivityTargetType = `${string}:${string}`

/** A namespaced type as the log stores it: `pluginId:noun`, both parts plain. */
const PLUGIN_TARGET_TYPE = /^([a-z][a-z0-9-]*):([A-Za-z][A-Za-z0-9]*)$/

/** Whether a stored target type is a plugin's namespaced one. */
export function isPluginActivityTargetType(type: unknown): type is PluginActivityTargetType {
  return typeof type === 'string' && PLUGIN_TARGET_TYPE.test(type)
}

/**
 * The noun a plugin's namespaced type names — `outreach:mailbox` →
 * `mailbox` — or `undefined` for any other type.
 */
export function pluginActivityTargetNoun(type: unknown): string | undefined {
  if (typeof type !== 'string') return undefined
  return PLUGIN_TARGET_TYPE.exec(type)?.[2]
}

export interface PluginActivityAction {
  /** The stored action code — dotted, stable, never a sentence. */
  key: string
  /** What a person reads for the code in the feed and the actor table. */
  label: string
  /** Which log(s) the writers put the code in. */
  scope: PluginActivityScope | readonly PluginActivityScope[]
  /** The feed target types rows carrying this code file their output under. */
  resourceTypes?: readonly string[]
}

/**
 * The filter a plugin's coded rows share: one chip in the org feed and the
 * actor table, one facet group on the staff audit page.
 */
export interface PluginActivityGroup {
  /** Stable group id — the facet's value (`ai`). */
  id: string
  /** The chip and the facet option (`AI`). */
  label: string
  /**
   * Staff audit actions that belong to the group without carrying one of the
   * registered codes — rows written by core on the plugin's behalf, matched
   * by prefix (`billing.assistOverage.`).
   */
  staffAuditPrefixes?: readonly string[]
  /**
   * Staff audit actions a plugin's staff doors write when staff READ
   * something rather than change it (AGL-2939): the audit log files them as
   * an access. Matched exactly.
   */
  staffAuditAccessActions?: readonly string[]
}

export interface PluginActivityRegistration {
  pluginId: string
  group: PluginActivityGroup
  actions: readonly PluginActivityAction[]
}

const registrations = new Map<string, PluginActivityRegistration>()

/**
 * Idempotent per plugin — re-registration replaces that plugin's catalog. A
 * code already declared by a DIFFERENT plugin is refused for the whole
 * registration: two owners for one code would give the row two labels.
 */
export function registerPluginActivityActions(
  registration: PluginActivityRegistration,
): void {
  const pluginId = registration.pluginId.trim()
  if (!pluginId) throw new Error('plugin activity actions need a pluginId')
  for (const action of registration.actions) {
    const owner = ownerOfActivityAction(action.key)
    if (owner && owner !== pluginId) {
      throw new Error(
        `activity action "${action.key}" is already declared by "${owner}"; ` +
          `refused "${pluginId}"`,
      )
    }
  }
  registrations.set(pluginId, registration)
}

function ownerOfActivityAction(key: string): string | undefined {
  for (const registration of registrations.values()) {
    if (registration.actions.some((action) => action.key === key)) {
      return registration.pluginId
    }
  }
  return undefined
}

/** Every registration, in registration order. */
export function listPluginActivityRegistrations(): PluginActivityRegistration[] {
  return [...registrations.values()]
}

/** Every declared action across plugins. */
export function listPluginActivityActions(): PluginActivityAction[] {
  return listPluginActivityRegistrations().flatMap((entry) => [...entry.actions])
}

/** The readable label for a declared code; `undefined` for any other action. */
export function pluginActivityActionLabel(action: unknown): string | undefined {
  if (typeof action !== 'string') return undefined
  for (const registration of registrations.values()) {
    const match = registration.actions.find((entry) => entry.key === action)
    if (match) return match.label
  }
  return undefined
}

/** The group a stored action's code belongs to, or `undefined`. */
export function pluginActivityGroupForAction(
  action: unknown,
): PluginActivityGroup | undefined {
  if (typeof action !== 'string') return undefined
  for (const registration of registrations.values()) {
    if (registration.actions.some((entry) => entry.key === action)) {
      return registration.group
    }
  }
  return undefined
}

/**
 * The filter chips the feeds offer: one per registered group, each with the
 * codes its chip keeps. What an `action isAnyOf …` request sends.
 */
export function listPluginActivityFilters(): Array<{
  group: PluginActivityGroup
  actions: string[]
}> {
  return listPluginActivityRegistrations().map((entry) => ({
    group: entry.group,
    actions: entry.actions.map((action) => action.key),
  }))
}

/**
 * The staff audit facet group for an action: a registered group when the
 * action is one of its codes or starts with one of its prefixes, else the
 * action's leading namespace (`billing`, `org`, `plugins`).
 */
export function pluginStaffAuditActionGroup(action: unknown): string {
  const text = typeof action === 'string' ? action.trim() : ''
  if (!text) return ''
  const byCode = pluginActivityGroupForAction(text)
  if (byCode) return byCode.id
  for (const registration of registrations.values()) {
    const prefixes = registration.group.staffAuditPrefixes ?? []
    if (prefixes.some((prefix) => text.startsWith(prefix))) {
      return registration.group.id
    }
  }
  const dot = text.indexOf('.')
  return dot > 0 ? text.slice(0, dot) : text
}

/** Whether a staff audit action is a read some plugin declared (AGL-2939). */
export function isPluginStaffAuditAccess(action: unknown): boolean {
  if (typeof action !== 'string' || !action) return false
  for (const registration of registrations.values()) {
    if (registration.group.staffAuditAccessActions?.includes(action)) return true
  }
  return false
}

/** How a facet group reads in the menu: a registered label, else the id. */
export function pluginStaffAuditActionGroupLabel(group: string): string {
  for (const registration of registrations.values()) {
    if (registration.group.id === group) return registration.group.label
  }
  return group
}

/** Test seam: forget every registration. */
export function resetPluginActivityActionsForTests(): void {
  registrations.clear()
}
