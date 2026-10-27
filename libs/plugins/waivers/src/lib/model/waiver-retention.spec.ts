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
  WAIVERS_CONFIG_SCHEMA,
  WAIVER_RETENTION_YEARS,
  waiverRetainUntilMs,
  waiverRetentionStartDayKey,
  waiverRetentionYears,
} from './waiver-retention'

/**
 * How long a signed waiver is kept after its signer asks to be erased
 * (AGL-4042): the store's setting in whole years, counted from the last day
 * the waiver covers, or from the day the youngest minor on it reaches the
 * waiver's adult age, whichever is later.
 */

describe('the retention setting', () => {
  it('defaults to seven years, inside one to thirty', () => {
    expect(WAIVERS_CONFIG_SCHEMA.defaults).toEqual({ retentionYears: 7 })
    expect(WAIVERS_CONFIG_SCHEMA.fields[0]).toMatchObject({ key: 'retentionYears', type: 'number', min: 1, max: 30 })
    expect(waiverRetentionYears({})).toBe(WAIVER_RETENTION_YEARS.default)
    expect(waiverRetentionYears({ retentionYears: 10 })).toBe(10)
    expect(waiverRetentionYears({ retentionYears: '3' })).toBe(3)
    expect(waiverRetentionYears({ retentionYears: 0 })).toBe(1)
    expect(waiverRetentionYears({ retentionYears: 99 })).toBe(30)
    expect(waiverRetentionYears({ retentionYears: 'soon' })).toBe(7)
  })
})

describe('when a kept signature is deleted', () => {
  const adult = { validThroughDayKey: '2026-10-24', minors: [], adultAge: 18 }

  it('counts the years from the last day the waiver covers, keeping that whole last day', () => {
    expect(waiverRetentionStartDayKey(adult)).toBe('2026-10-24')
    expect(waiverRetainUntilMs(adult, 7)).toBe(Date.UTC(2033, 9, 25))
    expect(waiverRetainUntilMs({ ...adult, validThroughDayKey: '2027-10-23' }, 1)).toBe(Date.UTC(2028, 9, 24))
  })

  it('counts from the day the youngest minor reaches the waiver’s adult age, when that is later', () => {
    const minors = [
      { name: 'Pat Lee', dateOfBirth: '2014-09-30' },
      { name: 'Sam Lee', dateOfBirth: '2016-03-02' },
    ]
    expect(waiverRetentionStartDayKey({ ...adult, minors })).toBe('2034-03-02')
    expect(waiverRetentionStartDayKey({ ...adult, minors, adultAge: 21 })).toBe('2037-03-02')
    expect(waiverRetainUntilMs({ ...adult, minors }, 7)).toBe(Date.UTC(2041, 2, 3))
    // A signature taken before each waiver set its own adult age reads as 18.
    expect(waiverRetentionStartDayKey({ validThroughDayKey: '2026-10-24', minors })).toBe('2034-03-02')
  })

  it('never ends a day early on a leap day', () => {
    expect(waiverRetainUntilMs({ validThroughDayKey: '2028-02-29' }, 1)).toBe(Date.UTC(2029, 2, 2))
  })
})
