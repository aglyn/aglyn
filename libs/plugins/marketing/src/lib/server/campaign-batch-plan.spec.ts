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
 *
 * @jest-environment node
 */

import { EMAIL_MAX_SEND_BATCHES } from '@aglyn/shared-util-email'
import { campaignBatchPlan } from './campaign-batch-plan'

/**
 * THE BATCH PLAN, WHICH IS A TERMINATION ARGUMENT MORE THAN AN ARITHMETIC ONE.
 *
 * A send that reschedules itself has exactly one interesting failure — doing
 * it forever — and the three ways this one stops are the three cases below.
 * Each is checked against its neighbour: the case that resumes, and the case
 * one step over that must not.
 */
describe('campaignBatchPlan', () => {
  const base = {
    mailable: 3000,
    addressed: 500,
    retryable: 0,
    settled: 500,
    batchesSoFar: 0,
  }

  it('resumes while there is a remainder and the frontier is moving', () => {
    expect(campaignBatchPlan(base)).toEqual({
      remaining: 2500,
      batch: 1,
      resuming: true,
      stop: null,
    })
  })

  it('stops the moment nothing is left', () => {
    expect(
      campaignBatchPlan({ ...base, mailable: 500, addressed: 500 }),
    ).toEqual({ remaining: 0, batch: 1, resuming: false, stop: 'complete' })
  })

  it('counts an hourly cut back into the remainder rather than losing it', () => {
    // 500 addressed, 200 of them cut off by the governor: those 200 are not a
    // shortfall, they are the next batch's work.
    expect(
      campaignBatchPlan({ ...base, retryable: 200, settled: 300 }).remaining,
    ).toBe(2700)
  })

  it('stops when a batch settled nobody', () => {
    // The only way a self-rescheduling job loops: the frontier cannot move,
    // so the next batch would address exactly these people again.
    expect(campaignBatchPlan({ ...base, settled: 0 })).toMatchObject({
      resuming: false,
      stop: 'no-progress',
    })
  })

  it('resumes on ONE settled person — the guard is progress, not a quota', () => {
    expect(campaignBatchPlan({ ...base, settled: 1 }).resuming).toBe(true)
  })

  it('stops at the batch guard', () => {
    expect(
      campaignBatchPlan({ ...base, batchesSoFar: EMAIL_MAX_SEND_BATCHES - 1 }),
    ).toMatchObject({ resuming: false, stop: 'batch-limit' })
    // And not one batch early.
    expect(
      campaignBatchPlan({ ...base, batchesSoFar: EMAIL_MAX_SEND_BATCHES - 2 })
        .resuming,
    ).toBe(true)
  })

  it('is total — nonsense clamps rather than throwing', () => {
    expect(() =>
      campaignBatchPlan({
        mailable: NaN,
        addressed: -5,
        retryable: Infinity,
        settled: null as never,
        batchesSoFar: -1,
      }),
    ).not.toThrow()
    expect(
      campaignBatchPlan({
        mailable: NaN,
        addressed: -5,
        retryable: Infinity,
        settled: null as never,
        batchesSoFar: -1,
      }),
    ).toMatchObject({ remaining: 0, resuming: false })
  })

  it('never reports a remainder larger than the audience', () => {
    // The rate-over-its-denominator failure, one surface over: a remainder
    // above the audience would render as "reached 500 of 3,000, 4,000 left".
    const plan = campaignBatchPlan({ ...base, retryable: 500, settled: 1 })
    expect(plan.remaining).toBeLessThanOrEqual(base.mailable)
  })
})
