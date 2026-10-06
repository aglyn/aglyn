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

import { ASSIST_CREDIT_RETURNS_FIELD } from './assist-credit-returns'
import {
  accountCreditMeter,
  returnAssistCredits,
  workspaceCreditMeter,
  type AssistCreditReturnOutcome,
} from './assist-credit-returns-write'
import type { FreeAssistAccount } from './assist-free-taste'

/**
 * A Free plan our own checks refused gives its credits back (AGL-3594).
 *
 * The plan step's answer and its one re-ask were spent, and a plan the plan
 * rules still turned away is nothing the person can use: on a 300-credit
 * Free taste, the 227 credits one such plan cost left a new workspace a
 * Try again that could not succeed. So the machine meters the step as it
 * meters every step — the tokens were spent, and the signal and the
 * provider cost keep the truth — and then hands the step's credits back to
 * the workspace's band and the owner's allowance through the one give-back
 * writer staff use (`returnAssistCredits`, AGL-3595), keyed per step run,
 * attributed to `system:plan-refund`.
 *
 * ── Bounded ──────────────────────────────────────────────────────────────
 *
 * A give-back can never exceed what the month used, which is the writer's
 * own bound. This adds the one an automatic path needs: at most
 * `AI_PLAN_REFUNDS_PER_DAY` refunded plans an account a UTC day, counted off
 * the give-backs the account's month already records, so a brief that keeps
 * failing cannot plan for free all day. Past it, a refused plan is metered
 * as any other step.
 */

/** Refunded refused plans an account may have a UTC day. */
export const AI_PLAN_REFUNDS_PER_DAY = 3

/** The `source` a refused plan's give-back is recorded under. */
export const AI_PLAN_REFUND_SOURCE = 'plan-refund'

/** Who gives it back: the platform, not a member of staff. */
export const AI_PLAN_REFUND_ACTOR = `system:${AI_PLAN_REFUND_SOURCE}`

/**
 * The give-back's key: the day it counts against, the job and the step run.
 * A key is a Firestore map key the writer holds to `[A-Za-z0-9_-]{8,100}`,
 * so the day is written without its hyphens' meaning lost and the id is cut
 * to fit.
 */
export function aiPlanRefundKey(input: { day: string; jobId: string; stepIndex: number; at: number }): string {
  const job = input.jobId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48)
  return `${AI_PLAN_REFUND_SOURCE}-${input.day.replace(/-/g, '')}-${job}-${input.stepIndex}-${input.at}`
}

/** How many refused plans a meter's month already gave back on `day`. */
export function aiPlanRefundsOn(returns: unknown, day: string): number {
  if (!returns || typeof returns !== 'object') return 0
  const prefix = `${AI_PLAN_REFUND_SOURCE}-${day.replace(/-/g, '')}-`
  return Object.keys(returns).filter((key) => key.startsWith(prefix)).length
}

export type AiPlanRefundOutcome = AssistCreditReturnOutcome | { status: 'bounded'; lines: [] }

/**
 * Give a refused Free plan's credits back, or say why not. The account's
 * month is the bound's counter where the workspace names an owner, the
 * workspace's month otherwise.
 */
export async function refundRefusedFreePlan(
  firestore: FirebaseFirestore.Firestore,
  input: {
    orgId: string
    free: FreeAssistAccount
    jobId: string
    stepIndex: number
    credits: number
    month: string
    day: string
    now: Date
  },
): Promise<AiPlanRefundOutcome> {
  const workspace = workspaceCreditMeter(firestore, input.orgId, input.month)
  const account = input.free.accountUid
    ? accountCreditMeter(firestore, input.free.accountUid, input.month)
    : null
  const counter = await (account ?? workspace).ref.get()
  if (aiPlanRefundsOn(counter.get(ASSIST_CREDIT_RETURNS_FIELD), input.day) >= AI_PLAN_REFUNDS_PER_DAY) {
    return { status: 'bounded', lines: [] }
  }
  return returnAssistCredits(firestore, {
    month: input.month,
    meters: account ? [workspace, account] : [workspace],
    credits: input.credits,
    key: aiPlanRefundKey({ day: input.day, jobId: input.jobId, stepIndex: input.stepIndex, at: input.now.getTime() }),
    reason: 'A plan the plan rules refused after its re-ask',
    actorUid: AI_PLAN_REFUND_ACTOR,
    source: AI_PLAN_REFUND_SOURCE,
    jobId: input.jobId,
  })
}
