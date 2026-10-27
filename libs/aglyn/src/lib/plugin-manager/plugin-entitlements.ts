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
 * - `plugin-permissions` receives the permissions with the owner filled in;
 * - `org-permissions` folds every declared catalog key into the org
 *   permission catalog — the role editor, custom roles, per-member overrides
 *   and the rules stamp — and `host-permissions` decides the keys that
 *   declare host-role defaults for a site collaborator, per site.
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

import type { AglynOrgBilling, HostAccessRole, OrgPlan, OrgRole } from '../foundation'
import { declarationRoleDefaults } from '../app-utils/org-role-grants'
import { FIRST_PARTY_PLUGINS } from './enabled-plugins'
import {
  listPluginPermissions,
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
   * The quota each unit widens: the resolved entitlement named by `key`
   * gains `perUnit(org, plan) × units` when the figure depends on WHAT was
   * bought (the Aglyn AI tier, AGL-3965), else `perUnitByPlan[plan] × units`.
   * A plan the add-on is not sold on answers 0.
   */
  quota?: {
    key: string
    perUnitByPlan?: Readonly<Record<OrgPlan, number>>
    /**
     * The per-unit figure read off the org itself. `org` is the billing
     * document as `resolveOrgEntitlements` received it and `plan` its
     * effective plan.
     */
    perUnit?: (org: Readonly<Partial<AglynOrgBilling>>, plan: OrgPlan) => number
  }
  /** Feature flags a purchased unit switches on. */
  features?: readonly string[]
  /**
   * Whether a plan sells the add-on, when `perUnitByPlan` cannot say so
   * (a `perUnit` quota, AGL-3965). Absent: sold where `perUnitByPlan` names
   * a figure above zero, or everywhere for an add-on with no quota.
   */
  soldOn?: (plan: OrgPlan) => boolean
}

/**
 * Whether a plan sells a declared seat add-on: its own `soldOn`, else a
 * `perUnitByPlan` figure above zero for the plan, else (no quota) yes.
 */
