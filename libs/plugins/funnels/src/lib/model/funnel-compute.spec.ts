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

import {
  computeFunnel,
  DIRECT_SOURCE,
  FUNNEL_SOURCE_ROWS,
  funnelRange,
  journeyProgress,
  journeySourceLabel,
  median,
  OTHER_SOURCE,
} from './funnel-compute'
import type { FunnelStep, JourneyForCompute, JourneyStepRecord } from './funnels.types'

const STEPS: FunnelStep[] = [
  { type: 'page', key: '/pricing', match: 'exact' },
  { type: 'page', key: '/signup', match: 'exact' },
  { type: 'form', key: 'signup-form' },
]

const at = (minutes: number) => minutes * 60_000
const step = (t: JourneyStepRecord['t'], k: string, minutes: number): JourneyStepRecord => ({ t, k, at: at(minutes) })
const visit = (steps: JourneyStepRecord[], source: JourneyForCompute['source'] = null): JourneyForCompute => ({ steps, source })

describe('journeyProgress (AGL-3605)', () => {
  it('follows the steps in time order, whatever order they were stored in', () => {
    const progress = journeyProgress(STEPS, visit([
      step('form', 'signup-form', 9),
      step('page', '/signup', 5),
      step('page', '/pricing', 1),
    ]))
    expect(progress).toEqual({ reached: 3, times: [at(1), at(5), at(9)] })
  })

  it('does not count a step done before the step ahead of it', () => {
    const progress = journeyProgress(STEPS, visit([
      step('page', '/signup', 1),
      step('page', '/pricing', 2),
    ]))
    expect(progress.reached).toBe(1)
  })

  it('matches the earliest event for each step and counts a repeated step once', () => {
    const progress = journeyProgress(STEPS, visit([
      step('page', '/pricing', 1),
      step('page', '/pricing', 3),
      step('page', '/signup', 4),
      step('page', '/signup', 8),
    ]))
    expect(progress).toEqual({ reached: 2, times: [at(1), at(4)] })
  })

  it('matches a prefix page step on the path and anything under it, and nothing beside it', () => {
    const prefix: FunnelStep[] = [{ type: 'page', key: '/blog', match: 'prefix' }, { type: 'order', key: '' }]
    expect(journeyProgress(prefix, visit([step('page', '/blog/post-1', 1), step('order', '', 2)])).reached).toBe(2)
    expect(journeyProgress(prefix, visit([step('page', '/blogger', 1)])).reached).toBe(0)
  })

  it('treats an empty key as any of the kind', () => {
    const any: FunnelStep[] = [{ type: 'cart', key: '' }, { type: 'booking', key: 'svc-1' }]
    expect(journeyProgress(any, visit([step('cart', 'p-9', 1), step('booking', 'svc-2', 2)])).reached).toBe(1)
    expect(journeyProgress(any, visit([step('cart', 'p-9', 1), step('booking', 'svc-1', 2)])).reached).toBe(2)
  })
})

