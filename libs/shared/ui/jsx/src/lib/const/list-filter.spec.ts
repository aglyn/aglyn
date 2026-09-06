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

import { type ListFilterField, matchListFilter } from './list-filter'

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
