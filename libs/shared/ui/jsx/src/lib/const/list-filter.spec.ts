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
 * The in-memory matcher and the query translators read the same declaration,
 * so a field that says its tokens are opaque ids has to mean it in memory
 * too (AGL-2612): a form id is minted with mixed case, and a matcher that
 * folded it would answer "not in this form" for the one form it is in.
 */

import {
  gridFilterRequest,
  gridFilterRequests,
  type ListFilterField,
  listFilterOperatorLabel,
  matchListFilter,
} from './list-filter'

const FIELDS: readonly ListFilterField[] = [
  {
    column: 'formIds',
    kind: 'text',
    path: 'formIds',
    tokensPath: 'formIds',
    verbatimTokens: true,
    operators: ['contains'],
  },
  {
    column: 'tags',
    kind: 'text',
    path: 'tags',
    tokensPath: 'tags',
    operators: ['contains'],
  },
]

describe('matchListFilter with verbatim tokens', () => {
  const row = { formIds: ['Fx9_Q-abc', 'other'], tags: ['vip', 'beta'] }

  it('matches an id whole and byte for byte', () => {
    expect(
      matchListFilter(row, FIELDS, { field: 'formIds', op: 'contains', value: 'Fx9_Q-abc' }),
    ).toBe(true)
    // Folded, and therefore a different id.
    expect(
      matchListFilter(row, FIELDS, { field: 'formIds', op: 'contains', value: 'fx9_q-abc' }),
    ).toBe(false)
    // A prefix of an id is not the id.
    expect(
      matchListFilter(row, FIELDS, { field: 'formIds', op: 'contains', value: 'Fx9' }),
    ).toBe(false)
  })

  it('leaves a word-token field case-folded, as it always was', () => {
    expect(
      matchListFilter(row, FIELDS, { field: 'tags', op: 'contains', value: 'VIP' }),
    ).toBe(true)
  })
})

/**
 * A saved view carries a LIST of clauses (AGL-2617), and most of them are
 * matched over the rows a bounded query returned — so the in-memory matcher
 * has to read an array by member and a presence map by key, and the plural
 * reader has to keep every item the singular one would have taken.
 */
describe('an array is matched by whole member', () => {
  const contact = { tags: ['vip', 'wholesale'], sources: { form: true, order: false } }
  const VIEW_FIELDS: readonly ListFilterField[] = [
    ...FIELDS,
    { column: 'source', kind: 'exact', path: 'sources', keysOf: true },
  ]

  it('contains is a member, not a substring of the joined array', () => {
    expect(
      matchListFilter(contact, VIEW_FIELDS, { field: 'tags', op: 'contains', value: 'vip' }),
    ).toBe(true)
    // `vip` is not a prefix search over `vip-gold`, and the query's own
    // `array-contains` would not have said so either.
    expect(
      matchListFilter(
        { tags: ['vip-gold'] },
        VIEW_FIELDS,
        { field: 'tags', op: 'contains', value: 'vip' },
      ),
    ).toBe(false)
  })

  it('isAnyOf is any member in the asked list', () => {
    expect(
      matchListFilter(contact, VIEW_FIELDS, {
        field: 'tags',
        op: 'isAnyOf',
        value: 'beta, wholesale',
      }),
    ).toBe(true)
    expect(
      matchListFilter(contact, VIEW_FIELDS, { field: 'tags', op: 'isAnyOf', value: 'beta' }),
    ).toBe(false)
  })

  it('an empty array is empty', () => {
    expect(
      matchListFilter({ tags: [] }, VIEW_FIELDS, { field: 'tags', op: 'isNotEmpty', value: '' }),
    ).toBe(false)
    expect(
      matchListFilter({ tags: [] }, VIEW_FIELDS, { field: 'tags', op: 'isEmpty', value: '' }),
    ).toBe(true)
  })

  it('a plain array the query never serves is matched as its joined text', () => {
    // The staff account list's providers: no token path, so no
    // `array-contains` to agree with, and `contains google` finding
    // `google.com` is the mid-string answer that list documents.
    const PLAIN: readonly ListFilterField[] = [
      { column: 'providers', kind: 'text', path: 'providers' },
    ]
    expect(
      matchListFilter({ providers: ['google.com', 'password'] }, PLAIN, {
        field: 'providers',
        op: 'contains',
        value: 'google',
      }),
    ).toBe(true)
    expect(
      matchListFilter({ providers: ['password'] }, PLAIN, {
        field: 'providers',
        op: 'doesNotContain',
        value: 'google',
      }),
    ).toBe(true)
  })

  it('a presence map is matched on its truthy keys', () => {
    expect(
      matchListFilter(contact, VIEW_FIELDS, { field: 'source', op: 'equals', value: 'form' }),
    ).toBe(true)
    // `order: false` is not a source the person came in through.
    expect(
      matchListFilter(contact, VIEW_FIELDS, { field: 'source', op: 'equals', value: 'order' }),
    ).toBe(false)
    expect(
      matchListFilter(contact, VIEW_FIELDS, {
        field: 'source',
        op: 'isAnyOf',
        value: 'order,form',
      }),
    ).toBe(true)
    expect(
      matchListFilter({ sources: {} }, VIEW_FIELDS, { field: 'source', op: 'isNotEmpty', value: '' }),
    ).toBe(false)
  })
})

describe('the plural reader keeps every usable item', () => {
  it('in panel order, dropping only what the singular reader would drop', () => {
    const model = {
      items: [
        { field: 'name', operator: 'contains', value: '' },
        { field: 'tags', operator: 'contains', value: 'vip' },
        { field: 'ordersCount', operator: 'isNotEmpty' },
        { field: 'email', operator: 'equals', value: null },
        { field: 'createdAt', operator: 'after', value: new Date('2026-01-02T00:00:00.000Z') },
      ],
    }
    expect(gridFilterRequests(model)).toEqual([
      { field: 'tags', op: 'contains', value: 'vip' },
      { field: 'ordersCount', op: 'isNotEmpty', value: '' },
      { field: 'createdAt', op: 'after', value: '2026-01-02T00:00:00.000Z' },
    ])
    // The two readers agree on what the first usable item is.
    expect(gridFilterRequest(model)).toEqual(gridFilterRequests(model)[0])
  })

  it('reads an operator back as a sentence, and an unknown one as itself', () => {
    expect(listFilterOperatorLabel('isAnyOf')).toBe('is any of')
    expect(listFilterOperatorLabel('onOrAfter')).toBe('on or after')
    expect(listFilterOperatorLabel('>=')).toBe('at least')
    expect(listFilterOperatorLabel('between')).toBe('between')
  })
})