export function pluginSeatAddonSoldOn(
  addon: PluginSeatAddonDeclaration,
  plan: OrgPlan,
): boolean {
  if (addon.soldOn) return addon.soldOn(plan)
  if (!addon.quota) return true
  return (addon.quota.perUnitByPlan?.[plan] ?? 0) > 0
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
   * What the lever is called in the customer's mail when staff pull it for
   * their workspace (`media uploads`, `AI generation`). A noun phrase that
   * reads right mid-sentence ("our team paused media uploads") and after a
   * colon, so lowercase unless it starts with a name or an acronym. The
   * staff `label` never reaches a customer.
   */
  customerName: string
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

/**
 * A key a plugin adds to the org permission CATALOG (AGL-2984): the granular
 * map custom roles and per-member overrides are stored in, that
 * `resolveOrgPermissions` layers and the rules stamp carries, and that the
 * role editor lists. A declared key is stored, layered and resolved exactly
 * like a core key; the declaration supplies what a core key's catalog entry
 * and role table supply.
 */
export interface PluginOrgPermissionDeclaration {
  /** The dotted key a custom role and a per-member override store (`reviews.reply`). */
  key: string
  /** The role editor's line for the key, and the word a refusal names. */
  label: string
  /** What the key opens, under the label in the role editor. */
  description: string
  /** Each org role's verdict when no custom role or per-member override sets the key. */
  roleDefaults: Readonly<Record<OrgRole, boolean>>
  /**
   * Each HOST role's verdict, for a key a site collaborator holds per site.
   *
   * A collaborator's membership carries no org standing to refine — it
   * exists only to carry access to named sites — so a key with this field is
   * decided for them on the site a request names: the host role they hold
   * there, refined by the per-site toggle on their member document. A key
   * without it is never held by a collaborator.
   */
  hostRoleDefaults?: Readonly<Record<HostAccessRole, boolean>>
  /**
   * The role editor's group for the key (AGL-4047): a core group id
   * (`CORE_ORG_PERMISSION_GROUPS`) or, absent, a group of the plugin's own.
   */
  group?: string
  /** The heading of a group of the plugin's own; absent: the plugin's catalog label. */
  groupLabel?: string
  /**
   * A broader key this one is a finer part of (AGL-4047): never granted
   * without it, and following it where nothing sets this key. See
   * `PluginPermission.refines`.
   */
  refines?: string
  /**
   * A key this one takes its verdict from where nothing sets it, without
   * needing it (AGL-4047). See `PluginPermission.follows`.
   */
  follows?: string
}

/**
 * One key of the ONE permission catalog that a plugin contributes (AGL-4047),
 * whichever of the two declaration APIs it came through:
 * `registerPluginEntitlements({ orgPermissions })` (`source: 'catalog'`) or
 * `registerPluginPermissions` (`source: 'tier'`, its per-tier defaults read
 * as org-role defaults, the owner on the admin tier).
 */
export interface PluginCatalogPermission {
  key: string
  label: string
  description: string
  pluginId: string
  roleDefaults: Readonly<Record<OrgRole, boolean>>
  hostRoleDefaults?: Readonly<Record<HostAccessRole, boolean>>
  group: string
  groupLabel: string
  source: 'catalog' | 'tier'
  /** The broader key this one refines, when it does. */
  refines?: string
  /** The key this one follows without needing it, when it does. */
  follows?: string
}

export interface PluginEntitlementRegistration {
  pluginId: string
  seatAddons?: readonly PluginSeatAddonDeclaration[]
  features?: readonly PluginFeatureDeclaration[]
  lockdownFeatures?: readonly PluginLockdownFeatureDeclaration[]
  /** Per-tier keys a plugin's own pages read (`registerPluginPermissions`). */
  permissions?: readonly Omit<PluginPermission, 'pluginId'>[]
  /** Keys added to the org permission catalog — see {@link PluginOrgPermissionDeclaration}. */
  orgPermissions?: readonly PluginOrgPermissionDeclaration[]
}

/**
 * The registrations and their listeners, held on `globalThis` rather than in
 * module `const`s (AGL-3596), as the custom field registry and the
 * declarations repair hook are (AGL-3412).
 *
 * An app registers the plugins' declarations from `instrumentation.ts`, which
 * Next compiles into a different module graph from the routes. A module-scoped
 * map was filled in the instrumentation's copy and read empty in a route's, so
 * a core route that never loaded a plugin knew none of its keys: the site
 * create door asked for `ai.generate`, read `undefined` from a catalog that
 * had never heard of it, and every guided AI start was born with the starter.
 * One map per process, under a `Symbol.for` key, is the same map in every
 * copy.
 */
const REGISTRY_KEY = Symbol.for('@aglyn/aglyn:plugin-entitlements')

interface PluginEntitlementsRegistry {
  registrations: Map<string, PluginEntitlementRegistration>
  /**
   * Readers of the registrations that keep a derived view in step with them —
   * every copy of the org permission catalog rebuilds itself on every
   * registration and reset, because a plugin's declarations can register
   * after a module that imported the catalog was evaluated, and in another
   * module graph's copy of this file.
   */
  listeners: Set<() => void>
}

const globalScope = globalThis as typeof globalThis & {
  [REGISTRY_KEY]?: PluginEntitlementsRegistry
}

const registry: PluginEntitlementsRegistry = (globalScope[REGISTRY_KEY] ??= {
  registrations: new Map(),
  listeners: new Set(),
})

const registrations = registry.registrations
const listeners = registry.listeners

/** Calls `listener` after every registration and reset; answers the unsubscribe. */
export function subscribePluginEntitlements(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notifyListeners(): void {
  for (const listener of [...listeners]) listener()
}

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
  kind: 'seat add-on' | 'lockdown feature' | 'org permission',
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
 * declarations. A seat add-on, lockdown or catalog permission key another
 * plugin already owns refuses the whole registration: one key, one owner,
 * or the two declarations disagree about what the key means.
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
  refuseStolenKeys(
    pluginId,
    'org permission',
    (registration.orgPermissions ?? []).map((entry) => entry.key),
    (key) => pluginOrgPermissionOwner(key) ?? pluginTierPermissionOwner(key),
  )
  registrations.set(pluginId, { ...registration, pluginId })
  if (registration.permissions?.length) {
    registerPluginPermissions(
      registration.permissions.map((permission) => ({ ...permission, pluginId })),
    )
  }
  notifyListeners()
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

function pluginOrgPermissionOwner(key: string): string | undefined {
  for (const entry of registrations.values()) {
    if (entry.orgPermissions?.some((permission) => permission.key === key)) {
      return entry.pluginId
    }
  }
  return undefined
}

function pluginTierPermissionOwner(key: string): string | undefined {
  return listPluginPermissions().find((permission) => permission.key === key)?.pluginId
}

/** Refusals already logged by `listPluginCatalogPermissions`, so each is reported once. */
// boot-registry: per copy — it only de-duplicates a warning; a second compiled copy logging the same refusal once more is harmless, and nothing reads it to decide anything.
const reportedCatalogRefusals = new Set<string>()

/** A plugin's catalog label, the heading its own permission group carries. */
function pluginLabel(pluginId: string): string {
  return FIRST_PARTY_PLUGINS.find((plugin) => plugin.id === pluginId)?.label ?? pluginId
}

/**
 * Every key plugins contribute to the permission catalog, through EITHER
 * declaration API, in catalog order (AGL-4047): per plugin, its
 * `orgPermissions` declarations and then its `registerPluginPermissions`
 * keys. A key both APIs carry for the same plugin is the catalog
 * declaration's; one a DIFFERENT plugin already declared is refused and
 * logged once, the first declaration keeping its meaning and defaults.
 *
 * Read live: both registries fill at plugin module scope, which can be after
 * any reader of this was evaluated.
 */
export function listPluginCatalogPermissions(): PluginCatalogPermission[] {
  const byPlugin = new Map<string, PluginCatalogPermission[]>()
  const owner = new Map<string, string>()
  const add = (entry: PluginCatalogPermission): void => {
    const incumbent = owner.get(entry.key)
    if (incumbent !== undefined) {
      if (incumbent !== entry.pluginId) {
        const refusal = `${entry.pluginId}\x00${entry.key}`
        if (!reportedCatalogRefusals.has(refusal)) {
          reportedCatalogRefusals.add(refusal)
          console.error(
            `[plugins] refused permission key "${entry.key}" to "${entry.pluginId}": ` +
              `already declared by "${incumbent}"`,
          )
        }
      }
      return
    }
    owner.set(entry.key, entry.pluginId)
    const list = byPlugin.get(entry.pluginId) ?? []
    list.push(entry)
    byPlugin.set(entry.pluginId, list)
  }
  for (const permission of listPluginOrgPermissions()) {
    add({
      key: permission.key,
      label: permission.label,
      description: permission.description,
      pluginId: permission.pluginId,
      roleDefaults: declarationRoleDefaults(permission),
      ...(permission.hostRoleDefaults ? { hostRoleDefaults: permission.hostRoleDefaults } : {}),
      group: permission.group ?? permission.pluginId,
      groupLabel: permission.groupLabel ?? pluginLabel(permission.pluginId),
      source: 'catalog',
      ...(permission.refines ? { refines: permission.refines } : {}),
      ...(permission.follows ? { follows: permission.follows } : {}),
    })
  }
  for (const permission of listPluginPermissions()) {
    add({
      key: permission.key,
      label: permission.label,
      description: permission.description ?? '',
      pluginId: permission.pluginId,
      roleDefaults: declarationRoleDefaults(permission),
      group: permission.group ?? permission.pluginId,
      groupLabel: permission.groupLabel ?? pluginLabel(permission.pluginId),
      source: 'tier',
      ...(permission.refines ? { refines: permission.refines } : {}),
      ...(permission.follows ? { follows: permission.follows } : {}),
    })
  }
  return [...byPlugin.keys()]
    .sort((a, b) => catalogRank(a) - catalogRank(b) || a.localeCompare(b))
    .flatMap((pluginId) => byPlugin.get(pluginId) ?? [])
}

/** Every declared catalog permission, in catalog order, with the plugin that declared it. */
export function listPluginOrgPermissions(): Array<
  PluginOrgPermissionDeclaration & { pluginId: string }
> {
  return orderedRegistrations().flatMap((entry) =>
    (entry.orgPermissions ?? []).map((permission) => ({
      ...permission,
      pluginId: entry.pluginId,
    })),
  )
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

/**
 * Test seam: forget every registration. The per-tier permissions stay
 * registered; the catalog permissions go with their registrations.
 */
export function resetPluginEntitlementsForTests(): void {
  registrations.clear()
  notifyListeners()
}
