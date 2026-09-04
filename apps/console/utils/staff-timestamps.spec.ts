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

import { formatStaffTimestamp } from './staff-timestamps'

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
