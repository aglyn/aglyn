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
  buildMatchLookup,
  domainOf,
  foldName,
  foldSlug,
  MATCH_KEY_PART_SEPARATOR,
  matchKeyValue,
  matchLookupKey,
  matchLookupRequests,
  matchRows,
  normalizeMatchValue,
  summarizeMatches,
} from './match'
import type { MatchKeySpec } from './match'

describe('normalizers', () => {
  it('reads a domain from a web address or an email address', () => {
    expect(domainOf('https://www.Example.com/about?x=1')).toBe('example.com')
    expect(domainOf('bob@Mail.Example.co.uk')).toBe('mail.example.co.uk')
    expect(domainOf('example.com:8080')).toBe('example.com')
    expect(domainOf('http://user@host.io')).toBe('host.io')
    expect(domainOf('not a domain')).toBeNull()
    expect(domainOf('')).toBeNull()
  })

  it('folds names and slugs', () => {
    expect(foldName('  Café  & Co., Inc. ')).toBe('cafe and co inc')
    expect(foldSlug('About Us!')).toBe('about-us')
  })

  it('normalizes each kind of key and returns null for no key', () => {
    expect(normalizeMatchValue('email', ' Jane@Example.com ')).toBe('jane@example.com')
    expect(normalizeMatchValue('email', 'nope')).toBeNull()
    expect(normalizeMatchValue('domain', 'jane@example.com')).toBe('example.com')
    expect(normalizeMatchValue('name', 'ACME  Corp')).toBe('acme corp')
    expect(normalizeMatchValue('slug', 'Home Page')).toBe('home-page')
    expect(normalizeMatchValue('phone', '(512) 555-0107')).toBe('+15125550107')
    expect(normalizeMatchValue('externalId', ' 0013x00 ')).toBe('0013x00')
    expect(normalizeMatchValue('caseless', ' AbC ')).toBe('abc')
    expect(normalizeMatchValue('exact', ' AbC ')).toBe(' AbC ')
    expect(normalizeMatchValue('aglynId', '')).toBeNull()
    expect(normalizeMatchValue('trim', null)).toBeNull()
  })
})

const keys: MatchKeySpec[] = [
  { fieldId: 'id', normalizer: 'aglynId' },
  { fieldId: 'email', normalizer: 'email' },
  { fieldId: 'website', normalizer: 'domain' },
]

const existing = [
  { id: 'r1', values: { email: 'jane@example.com', website: 'https://jane.dev' } },
  { id: 'r2', values: { email: 'bob@example.org', website: 'shared.io' } },
  { id: 'r3', values: { email: ['alt@example.net', 'third@example.net'], website: 'www.shared.io' } },
]

describe('lookups', () => {
  it('lists the distinct values each key must be looked up for', () => {
    expect(
      matchLookupRequests([{ email: 'A@x.co' }, { email: 'a@x.co', website: 'x.co' }, { id: 'r9' }], keys),
    ).toEqual([
      { fieldId: 'id', normalizer: 'aglynId', values: ['r9'] },
      { fieldId: 'email', normalizer: 'email', values: ['a@x.co'] },
      { fieldId: 'website', normalizer: 'domain', values: ['x.co'] },
    ])
  })

  it('files every record under each of its key values, its own id included', () => {
    const lookup = buildMatchLookup(existing, keys)
    expect(lookup.get(matchLookupKey('id', 'r1'))).toEqual(['r1'])
    expect(lookup.get(matchLookupKey('email', 'third@example.net'))).toEqual(['r3'])
    expect(lookup.get(matchLookupKey('website', 'shared.io'))).toEqual(['r2', 'r3'])
  })
})

