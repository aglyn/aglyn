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
  expect(rows[0]).toEqual({ screenId: 'ok', total: 3, devices: {} })
})

it('names the leading device, empty when nothing was recorded', () => {
  const [row] = aggregateScreenDays([
    { screenId: 'a', total: 4, devices: { mobile: 3, desktop: 1 } },
  ])
  expect(topDevice(row)).toBe('mobile')
  const [bare] = aggregateScreenDays([{ screenId: 'b', total: 1 }])
  expect(topDevice(bare)).toBe('')
})
