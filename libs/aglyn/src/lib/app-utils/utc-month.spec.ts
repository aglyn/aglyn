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

import { nextUtcMonthStart, utcMonthKey } from './utc-month'

describe('the month a monthly counter is keyed by', () => {
  it('is the UTC YYYY-MM every writer keys its counters with', () => {
    // A reader deriving the key differently would read zero on exactly the
    // sites a counter is about (AGL-1666).
    const now = new Date('2026-08-14T12:00:00.000Z')
    expect(utcMonthKey(now)).toBe(now.toISOString().slice(0, 7))
    expect(utcMonthKey(now)).toBe('2026-08')
    expect(utcMonthKey(new Date('2026-08-31T23:59:59.000Z'))).toBe('2026-08')
  })

  it('rolls over on the FIRST of next month, in UTC, and rolls the year', () => {
    expect(nextUtcMonthStart(new Date('2026-08-14T12:00:00.000Z')).toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    )
    expect(nextUtcMonthStart(new Date('2026-12-31T23:59:59.000Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    )
  })
})
