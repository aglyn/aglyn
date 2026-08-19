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
  aggregateScreenDays,
  topDevice,
  topReferrer,
} from './screen-analytics-aggregate'

it('folds multiple days of one screen into a single summed row', () => {
  const rows = aggregateScreenDays([
    { screenId: 'a', total: 3, devices: { desktop: 2, mobile: 1 } },
    { screenId: 'a', total: 5, devices: { desktop: 1, tablet: 4 } },
  ])
  expect(rows).toHaveLength(1)
  expect(rows[0].total).toBe(8)
  expect(rows[0].devices).toEqual({ desktop: 3, mobile: 1, tablet: 4 })
})

it('sorts screens by views descending', () => {
  const rows = aggregateScreenDays([
    { screenId: 'quiet', total: 1 },
    { screenId: 'busy', total: 10 },
    { screenId: 'middle', total: 5 },
  ])
  expect(rows.map((row) => row.screenId)).toEqual(['busy', 'middle', 'quiet'])
})

it('drops malformed docs instead of producing NaN rows', () => {
  const rows = aggregateScreenDays([
    { screenId: 'ok', total: 2 },
    { screenId: '', total: 4 },
    { screenId: 42 as any, total: 4 },
    { screenId: 'nan', total: 'wat' },
    { screenId: 'zero', total: 0 },
    { screenId: 'ok', total: 1, devices: { desktop: 'junk' as any } },
  ])
  expect(rows).toHaveLength(1)
  expect(rows[0]).toEqual({
    screenId: 'ok',
    total: 3,
    devices: {},
    referrers: {},
  })
})

it('names the leading device, empty when nothing was recorded', () => {
  const [row] = aggregateScreenDays([
    { screenId: 'a', total: 4, devices: { mobile: 3, desktop: 1 } },
  ])
  expect(topDevice(row)).toBe('mobile')
  const [bare] = aggregateScreenDays([{ screenId: 'b', total: 1 }])
  expect(topDevice(bare)).toBe('')
})

/**
 * REFERRERS REACH THE TABLE (AGL-2341).
 *
 * `/api/analytics/collect` increments `referrers` on every pageview, keyed by
 * referring host, and this helper modelled `total` and `devices` only — so
 * the widest-fanout field on the document reached the per-screen drilldown
 * and nothing else. "Where is my traffic coming from" could be asked one
 * screen at a time and never across the site.
 *
 * Each assertion below varies the COUNTS between hosts and between screens,
 * so a helper that summed to a constant, returned the first host it saw, or
 * reused one screen's leader for every row dies here. A single-screen,
 * single-referrer fixture would pass all of those.
 */
it('sums referrers per host across days, like the devices sibling', () => {
  const rows = aggregateScreenDays([
    {
      screenId: 'a',
      total: 9,
      referrers: { 'news.example': 5, 'search.example': 1 },
    },
    { screenId: 'a', total: 4, referrers: { 'news.example': 2 } },
  ])
  expect(rows[0].referrers).toEqual({
    'news.example': 7,
    'search.example': 1,
  })
})

it('names each screen’s OWN leading referrer', () => {
  const rows = aggregateScreenDays([
    {
      screenId: 'landing',
      total: 20,
      // The LEADER IS NOT FIRST in insertion order, deliberately. With it
      // first, `Object.entries(...)[0]` — take whatever came back — answers
      // correctly by accident, and the sort this helper does is unguarded.
      // Verified by making that exact mutation: the test stayed green until
      // these maps were reordered.
      referrers: { 'search.example': 3, 'news.example': 12 },
    },
    {
      screenId: 'pricing',
      total: 9,
      // A different leader, deliberately: one screen's answer must not be
      // handed to the other, which is what a table wired to `rows[0]` does.
      referrers: { 'news.example': 1, 'search.example': 8 },
    },
  ])
  const byScreen = Object.fromEntries(rows.map((row) => [row.screenId, row]))
  expect(topReferrer(byScreen['landing'])).toBe('news.example')
  expect(topReferrer(byScreen['pricing'])).toBe('search.example')
})

it('reports no referrer for a screen people reach directly', () => {
  // A direct visit records nothing, so the map is empty rather than absent —
  // and inventing a "direct" bucket the collector never wrote would be a
  // number nobody measured.
  const rows = aggregateScreenDays([{ screenId: 'a', total: 4 }])
  expect(rows[0].referrers).toEqual({})
  expect(topReferrer(rows[0])).toBe('')
})

it('drops a malformed referrer count rather than rendering NaN', () => {
  const rows = aggregateScreenDays([
    {
      screenId: 'a',
      total: 4,
      referrers: { 'good.example': 3, 'bad.example': 'lots' as unknown },
    },
  ])
  expect(rows[0].referrers).toEqual({ 'good.example': 3 })
})
