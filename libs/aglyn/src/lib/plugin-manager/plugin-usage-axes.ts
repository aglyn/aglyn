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
 *    core's own bands. A METERED band is also billed past what the plan
 *    includes, at its published billed rate (cost + 30% kept after card
 *    fees), beside storage and bandwidth: the invoice sweep, the Billing
 *    card's estimate, the monthly summary and the staff usage rows read it
 *    from here.
 *  - a SPEND LINE names the month document holding what the plugin's usage
 *    came to at the rates it bills, the deployment variable naming the month
 *    it is first charged for, and the unit a customer sees it in. The usage
 *    budget shows it beside the metered figure and counts it once charged.
 *  - a METER names what the plugin measures in the monthly usage sweep
 *    (`plugin-usage-meters.ts`), so the sweep can refuse to bill a month the
 *    registered meter is missing from.
 *
 * ## What core keeps
 *
 * The MONEY. Every unit rate stays in `ORG_COGS_UNIT_RATES_USD`, beside the
 * billed table it is reconciled against (`METERED_UNIT_RATES_USD`, which a
 * metered band names its rate in), and every included figure stays in
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

import type { ReleaseFlagKey } from '../app-utils/release-flags'
import {
  PLUGIN_COST_AXES_DECLARED,
  PLUGIN_SPEND_LINES_DECLARED,
  PLUGIN_USAGE_BANDS_DECLARED,
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
   * Rollup fields the plugin's usage sweep writes beside the meter for its
   * staff surfaces to read — served on the staff usage rows, `null` where a
   * rollup never wrote one, and never forwarded to the cost model.
   */
  staffFields?: readonly string[]
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
  /**
   * The per-site monthly counter the band is measured by:
   * `hosts/{hostId}/counters/{hostCounter}`, field `{month}`, summed over the
   * workspace's sites.
   */
  hostCounter?: string
  /**
   * The WORKSPACE-wide monthly counter the band is enforced against:
   * `orgs/{orgId}/counters/{orgCounter}`, field `{month}` (AGL-3472). Declared
   * by a band whose runtime counts every unit on the org's counter as well as
   * on the site's, in one write, so a workspace-wide band is held to every
   * site's use rather than handed to each site whole. The Billing card meters
   * the band once for the organization from it, where a band without one is
   * metered per site. The usage sweep and alerts still sum `hostCounter`,
   * which the same write moves.
   */
  orgCounter?: string
  /**
   * The workspace is WARNED as it approaches and reaches this band, by the
   * usage-alerts sweep, from its `hostCounter` against what the plan includes
   * of `entitlement`, once per threshold per month. `label` names the band in
   * the title ("monthly workflow runs") and `noun` in the opening sentence
   * ("workflow runs"); `outcome` is what happens at the band — `stops`,
   * `bills` or `continues` — and `reached` and `approach` are the sentences
   * that say so, at the band and approaching it.
   */
  alert?: {
    label: string
    noun: string
    outcome: 'stops' | 'bills' | 'continues'
    reached: string
    approach: string
  }
  /**
   * The console's quota banner WARNS an organization-wide reader on every
   * console page as the workspace approaches and reaches this band
   * (AGL-2898, AGL-3080). `standing` is a console API path the plugin
   * serves, asked `?orgId=` with the reader's token, that answers the
   * band's standing in its own unit under `member` — `{ used, limit }`,
   * `limit: null` for a plan with no band, which is no row — and
   * `stopsAtBand`: whether reaching it stops the feature (the reading when
   * the route does not say) or bills past it. `approach` is the sentence
   * above 80%; `reached.stops` and `reached.bills` the two at the band.
   * `linksUsage` says the sentences name Billing → Usage, and the banner
   * offers the link.
   *
   * A route, not a counter: a band's meter may be one no client may read,
   * and the route answers in the unit the customer was sold.
   */
  consoleWarning?: {
    standing: string
    member: string
    approach: string
    reached: { stops: string; bills: string }
    linksUsage?: boolean
  }
  /**
   * The band is one of the INFRASTRUCTURE meters (AGL-1280): what the
   * workspace uses past it is billed at its published billed rate (cost +
   * 30% kept after card fees), beside storage and bandwidth, on the same
   * invoice line and the same estimate.
   * A metered band names one rollup field and the `hostCounter` it is
   * measured by.
   */
  metered?: PluginMeteredBand
}

