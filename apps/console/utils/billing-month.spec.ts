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
 * The billing month (AGL-2219).
 *
 * `monthIsClosed` is the single predicate standing between the in-progress
 * usage sweep and a permanently wrong invoice, so it is pinned on its own,
 * with an explicit clock, rather than only through the route.
 */

import {
  currentMonth,
  monthIsClosed,
  previousMonth,
} from './billing-month'

/** Mid-month, mid-day, so no case is accidentally a boundary case. */
const NOW = new Date('2026-08-19T03:00:00.000Z')

describe('currentMonth / previousMonth', () => {
  it('reads the month in progress, in UTC', () => {
    expect(currentMonth(NOW)).toBe('2026-08')
    expect(previousMonth(NOW)).toBe('2026-07')
  })

  it('crosses a year boundary backwards', () => {
    const january = new Date('2026-01-04T00:00:00.000Z')
    expect(currentMonth(january)).toBe('2026-01')
    expect(previousMonth(january)).toBe('2025-12')
  })

  it('is UTC, not local — the last hour of a month is still that month', () => {
    // Every meter on the platform keys on UTC. A helper that answered in
    // local time would put the last hours of the 31st into the next month
    // for anyone east of Greenwich, and the invoice would disagree with the
    // counters it was summed from.
    const lastInstant = new Date('2026-08-31T23:59:59.999Z')
    expect(currentMonth(lastInstant)).toBe('2026-08')
  })
})

describe('monthIsClosed — may this month be invoiced?', () => {
  it('is CLOSED for a month that has ended', () => {
    expect(monthIsClosed('2026-07', NOW)).toBe(true)
    expect(monthIsClosed('2025-12', NOW)).toBe(true)
  })

  it('is OPEN for the month in progress', () => {
    // The whole point: the in-progress sweep names this month, and naming it
    // must not make it reportable.
    expect(monthIsClosed('2026-08', NOW)).toBe(false)
  })

  it('is OPEN for a month that has not started', () => {
    expect(monthIsClosed('2026-09', NOW)).toBe(false)
    expect(monthIsClosed('2027-01', NOW)).toBe(false)
  })

  it('FAILS CLOSED on anything that is not a YYYY-MM', () => {
    // Fail-closed in the direction that matters: a month wrongly withheld
    // reports late and visibly; a month wrongly metered is a Stripe meter
    // event keyed `{orgId}-{month}` that can never be corrected.
    for (const bad of [
      '',
      'current',
      '2026',
      '2026-8',
      '2026-07-01',
      'nope',
      null,
      undefined,
      // A far-past-looking string that is not a month must not sneak through
      // on the lexicographic comparison alone.
      '1999',
    ]) {
      expect(monthIsClosed(bad as never, NOW)).toBe(false)
    }
  })

  it('compares as a month key, not as a number', () => {
    // '2026-9' < '2026-10' is true numerically and false as a key. The regex
    // rejects the unpadded form, which is why the padding matters here.
    expect(monthIsClosed('2026-09', new Date('2026-10-02T00:00:00.000Z'))).toBe(
      true,
    )
    expect(monthIsClosed('2026-10', new Date('2026-10-02T00:00:00.000Z'))).toBe(
      false,
    )
  })

  it('closes the previous month the instant the new one starts', () => {
    const firstInstant = new Date('2026-09-01T00:00:00.000Z')
    expect(monthIsClosed('2026-08', firstInstant)).toBe(true)
    expect(monthIsClosed('2026-09', firstInstant)).toBe(false)
  })
})
