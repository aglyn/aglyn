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

import { resolveAssistCreditBudget } from '@aglyn/aglyn/app-utils/assist-credits'
import {
  aiAddonName,
  hasAiAddon,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import {
  assistCeilingBreach,
  assistCogsAlertThresholdUsd,
  assistMarginBreach,
  assistMarginMultiple,
  assistOrgMonthlyCostLimitUsd,
} from '@aglyn/aglyn/app-utils/usage-budget'
import type { UsageAlertContext } from '@aglyn/aglyn/plugin-manager/usage-alert-contributors'

/**
 * The AI plugin's staff alerts on provider spend (AGL-2984), evaluated for
 * every org by the usage-alerts sweep through its usage alert contributor
 * seam. Two alerts, in this order, each deduped under its own guard key:
 *
 * - THE MARGIN GUARD warns. The meter caps an entitled org by MESSAGE count,
 *   and a month of long, cache-cold exchanges on a large model is a
 *   three-figure provider bill against a subscription that did not move. One
 *   org's spend crossing the review threshold tells staff, and every further
 *   whole multiple of the threshold tells them again, so an escalating cost
 *   never goes quiet because it already spoke.
 * - THE HARD CEILING reports a stop. Past the monthly spend ceiling the
 *   reservation refuses every assist request from the org, so its assistant
 *   has stopped answering, and staff are told so in those words. It cannot
 *   ride the margin guard: that one speaks in whole multiples of its
 *   threshold, so an org climbing from the threshold to the ceiling is still
 *   at 1x and says nothing. Announced once a month, because crossing is a
 *   state rather than an escalating sum.
 *
 * Both are STAFF alerts. The org is not charged for this spend and has done
 * nothing wrong, so mailing the customer about our cost would be alarming and
 * meaningless. Both read the spend figure the sweep built, record through the
 * sweep's guard and send through the sweep's senders, so the first-sweep
 * seeding and the run's report apply to them exactly as to core's alerts.
 */

/** The margin guard's key: the whole multiples announced this month. */
export const AI_MARGIN_GUARD_KEY = 'assistCogs'

/** The hard ceiling's key: announced once for the month. */
export const AI_CEILING_GUARD_KEY = 'assistCeiling'

/** Both alerts send staff to the org list. */
const STAFF_ORGS_LINK = '/admin/orgs'

/** Evaluates one org: the margin guard, then the hard ceiling. */
export async function evaluateAiUsageAlerts(
  context: UsageAlertContext,
): Promise<void> {
  await alertOnMarginGuard(context)
  await alertOnHardCeiling(context)
}

/** How both alerts name the org: its slug, or its id when it has none. */
function orgName({ orgSlug, orgId }: UsageAlertContext): string {
  return orgSlug ?? orgId
}

async function alertOnMarginGuard(context: UsageAlertContext): Promise<void> {
  const { org, month, spend } = context
  const thresholdUsd = assistCogsAlertThresholdUsd(
    process.env.ASSIST_ORG_MONTHLY_COGS_ALERT_USD,
  )
  // The guard records the whole multiple announced, which is 0 for a zero or
  // non-finite threshold — a reading the breach predicate never agrees to.
  const multiple = assistMarginMultiple(spend.assistUsd, thresholdUsd)
  const due = assistMarginBreach({
    assistUsd: spend.assistUsd,
    thresholdUsd,
    guard: context.guards[AI_MARGIN_GUARD_KEY],
    month,
  })
  if (!due || !context.recordAlert(AI_MARGIN_GUARD_KEY, multiple)) return

  const title = `Assist token spend is $${spend.assistUsd.toFixed(2)} for one org this month`
  // The add-on state and the band: the same dollar figure is a finding on an
  // org paying for the add-on and an incident on one that is not, and the
  // reader should not have to open the console to know which.
  const addonClause = hasAiAddon(org as never)
    ? `The ${aiAddonName()} add-on is on`
    : `The ${aiAddonName()} add-on is off`
  const bandCredits = resolveAssistCreditBudget(org as never)
  const bandClause =
    bandCredits === null
      ? 'no AI credit band'
      : `an AI credit band of ${bandCredits.toLocaleString()}`
  await context.alertStaff({
    quota: AI_MARGIN_GUARD_KEY,
    threshold: multiple,
    title,
    body:
      `${orgName(context)} has run about ` +
      `$${spend.assistUsd.toFixed(2)} of ${PLATFORM_BRAND_NAME} Assist ` +
      `tokens in ${month}, past the $${thresholdUsd.toFixed(0)} review ` +
      'threshold. Assist is a plan entitlement with no per-token ' +
      'price, so this is margin, not revenue. ' +
      `${addonClause}, with ${bandClause}.`,
    link: STAFF_ORGS_LINK,
    emailContext: 'assist-margin',
  })
}

async function alertOnHardCeiling(context: UsageAlertContext): Promise<void> {
  const { month, spend } = context
  // The same resolver the reservation refuses on, so the figure announced and
  // the figure enforced cannot drift apart.
  const ceilingUsd = assistOrgMonthlyCostLimitUsd(
    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD,
  )
  const due = assistCeilingBreach({
    assistUsd: spend.assistUsd,
    ceilingUsd,
    guard: context.guards[AI_CEILING_GUARD_KEY],
    month,
  })
  if (!due || !context.recordAlert(AI_CEILING_GUARD_KEY, 1)) return

  const ceiling = `$${Number(ceilingUsd).toFixed(0)}`
  await context.alertStaff({
    quota: AI_CEILING_GUARD_KEY,
    threshold: 1,
    title:
      `Assist is REFUSING ${orgName(context)} — the ` +
      `${ceiling} monthly spend ceiling is crossed`,
    body:
      `${orgName(context)} has run about ` +
      `$${spend.assistUsd.toFixed(2)} of ${PLATFORM_BRAND_NAME} Assist ` +
      `tokens in ${month}, past the ` +
      `${ceiling} ceiling. Every further ` +
      'Assist request from this organization is refused until the month ' +
      'rolls over — the assistant is not degraded or slowed, it is off. ' +
      'The customer keeps whatever messages their plan has left, and the ' +
      'refusal says so in its own words.',
    link: STAFF_ORGS_LINK,
    emailContext: 'assist-ceiling',
  })
}