/** How a metered band is priced, quoted and withheld. */
export interface PluginMeteredBand {
  /**
   * The `METERED_UNIT_RATES_USD` key holding our cost per unit — never a
   * number: the rate table is the platform's, beside the markup it is
   * published with.
   */
  rate: string
  /** The count a published price is quoted per: `1000` reads "per 1,000". */
  quotedPer: number
  /** The band in running prose, plural and lowercase: "form submissions". */
  noun: string
  /**
   * A release flag the overage waits behind: while it is off for the
   * workspace, the units are counted and the charge is recorded as withheld
   * rather than billed — nobody is charged for what they cannot reach
   * (AGL-1604). The rollup records the verdict as `{field}Billed` and what
   * was forgone, at cost, as `{field}OverageWithheldUsd`.
   */
  withheldUntil?: ReleaseFlagKey
}

/**
 * A line of a workspace's monthly SPEND a plugin contributes to its usage
 * budget (`usage-budget.ts`): what the plugin's usage came to this month, in
 * the dollars it is billed at, shown on the customer's budget card and
 * counted toward the budget from the month the plugin starts charging for it.
 */
export interface PluginSpendLineDeclaration {
  /** The line's key. */
  id: string
  /** What the budget card and the budget alert call it. */
  label: string
  /**
   * Where the month's figure is read: `orgs/{orgId}/{collection}/{month}`,
   * field `field`, in dollars.
   */
  live: { collection: string; field: string }
  /**
   * The deployment variable naming the first month (`YYYY-MM`) the line is
   * charged for. Until it names this month or an earlier one — and on any
   * value that is not a month — the line is shown and never counted.
   */
  billedFromEnv: string
  /**
   * The unit the customer is shown the line in, when the stored dollars are
   * not theirs to see: `ceil(dollars / costUsd)` of `label`, and the dollar
   * figure never crosses to the browser.
   */
  unit?: { costUsd: number; label: string }
}

/**
 * A meter the plugin measures in the platform's monthly usage sweep and
 * registers at runtime (`plugin-usage-meters.ts`). Declared as well as
 * registered so the sweep can refuse to bill a workspace's month without it.
 */
export interface PluginUsageMeterDeclaration {
  /** As `registerPluginUsageMeter` names it. */
  id: string
}

export type ResolvedPluginCostAxis = PluginCostAxisDeclaration & { pluginId: string }
export type ResolvedPluginUsageBand = PluginUsageBandDeclaration & { pluginId: string }
export type ResolvedPluginSpendLine = PluginSpendLineDeclaration & { pluginId: string }
export type ResolvedPluginUsageMeter = PluginUsageMeterDeclaration & { pluginId: string }

/** What a plugin's `usageAxes` function answers. */
export interface PluginUsageAxesDeclaration {
  costAxes?: readonly PluginCostAxisDeclaration[]
  bands?: readonly PluginUsageBandDeclaration[]
  spendLines?: readonly PluginSpendLineDeclaration[]
  meters?: readonly PluginUsageMeterDeclaration[]
}

export function pluginCostAxes(): readonly ResolvedPluginCostAxis[] {
  return PLUGIN_COST_AXES_DECLARED
}

export function pluginUsageBands(): readonly ResolvedPluginUsageBand[] {
  return PLUGIN_USAGE_BANDS_DECLARED
}

/** A declared band that is metered, with its one field and its counter. */
export type ResolvedPluginMeteredBand = ResolvedPluginUsageBand & {
  metered: PluginMeteredBand
  hostCounter: string
}