describe('computeFunnel (AGL-3605)', () => {
  const journeys = [
    // Completes: 2 min, then 4 min.
    visit([step('page', '/pricing', 0), step('page', '/signup', 2), step('form', 'signup-form', 6)], { utmSource: 'news', utmCampaign: 'fall' }),
    // Completes: 4 min, then 2 min.
    visit([step('page', '/pricing', 10), step('page', '/signup', 14), step('form', 'signup-form', 16)]),
    // Drops after step 2: 6 min.
    visit([step('page', '/pricing', 20), step('page', '/signup', 26)], { referrerHost: 'google.com' }),
    // Drops after step 1.
    visit([step('page', '/pricing', 30)], { referrerHost: 'google.com' }),
    // Never enters.
    visit([step('page', '/signup', 40)]),
  ]
  const result = computeFunnel(STEPS, journeys)

  it('counts visits per step, entered and completed', () => {
    expect(result.steps.map((row) => row.visitors)).toEqual([4, 3, 2])
    expect(result.entered).toBe(4)
    expect(result.completed).toBe(2)
    expect(result.overall).toBe(0.5)
  })

  it('works out step-to-step and overall conversion and drop-off', () => {
    expect(result.steps[0]).toMatchObject({ fromPrevious: null, fromStart: 1, dropOff: 0 })
    expect(result.steps[1]).toMatchObject({ fromPrevious: 0.75, fromStart: 0.75, dropOff: 1 })
    expect(result.steps[2].fromPrevious).toBeCloseTo(2 / 3)
    expect(result.steps[2]).toMatchObject({ fromStart: 0.5, dropOff: 1 })
  })

  it('takes the median time between steps over the visits that made both', () => {
    expect(result.steps[0].medianMsFromPrevious).toBeNull()
    // 2, 4 and 6 minutes.
    expect(result.steps[1].medianMsFromPrevious).toBe(at(4))
    // 4 and 2 minutes: the mean of the middle two.
    expect(result.steps[2].medianMsFromPrevious).toBe(at(3))
  })

  it('breaks entered and completed down by source, busiest first', () => {
    expect(result.sources).toEqual([
      { source: DIRECT_SOURCE, entered: 1, completed: 1, conversion: 1 },
      { source: 'google.com', entered: 2, completed: 0, conversion: 0 },
      { source: 'news / fall', entered: 1, completed: 1, conversion: 1 },
    ].sort((a, b) => b.entered - a.entered || a.source.localeCompare(b.source)))
  })

  it('folds sources past the cap into Other', () => {
    const many = Array.from({ length: FUNNEL_SOURCE_ROWS + 3 }, (_, index) =>
      visit([step('page', '/pricing', index)], { referrerHost: `site-${index}.com` }),
    )
    const sources = computeFunnel(STEPS, many).sources
    expect(sources).toHaveLength(FUNNEL_SOURCE_ROWS + 1)
    expect(sources[sources.length - 1]).toEqual({ source: OTHER_SOURCE, entered: 3, completed: 0, conversion: 0 })
  })

  it('answers no rates when nobody entered', () => {
    const empty = computeFunnel(STEPS, [])
    expect(empty.overall).toBeNull()
    expect(empty.steps.every((row) => row.visitors === 0)).toBe(true)
    expect(empty.steps[1].fromPrevious).toBeNull()
  })
})

describe('median and source labels', () => {
  it('medians odd, even and empty lists', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(3)
    expect(median([])).toBeNull()
  })

  it('credits UTM labels before the referrer, and Direct last', () => {
    expect(journeySourceLabel({ utmSource: 'ads', referrerHost: 'x.com' })).toBe('ads')
    expect(journeySourceLabel({ referrerHost: 'x.com' })).toBe('x.com')
    expect(journeySourceLabel(null)).toBe(DIRECT_SOURCE)
  })
})

describe('funnelRange', () => {
  const NOW = Date.parse('2026-10-06T12:00:00Z')
  it('reads two days inclusive as a half-open window', () => {
    expect(funnelRange('2026-10-01', '2026-10-06', 90, NOW)).toEqual({
      from: '2026-10-01',
      to: '2026-10-06',
      startMs: Date.parse('2026-10-01T00:00:00Z'),
      endMs: Date.parse('2026-10-07T00:00:00Z'),
    })
  })

  it('refuses a range that is malformed, backwards, too wide or in the future', () => {
    expect(funnelRange('nope', '2026-10-06', 90, NOW)).toHaveProperty('error')
    expect(funnelRange('2026-10-06', '2026-10-01', 90, NOW)).toHaveProperty('error')
    expect(funnelRange('2026-01-01', '2026-10-06', 90, NOW)).toHaveProperty('error')
    expect(funnelRange('2026-11-01', '2026-11-02', 90, NOW)).toHaveProperty('error')
  })
})
