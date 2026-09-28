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
  AREA_SERVED_MAX,
  AREA_SERVED_NAME_MAX_LENGTH,
  LOCAL_BUSINESS_TYPES,
  OPENING_HOURS_MAX_ROWS,
  invalidOpeningHoursLines,
  localBusinessType,
  normalizeAreaServed,
  parseOpeningHours,
} from './local-business'

describe('LOCAL_BUSINESS_TYPES', () => {
  it('lists each schema.org type once, every one a LocalBusiness', () => {
    const values = LOCAL_BUSINESS_TYPES.map((entry) => entry.value)
    expect(new Set(values).size).toBe(values.length)
    expect(values).toContain('LocalBusiness')
    // A schema.org type name: PascalCase, letters only.
    for (const value of values) expect(value).toMatch(/^[A-Z][A-Za-z]+$/)
  })
})

describe('localBusinessType', () => {
  it('accepts a listed type, in any case, and returns its canonical spelling', () => {
    expect(localBusinessType('Plumber')).toBe('Plumber')
    expect(localBusinessType(' realestateagent ')).toBe('RealEstateAgent')
  })

  it('refuses anything not on the list', () => {
    for (const value of ['', 'Organization', 'Person', 'Plumbr', 42, null, undefined]) {
      expect([value, localBusinessType(value)]).toEqual([value, undefined])
    }
  })
})

describe('normalizeAreaServed', () => {
  it('trims, drops blanks and de-duplicates without regard to case', () => {
    expect(
      normalizeAreaServed(['  Austin ', '', 'AUSTIN', 'Round  Rock', 7 as never]),
    ).toEqual(['Austin', 'Round Rock'])
  })

  it('reads a newline-separated string the same as an array', () => {
    expect(normalizeAreaServed('Austin\r\n\nPflugerville\n')).toEqual([
      'Austin',
      'Pflugerville',
    ])
  })

  it('caps the count and the length of each name', () => {
    const many = Array.from({ length: AREA_SERVED_MAX + 5 }, (_, i) => `Town ${i}`)
    expect(normalizeAreaServed(many)).toHaveLength(AREA_SERVED_MAX)
    expect(normalizeAreaServed(['x'.repeat(500)])[0]).toHaveLength(
      AREA_SERVED_NAME_MAX_LENGTH,
    )
  })

  it('is empty for nothing', () => {
    expect(normalizeAreaServed(undefined)).toEqual([])
    expect(normalizeAreaServed({})).toEqual([])
  })
})

describe('parseOpeningHours', () => {
  it('reads a range, a list and a single day', () => {
    expect(
      parseOpeningHours('Mo-Fr 09:00-17:00\nMo,We,Fr 7:30-12:00\nSu 10:00-14:00'),
    ).toEqual([
      {
        days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        opens: '09:00',
        closes: '17:00',
      },
      { days: ['Monday', 'Wednesday', 'Friday'], opens: '07:30', closes: '12:00' },
      { days: ['Sunday'], opens: '10:00', closes: '14:00' },
    ])
  })

  it('takes three-letter and full day names, and a dash of any width', () => {
    expect(parseOpeningHours('Mon – Thursday 08:00–16:00')).toEqual([
      {
        days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'],
        opens: '08:00',
        closes: '16:00',
      },
    ])
  })

  it('wraps a range across the weekend', () => {
    expect(parseOpeningHours('Fr-Mo 18:00-02:00')).toEqual([
      {
        days: ['Friday', 'Saturday', 'Sunday', 'Monday'],
        opens: '18:00',
        closes: '02:00',
      },
    ])
  })

  it('drops a line with a bad day, a bad time or no closing time', () => {
    expect(
      parseOpeningHours(
        [
          'Mo-Fr 24:00-17:00',
          'Mo-Fr 09:60-17:00',
          'T 09:00-17:00',
          'Xy 09:00-17:00',
          'Mo-We-Fr 09:00-17:00',
          'Sa 09:00',
          '09:00-17:00',
          'Sa 10:00-14:00',
        ].join('\n'),
      ),
    ).toEqual([{ days: ['Saturday'], opens: '10:00', closes: '14:00' }])
  })

  it('caps the rows', () => {
    const text = Array.from({ length: 30 }, () => 'Mo 09:00-10:00').join('\n')
    expect(parseOpeningHours(text)).toHaveLength(OPENING_HOURS_MAX_ROWS)
  })

  it('is empty for anything that is not text', () => {
    expect(parseOpeningHours(undefined)).toEqual([])
    expect(parseOpeningHours(['Mo 09:00-17:00'])).toEqual([])
  })
})

describe('invalidOpeningHoursLines', () => {
  it('names the lines that would be dropped, ignoring blank ones', () => {
    expect(invalidOpeningHoursLines('Mo-Fr 09:00-17:00\n\nSa 9-5\nSu nope')).toEqual([
      3, 4,
    ])
    expect(invalidOpeningHoursLines('Mo-Fr 09:00-17:00')).toEqual([])
    expect(invalidOpeningHoursLines(undefined)).toEqual([])
  })
})