/**
 * Every band billed at cost past what the plan includes, in band order — the
 * infrastructure meters a plugin adds beside storage and bandwidth.
 */
export function meteredPluginBands(): readonly ResolvedPluginMeteredBand[] {
  return PLUGIN_USAGE_BANDS_DECLARED.filter(
    (band): band is ResolvedPluginMeteredBand =>
      Boolean(band.metered && band.hostCounter),
  )
}

/** A declared band measured by a per-site counter and never billed past it. */
export type ResolvedPluginCountedBand = ResolvedPluginUsageBand & {
  hostCounter: string
}

/**
 * Every band measured by a per-site counter and not metered, in band order:
 * the usage sweep sums each across the workspace's sites and records it under
 * the band's first field, and the staff usage rows show the count. A metered
 * band's counter is read with the infrastructure meters instead.
 */
export function countedPluginBands(): readonly ResolvedPluginCountedBand[] {
  return PLUGIN_USAGE_BANDS_DECLARED.filter(
    (band): band is ResolvedPluginCountedBand =>
      Boolean(band.hostCounter && !band.metered),
  )
}

/** A declared band kept on a workspace-wide counter. */
export type ResolvedPluginOrgCountedBand = ResolvedPluginUsageBand & {
  orgCounter: string
}

/**
 * Every band with a workspace-wide counter (`orgCounter`), in band order: the
 * bands the Billing card meters once for the organization, from the counter
 * the band is enforced against.
 */
export function orgCountedPluginBands(): readonly ResolvedPluginOrgCountedBand[] {
  return PLUGIN_USAGE_BANDS_DECLARED.filter(
    (band): band is ResolvedPluginOrgCountedBand => Boolean(band.orgCounter),
  )
}

/** The rollup field a metered band records its count under. */
export function meteredBandField(band: ResolvedPluginMeteredBand): string {
  return band.fields[0]!
}

/**
 * Where the rollup records a withheld band's verdict (`metered.withheldUntil`):
 * whether the month billed the band's overage, and what was forgone, at cost,
 * when it did not. Without the second a withheld month reads as a month that
 * stayed inside the band.
 */
export function meteredBandVerdictFields(band: ResolvedPluginMeteredBand): {
  billed: string
  withheldUsd: string
} {
  const field = meteredBandField(band)
  return { billed: `${field}Billed`, withheldUsd: `${field}OverageWithheldUsd` }
}

export function pluginSpendLines(): readonly ResolvedPluginSpendLine[] {
  return PLUGIN_SPEND_LINES_DECLARED
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

/**
 * A month's rollup as a staff reader is served it, one entry per field the
 * declared cost axes read, record or serve to staff (`get` reads one rollup
 * field).
 *
 * A field an axis prices reads zero where the rollup lacks it, as the cost
 * model reads it — except where the axis falls back to an older basis when
 * the rollup carries none of its fields: there absence is the answer that
 * selects the fallback, so it is served as `null`, and a reader pricing the
 * served row reads the month the way the sweep did. A field an axis only
 * records or serves reads `null` when the rollup never wrote it: "not
 * recorded" and "recorded zero" are different answers, and a projection
 * that collapses them invents history (AGL-2321).
 */
export function pluginCostAxisProjection(
  get: (field: string) => unknown,
): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const axis of PLUGIN_COST_AXES_DECLARED) {
    const absentIsNull = [
      ...(axis.fallbackFields?.length ? axis.fields : []),
      ...(axis.recordedFields ?? []),
      ...(axis.staffFields ?? []),
    ]
    for (const field of [
      ...axis.fields,
      ...(axis.fallbackFields ?? []),
      ...(axis.recordedFields ?? []),
      ...(axis.staffFields ?? []),
    ]) {
      if (field in out) continue
      const value = get(field)
      out[field] =
        value != null ? Number(value) : absentIsNull.includes(field) ? null : 0
    }
  }
  return out
}
