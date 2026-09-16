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
 * THE CUTOVER (AGL-3011): one switch, and everything hangs off it.
 *
 * `AI_OVERAGE_INVOICED_FROM` names the first month (`YYYY-MM`) in which AI
 * overage is billed by invoice as it accrues. Unset — which is how it ships
 * — every workspace behaves exactly as it does today: overage accrues, the
 * monthly sweep prices it into the meter event, and the renewal invoice
 * bills it. Nothing charges mid-period and nothing new refuses.
 *
 * ## Why the GUARDS are behind the same switch as the charging
 *
 * The unpaid bound refuses a workspace whose accrued overage has not been
 * paid for. Before cutover nothing charges, so nothing is ever paid for, so
 * every workspace past $50 of overage would be refused with no invoice to
 * pay and no way to clear it. A bound with no way to settle is not a bound,
 * it is a wall — and a wall nobody agreed to.
 *
 * So the guards read this same switch. Turning it on turns on the charging
 * and the guards together, which is the only combination in which each one
 * makes sense.
 *
 * ## Why it is a month and not a boolean
 *
 * The meter and the invoice must never both bill one month's overage. A
 * month is the unit the meter reports in, so a month is the unit the handover
 * has to be expressed in: everything before the named month bills through the
 * meter exactly as it always did, and everything from it bills by invoice.
 * A boolean flipped mid-month would split one month's overage across both
 * channels and bill part of it twice.
 */

import { registerPluginMeteredLine } from '@aglyn/aglyn/plugin-manager/plugin-metered-lines'
import { AI_PLUGIN_ID } from '../constants'

/**
 * Core's own name for the AI overage line in the monthly usage sweep. The
 * sweep asks the registry by this id; the plugin answers.
 */
export const AI_OVERAGE_METER_LINE_ID = 'assist-overage'

/** The environment variable that starts mid-period charging. */
export const AI_OVERAGE_INVOICED_FROM_ENV = 'AI_OVERAGE_INVOICED_FROM'

const MONTH = /^\d{4}-\d{2}$/

/**
 * The configured cutover month, or `null` when there is none.
 *
 * Read on every call rather than cached, so setting the variable takes
 * effect without a restart and a process that started before it was set is
 * not stuck a month behind.
 *
 * An unparseable value is `null`, not an error: a typo must leave the
 * platform billing through the channel that works, not stop billing.
 */
export function aiOverageInvoicedFrom(): string | null {
  const raw = String(process.env[AI_OVERAGE_INVOICED_FROM_ENV] ?? '').trim()
  return MONTH.test(raw) ? raw : null
}

/**
 * Is AI overage billed by invoice — rather than through the monthly meter —
 * for this month?
 *
 * `YYYY-MM` is zero-padded and fixed width, so it orders identically as a
 * string and as a date; the format checks are what make that true rather
 * than lucky.
 */
export function aiOverageBillsByInvoice(month: string): boolean {
  const from = aiOverageInvoicedFrom()
  if (!from) return false
  if (!MONTH.test(month)) return false
  return month >= from
}

/**
 * Are the overage guards live for this month?
 *
 * The same answer as `aiOverageBillsByInvoice`, given its own name because
 * it is asked for a different reason and a reader of the gate should not
 * have to work out why the gate consults a billing question. If the two ever
 * need to differ, this is where that would be said — and it would need a
 * paragraph explaining how a workspace refused for unpaid overage is
 * supposed to pay it.
 */
export function aiOverageGuardsApply(month: string): boolean {
  return aiOverageBillsByInvoice(month)
}

/**
 * Claims the meter line, so the monthly sweep leaves AI overage out of the
 * figure it meters from the cutover month on.
 *
 * Registered from the plugin's server declarations, at boot, because the
 * sweep is a core cron that never loads an AI door. Idempotent by the
 * registry's own rule: the same plugin re-claiming replaces its claim.
 */
export function registerAiOverageMeteredLine(): void {
  registerPluginMeteredLine({
    lineId: AI_OVERAGE_METER_LINE_ID,
    pluginId: AI_PLUGIN_ID,
    billsFrom: aiOverageInvoicedFrom,
    // Loaded on the first closed month rather than at boot, so the console's
    // every process does not carry the Stripe path for a sweep that runs
    // once a day in one of them.
    closeMonth: async (context) => {
      const { closeAiOverageMonth } = await import('./ai-overage-close')
      await closeAiOverageMonth(context)
    },
  })
}
