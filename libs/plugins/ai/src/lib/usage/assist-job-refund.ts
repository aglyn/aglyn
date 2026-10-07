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
 * A job that failed on our side gives back what it spent (AGL-3594).
 *
 * "On our side" is the machine's to say, and it says it for: a plan the plan
 * rules still refused after their re-ask, a building step whose answer still
 * broke a building rule after its re-ask (AGL-3596), a provider or model error, a step
 * the machine gave up on after its attempts (a timeout or a lease that kept
 * expiring), a step that failed of its own accord, and a step no runner could
 * take. Never for a person canceling — they pay for what ran until they did —
 * nor for a model declining the brief, which the Free taste already meters as
 * a refusal and the refusal pause bounds.
 *
 * WHAT IS GIVEN BACK. A job that delivered nothing gives back everything it
 * spent and has not already given back. A job that delivered drafts and then
 * failed keeps them and pays for them: only the failing step's own spend goes
 * back. The site's listing proposal is not a delivery — it is derived from the
 * answers, costs nothing, and rides out with the first unit.
 *
 * HOW. Through the one give-back writer (`returnAssistCredits`, AGL-3595), to
 * the workspace's band and, on the Free taste, the owner's allowance — the
 * meters the spend was charged to — recorded as `system:job-refund`. The
 * tokens stay on the bill and the signal; the give-back nets them out of what
 * every reader calls "used".
 *
 * BOUNDED. The writer never returns more than a meter's month used. On top
 * of it, at most `AI_JOB_REFUNDS_PER_DAY` automatic give-backs an account a
 * UTC day (the workspace's own month where it names no owner), counted off
 * the give-backs the month already records, so a brief that keeps failing
 * cannot keep spending for free. Past it, the failure is metered as it always
 * was.
 */

/** Automatic give-backs an account may have a UTC day. */
export const AI_JOB_REFUNDS_PER_DAY = 3

/** The `source` a job's give-back is recorded under. */
export const AI_JOB_REFUND_SOURCE = 'job-refund'

/** Who gives it back: the platform, not a member of staff. */
export const AI_JOB_REFUND_ACTOR = `system:${AI_JOB_REFUND_SOURCE}`

/** Why a job's credits went back, as the job records it. */
export type AiJobRefundReason =
  | 'plan-refused'
  | 'doctrine-refused'
  | 'provider'
  | 'timeout'
  | 'step-failure'
  | 'unavailable'

/**
 * The give-back's key. Per job and per give-back on it (`ordinal`, the job's
 * count of give-backs so far), so one failure gives back once however often
 * it is handled, and a later failure of the same job — a plan tried again and
 * refused again — is a give-back of its own. The day leads, so a day's
 * give-backs are counted off the month's keys. The writer holds a key to
 * `[A-Za-z0-9_-]{8,100}`; the job id is cut to fit.
 */
export function aiJobRefundKey(input: { day: string; jobId: string; ordinal: number }): string {
  const job = input.jobId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48)
  return `${AI_JOB_REFUND_SOURCE}-${input.day.replace(/-/g, '')}-${job}-${Math.max(0, Math.floor(input.ordinal))}`
}

/**
 * A build item's give-back key (AGL-3616): per job, per item and per
 * attempt, so one item's failure gives back once however often its pass is
 * replayed, and Try again's next attempt is a give-back of its own. The day
 * is the JOB's (the day it was created), not the day of the give-back, so a
 * pass replayed across midnight finds the same key. `item` marks it, so the
 * daily bound counts a build's give-backs once per job. `slot` is the unit's
 * slot (`c0`, `p1`, `i2`) or `plan` for the build's own planning.
 */
export function aiJobItemRefundKey(input: { day: string; jobId: string; slot: string; attempt: number }): string {
  const job = input.jobId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)
  const slot = input.slot.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'x'
  return `${AI_JOB_REFUND_SOURCE}-${input.day.replace(/-/g, '')}-item-${job}-${slot}-${Math.max(0, Math.floor(input.attempt))}`
}

/** The tail every item key ends in: its slot and attempt. */
const ITEM_KEY_TAIL = /-[A-Za-z0-9]{1,8}-\d+$/

