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
 * Plugin-declared billing and access keys (AGL-2940).
 *
 * A plugin that sells something, gates something, or can be switched off in
 * an incident declares the KEYS here — a seat add-on, a feature flag, a
 * lockdown lever, a permission — and the core catalogs that used to be
 * edited for each one read the declarations instead:
 *
 * - `plan-entitlements` folds every registered seat add-on into
 *   `resolveOrgEntitlements` (a quota raised per unit, features switched on)
 *   and answers a registered feature's plan defaults;
 * - `lockdown` lists a registered lever on the staff page, carries its label,
 *   its staff-bypass rule and its visitor notice, and maps the API paths it
 *   names onto it for the plugin dispatcher;
 * - `plugin-permissions` receives the permissions with the owner filled in.
 *
 * The NUMBERS stay where they are checked. A seat add-on's price is a row in
 * `PLAN_PRICING`, read by the Stripe wiring and reconciled by
 * `check-pricing-drift`; a declaration names the quota it widens and by how
 * much per plan, and nothing here restates a price.
 *
 * Registration order is deterministic: the catalog order of
 * `FIRST_PARTY_PLUGINS`, then any other id alphabetically. Plugin modules
 * load in parallel, so the order they REGISTER in is whatever the network
 * gave, and a list that followed it would put the staff lockdown checklist
 * in a different order per session.
 */

import type { OrgPlan } from '../foundation'
import { FIRST_PARTY_PLUGINS } from './enabled-plugins'
import {
  registerPluginPermissions,
  type PluginPermission,
} from './plugin-permissions'

export interface PluginSeatAddonDeclaration {
  /** The `org.seatAddons` key the purchase is stored under (`aiAddon`). */
  key: string
  label: string
  /**
   * How many purchased units count. `1` for an org-wide add-on that is
   * bought once, where a doubled webhook item or a hand edit above one is
   * still one purchase; absent to count the stored quantity.
   */
  maxUnits?: number
  /**
   * The quota each unit widens, per plan: the resolved entitlement named by
   * `key` gains `perUnitByPlan[plan] × units`. A plan the add-on is not sold
   * on declares 0.
   */
  quota?: {
    key: string
    perUnitByPlan: Readonly<Record<OrgPlan, number>>
  }
  /** Feature flags a purchased unit switches on. */
  features?: readonly string[]
}

export interface PluginFeatureDeclaration {
  /** The `OrgFeatureFlags` key. */
  key: string
  label: string
  /**
   * The plan defaults, when the key is not one the plan tables already
   * carry. Absent means the plan tables decide, which is the case for every
   * key that predates this registry.
   */
  defaultByPlan?: Readonly<Partial<Record<OrgPlan, boolean>>>
}

export interface PluginLockdownFeatureDeclaration {
  /** The lever's wire identity (`ai-generate`). */
  key: string
  /** The staff checklist's label. */
  label: string
  /**
   * Whether a verified staff claim passes the lock. Granted where a staff
   * action aids incident response — one real call proves a provider is back
   * — and withheld where the staff action would BE the incident.
   */
  staffBypass: boolean
  /**
   * What a visitor reads while the lever is pulled: what is paused AND what
   * still works. The expected-back window is appended by the notice builder.
   */
  notice: { title: string; body: string }
  /**
   * Plugin API paths the lever gates at the dispatcher: exact paths, and
   * prefixes matched on a segment boundary (`ai/generate` also gates
   * `ai/generate/section`, never `ai/generated-report`).
   */
  apiPaths?: { exact?: readonly string[]; prefixes?: readonly string[] }
}

export interface PluginEntitlementRegistration {
  pluginId: string
  seatAddons?: readonly PluginSeatAddonDeclaration[]
  features?: readonly PluginFeatureDeclaration[]
  lockdownFeatures?: readonly PluginLockdownFeatureDeclaration[]
  permissions?: readonly Omit<PluginPermission, 'pluginId'>[]
}

const registrations = new Map<string, PluginEntitlementRegistration>()

const CATALOG_ORDER = new Map(
  FIRST_PARTY_PLUGINS.map((plugin, index) => [plugin.id, index]),
)

