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

/**
 * The AI plugin's spend guards, without a sweep: the staff review threshold
 * on one workspace's provider spend and the hard ceiling that refuses it.
 * Every case was forced RED before it was kept — the note on each says which
 * line was broken to prove it.
 */

import {
  assistCeilingBreach,
  assistCogsAlertThresholdUsd,
  assistMarginBreach,
  assistMarginMultiple,
} from './assist-spend-guards'

describe('the Assist margin guard', () => {
  const month = '2026-08'

  it('takes its threshold from config and falls back to the default', () => {
    expect(assistCogsAlertThresholdUsd('50')).toBe(50)
    for (const bad of ['', '0', '-4', 'lots', null, undefined]) {
      expect(assistCogsAlertThresholdUsd(bad as never)).toBe(25)
    }
  })

  it('stays quiet under the threshold', () => {
    expect(
      assistMarginBreach({ assistUsd: 24.99, thresholdUsd: 25, guard: null, month }),
    ).toBe(false)
  })

  it('fires once at the threshold', () => {
    expect(
      assistMarginBreach({ assistUsd: 25, thresholdUsd: 25, guard: null, month }),
    ).toBe(true)
    expect(
      assistMarginBreach({
        assistUsd: 30,
        thresholdUsd: 25,
        guard: { month, threshold: 1 },
        month,
      }),
    ).toBe(false)
  })

  it('fires AGAIN at the next multiple', () => {
    // Forced red by storing a boolean instead of the multiple: an org whose
    // Assist cost went from $25 to $250 announced itself once, at $25, and
    // then went quiet for the expensive part.
    expect(assistMarginMultiple(52, 25)).toBe(2)
    expect(
      assistMarginBreach({
        assistUsd: 52,
        thresholdUsd: 25,
        guard: { month, threshold: 1 },
        month,
      }),
    ).toBe(true)
  })

  it('resets with the month', () => {
    expect(
      assistMarginBreach({
        assistUsd: 30,
        thresholdUsd: 25,
        guard: { month: '2026-07', threshold: 9 },
        month,
      }),
    ).toBe(true)
  })
})

/**
 * The HARD ceiling's staff announcement (AGL-2264).
 *
 * Distinct from the margin alert above and deliberately so: past this figure
 * the org's assistant is REFUSED, not merely expensive, and the margin
 * alert's whole-multiples arithmetic cannot say so — an org climbing from
 * $25 to the $40 ceiling is still at 1x of the $25 threshold and stays
 * silent. That silence is the failure this block exists to prevent, so the
 * load-bearing test here is the third one.
 */
describe('assistCeilingBreach — staff hear that the assistant STOPPED', () => {
  const month = '2026-08'

  it('stays quiet under the ceiling, and fires once at it', () => {
    expect(
      assistCeilingBreach({ assistUsd: 39.99, ceilingUsd: 40, guard: null, month }),
    ).toBe(false)
    expect(
      assistCeilingBreach({ assistUsd: 40, ceilingUsd: 40, guard: null, month }),
    ).toBe(true)
    // Announced once for the month: crossing is a state, and the org is
    // refused from here to the boundary however far past it the sum climbs.
    expect(
      assistCeilingBreach({
        assistUsd: 400,
        ceilingUsd: 40,
        guard: { month, threshold: 1 },
        month,
      }),
    ).toBe(false)
  })

  it('says nothing when an operator turned the ceiling OFF', () => {
    // Nothing is being refused, so there is nothing to announce. Without
    // this, a deployment that opted out would be mailed about a stop that
    // never happened.
    expect(
      assistCeilingBreach({
        assistUsd: 10_000,
        ceilingUsd: null,
        guard: null,
        month,
      }),
    ).toBe(false)
  })

  it('is NOT suppressed by the margin alert having already spoken', () => {
    // The two guards are separate keys on purpose. This is the case the
    // margin alert cannot carry: $40 is still 1x of its $25 threshold, so
    // `assistMarginBreach` is silent on the very reading where the customer's
    // assistant went off.
    expect(
      assistMarginBreach({
        assistUsd: 41,
        thresholdUsd: 25,
        guard: { month, threshold: 1 },
        month,
      }),
    ).toBe(false)
    expect(
      assistCeilingBreach({
        assistUsd: 41,
        ceilingUsd: 40,
        guard: null,
        month,
      }),
    ).toBe(true)
  })

  it('resets with the month', () => {
    expect(
      assistCeilingBreach({
        assistUsd: 41,
        ceilingUsd: 40,
        guard: { month: '2026-07', threshold: 1 },
        month,
      }),
    ).toBe(true)
  })
})
