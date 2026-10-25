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

import { planLabelGrantingQuota } from '@aglyn/aglyn'

/**
 * The `reason` a campaign refusal carries when the plan's monthly campaign
 * allowance is what stopped it, so the console can answer with an upgrade
 * path instead of matching on the sentence.
 */
export const CAMPAIGN_PLAN_CAP_REASON = 'campaign-plan-cap'

/** Why the plan stops this campaign, when it does. */
export type CampaignPlanLockKind =
  /** The plan includes no campaign email at all (Free, Starter). */
  | 'not-on-plan'
  /** This month's allowance is spent. */
  | 'allowance-spent'
  /** This audience is bigger than what is left of this month's allowance. */
  | 'audience-over-allowance'

export interface CampaignPlanLock {
  kind: CampaignPlanLockKind
  /** The cheapest plan whose allowance would let this campaign go out. */
  planLabel: string | undefined
  /** One sentence for the disabled Send button's tooltip. */
  reason: string
  /** The upsell notice's body: what is stopped and what still works. */
  notice: string
}

/**
 * Whether the plan's monthly campaign allowance stops this campaign, and
 * the words for saying so before Send rather than after it.
 *
 * `limit` and `used` are the same `emailSendsPerMonth` limit and
 * `campaignEmailSends` counter `performCampaignSend` claims against, so the
 * console's lock and the server's refusal cannot disagree. `sendable` is the
 * audience preview's count when it has one; without it only the two
 * audience-independent locks can be known.
 */
export function campaignPlanLock(input: {
  limit: number
  used: number
  sendable?: number | null
}): CampaignPlanLock | null {
  const { limit, used } = input
  const sendable = Math.max(0, Number(input.sendable ?? 0))
  if (!Number.isFinite(limit)) return null
  if (limit <= 0) {
    const planLabel = planLabelGrantingQuota('emailSendsPerMonth', 1)
    return {
      kind: 'not-on-plan',
      planLabel,
      reason: planLabel
        ? `Campaign email is included from ${planLabel}.`
        : 'Campaign email is not included in your plan.',
      notice:
        'Your plan does not include campaign email. You can still write ' +
        'this email, save it as a draft and send yourself a test. Upgrade ' +
        'to send it to your audience.',
    }
  }
  const remaining = Math.max(0, limit - used)
  if (remaining === 0) {
    return {
      kind: 'allowance-spent',
      planLabel: planLabelGrantingQuota(
        'emailSendsPerMonth',
        used + Math.max(1, sendable),
      ),
      reason: `All ${limit.toLocaleString()} campaign emails this month are sent.`,
      notice:
        `You have sent all ${limit.toLocaleString()} campaign emails your ` +
        'plan includes this month. Upgrade for a larger allowance, or ' +
        'send this on the 1st when it resets.',
    }
  }
  if (sendable > remaining) {
    return {
      kind: 'audience-over-allowance',
      planLabel: planLabelGrantingQuota('emailSendsPerMonth', used + sendable),
      reason:
        `This audience is ${sendable.toLocaleString()} people and ` +
        `${remaining.toLocaleString()} campaign emails are left this month.`,
      notice:
        `This campaign goes to ${sendable.toLocaleString()} people, and ` +
        `your plan has ${remaining.toLocaleString()} campaign emails left ` +
        'this month. Upgrade for a larger allowance, or narrow the audience.',
    }
  }
  return null
}

/**
 * The server's refusal sentence for a campaign the plan stops. It names the
 * plan that would carry it, so a refusal that reaches a merchant anyway (a
 * native app, a scheduled send) still says what to do.
 */
export function campaignPlanCapMessage(lock: CampaignPlanLock): string {
  const upgrade = lock.planLabel
    ? ` Upgrade to ${lock.planLabel} in Billing to send it.`
    : ' Upgrade in Billing to send it.'
  const transactional =
    ' Transactional mail (receipts, booking reminders, password resets) ' +
    'keeps sending.'
  if (lock.kind === 'not-on-plan') {
    return `Your plan does not include campaign email.${upgrade}${transactional}`
  }
  return `${lock.reason}${upgrade}${transactional}`
}
