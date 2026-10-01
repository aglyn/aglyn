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
 * WHAT A PLUGIN'S USAGE COSTS, AND HOW MUCH OF ITS BAND IT SPENT (AGL-3080).
 *
 * The platform keeps one cost model (`orgMonthlyCogsUsd`) and one
 * utilization table (`margin-utilization.ts`), and both read the monthly
 * usage rollup. Several of the rollup's meters are a plugin's: the AI
 * plugin's provider spend, the CRM's records, the forms plugin's
 * submissions, the workflows plugin's runs. Core used to name each of them —
 * its rollup field, the unit rate that prices it, the band it is measured
 * against — so a plugin that metered something new could not reach the
 * discount guardrail without a core edit, and core could not be taken
 * without the plugins it named.
 *
 * So a plugin declares its meters, and core composes them:
 *
 *  - a COST AXIS names the rollup fields a meter is recorded under and the
 *    `ORG_COGS_UNIT_RATES_USD` key that prices one unit, or no key when the
 *    field is already dollars. `orgMonthlyCogsUsd` prices it beside core's
 *    own axes, and `orgCogsInputFrom` forwards its fields.
 *  - a BAND names the rollup fields that measure it and the entitlement that
 *    says what the plan includes. The utilization table reads it beside
 *    core's own bands.
 *
 * ## What core keeps
 *
 * The MONEY. Every unit rate stays in `ORG_COGS_UNIT_RATES_USD`, beside the
 * billed table it is reconciled against, and every included figure stays in
 * `PLAN_ENTITLEMENTS`. A declaration names fields and keys; it carries no
 * price. The one number a declaration may carry is a band's unit cost, where
 * the band is sold in a unit OF cost (a credit is a fixed quantity of
 * dollars), and that number is the plugin's own definition of its unit.
 *
 * ## Compiled, never registered
 *
 * The cost model's readers include the staff org page, which prices a rollup
 * in the browser, and the discount guardrail, whose every wrong answer is in
 * the approving direction: a cost axis a registry had not filled would price
 * at nothing and approve a discount the margin cannot carry. So these are
 * compiled from each plugin's `usage-axes` declaration by the manifest
 * generator, like the plan figures, and a rate key core does not have is an
 * error rather than a zero.
 */

import {
  PLUGIN_USAGE_BANDS_DECLARED,
  PLUGIN_COST_AXES_DECLARED,
} from './first-party-plugins.generated'

/** A meter a plugin contributes to the platform's cost model. */
export interface PluginCostAxisDeclaration {
  /** The breakdown key every staff reader shows it under. */
  id: string
  /** Where it sorts among the cost model's axes; core's own are multiples of 10. */
  order: number
  /** Rollup fields summed for the axis. */
  fields: readonly string[]
  /**
   * Read only when every one of `fields` is absent from a rollup — the
   * narrower field an older rollup recorded the same meter under.
   */
  fallbackFields?: readonly string[]
  /**
   * Rollup fields recorded beside the meter so its sum is legible, forwarded
   * by `orgCogsInputFrom` and never priced.
   */
  recordedFields?: readonly string[]
  /**
   * The `ORG_COGS_UNIT_RATES_USD` key pricing one unit. Absent when the
   * fields are already dollars, which then enter the model at ×1.
   */
  rate?: string
  /**
   * The month's LIVE reading, when the rollup's figure is a snapshot a meter
   * keeps adding to: `orgs/{orgId}/{collection}/{month}`, the first of
   * `fields` that is a positive number. It replaces the axis's first rollup
   * field wherever a reader fetches it.
   */
  live?: { collection: string; fields: readonly string[] }
}

/** A band a plugin contributes to the utilization table. */
export interface PluginUsageBandDeclaration {
  /** The band's key, and the column the staff table shows it under. */
  id: string
  label: string
  order: number
  /** Rollup fields summed for what the org used. */
  fields: readonly string[]
  fallbackFields?: readonly string[]
  /** The resolved entitlement holding what the plan includes. */
  entitlement: string
  /** The entitlement is per SITE and the org-wide band is it × `hostLimit`. */
  perHost?: boolean
  /**
   * The band is sold in a unit of cost and the rollup records dollars: what
   * was used is `ceil(dollars / unitCostUsd)`, rounded UP so spend already
   * made never reads as less of the band.
   */
  unitCostUsd?: number
}

export type ResolvedPluginCostAxis = PluginCostAxisDeclaration & { pluginId: string }
export type ResolvedPluginUsageBand = PluginUsageBandDeclaration & { pluginId: string }

/** What a plugin's `usageAxes` function answers. */
export interface PluginUsageAxesDeclaration {
  costAxes?: readonly PluginCostAxisDeclaration[]
  bands?: readonly PluginUsageBandDeclaration[]
}

export function pluginCostAxes(): readonly ResolvedPluginCostAxis[] {
  return PLUGIN_COST_AXES_DECLARED
}

export function pluginUsageBands(): readonly ResolvedPluginUsageBand[] {
  return PLUGIN_USAGE_BANDS_DECLARED
}

/** A positive finite number, or 0 — the reading every meter is priced from. */
function meterValue(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/**
 * What a rollup recorded for a declared meter: `fields` summed, or
 * `fallbackFields` summed when the rollup carries none of `fields` at all.
 *
 * "Carries none" is `null` or absent, never zero. A rollup that measured
 * zero has answered, and must not fall back to a figure recorded under an
 * older, narrower basis.
 */
export function declaredMeterReading(
  source: Readonly<Record<string, unknown>> | null | undefined,
  declared: {
    fields: readonly string[]
    fallbackFields?: readonly string[]
  },
): number {
  const present = declared.fields.some((field) => source?.[field] != null)
  const fields =
    !present && declared.fallbackFields?.length
      ? declared.fallbackFields
      : declared.fields
  return fields.reduce((sum, field) => sum + meterValue(source?.[field]), 0)
}

/**
 * The live reading a cost axis names: the first of its `live.fields` that is
 * a positive number on the month's document, or `undefined` when none is.
 * `undefined` is "keep the rollup's snapshot", never zero.
 */
export function liveMeterReading(
  document: { get(field: string): unknown } | null | undefined,
  live: { fields: readonly string[] },
): number | undefined {
  for (const field of live.fields) {
    const value = meterValue(document?.get(field))
    if (value > 0) return value
  }
  return undefined
}

/** Every rollup field the declared cost axes read or record, in order. */
export function pluginCostAxisFields(): string[] {
  const fields: string[] = []
  for (const axis of PLUGIN_COST_AXES_DECLARED) {
    for (const field of [
      ...axis.fields,
      ...(axis.fallbackFields ?? []),
      ...(axis.recordedFields ?? []),
    ]) {
      if (!fields.includes(field)) fields.push(field)
    }
  }
  return fields
}
