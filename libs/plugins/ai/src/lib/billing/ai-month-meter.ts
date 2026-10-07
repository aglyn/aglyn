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

import {
  ASSIST_PROVIDER_COST_FIELD,
  assistMonthOverage,
  assistProviderCostUsd,
} from '../usage/assist-credits'
import type {
  PluginUsageMeterCloseContext,
  PluginUsageMeterContext,
  PluginUsageMeterReading,
} from '@aglyn/aglyn/plugin-manager/plugin-usage-meters'
import { aiOverageBillsByInvoice } from './ai-overage-cutover'
import { aiOverageFirestore } from './ai-overage-trigger'
import {
  ASSIST_RETURNED_USD_FIELD,
  assistSpendAfterReturnsUsd,
} from '../usage/assist-credit-returns'

/**
 * One workspace's month of Aglyn Assist, as the usage sweep records and bills
 * it (AGL-2280, AGL-2653, AGL-3011).
 *
 * THE SPEND is recorded and never billed. `assistCostUsd` is the provider
 * figure of the two the month's document keeps (AGL-3015) — what the tokens
 * cost US, at the provider's rates — and enters the cost model at ×1 through
 * this plugin's cost axis, because the discount guardrail's whole job is to
 * compare revenue with what a workspace costs. On the invoice it would charge
 * for what the subscription already bought.
 *
 * THE OVERAGE is billed. The credits past the plan's band were sold at the
 * plan's per-1,000 rate, so they enter the month's billed figure beside the
 * platform's plan-priced overages. One derivation — `assistMonthOverage` turns
 * the BILLED spend (`estCostUsd`) into credits, subtracts the band the
 * workspace resolves to and prices the rest — so the customer's meter and this
 * line cannot disagree about what was over. The workspace's hard-cap switch is
 * not read here: it lives at the gate, and reading it at sweep time would let a
 * flip on the 1st erase a month's overage.
 *
 * From the month `AI_OVERAGE_INVOICED_FROM` names, the overage is billed by
 * invoice as it accrues instead, and leaves the meter figure so one month's
 * usage reaches exactly one invoice. It is still priced and recorded either
 * way, so a month billed through the other channel never reads as a month
 * inside its band.
 */
export async function measureAiMonth(
  context: PluginUsageMeterContext,
): Promise<PluginUsageMeterReading> {
  const snapshot = await aiOverageFirestore()
    .collection('orgs')
    .doc(context.orgId)
    .collection('assistUsage')
    .doc(context.month)
    .get()
  const assistCostUsd = assistProviderCostUsd(
    snapshot.get('estCostUsd'),
    snapshot.get(ASSIST_PROVIDER_COST_FIELD),
  )
  // The credits drawn are net of any given back (AGL-3595): a give-back is
  // compensation, and billing the credits it returned would take it back.
  // The provider figure above is not — that money was spent.
  const overage = assistMonthOverage(
    context.org as never,
    assistSpendAfterReturnsUsd(
      snapshot.get('estCostUsd'),
      snapshot.get(ASSIST_RETURNED_USD_FIELD),
    ),
  )
  const billedByInvoice = aiOverageBillsByInvoice(context.month)
  const meteredUsd = billedByInvoice ? 0 : overage.overageMonthlyUsd
  return {
    fields: {
      assistCostUsd,
      // The credit view of the same month: what was drawn, the band it was
      // drawn against (`null` where the plan sells none), the part past it
      // and the rate it was priced at. Recorded always, zeros included, so a
      // month inside its band is legible as one.
      assistCredits: overage.usedCredits,
      assistCreditsBand: overage.bandCredits,
      assistCreditsOverage: overage.overageCredits,
      assistOverageUsd: overage.overageMonthlyUsd,
      assistOverageRateUsd: overage.overageRateUsd,
      // What entered the meter figure, and whether the invoice channel took
      // it instead — countable from the rows rather than inferred from a
      // deployment variable.
      assistOverageMeteredUsd: meteredUsd,
      assistOverageBilledByPlugin: billedByInvoice,
    },
    billedUsd: meteredUsd,
  }
}

/**
 * The close-out of a month whose overage is billed by invoice: the remainder
 * that never reached the charge threshold, reconciled and invoiced
 * (`ai-overage-close.ts`). Before the cutover month there is nothing of this
 * plugin's to settle, and the workspace's billing document is never read.
 */
export async function closeAiMonth(
  context: PluginUsageMeterCloseContext,
): Promise<void> {
  if (!aiOverageBillsByInvoice(context.month)) return
  const { closeAiOverageMonth } = await import('./ai-overage-close')
  await closeAiOverageMonth({
    orgId: context.orgId,
    month: context.month,
    org: context.org,
    stripeCustomerId: await context.stripeCustomerId(),
  })
}
