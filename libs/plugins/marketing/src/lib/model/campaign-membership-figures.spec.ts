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
 * MEMBERSHIP FIGURES, WHICH ARE NOT ATTRIBUTED FIGURES.
 *
 * The rollup here is arithmetic over counters that belong to the forms, not
 * to the campaign. Three properties make it safe to print beside attributed
 * numbers, and each is a way it could quietly be wrong instead:
 *
 *  1. **A windowed campaign never gets lifetime figures.** The flat counters
 *     include every submission from before the form was filed here.
 *  2. **A counter nothing recorded stays `null`.** A campaign whose forms
 *     never counted a lead must not report zero leads, which is a
 *     measurement nobody took.
 *  3. **The overlap is counted and disclosed.** A form in two campaigns lends
 *     the same submissions to both, so the total cannot be presented as this
 *     campaign's exclusive property.
 */

import {
  campaignFormsRollup,
  campaignFormTotals,
  campaignPeriodRange,
  isWindowedRange,
} from './campaign-membership-figures'

const STATS = {
  submissions: 40,
  leads: 6,
  views: 400,
  starts: 150,
  periods: {
    '2026-01': { submissions: 10, views: 100, starts: 40 },
    '2026-02': { submissions: 12, leads: 4, views: 90, starts: 35 },
    '2026-03': { submissions: 8, leads: 2, views: 60, starts: 25 },
  },
}

describe('a campaign’s dates decide which months a figure covers', () => {
  it('turns the campaign’s milliseconds into month keys', () => {
    const range = campaignPeriodRange({
      startAtMs: Date.UTC(2026, 1, 10),
      endAtMs: Date.UTC(2026, 2, 20),
    })
    expect(range).toEqual({ from: '2026-02', to: '2026-03' })
    expect(isWindowedRange(range)).toBe(true)
  })

  it('leaves a missing end open rather than closing it at today', () => {
    const range = campaignPeriodRange({ startAtMs: Date.UTC(2026, 1, 1) })
    expect(range.from).toBe('2026-02')
    expect(range.to).toBeUndefined()
  })

  it('is not a window at all when the campaign has no dates', () => {
    const range = campaignPeriodRange({ startAtMs: null, endAtMs: null })
    expect(isWindowedRange(range)).toBe(false)
    // The control for property (1) in the other direction: with no window,
    // lifetime is the honest answer and the caller has to label it.
    expect(campaignFormTotals(STATS, range).periods).toBeNull()
    expect(campaignFormTotals(STATS, range).submissions).toBe(40)
  })

  it('confines a form’s counters to the campaign’s months', () => {
    // The control for property (1): the lifetime 40 must not survive a
    // campaign that only ran in February and March.
    const range = campaignPeriodRange({
      startAtMs: Date.UTC(2026, 1, 10),
      endAtMs: Date.UTC(2026, 2, 20),
    })
    const totals = campaignFormTotals(STATS, range)
    expect(totals.submissions).toBe(20)
    expect(totals.periods).toBe(2)
  })
})

describe('adding up what a campaign’s forms hold', () => {
  const member = (
    totals: ReturnType<typeof campaignFormTotals>,
    campaigns = 1,
  ) => ({ totals, campaigns })
  const lifetime = (stats: unknown) => campaignFormTotals(stats as any, {})

  it('sums each counter and names how many forms recorded it', () => {
    const rollup = campaignFormsRollup([
      member(lifetime({ submissions: 10, views: 100 })),
      member(lifetime({ submissions: 5 })),
    ])
    expect(rollup.submissions.value).toBe(15)
    expect(rollup.submissions.recorded).toBe(2)
    // A total over one of two forms is a different statement from a total
    // over two, and the caller prints the difference.
    expect(rollup.views.value).toBe(100)
    expect(rollup.views.recorded).toBe(1)
    expect(rollup.views.members).toBe(2)
  })

  it('reports a counter no form recorded as unrecorded, never as zero', () => {
    // The control for property (2). A `0` here says these forms produced no
    // leads; the truth is that nothing counted leads for them.
    const rollup = campaignFormsRollup([
      member(lifetime({ submissions: 10 })),
      member(lifetime({ submissions: 5 })),
    ])
    expect(rollup.leads.value).toBeNull()
    expect(rollup.leads.recorded).toBe(0)
  })

  it('counts the forms that lend their figures to another campaign', () => {
    // The control for property (3).
    const rollup = campaignFormsRollup([
      member(lifetime({ submissions: 10 }), 3),
      member(lifetime({ submissions: 5 }), 1),
    ])
    expect(rollup.members).toBe(2)
    expect(rollup.shared).toBe(1)
    // The overlap is disclosed, never divided out: there is no honest way to
    // split one submission between two campaigns the form is filed under.
    expect(rollup.submissions.value).toBe(15)
  })

  it('holds nothing for a campaign with no forms', () => {
    const rollup = campaignFormsRollup([])
    expect(rollup.members).toBe(0)
    expect(rollup.shared).toBe(0)
    expect(rollup.submissions.value).toBeNull()
  })

  it('adds a windowed form that recorded nothing in those months as nothing', () => {
    /*
     * A form whose counters predate the month series contributes no figure to
     * a windowed campaign — and must not contribute a zero either, because
     * that would claim its quiet months were measured.
     */
    const range = campaignPeriodRange({ startAtMs: Date.UTC(2026, 1, 1) })
    const rollup = campaignFormsRollup([
      member(campaignFormTotals({ submissions: 500 }, range)),
      member(campaignFormTotals(STATS, range)),
    ])
    expect(rollup.submissions.value).toBe(20)
    expect(rollup.submissions.recorded).toBe(1)
    expect(rollup.submissions.members).toBe(2)
  })
})
