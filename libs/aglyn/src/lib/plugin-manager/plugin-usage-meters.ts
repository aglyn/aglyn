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
 * A METER A PLUGIN MEASURES IN THE MONTHLY USAGE SWEEP (AGL-3080).
 *
 * The usage sweep (`/api/billing/report-usage`) writes one rollup per
 * workspace and month — `orgs/{orgId}/usage/{month}` — and posts the month's
 * billed figure as one Stripe meter event. The platform's own meters (storage,
 * bandwidth, API requests, email) it measures itself. A plugin's meter it
 * cannot: the plugin owns the collection the usage is recorded in, the band
 * it is measured against and the price past the band.
 *
 * So the plugin registers a meter, and the sweep asks it once per workspace:
 * `measure` answers the fields the plugin writes onto the rollup — under the
 * names its usage axes declare, so the cost model and the utilization table
 * read them — and the dollars that enter the month's billed figure. The sweep
 * never learns what the meter counts or how it prices it, and the plugin
 * never edits the sweep.
 *
 * ## Declared, then registered, and refused when missing
 *
 * A meter is a runtime registration because measuring is code — a read of the
 * plugin's own storage, a band, a price. But a meter that failed to register
 * is money the sweep would silently stop billing, so the plugin also DECLARES
 * it (`usageAxes` → `meters`, compiled into the catalog file), and the sweep
 * refuses to report a workspace's month while a declared meter is missing:
 * the workspace fails loudly for this pass and is swept again tomorrow, which
 * is late and visible, where a month billed without the meter would be short
 * and final.
 *
 * ## A throw is the workspace's, not the sweep's
 *
 * `measure` throwing fails that workspace's pass the same way — a meter that
 * could not measure has no figure worth billing. `closeMonth` is different:
 * it settles what the plugin bills on its own, is logged when it fails, and
 * never costs the platform's own metering.
 */

import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import type { ReleaseFlagKey } from '../app-utils/release-flags'
import { PLUGIN_USAGE_METERS_DECLARED } from './first-party-plugins.generated'

/** What the sweep tells a meter about one workspace's month. */
export interface PluginUsageMeterContext {
  orgId: string
  /** The workspace document, as the sweep read it for every decision. */
  org: Readonly<Record<string, unknown>>
  /** `YYYY-MM`, the month being measured. */
  month: string
  /**
   * Whether the month has CLOSED. A closed month is the one an invoice is
   * about; an open one is measured daily for the budget and never billed.
   */
  closed: boolean
  /**
   * The month's rollup as it stood before this run — for a stock meter, the
   * last reading an earlier sweep stamped inside the month.
   */
  previous: Readonly<Record<string, unknown>>
  /**
   * A release flag's verdict for this workspace, resolved as the sweep
   * resolves every flag it gates billing on: bucketed by workspace, with its
   * overrides and its tier.
   */
  releaseFlagOn: (key: ReleaseFlagKey) => boolean
}

/** What a meter answers for one workspace's month. */
export interface PluginUsageMeterReading {
  /**
   * Written onto the month's rollup on every run, zeros included. A field the
   * platform writes itself is never overwritten.
   */
  fields: Readonly<Record<string, unknown>>
  /**
   * Written only while the month is OPEN — a stock meter's period-end reading,
   * which a closed sweep then bills from. Never written for a closed month,
   * so a re-run of a closed month reads the same input every time.
   */
  periodEndFields?: Readonly<Record<string, unknown>>
  /**
   * Dollars that enter the month's billed figure. Rounded to cents per meter,
   * like every plan-priced line beside it; 0 for a meter that bills nothing.
   */
  billedUsd: number
  /**
   * For a stock meter on a CLOSED month: `true` when the reading came from a
   * period-end stamp taken inside the month. The rollup's `stockBasis` is
   * `period-end` when any stock reading was.
   */
  periodEndBasis?: boolean
}

/** What a meter's close-out is told about one workspace's closed month. */
export interface PluginUsageMeterCloseContext extends PluginUsageMeterContext {
  /**
   * The workspace's Stripe customer, or `null` when it has none. Read only
   * when asked, so a close-out with nothing to settle costs no read.
   */
  stripeCustomerId: () => Promise<string | null>
}

/** A plugin's meter in the monthly usage sweep. */
export interface PluginUsageMeter {
  pluginId: string
  /** As the plugin's `usageAxes` declaration names it under `meters`. */
  id: string
  measure: (context: PluginUsageMeterContext) => Promise<PluginUsageMeterReading>
  /**
   * Called once per workspace for a CLOSED month, every day the sweep runs,
   * so a plugin that bills part of its usage itself can settle what is left
   * of it. Idempotent by the plugin's own records; errors are logged.
   */
  closeMonth?: (context: PluginUsageMeterCloseContext) => Promise<void>
}

const meters = new Map<string, PluginUsageMeter>()

const keyOf = (pluginId: string, id: string) => `${pluginId}:${id}`

/**
 * Registers a meter. Idempotent per plugin and id: the same pair again
 * replaces the earlier registration, so a declarations module evaluated twice
 * measures once. A meter with no owner, no id or no `measure` throws.
 */
export function registerPluginUsageMeter(
  meter: Omit<PluginUsageMeter, 'pluginId'> & { pluginId?: string },
): void {
  const pluginId = (getRegisteringPluginId() ?? meter.pluginId ?? '').trim()
  const id = String(meter.id ?? '').trim()
  if (!pluginId || !id) {
    throw new Error('a usage meter needs a pluginId and an id')
  }
  if (typeof meter.measure !== 'function') {
    throw new Error(`usage meter "${keyOf(pluginId, id)}" has no measure function`)
  }
  meters.set(keyOf(pluginId, id), {
    pluginId,
    id,
    measure: meter.measure,
    ...(typeof meter.closeMonth === 'function'
      ? { closeMonth: meter.closeMonth }
      : {}),
  })
}

/**
 * Every registered meter, in the order the sweep runs them: declared meters in
 * catalog order, then any other in registration order. The order is fixed so
 * two processes write one workspace's rollup the same way.
 */
export function listPluginUsageMeters(): PluginUsageMeter[] {
  const declared = PLUGIN_USAGE_METERS_DECLARED.map((one) =>
    keyOf(one.pluginId, one.id),
  )
  const rank = (key: string) => {
    const index = declared.indexOf(key)
    return index === -1 ? Number.MAX_SAFE_INTEGER : index
  }
  return [...meters.entries()]
    .map(([key, meter], sequence) => ({ key, meter, sequence }))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.sequence - b.sequence)
    .map(({ meter }) => ({ ...meter }))
}

/**
 * Every DECLARED meter nothing registered, as `pluginId:id`. The sweep refuses
 * to report a workspace's month while this is not empty.
 */
export function unregisteredPluginUsageMeters(): string[] {
  return PLUGIN_USAGE_METERS_DECLARED.map((one) =>
    keyOf(one.pluginId, one.id),
  ).filter((key) => !meters.has(key))
}

/** Test seam: forget every meter. */
export function resetPluginUsageMetersForTests(): void {
  meters.clear()
}