/**
 * What one give-back counts as toward the daily bound: the key itself, or
 * for a build item's key its job (AGL-3616) — a ten-item build whose items
 * fail is one give-back, not ten, or the bound would starve it.
 */
function aiJobRefundIdentity(key: string, prefix: string): string {
  const rest = key.slice(prefix.length)
  return rest.startsWith('item-') ? rest.replace(ITEM_KEY_TAIL, '') : rest
}

/** How many give-backs a meter's month already records for `day`: build items once per job. */
export function aiJobRefundsOn(returns: unknown, day: string): number {
  return aiJobRefundIdentitiesOn(returns, day).size
}

/** The give-backs a meter's month records for `day`, each by what it counts as. */
export function aiJobRefundIdentitiesOn(returns: unknown, day: string): Set<string> {
  if (!returns || typeof returns !== 'object') return new Set()
  const prefix = `${AI_JOB_REFUND_SOURCE}-${day.replace(/-/g, '')}-`
  return new Set(
    Object.keys(returns)
      .filter((key) => key.startsWith(prefix))
      .map((key) => aiJobRefundIdentity(key, prefix)),
  )
}

/**
 * What a failure gives back: everything the job spent and has not already
 * given back when it delivered nothing, else the failing step's own spend.
 */
export function aiJobRefundCredits(input: {
  delivered: boolean
  jobCredits: number
  stepCredits: number
  alreadyRefunded: number
}): number {
  const step = Math.max(0, Math.floor(input.stepCredits))
  if (input.delivered) return step
  return Math.max(0, Math.floor(input.jobCredits) - Math.max(0, Math.floor(input.alreadyRefunded)))
}

export type AiJobRefundOutcome = AssistCreditReturnOutcome | { status: 'bounded'; lines: [] }

/**
 * Give a failed job's credits back to the meters it was charged to, or say
 * why not.
 */
export async function refundJobCredits(
  firestore: FirebaseFirestore.Firestore,
  input: {
    orgId: string
    /** The Free taste's attribution, or `null` on a paid workspace. */
    free: FreeAssistAccount | null
    jobId: string
    ordinal: number
    credits: number
    month: string
    day: string
    reason: AiJobRefundReason
    /**
     * A build item's give-back (AGL-3616), keyed by `aiJobItemRefundKey`
     * rather than by `ordinal`: its slot and attempt, and the day the job was
     * created. Counted toward the daily bound once per job.
     */
    item?: { slot: string; attempt: number; jobDay: string }
  },
): Promise<AiJobRefundOutcome> {
  const workspace = workspaceCreditMeter(firestore, input.orgId, input.month)
  const account = input.free?.accountUid
    ? accountCreditMeter(firestore, input.free.accountUid, input.month)
    : null
  const key = input.item
    ? aiJobItemRefundKey({ day: input.item.jobDay, jobId: input.jobId, slot: input.item.slot, attempt: input.item.attempt })
    : aiJobRefundKey({ day: input.day, jobId: input.jobId, ordinal: input.ordinal })
  const counter = await (account ?? workspace).ref.get()
  const returns = counter.get(ASSIST_CREDIT_RETURNS_FIELD)
  const counted = aiJobRefundIdentitiesOn(returns, input.day)
  // A build already given back today counts once: its later items ride the same give-back.
  const jobCounted = input.item
    ? counted.has(aiJobRefundIdentity(key, `${AI_JOB_REFUND_SOURCE}-${input.item.jobDay.replace(/-/g, '')}-`))
    : false
  if (!jobCounted && counted.size >= AI_JOB_REFUNDS_PER_DAY) {
    return { status: 'bounded', lines: [] }
  }
  return returnAssistCredits(firestore, {
    month: input.month,
    meters: account ? [workspace, account] : [workspace],
    credits: input.credits,
    key,
    reason: `An AI job failed on our side (${input.reason})`,
    actorUid: AI_JOB_REFUND_ACTOR,
    source: AI_JOB_REFUND_SOURCE,
    jobId: input.jobId,
  })
}
