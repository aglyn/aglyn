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
 * WHAT EACH PLAN INCLUDES OF A PLUGIN'S OWN KEYS (AGL-3080).
 *
 * `plugin-entitlement-keys` gives a plugin the TYPE of a key it owns, by
 * augmentation, so `OrgEntitlements` and `OrgFeatureFlags` carry the key
 * without core naming it. That leaves the VALUE: what Free, Starter and every
 * other plan include of it. A key that only a plugin's type declares still
 * needs a figure in every row of `PLAN_ENTITLEMENTS`, and core writing the
 * figure is core naming the key.
 *
 * So the owning plugin declares the figure per plan, beside the reasoning
 * that sized it, and core composes it into the plan table. A plan row in
 * `PLAN_ENTITLEMENTS` still answers every key the platform sells, at the same
 * number — `/pricing`, the plan comparison, the pricing-table generator and
 * every quota gate read the composed table and cannot tell the difference.
 *
 * ## Compiled, never registered
 *
 * The readers include the published pricing tables, which a generator builds
 * from `PLAN_ENTITLEMENTS` with no plugin loaded, and the customer's plan
 * comparison, which renders before any plugin surface does. A registry one of
 * them had not filled would publish a plan without the band — a missing row on
 * the price list, or a quota gate reading nothing — with nothing red. So a
 * first-party plugin names a function under `register.planEntitlements` in
 * `plugins.config.json`; `tools/scripts/generate-plugin-manifests.mjs` loads
 * `${package}/plan-entitlements`, calls it, validates the answer and compiles
 * it into `first-party-plugins.generated.ts` as data. There is no runtime
 * registrar, for the reason `plugin-org-capacity` gives: a registrar nothing
 * can safely call is worse than none.
 *
 * ## What a missing figure means
 *
 * A declaration names every plan: the generated rows are typed
 * `Record<OrgPlan, …>`, so a plan left out does not compile. A key nobody
 * declares is absent from the table, and each reader answers absence in the
 * closed direction — a quota reads as nothing included, a feature as off.
 * `planQuotaOf` below is that reading, and it never answers "unlimited" or
 * "free" for a key that has no figure.
 *
 * ## One key, one owner, and never one of core's
 *
 * The generator refuses a key two plugins declare. A key the platform's own
 * rows already carry is refused by `plan-entitlements.spec.ts` rather than
 * here, because the generator cannot read core's rows without loading the
 * module that imports this one; the composition keeps core's figure either
 * way, so a collision can shadow nothing a customer is charged.
 */

import type { OrgPlan } from '../foundation'
import {
  PLUGIN_PLAN_FEATURES_DECLARED,
  PLUGIN_PLAN_QUOTAS_DECLARED,
} from './first-party-plugins.generated'

/** A numeric entitlement a plugin owns: a band, a daily pace, a take rate. */
export interface PluginPlanQuotaDeclaration {
  /** The stored key, exactly as `OrgEntitlements` and an override spell it. */
  key: string
  /** What a staff page calls it. */
  label: string
  /**
   * What each plan includes. `Infinity` is `UNLIMITED`; every other value is
   * a finite, non-negative number.
   */
  byPlan: Readonly<Record<OrgPlan, number>>
  /**
   * A PRICE rather than a cap — a percentage of a sale — so an uncapped plan
   * comp must never lift it (`PRICE_ENTITLEMENT_KEYS`).
   */
  price?: boolean
}

/** A boolean gate a plugin owns. */
export interface PluginPlanFeatureDeclaration {
  /** The stored key, exactly as `OrgFeatureFlags` and an override spell it. */
  key: string
  label: string
  byPlan: Readonly<Record<OrgPlan, boolean>>
}

/** What a plugin's `planEntitlements` function answers. */
export interface PluginPlanEntitlementsDeclaration {
  quotas?: readonly PluginPlanQuotaDeclaration[]
  features?: readonly PluginPlanFeatureDeclaration[]
}

/** A quota declaration with the plugin that made it. */
export type ResolvedPluginPlanQuota = PluginPlanQuotaDeclaration & {
  pluginId: string
}

/** A feature declaration with the plugin that made it. */
export type ResolvedPluginPlanFeature = PluginPlanFeatureDeclaration & {
  pluginId: string
}

/** Every declared quota, in catalog order. */
export function pluginPlanQuotas(): readonly ResolvedPluginPlanQuota[] {
  return PLUGIN_PLAN_QUOTAS_DECLARED
}

/** Every declared feature, in catalog order. */
export function pluginPlanFeatures(): readonly ResolvedPluginPlanFeature[] {
  return PLUGIN_PLAN_FEATURES_DECLARED
}

/** The plugin that declared a quota or feature key, or `null`. */
export function pluginPlanEntitlementOwner(key: string): string | null {
  return (
    PLUGIN_PLAN_QUOTAS_DECLARED.find((one) => one.key === key)?.pluginId ??
    PLUGIN_PLAN_FEATURES_DECLARED.find((one) => one.key === key)?.pluginId ??
    null
  )
}

/** The declared quotas' figures for one plan, keyed by the stored key. */
export function pluginPlanQuotaRow(plan: OrgPlan): Record<string, number> {
  return Object.fromEntries(
    PLUGIN_PLAN_QUOTAS_DECLARED.map((one) => [one.key, one.byPlan[plan]]),
  )
}

/** The declared features' answers for one plan, keyed by the stored key. */
export function pluginPlanFeatureRow(plan: OrgPlan): Record<string, boolean> {
  return Object.fromEntries(
    PLUGIN_PLAN_FEATURES_DECLARED.map((one) => [one.key, one.byPlan[plan]]),
  )
}

/**
 * A resolved quota read by its key — the reading core uses for a key a plugin
 * owns, since core compiles without the plugin's type augmentation.
 *
 * ⚑ ABSENT IS NOTHING INCLUDED. A key no plugin declares, or a value that is
 * not a number, reads as `0`: every gate that compares usage against it
 * refuses, and every meter drawn from it shows full. That is the same
 * direction `plugin-org-capacity` answers an unknown capacity in. Reading
 * absence as `UNLIMITED` would be a plan giving away what nobody declared it
 * sells.
 */
export function planQuotaOf(entitlements: object, key: string): number {
  const value = (entitlements as Record<string, unknown>)[key]
  return typeof value === 'number' && !Number.isNaN(value) ? value : 0
}