describe('matchRows', () => {
  const lookup = buildMatchLookup(existing, keys)

  it('decides by the first key that finds anything', () => {
    const outcomes = matchRows(
      [
        { id: 'r2', email: 'jane@example.com' },
        { email: 'JANE@example.com ' },
        { email: 'new@example.com', website: 'https://jane.dev' },
        { email: 'nobody@example.com' },
      ],
      keys,
      lookup,
    )
    expect(outcomes[0]).toEqual({ kind: 'matched', recordId: 'r2', via: { fieldId: 'id', value: 'r2' }, alsoMatched: ['r1'] })
    expect(outcomes[1]).toEqual({ kind: 'duplicateInFile', firstRow: 0, via: { fieldId: 'email', value: 'jane@example.com' } })
    expect(outcomes[2]).toEqual({ kind: 'matched', recordId: 'r1', via: { fieldId: 'website', value: 'jane.dev' } })
    expect(outcomes[3]).toEqual({ kind: 'new' })
  })

  it('reports several records for one key as ambiguous', () => {
    expect(matchRows([{ website: 'shared.io' }], keys, lookup)).toEqual([
      { kind: 'ambiguous', recordIds: ['r2', 'r3'], via: { fieldId: 'website', value: 'shared.io' } },
    ])
  })

  it('holds back a later row that repeats any key of an earlier one, matched or not', () => {
    const outcomes = matchRows(
      [{ email: 'fresh@example.com' }, { email: 'other@example.com', website: 'z.io' }, { website: 'Z.io' }],
      keys,
      lookup,
    )
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['new', 'new', 'duplicateInFile'])
    expect(summarizeMatches(outcomes)).toEqual({ new: 2, matched: 0, ambiguous: 0, duplicateInFile: 1 })
  })

  it('treats a row with no key as new', () => {
    expect(matchRows([{ name: 'Nobody' }], keys, lookup)).toEqual([{ kind: 'new' }])
  })
})

describe('compound keys', () => {
  const key: MatchKeySpec = { fieldId: 'title', normalizer: 'name', with: [{ fieldId: 'startsAt', normalizer: 'instant' }] }
  const START = Date.UTC(2026, 9, 5, 14, 30)

  it('reads a moment to the minute from milliseconds, ISO text or a Date', () => {
    expect(normalizeMatchValue('instant', START)).toBe('2026-10-05T14:30Z')
    expect(normalizeMatchValue('instant', '2026-10-05T09:30:41-05:00')).toBe('2026-10-05T14:30Z')
    expect(normalizeMatchValue('instant', new Date(START))).toBe('2026-10-05T14:30Z')
    expect(normalizeMatchValue('instant', String(START))).toBe('2026-10-05T14:30Z')
    expect(normalizeMatchValue('instant', 'not a date')).toBeNull()
  })

  it('joins every part, and has no value when a part is missing', () => {
    expect(matchKeyValue(key, { title: 'Yoga, Level 1', startsAt: START })).toBe(
      `yoga level 1${MATCH_KEY_PART_SEPARATOR}2026-10-05T14:30Z`,
    )
    expect(matchKeyValue(key, { title: 'Yoga' })).toBeNull()
  })

  it('tells a weekly event apart by its start, and finds the one at the same moment', () => {
    const lookup = buildMatchLookup(
      [
        { id: 'e1', values: { title: 'Yoga', startsAt: START } },
        { id: 'e2', values: { title: 'Yoga', startsAt: START + 7 * 86_400_000 } },
      ],
      [key],
    )
    const outcomes = matchRows(
      [
        { title: 'yoga', startsAt: '2026-10-05T14:30:00Z' },
        { title: 'Yoga', startsAt: '2026-10-19T14:30:00Z' },
        { title: 'Yoga', startsAt: '2026-10-19T14:30:00Z' },
      ],
      [key],
      lookup,
    )
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['matched', 'new', 'duplicateInFile'])
    expect(outcomes[0]).toMatchObject({ recordId: 'e1' })
    expect(matchLookupRequests([{ title: 'Yoga', startsAt: START }], [key])).toEqual([
      { ...key, values: [`yoga${MATCH_KEY_PART_SEPARATOR}2026-10-05T14:30Z`] },
    ])
  })
})
