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
  formatStaffActivity,
  formatStaffAgo,
  formatStaffTimestamp,
} from './staff-timestamps'

describe('formatStaffTimestamp', () => {
  const moment = '2026-08-26T04:48:13.000Z'

  it('carries the TIME, which a date alone throws away', () => {
    const formatted = formatStaffTimestamp(moment)
    expect(formatted).not.toBe(new Date(moment).toLocaleDateString())
    expect(formatted).toBe(new Date(moment).toLocaleString())
  })

  it('answers in the reader own zone, not GMT', () => {
    // The identity card printed the raw Firebase Auth string, which is
    // `Wed, 26 Aug 2026 04:48:13 GMT` — correct, and the arithmetic is left
    // to someone making a decision about a live session.
    expect(formatStaffTimestamp(moment)).not.toContain('GMT')
  })

  it('takes the shapes these surfaces actually hold', () => {
    const expected = new Date(moment).toLocaleString()
    expect(formatStaffTimestamp(new Date(moment))).toBe(expected)
    expect(formatStaffTimestamp(Date.parse(moment))).toBe(expected)
    expect(formatStaffTimestamp('Wed, 26 Aug 2026 04:48:13 GMT')).toBe(expected)
  })

  it('shows an em dash for nothing at all', () => {
    // An account that has never signed in.
    for (const empty of [null, undefined, '']) {
      expect(formatStaffTimestamp(empty)).toBe('—')
    }
  })

  /**
   * Absent and unparseable are different answers. A value that IS there is
   * data the surface received; turning it into the same em dash hides a real
   * answer behind the shape of an absent one.
   */
  it('passes an unparseable value through rather than hiding it', () => {
    expect(formatStaffTimestamp('not a date')).toBe('not a date')
  })
})

describe('formatStaffAgo and formatStaffActivity (last activity)', () => {
  const now = Date.parse('2026-10-09T20:00:00.000Z')
  const before = (ms: number) => new Date(now - ms).toISOString()
  const MIN = 60_000

  it('says how long ago in the one unit worth reading', () => {
    expect(formatStaffAgo(before(20_000), now)).toBe('just now')
    expect(formatStaffAgo(before(12 * MIN), now)).toBe('12 min ago')
    expect(formatStaffAgo(before(3 * 60 * MIN), now)).toBe('3 h ago')
    expect(formatStaffAgo(before(5 * 24 * 60 * MIN), now)).toBe('5 d ago')
    expect(formatStaffAgo(before(100 * 24 * 60 * MIN), now)).toBe('3 mo ago')
    expect(formatStaffAgo(before(800 * 24 * 60 * MIN), now)).toBe('2 y ago')
  })

  it('reads a moment ahead of the reader clock as just now, never negative', () => {
    expect(formatStaffAgo(new Date(now + 5 * MIN).toISOString(), now)).toBe('just now')
  })

  it('is null for nothing and for what does not parse', () => {
    for (const empty of [null, undefined, '', 'not a date']) {
      expect(formatStaffAgo(empty, now)).toBeNull()
    }
  })

  it('pairs the local date and time with the age', () => {
    const at = before(2 * 60 * MIN)
    expect(formatStaffActivity(at, now)).toBe(`${new Date(at).toLocaleString()} · 2 h ago`)
    expect(formatStaffActivity(null, now)).toBe('—')
  })
})
