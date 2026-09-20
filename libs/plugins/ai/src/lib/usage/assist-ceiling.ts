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
  assistBandRefuses,
  resolveAssistBudgetUsd,
} from '@aglyn/aglyn/app-utils/assist-credits'
import { isUncappedPlanComp } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  assistOperatorCeilingUsd,
  assistOrgMonthlyCostLimitUsd,
} from '@aglyn/aglyn/app-utils/usage-budget'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'

/*
 * THE MONTHLY DOLLAR CEILING an assist reservation is measured against, apart
 * from the reservation itself: pure arithmetic over the org document and the
 * operator's setting, with nothing that writes. The reservation resolves it
 * before its transaction opens, and the staff alert that announces a refusal
 * reads the same composition, so the figure announced is the figure enforced.
 */

/**
 * The ceiling one reservation is actually measured against, given the org's
 * plan band.
 *
 * ## Why the repo default must not bind an org that has a band
 *
 * `ASSIST_ORG_MONTHLY_COGS_LIMIT_DEFAULT_USD` (in `usage-budget.ts`, beside
 * the alert that announces the ceiling) is $40, which was sized as a
 * runaway guard back when every org's assist spend was bounded by a message
 * cap. It is BELOW what Agency and Enterprise include, so applying it to a
 * plan band would refuse those workspaces partway through capacity they are
 * paying for. The rule is not about which tiers happen to clear $40 today: a
 * band that is sold is a product limit, and a default nobody typed is not
 * allowed to undercut one at any size.
 *
 * ## Why an operator's explicit figure still does
 *
 * A self-hoster paying their own provider bill, or an operator responding to
 * an incident, sets `ASSIST_ORG_MONTHLY_COGS_LIMIT_USD` on purpose. The lower
 * of the two wins there, because that is what setting it means.
 *
 * `off` removes the operator's ceiling and does NOT remove a plan band: the
 * word turns off a backstop, and the band is not one.
 *
 * An org with no band (`budgetUsd === null`) is unchanged in every case: it
 * gets exactly the ceiling it got before, default and all. Since AGL-3203
 * every plan row carries a band, so this is an org whose band was overridden
 * to zero rather than a tier that sells none.
 *
 * ## When the band is a line rather than a wall (AGL-2653)
 *
 * `bandRefuses` is `assistBandRefuses(org)`: false on a plan that sells
 * credits past its band unless the org's `assistOverage.hardCap` is on. A
 * band that does not refuse is not a ceiling, so it drops out of the
 * composition and the operator's explicit figure is the only thing left that
 * can bind — the repo default stays off, for the reason above, and `off`
 * leaves nothing. The message cap is still there either way, so a workspace
 * buying overage is bounded by messages a month rather than by nothing; the
 * overage it buys is priced by `report-usage` at the plan's rate.
 *
 * ## An uncapped staff comp (AGL-3049)
 *
 * `uncapped` is `isUncappedPlanComp(org)`. Its band resolves `null` — there
 * is no band — but it is not a workspace that was never sold one, so the
 * repo default must not stand in for a band here any more than it may
 * undercut a sold one: a $40 wall on the workspace staff uncapped is exactly
 * the cap uncapping removes. It composes like a band that does not refuse:
 * the operator's explicit figure binds, because that is an incident
 * decision about every workspace, and nothing else does. The message cap
 * still applies, as it does to every entitled workspace.
 */
export function assistMonthlyCeilingUsd(
  budgetUsd: number | null,
  bandRefuses = true,
  uncapped = false,
): number | null {
  const configured = process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD
  if (uncapped) {
    const operator = assistOperatorCeilingUsd(configured)
    return typeof operator === 'number' ? operator : null
  }
  if (budgetUsd === null) return assistOrgMonthlyCostLimitUsd(configured)
  const operator = assistOperatorCeilingUsd(configured)
  if (!bandRefuses) return typeof operator === 'number' ? operator : null
  return typeof operator === 'number'
    ? Math.min(budgetUsd, operator)
    : budgetUsd
}

/**
 * The dollar ceiling this org's reservations refuse at that is NOT its own
 * band, or `null` where none applies — the operator backstop as it binds
 * this workspace.
 *
 * A reservation measured against a band that refuses is the workspace's own
 * product limit, refused as `band` and told to the customer by the credits
 * alert. Every other finite ceiling the reservation compares against is a
 * backstop, refused as `budget`, and that is the stop staff are told about.
 * Which one applies is `assistMonthlyCeilingUsd`'s decision, so:
 *
 *  - a workspace with no band gets the repo default or the operator's figure;
 *  - a band sold past, or an uncapped staff comp (AGL-3049), gets only an
 *    operator's explicit figure, and nothing when none is set;
 *  - a band that is a wall gets the operator's figure only where it sits
 *    below the band, because only then is the operator's figure what refuses.
 */
export function assistBackstopCeilingUsd(
  org: Partial<AglynOrgBilling> | null | undefined,
): number | null {
  const budgetUsd = resolveAssistBudgetUsd(org)
  const bandRefuses = assistBandRefuses(org)
  const ceilingUsd = assistMonthlyCeilingUsd(
    budgetUsd,
    bandRefuses,
    isUncappedPlanComp(org),
  )
  const ceilingIsBand =
    bandRefuses && budgetUsd !== null && ceilingUsd === budgetUsd
  return ceilingIsBand ? null : ceilingUsd
}
