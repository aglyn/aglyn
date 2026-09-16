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
 * A METER LINE A PLUGIN BILLS FOR ITSELF (AGL-3011).
 *
 * The monthly usage sweep prices several lines into one figure and posts it
 * as a single Stripe meter event. A plugin that bills one of those lines its
 * own way — charging it as it accrues, say — must have that line LEFT OUT of
 * the meter figure from the month it takes over, or the customer is billed
 * for it twice.
 *
 * That claim is what this registry holds: a line id, the plugin that owns
 * the billing of it, and the first month from which the plugin bills it. The
 * sweep asks by line id and gets a yes or a no. It never learns how the
 * plugin bills, and the plugin never edits the sweep.
 *
 * ## Only the billing moves, never the measurement
 *
 * A claimed line is still measured, still priced and still written to the
 * month's audit fields. What changes is whether its dollars enter the figure
 * the meter event carries. "We stopped billing it here" and "we stopped
 * counting it" must stay different facts, or a claim would erase a month of
 * usage history along with its invoice line.
 *
 * ## Unclaimed is the safe answer
 *
 * A line nobody claimed, a month before the claim's start, an unparseable
 * start month and a plugin that failed to register all answer the same way:
 * the sweep bills the line as it always has. Every failure mode therefore
 * bills through the channel that already works, rather than through neither.
 */

import { getRegisteringPluginId } from '../app-utils/registering-plugin'

/** One plugin's claim on one line. */
export interface PluginMeteredLineClaim {
  /**
   * The line the sweep knows, e.g. the assist-overage line. Core's own name
   * for a figure it already computes — not a plugin's internal name for it.
   */
  lineId: string
  /** The plugin that bills it. */
  pluginId: string
  /**
   * The first month (`YYYY-MM`) the plugin bills the line for, or `null`
   * while the plugin has registered the claim but not yet been switched on.
   *
   * A function rather than a value because the answer comes from deployment
   * configuration that can change without a restart, and because a claim
   * evaluated once at boot would pin the cutover to whenever the process
   * happened to start.
   */
  billsFrom: () => string | null
  /**
   * Called once per workspace for a month this sweep has CLOSED, so a plugin
   * billing the line can settle what is left of it.
   *
   * A plugin that charges as usage accrues always has a remainder: the part
   * that never reached its threshold before the month ended. Something has to
   * bill that, and the sweep that closes the month is the one thing that
   * already knows every workspace, its month and its Stripe customer — which
   * is why this is a hook here rather than a second cron with a second
   * schedule to keep in step with this one.
   *
   * Called whether or not the meter reported for the workspace, because the
   * remainder is owed either way. Errors are logged and never the sweep's:
   * this is money the plugin bills, and failing the platform's own metering
   * over it would be the larger loss. A plugin makes it idempotent; it is
   * called again every day the sweep runs.
   */
  closeMonth?: (context: PluginMeteredLineMonthContext) => Promise<void>
}

/** What a plugin is told about one workspace's closed month. */
export interface PluginMeteredLineMonthContext {
  orgId: string
  /** `YYYY-MM`, the month that closed. */
  month: string
  /** The workspace's own document, as the sweep already read it. */
  org: Record<string, unknown>
  /** Its Stripe customer, or `null` when it has none. */
  stripeCustomerId: string | null
}

const claims = new Map<string, PluginMeteredLineClaim>()

/**
 * Claims a meter line. One plugin per line: a second plugin claiming a line
 * another already holds throws, because two plugins each believing they bill
 * a line is how it reaches no invoice at all.
 *
 * The same plugin re-registering replaces its own claim, so a module
 * evaluated twice leaves one claim rather than two.
 */
export function registerPluginMeteredLine(
  claim: Omit<PluginMeteredLineClaim, 'pluginId'> & { pluginId?: string },
): void {
  const pluginId = (getRegisteringPluginId() ?? claim.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(
      `metered line "${claim.lineId}" claimed with no owner: pass ` +
        '{ pluginId } when registering outside a plugin register fn',
    )
  }
  const held = claims.get(claim.lineId)
  if (held && held.pluginId !== pluginId) {
    throw new Error(
      `metered line "${claim.lineId}" is already billed by plugin ` +
        `"${held.pluginId}"; "${pluginId}" cannot claim it too`,
    )
  }
  claims.set(claim.lineId, {
    lineId: claim.lineId,
    pluginId,
    billsFrom: claim.billsFrom,
    closeMonth: claim.closeMonth,
  })
}

/**
 * Does a plugin bill this line for this month, so the sweep must leave it
 * out of the meter figure?
 *
 * A claim whose `billsFrom` throws answers `false` and logs: the sweep is
 * the only thing that bills the line while a claim is broken, and a throw
 * that propagated would fail the whole month's billing for every workspace.
 */
export function pluginBillsMeteredLine(lineId: string, month: string): boolean {
  const claim = claims.get(lineId)
  if (!claim) return false
  let from: string | null
  try {
    from = claim.billsFrom()
  } catch (error) {
    console.error(`[plugins] ${claim.pluginId} failed to answer for ${lineId}`, error)
    return false
  }
  const start = String(from ?? '').trim()
  if (!/^\d{4}-\d{2}$/.test(start)) return false
  if (!/^\d{4}-\d{2}$/.test(month)) return false
  // Zero-padded fixed-width `YYYY-MM` orders identically as a string and as
  // a date; the format checks above are what make that true rather than
  // lucky. The same comparison `billsEmailSendOverage` makes on its own gate.
  return month >= start
}

/**
 * Runs the claiming plugin's close-out for one workspace's closed month.
 *
 * `false` when no plugin claims the line, when it does not bill this month,
 * or when it registered no close-out — three different "nothing happened"s
 * that the sweep does not need to tell apart, and the plugin is the only
 * thing that could.
 */
export async function runPluginMeteredLineClose(
  lineId: string,
  context: PluginMeteredLineMonthContext,
): Promise<boolean> {
  const claim = claims.get(lineId)
  if (!claim?.closeMonth) return false
  if (!pluginBillsMeteredLine(lineId, context.month)) return false
  try {
    await claim.closeMonth(context)
    return true
  } catch (error) {
    console.error(
      `[plugins] ${claim.pluginId} failed to close ${lineId} for ${context.orgId}`,
      error,
    )
    return false
  }
}

/** The plugin billing a line, for diagnostics and staff readouts. */
export function pluginMeteredLineOwner(lineId: string): string | null {
  return claims.get(lineId)?.pluginId ?? null
}

/** Test seam: forget every claim. */
export function resetPluginMeteredLinesForTests(): void {
  claims.clear()
}
