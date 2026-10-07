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

import type { AiJobKind, AiJobStatus, AiJobSummary } from './ai-jobs.types'

/**
 * What a member reads when a plan could not be made (AGL-3594): one plain
 * sentence and one thing to do, never a rule number or a validator's words.
 *
 * The plan step's own checks refuse an answer in the doctrine's vocabulary —
 * "Rule 10 (Navigation and SEO travel with a page): A page reuses an
 * address…" — which is what the one re-ask is told and what staff read to
 * tell a rule that should bend from a model that ignored it. Shown to the
 * person who asked for a site, the same words read as the product breaking.
 * So the review a refused plan stops for carries this sentence as its
 * `message`, and the doctrine's sentence and findings ride beside it as
 * `detail` and `findings`, which the job document keeps and only staff are
 * shown.
 *
 * Pure: no React, no Admin SDK. The drawer's plan card and the plan step read
 * the same words.
 */

/** The violation code the Free wall refuses a plan with. */
export const AI_PLAN_FREE_WALL_CODE = 'plan-over-free-wall'

/** What the plan was for, as the sentence names it. */
function planningWhat(kind: AiJobKind | string): string {
  switch (kind) {
    case 'site':
      return 'your site'
    case 'page':
      return 'this page'
    default:
      return 'this'
  }
}

export interface AiPlanFailureCopyInput {
  /** The job kind whose plan was refused. */
  kind: AiJobKind | string
  /** The codes of the violations its last answer broke. */
  codes: readonly string[]
  /** The step's credits went back to the Free allowance (AGL-3594). */
  refunded: boolean
}

/**
 * The sentence a refused plan stops its job with. Over the Free wall, the way
 * out is fewer pages or a paid plan; anything else is ours to have got wrong,
 * and the way out is trying again — said to cost nothing only when it did.
 */
export function aiPlanFailureCopy(input: AiPlanFailureCopyInput): string {
  const spent = input.refunded ? ', and it did not use any of your AI credits' : ''
  if (input.codes.includes(AI_PLAN_FREE_WALL_CODE)) {
    return `We couldn't fit this plan into your Free AI credits${spent}. Try fewer pages, or upgrade for more.`
  }
  return `Something went wrong planning ${planningWhat(input.kind)}${spent}. Try again.`
}

/**
 * Why trying a refused plan again cannot work yet, or `null` when it can: the
 * Free allowance left this month is less than a plan of this kind can cost at
 * its worst. Said with the figures, and with the two ways out.
 */
export function aiPlanRetryRefusal(input: { creditsLeft: number; planCredits: number }): string | null {
  const left = Math.max(0, Math.floor(input.creditsLeft))
  if (left >= input.planCredits) return null
  return `You have ${left} AI ${left === 1 ? 'credit' : 'credits'} left this month, and a plan needs up to ${input.planCredits}. Your credits refresh next month, or upgrade for more.`
}

/**
 * What a guided site start that failed on our side says (AGL-3596): one plain
 * sentence, never a rule. Whether its credits came back is said beside it, from
 * the job's own record (`aiJobRefundCopy`).
 */
export const AI_SITE_GUIDED_BUILD_FAILED_COPY = 'Something went wrong building your site, and it was not built.'

/** What a person's own cancel says about its credits: they paid for what ran until then. */
export const AI_JOB_CANCELED_CREDITS_COPY = 'You paid for what was spent up to then.'

/**
 * What every surface that shows a stopped job says about its credits
 * (AGL-3596), read off the job's RECORDED give-back (`refundedCredits`),
 * never worked out again: a failure on our side that gave its credits back
 * says so plainly, and a person's own cancel says they paid for what ran.
 * `null` where there is nothing to say — a job still working, done, or one
 * that stopped without a give-back.
 */
export function aiJobRefundCopy(
  job: { status: AiJobStatus } & Partial<Pick<AiJobSummary, 'refundedCredits' | 'creditsSpent'>>,
): string | null {
  const refunded = Math.max(0, Math.floor(job.refundedCredits ?? 0))
  if (refunded > 0) {
    const credits = `${refunded} ${refunded === 1 ? 'credit' : 'credits'}`
    const back = refunded === 1 ? 'is' : 'are'
    const whole = refunded >= Math.floor(job.creditsSpent ?? 0)
    return whole
      ? `This one’s on us — you weren’t charged. The ${credits} it used ${back} back in your AI credits.`
      : `This one’s on us — you weren’t charged for the part that failed. The ${credits} it used ${back} back in your AI credits.`
  }
  if (job.status === 'canceled' && (job.creditsSpent ?? 0) > 0) return AI_JOB_CANCELED_CREDITS_COPY
  return null
}

/** The guided start's way back to the starter (AGL-3594). */
export const AI_SITE_STARTER_FALLBACK_LABEL = 'Use the starter site instead'

/**
 * Whether a job is a guided start that did not work out and can still be
 * traded for the starter (AGL-3594): a site job that failed, was canceled, or
 * stopped for a person on a refused step — never one waiting on its plan,
 * which is a plan to confirm — and that has built nothing, since the starter
 * is written only to a site with no page or layout.
 */
export function aiSiteStarterFallbackOffered(
  job: Pick<AiJobSummary, 'kind' | 'status' | 'hostId' | 'outputs' | 'review'>,
): boolean {
  if (job.kind !== 'site' || !job.hostId) return false
  // The site's listing proposal rides out with the first unit and builds nothing (AGL-3596).
  if (job.outputs.some((output) => output.resource !== 'seo')) return false
  if (job.status === 'failed' || job.status === 'canceled') return true
  return job.status === 'needs_review' && job.review?.reason === 'doctrine'
}
