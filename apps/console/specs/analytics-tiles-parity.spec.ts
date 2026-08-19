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
 * AGL-2160 — the four traffic tiles `/product/analytics` advertises.
 *
 * The delta is the one that mattered. It existed, as a `Week over week`
 * tile computed from `days.slice(-7)` against `days.slice(-14, -7)` — and
 * the card only ever LOADED `range` days, so on a 7-day range the "prior
 * week" slice was empty and on a 90-day range the tile reported last
 * week's movement beside ninety days of chart. It was never wrong enough
 * to look broken, which is why it survived.
 */

import {
  deviceSplit,
  deviceSplitLabel,
  deviceSplitValue,
  formatDwell,
  rollUp,
  splitTrafficWindows,
  trafficDeltaPct,
} from '../utils/analytics-summary'

const day = (
  id: string,
  total: number,
  extra: Partial<{
    paths: Record<string, number>
    referrers: Record<string, number>
    devices: Record<string, number>
  }> = {},
) => ({ day: id, total, visitors: 0, paths: {}, referrers: {}, devices: {}, ...extra })

describe('splitTrafficWindows', () => {
  it('takes the NEWEST window for display and the one before it for the delta', () => {
    // Days arrive oldest first. Getting this backwards only negates the
    // delta, which is why it needs asserting rather than eyeballing.
    const days = [1, 2, 3, 4, 5, 6].map((n) => day(`d${n}`, n))
    const { current, prior } = splitTrafficWindows(days, 3)
    expect(current.map((entry) => entry.day)).toEqual(['d4', 'd5', 'd6'])
    expect(prior.map((entry) => entry.day)).toEqual(['d1', 'd2', 'd3'])
  })

  it('gives an empty prior window when only one window was loaded', () => {
    const days = [1, 2, 3].map((n) => day(`d${n}`, n))
    const { current, prior } = splitTrafficWindows(days, 3)
    expect(current).toHaveLength(3)
    expect(prior).toEqual([])
  })

  it('never lets the prior window bleed into the current one', () => {
    // `slice(-2 * n, -n)` with a short array is where an off-by-one would
    // double-count the oldest displayed day into both windows.
    const days = [1, 2, 3, 4].map((n) => day(`d${n}`, n))
    const { current, prior } = splitTrafficWindows(days, 3)
    expect(current.map((entry) => entry.day)).toEqual(['d2', 'd3', 'd4'])
    expect(prior.map((entry) => entry.day)).toEqual(['d1'])
    const overlap = current.filter((entry) => prior.includes(entry))
    expect(overlap).toEqual([])
  })
})

describe('trafficDeltaPct', () => {
  it('reports the movement between two window totals', () => {
    expect(trafficDeltaPct(4820, 4300)).toBe(12.1)
    expect(trafficDeltaPct(900, 1000)).toBe(-10)
    expect(trafficDeltaPct(1000, 1000)).toBe(0)
  })

  it('says NOTHING when the prior window recorded nothing', () => {
    // A first week has no growth rate. `+100%` reads as growth against a
    // baseline that was never measured.
    expect(trafficDeltaPct(500, 0)).toBeNull()
    expect(trafficDeltaPct(0, 0)).toBeNull()
  })
})

describe('deviceSplit', () => {
  it('renders as the mockup shows it — labels and figures in one order', () => {
    const split = deviceSplit({ desktop: 390, mobile: 610 })
    expect(deviceSplitLabel(split)).toBe('Mobile / Desktop')
    expect(deviceSplitValue(split)).toBe('61% / 39%')
  })

  it('omits a device with no traffic rather than printing 0%', () => {
    // `Tablet 0%` reads as a measurement. Absence is not a measurement.
    const split = deviceSplit({ desktop: 4, mobile: 6, tablet: 0 })
    expect(split.map((entry) => entry.device)).toEqual(['mobile', 'desktop'])
    expect(deviceSplitLabel(split)).not.toContain('Tablet')
  })

  it('is empty when nothing was classified', () => {
    expect(deviceSplit({})).toEqual([])
    expect(deviceSplit({ desktop: 0 })).toEqual([])
    expect(deviceSplitValue(deviceSplit({}))).toBe('')
  })

  it('orders by share, largest first', () => {
    const split = deviceSplit({ tablet: 60, desktop: 30, mobile: 10 })
    expect(split.map((entry) => entry.device)).toEqual([
      'tablet',
      'desktop',
      'mobile',
    ])
  })
})

describe('rollUp', () => {
  it('sums a map across the window, biggest first', () => {
    const rolled = rollUp(
      [
        day('d1', 3, { paths: { '/': 2, '/pricing': 1 } }),
        day('d2', 4, { paths: { '/': 3, '/blog': 1 } }),
      ],
      'paths',
    )
    expect(rolled).toEqual([
      ['/', 5],
      ['/pricing', 1],
      ['/blog', 1],
    ])
    // The top row is what becomes the `Top page` tile.
    expect(rolled[0]).toEqual(['/', 5])
  })

  it('tolerates a day document missing the field entirely', () => {
    expect(rollUp([{}, day('d', 1, { referrers: { 'x.com': 2 } })], 'referrers'))
      .toEqual([['x.com', 2]])
  })
})

describe('formatDwell (AGL-2182)', () => {
  it('reads exactly as the mockup does', () => {
    expect(formatDwell(124_000)).toBe('2m 04s')
  })

  it('zero-pads the seconds so a column stays aligned', () => {
    expect(formatDwell(65_000)).toBe('1m 05s')
    expect(formatDwell(119_000)).toBe('1m 59s')
  })

  it('drops the minute part below a minute', () => {
    // `0m 04s` reads like a broken clock.
    expect(formatDwell(4_000)).toBe('4s')
    expect(formatDwell(0)).toBe('0s')
  })

  it('rolls over to hours rather than printing 90m', () => {
    expect(formatDwell(3_600_000)).toBe('1h 00m')
    expect(formatDwell(5_400_000)).toBe('1h 30m')
  })

  it('never renders a negative duration', () => {
    // A clock skew between the visitor and the server can produce one.
    expect(formatDwell(-5_000)).toBe('0s')
  })
})
