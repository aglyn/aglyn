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

import { EMAIL_MAX_SEND_BATCHES } from '@aglyn/shared-util-email'

/**
 * Whether a campaign that has delivered one batch runs another.
 *
 * A campaign larger than one send's recipient cap goes out in batches: the
 * sender addresses what it may, and reschedules itself for the rest. This is
 * the rule that decides whether it does, pure so it can be read and tested
 * without a send. The one property it exists to hold is that a campaign always
 * terminates. The ceiling on how many batches any bulk send may take,
 * {@link EMAIL_MAX_SEND_BATCHES}, is the mail rail's; the rule for this sender
 * is the campaign's own.
 */

/** Clamps a raw count to a positive integer, or returns `fallback`. */
function positiveInt(raw: unknown, fallback: number): number {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

/** Why a partly-delivered email will not run another batch. */
export type CampaignBatchStop =
  /** Nothing is left to address. */
  | 'complete'
  /** {@link EMAIL_MAX_SEND_BATCHES} reached. */
  | 'batch-limit'
  /** The batch settled nobody, so another one would settle nobody either. */
  | 'no-progress'

/** What happens to an email after one batch of it has been delivered. */
export interface CampaignBatchPlan {
  /** People this email has resolved and not yet addressed. */
  remaining: number
  /** Batches this email has now run, including the one just finished. */
  batch: number
  /** True when another batch will run. */
  resuming: boolean
  /**
   * Why no further batch will run. Null while {@link resuming} is true —
   * a reason for a state that has not happened is a reason a surface would
   * show.
   */
  stop: CampaignBatchStop | null
}

export interface CampaignBatchPlanInput {
  /** People this batch could have addressed, before the per-send cap. */
  mailable: number
  /** People it did address — `min(mailable, perSend)`. */
  addressed: number
  /**
   * Of those it addressed, how many are left for a later batch to try again:
   * the tail an hourly deferral cut off, and nothing else. A recipient the
   * send SETTLED — delivered, suppressed or off-topic — is not retryable and
   * is not counted here.
   */
  retryable: number
  /**
   * People this batch settled: delivered plus permanently excluded. Zero is
   * what {@link CampaignBatchStop} `no-progress` is, and it is the reason
   * this is an input rather than a derivation — a batch that addressed 500
   * people and settled none of them will address the same 500 next time.
   */
  settled: number
  /** Batches run before this one. */
  batchesSoFar: number
  /** Injectable for tests; defaults to the shipped guard. */
  maxBatches?: number
}

/**
 * Whether a partly-delivered email runs again, and how much is left.
 *
 * Pure, so the termination rule can be read and tested without a send. The
 * one property it exists to hold is that a campaign always terminates:
 * `resuming` is false whenever there is nothing left, whenever the batch
 * guard is reached, and whenever a batch settled nobody — the last of which
 * is the only way a self-rescheduling job can loop.
 */
export function campaignBatchPlan(
  input: CampaignBatchPlanInput,
): CampaignBatchPlan {
  const mailable = positiveInt(input.mailable, 0)
  const addressed = Math.min(mailable, positiveInt(input.addressed, 0))
  const retryable = Math.min(addressed, positiveInt(input.retryable, 0))
  const settled = positiveInt(input.settled, 0)
  const batch = positiveInt(input.batchesSoFar, 0) + 1
  const maxBatches = positiveInt(input.maxBatches, EMAIL_MAX_SEND_BATCHES)
  const remaining = Math.max(0, mailable - addressed) + retryable

  if (remaining <= 0) {
    return { remaining: 0, batch, resuming: false, stop: 'complete' }
  }
  if (batch >= maxBatches) {
    return { remaining, batch, resuming: false, stop: 'batch-limit' }
  }
  if (settled <= 0) {
    return { remaining, batch, resuming: false, stop: 'no-progress' }
  }
  return { remaining, batch, resuming: true, stop: null }
}
