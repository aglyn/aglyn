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
 * Several clauses at once (AGL-2617): the first the query can serve goes to
 * the query, every other narrows the window — and a field that lives where
 * no query reaches is never served at all.
 *
 * The web SDK's constraint builders are replaced with plain objects so a
 * case can read back WHICH predicate was built; the translator's own
 * behavior per operator is the console spec's business.
 */

jest.mock('firebase/firestore', () => ({
  where: (path: string, op: string, value: unknown) => ({ where: path, op, value }),
  orderBy: (path: unknown, direction?: string) => ({ orderBy: path, direction }),
  startAt: (value: unknown) => ({ startAt: value }),
  endAt: (value: unknown) => ({ endAt: value }),
  documentId: () => '__name__',
  Timestamp: { fromDate: (date: Date) => ({ ts: date.toISOString() }) },
}))

import type { ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'
import { listFilterConstraints, listFilterPlan } from './list-filter-constraints'

const FIELDS: readonly ListFilterField[] = [
  { column: 'name', kind: 'text', path: 'name', lowerPath: 'nameLower' },
  {
    column: 'tags',
    kind: 'text',
    path: 'tags',
    tokensPath: 'tags',
    containsOrderBy: 'updatedAt',
    operators: ['contains', 'isAnyOf'],
  },
  // A facet field: in the menu, in a view, never on the query.
  { column: 'ownerUid', kind: 'exact', path: 'ownerUid', windowOnly: true },
  { column: 'source', kind: 'exact', path: 'sources', keysOf: true },
]

describe('a window-only field is never served', () => {
  it('returns null for every operator, so the list matches it over the rows', () => {
    expect(
      listFilterConstraints(FIELDS, { field: 'ownerUid', op: 'equals', value: 'uid-a' }),
    ).toBeNull()
    expect(
      listFilterConstraints(FIELDS, { field: 'ownerUid', op: 'isNotEmpty', value: '' }),
    ).toBeNull()
  })
})

describe('a presence map is served one key at a time', () => {
  it('equals becomes the equality on the key path', () => {
    expect(
      listFilterConstraints(FIELDS, { field: 'source', op: 'equals', value: 'form' }),
    ).toEqual([
      { where: 'sources.form', op: '==', value: true },
      { orderBy: '__name__', direction: undefined },
    ])
  })

  it('refuses a key that could not be a path, and every other operator', () => {
    expect(
      listFilterConstraints(FIELDS, { field: 'source', op: 'equals', value: 'a.b' }),
    ).toBeNull()
    expect(
      listFilterConstraints(FIELDS, { field: 'source', op: 'isAnyOf', value: 'form,order' }),
    ).toBeNull()
  })
})

describe('the plan serves the first SERVABLE clause and windows the rest', () => {
  it('skips a leading clause the query cannot carry', () => {
    const plan = listFilterPlan(FIELDS, [
      { field: 'ownerUid', op: 'equals', value: 'uid-a' },
      { field: 'name', op: 'startsWith', value: 'ac' },
      { field: 'tags', op: 'contains', value: 'vip' },
    ])
    expect(plan.served).toEqual({ field: 'name', op: 'startsWith', value: 'ac' })
    expect(plan.constraints).toEqual([
      { orderBy: 'nameLower', direction: undefined },
      { startAt: 'ac' },
      { endAt: 'ac' },
    ])
    // In their original order, the owner clause included.
    expect(plan.window).toEqual([
      { field: 'ownerUid', op: 'equals', value: 'uid-a' },
      { field: 'tags', op: 'contains', value: 'vip' },
    ])
  })

  it('serves nothing when no clause can be, and windows them all', () => {
    const plan = listFilterPlan(FIELDS, [
      { field: 'ownerUid', op: 'equals', value: 'uid-a' },
      { field: 'tags', op: 'isAnyOf', value: 'vip,beta' },
    ])
    expect(plan.served).toBeNull()
    expect(plan.constraints).toBeNull()
    expect(plan.window).toHaveLength(2)
  })

  it('honors a pinned sort exactly as the single translator does', () => {
    const plan = listFilterPlan(
      FIELDS,
      [{ field: 'name', op: 'startsWith', value: 'ac' }],
      { fixedOrderBy: 'updatedAt' },
    )
    // A prefix range needs its own ordering, which a pinned sort forbids.
    expect(plan.served).toBeNull()
    expect(plan.window).toEqual([{ field: 'name', op: 'startsWith', value: 'ac' }])
  })

  it('is empty for no clauses', () => {
    expect(listFilterPlan(FIELDS, [])).toEqual({
      served: null,
      constraints: null,
      window: [],
    })
  })
})