function catalogRank(pluginId: string): number {
  return CATALOG_ORDER.get(pluginId) ?? Number.MAX_SAFE_INTEGER
}

function orderedRegistrations(): PluginEntitlementRegistration[] {
  return [...registrations.values()].sort(
    (a, b) =>
      catalogRank(a.pluginId) - catalogRank(b.pluginId) ||
      a.pluginId.localeCompare(b.pluginId),
  )
}

function refuseStolenKeys(
  pluginId: string,
  kind: 'seat add-on' | 'lockdown feature',
  keys: readonly string[],
  ownerOf: (key: string) => string | undefined,
): void {
  for (const key of keys) {
    const owner = ownerOf(key)
    if (owner && owner !== pluginId) {
      throw new Error(
        `${kind} "${key}" is already declared by "${owner}"; refused "${pluginId}"`,
      )
    }
  }
}

/**
 * Idempotent per plugin — re-registration replaces that plugin's
 * declarations. A seat add-on or lockdown key another plugin already owns
 * refuses the whole registration: one key, one owner, or the two
 * declarations disagree about what the key means.
 */
export function registerPluginEntitlements(
  registration: PluginEntitlementRegistration,
): void {
  const pluginId = registration.pluginId.trim()
  if (!pluginId) throw new Error('plugin entitlements need a pluginId')
  refuseStolenKeys(
    pluginId,
    'seat add-on',
    (registration.seatAddons ?? []).map((entry) => entry.key),
    (key) => pluginSeatAddonOwner(key),
  )
  refuseStolenKeys(
    pluginId,
    'lockdown feature',
    (registration.lockdownFeatures ?? []).map((entry) => entry.key),
    (key) => pluginLockdownFeatureOwner(key),
  )
  registrations.set(pluginId, { ...registration, pluginId })
  if (registration.permissions?.length) {
    registerPluginPermissions(
      registration.permissions.map((permission) => ({ ...permission, pluginId })),
    )
  }
}

function pluginSeatAddonOwner(key: string): string | undefined {
  for (const entry of registrations.values()) {
    if (entry.seatAddons?.some((addon) => addon.key === key)) return entry.pluginId
  }
  return undefined
}

function pluginLockdownFeatureOwner(key: string): string | undefined {
  for (const entry of registrations.values()) {
    if (entry.lockdownFeatures?.some((feature) => feature.key === key)) {
      return entry.pluginId
    }
  }
  return undefined
}

/** Every declared seat add-on, in catalog order. */
export function listPluginSeatAddons(): PluginSeatAddonDeclaration[] {
  return orderedRegistrations().flatMap((entry) => [...(entry.seatAddons ?? [])])
}

/** One declared seat add-on by its `seatAddons` key. */
export function pluginSeatAddon(key: string): PluginSeatAddonDeclaration | undefined {
  return listPluginSeatAddons().find((entry) => entry.key === key)
}

/** Every declared feature, in catalog order. */
export function listPluginFeatures(): PluginFeatureDeclaration[] {
  return orderedRegistrations().flatMap((entry) => [...(entry.features ?? [])])
}

/** Every declared lockdown lever, in catalog order. */
export function listPluginLockdownFeatures(): PluginLockdownFeatureDeclaration[] {
  return orderedRegistrations().flatMap((entry) => [
    ...(entry.lockdownFeatures ?? []),
  ])
}

/** One declared lockdown lever by key. */
export function pluginLockdownFeature(
  key: string,
): PluginLockdownFeatureDeclaration | undefined {
  return listPluginLockdownFeatures().find((entry) => entry.key === key)
}

/** The plugin that declared a lockdown lever, for attribution. */
export function pluginIdForLockdownFeature(key: string): string | undefined {
  return pluginLockdownFeatureOwner(key)
}

/** Every registration, in catalog order. */
export function listPluginEntitlementRegistrations(): PluginEntitlementRegistration[] {
  return orderedRegistrations()
}

/** Test seam: forget every registration (permissions stay registered). */
export function resetPluginEntitlementsForTests(): void {
  registrations.clear()
}
