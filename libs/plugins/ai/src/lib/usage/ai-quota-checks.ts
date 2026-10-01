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
  ASSIST_HARD_CAP_CONTROL_LABEL,
  ASSIST_HARD_CAP_CONTROL_LOCATION,
  assistBandRefuses,
  assistCreditsFromUsd,
  resolveAssistCreditBudget,
  resolveAssistHardCap,
  resolveAssistOverageRateUsdPer1k,
} from './assist-credits'
import type {
  UsageQuotaCheck,
  UsageQuotaContext,
} from '@aglyn/aglyn/plugin-manager/usage-alert-contributors'
import { AI_ASSIST_SPEND_LINE_ID } from '../usage-axes'

/** The guard key the credits band is warned under. */
export const AI_CREDITS_QUOTA_KEY = 'assistCredits'

/**
 * The AI credits band the WORKSPACE is warned about (AGL-2898), as a quota
 * check the usage-alerts sweep runs beside its own.
 *
 * Measured in CREDITS — the unit the customer was sold and the meter shows —
 * from this plugin's line of the month's spend (the billed `estCostUsd`)
 * through the one conversion, so this alert and the Billing meter cannot
 * disagree about how far into the band the org is. A plan with no band
 * resolves `null` and reads as a limit of 0, which the sweep skips the way it
 * skips Free's zero-quota dimensions.
 *
 * Approaching the band is the sweep's generic warning; REACHING it says what
 * happens next, which differs by plan and by the org's own controls — metered
 * at a rate unless a stop is set, or stopped until next month with nothing
 * ever billed — and telling a Free org to "set a monthly cap" on a charge it
 * can never incur would be the surprise bill in reverse.
 */
export async function aiQuotaChecks(
  context: UsageQuotaContext,
): Promise<readonly UsageQuotaCheck[]> {
  const org = context.org as never
  const bandCredits = resolveAssistCreditBudget(org)
  const spentUsd =
    context.spend.lines.find((line) => line.id === AI_ASSIST_SPEND_LINE_ID)
      ?.usd ?? 0
  // Whether crossing the band produces an invoice line or a stop. The same
  // predicate the reservation refuses on, so the words and the behavior
  // cannot drift: a band that refuses — the org's own switch, or a plan with
  // no rate — is a wall, and everything else is sold past.
  const bandIsWall = assistBandRefuses(org)
  // Through the same resolver `assistBandRefuses` asks, so the alert's rate
  // and its wall/sold verdict cannot disagree about one org. Read straight off
  // `PLAN_PRICING` they did: Starter's listed rate is null and the add-on's is
  // added by the resolver, so a Starter workspace with the add-on was told
  // "sold past the band" at "$0.00 per 1,000" in the same sentence (AGL-3014).
  const rateUsdPer1k = resolveAssistOverageRateUsdPer1k(org)
  const rate = `$${(rateUsdPer1k ?? 0).toFixed(2)} per 1,000`
  return [
    {
      key: AI_CREDITS_QUOTA_KEY,
      label: 'AI assist credits',
      noun: 'AI assist credits',
      used: assistCreditsFromUsd(spentUsd),
      limit: bandCredits ?? 0,
      cadence: 'monthly',
      outcome: bandIsWall ? 'stops' : 'bills',
      reachedTitle: bandIsWall
        ? "You've used your included AI assist credits"
        : "You've used your included AI assist credits — extra credits " +
          'are now billed',
      reached: bandIsWall
        ? 'AI assist stops here until next month — nothing past the band ' +
          'is ever billed. Upgrade in Billing to add credits' +
          (resolveAssistHardCap(org) && rateUsdPer1k !== null
            ? `, or turn off "${ASSIST_HARD_CAP_CONTROL_LABEL}" ` +
              `under ${ASSIST_HARD_CAP_CONTROL_LOCATION} to keep ` +
              `going at your plan’s rate.`
            : '.')
        : 'The assistant keeps answering, and the extra credits are ' +
          `metered on your monthly invoice at ${rate} — unless you set a ` +
          `stop under ${ASSIST_HARD_CAP_CONTROL_LOCATION}: stop at the ` +
          'included band, or stop once this month’s overage reaches a ' +
          'figure you choose.',
      approach: bandIsWall
        ? 'Nothing changes and nothing is charged — at the included band, ' +
          'AI assist stops until next month, and nothing past it is ever ' +
          'billed.'
        : 'Nothing is charged yet — past the included band, extra credits ' +
          `are metered on your monthly invoice at ${rate} unless you set a ` +
          `stop under ${ASSIST_HARD_CAP_CONTROL_LOCATION}.`,
    },
  ]
}
