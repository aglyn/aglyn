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
 * The site accounts list serves Status beside its one field clause, as an
 * equality on the boolean every member now carries (AGL-3321).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  where: (path: unknown, op: string, value: unknown) => ['where', path, op, value],
  orderBy: (path: unknown, direction?: string) => ['orderBy', path, direction ?? 'asc'],
  startAt: (value: unknown) => ['startAt', value],
  endAt: (value: unknown) => ['endAt', value],
  documentId: () => '__name__',
}))

import { orderBy } from 'firebase/firestore'
import { siteAccountQueryConstraints } from './site-account-query'

/** The list's own order, as the card names it. */
const NEWEST = [orderBy('createdAt', 'desc')]

const active = { field: 'suspended', op: 'equals', value: 'false' }
const suspended = { field: 'suspended', op: 'equals', value: 'true' }

describe('siteAccountQueryConstraints', () => {
  it('reads newest first, unfiltered', () => {
    expect(siteAccountQueryConstraints([], NEWEST)).toEqual([['orderBy', 'createdAt', 'desc']])
  })

  it('serves Status alone as an equality on the stored boolean, newest first', () => {
    expect(siteAccountQueryConstraints([active], NEWEST)).toEqual([
      ['where', 'suspended', '==', false],
      ['orderBy', 'createdAt', 'desc'],
    ])
    expect(siteAccountQueryConstraints([suspended], NEWEST)).toEqual([
      ['where', 'suspended', '==', true],
      ['orderBy', 'createdAt', 'desc'],
    ])
  })

  it('serves a field clause as before, with Status prefixed beside it', () => {
    const prefix = { field: 'email', op: 'startsWith', value: 'Ann' }
    expect(siteAccountQueryConstraints([prefix], NEWEST)).toEqual([
      ['orderBy', 'email', 'asc'],
      ['startAt', 'ann'],
      ['endAt', 'ann'],
    ])
    expect(siteAccountQueryConstraints([prefix, suspended], NEWEST)).toEqual([
      ['where', 'suspended', '==', true],
      ['orderBy', 'email', 'asc'],
      ['startAt', 'ann'],
      ['endAt', 'ann'],
    ])
    expect(
      siteAccountQueryConstraints(
        [active, { field: 'displayName', op: 'contains', value: 'rae' }],
        NEWEST,
      ),
    ).toEqual([
      ['where', 'suspended', '==', false],
      ['where', 'displayNameTokens', 'array-contains', 'rae'],
      ['orderBy', 'displayNameLower', 'asc'],
    ])
  })

  it('ignores a Status it cannot serve rather than guessing', () => {
    expect(
      siteAccountQueryConstraints(
        [{ field: 'suspended', op: 'equals', value: 'maybe' }],
        NEWEST,
      ),
    ).toEqual([['orderBy', 'createdAt', 'desc']])
  })

  it('every pairing it builds has its composite index', () => {
    const indexes = JSON.parse(
      readFileSync(
        join(__dirname, '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'),
        'utf8',
      ),
    ).indexes as Array<{
      collectionGroup: string
      fields: Array<{ fieldPath: string; order?: string; arrayConfig?: string }>
    }>
    const shapes = indexes
      .filter((index) => index.collectionGroup === 'siteMembers')
      .map((index) =>
        index.fields
          .map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`)
          .join(','),
      )
    expect(shapes).toEqual(
      expect.arrayContaining([
        // Status alone, beneath the newest-first order.
        'suspended:ASCENDING,createdAt:DESCENDING',
        // Beside a Joined range, a prefix of Email or Name, a Name word, and
        // Name "is not empty" — each clause's own ordering.
        'suspended:ASCENDING,createdAt:ASCENDING',
        'suspended:ASCENDING,email:ASCENDING',
        'suspended:ASCENDING,displayNameLower:ASCENDING',
        'displayNameTokens:CONTAINS,suspended:ASCENDING,displayNameLower:ASCENDING',
        'suspended:ASCENDING,displayName:ASCENDING',
      ]),
    )
  })
})
