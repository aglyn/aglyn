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

import type { AiJobKind } from './ai-jobs.types'

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
