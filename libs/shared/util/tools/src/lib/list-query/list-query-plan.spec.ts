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
 * Every clause and the search on ONE query, or refused by name (AGL-3321).
 */

import type { ListFilterField } from './list-filter'
import {
  type ListQueryDeclaration,
  defaultHeaderSort,
  listQueryIndexes,
  missingListQueryIndexes,
  planListQuery as plan,
} from './list-query-plan'

/** The platform's normalizers, restated: lower-case, first word, 12 letters. */
const NAMES = {
  key: (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase(),
  token: (value: string) => (value.trim().toLowerCase().split(/\s+/)[0] ?? '').slice(0, 12),
  reversed: (value: string) => [...value.trim().toLowerCase()].reverse().join(''),
  maxPrefix: 12,
}
const plan_ = (
  declaration: Parameters<typeof plan>[0],
  request: Parameters<typeof plan>[1],
) => plan(declaration, request, NAMES)
const planListQuery = (
  declaration: Parameters<typeof plan>[0],
  request: Parameters<typeof plan>[1],
) => plan(declaration, request, NAMES)

const FIELDS: ListFilterField[] = [
  { column: 'name', kind: 'text', path: 'name', lowerPath: 'nameLower', tokensPath: 'nameTokens', reversedPath: 'nameReversed' },
  { column: 'status', kind: 'exact', path: 'status', presence: 'always' },
  { column: 'owner', kind: 'exact', path: 'ownerUid' },
  { column: 'tags', kind: 'text', path: 'tags', tokensPath: 'tags', operators: ['contains'] },
  { column: 'total', kind: 'number', path: 'totalCents' },
  { column: 'createdAt', kind: 'date', path: 'createdAt', presence: 'always' },
  { column: 'dueAtMs', kind: 'date', path: 'dueAtMs', storedAs: 'millis', presence: 'always' },
  { column: 'facet', kind: 'exact', path: 'facet', windowOnly: true },
]
const DECLARATION: ListQueryDeclaration = {
  fields: FIELDS,
  sorts: [
    { path: 'updatedAt', direction: 'desc' },
    { path: 'nameLower', direction: 'asc', column: 'name' },
  ],
  search: { tokensPath: 'searchTokens' },
}

describe('planListQuery', () => {
  it('puts every equality, the search and the default order on one query', () => {
    const plan = planListQuery(DECLARATION, {
      clauses: [
        { field: 'status', op: 'equals', value: 'open' },
        { field: 'owner', op: 'isAnyOf', value: 'u1,u2' },
      ],
      search: ['Acme'],
    })
    expect(plan.filters).toEqual([
      { path: 'searchTokens', op: 'array-contains', value: 'acme' },
      { path: 'status', op: '==', value: 'open' },
      { path: 'ownerUid', op: 'in', value: ['u1', 'u2'] },
    ])
    expect(plan.orderBy).toEqual({ path: 'updatedAt', direction: 'desc' })
    expect(plan.refused).toEqual([])
  })

  it('orders by the range field, and refuses a second range by name', () => {
    const plan = planListQuery(DECLARATION, {
      clauses: [
        { field: 'createdAt', op: 'onOrAfter', value: '2026-09-17' },
        { field: 'total', op: '>', value: '100' },
      ],
    })
    expect(plan.orderBy).toEqual({ path: 'createdAt', direction: 'desc' })
    expect(plan.served.map((clause) => clause.field)).toEqual(['createdAt'])
    expect(plan.refused[0]).toMatchObject({ clause: { field: 'total' } })
  })

  it('gives the search the one array clause, and says a contains filter cannot join it', () => {
    const plan = planListQuery(DECLARATION, {
      clauses: [{ field: 'tags', op: 'contains', value: 'vip' }],
      search: ['acme'],
    })
    expect(plan.searched).toBe('acme')
    expect(plan.refused).toEqual([
      { clause: { field: 'tags', op: 'contains', value: 'vip' }, reason: expect.stringMatching(/search/) },
    ])
  })

  it('says when search used only the first word', () => {
    const plan = planListQuery(DECLARATION, { clauses: [], search: ['acme', 'coffee'] })
    expect(plan.searched).toBe('acme')
    expect(plan.notices[0]).toMatch(/one word/)
  })

  it('folds a search into the scope clause when the list writes scoped tokens', () => {
    const plan = planListQuery(
      { ...DECLARATION, search: { tokensPath: 'searchTokens', scoped: { tokensPath: 'scopedTokens', join: '~' } } },
      {
        clauses: [],
        search: ['acme'],
        base: [{ path: 'visibleTo', op: 'array-contains-any', value: ['org', 'host:h1'] }],
      },
    )
    expect(plan.filters).toEqual([
      { path: 'scopedTokens', op: 'array-contains-any', value: ['org~acme', 'host:h1~acme'] },
    ])
  })

  it('refuses the search under a scope when the list writes no scoped tokens', () => {
    const plan = planListQuery(DECLARATION, {
      clauses: [],
      search: ['acme'],
      base: [{ path: 'visibleTo', op: 'array-contains-any', value: ['org'] }],
    })
    expect(plan.searched).toBeNull()
    expect(plan.refused[0].clause).toBe('search')
  })

  it('keeps the disjunctions to thirty across an in and the scope', () => {
    const ten = Array.from({ length: 10 }, (_unused, at) => `u${at}`).join(',')
    const plan = planListQuery(DECLARATION, {
      clauses: [{ field: 'owner', op: 'isAnyOf', value: ten }],
      base: [{ path: 'visibleTo', op: 'array-contains-any', value: ['a', 'b', 'c', 'd'] }],
    })
    expect(plan.served).toEqual([])
    expect(plan.refused[0].reason).toMatch(/30/)
  })

  it('never serves a field no query can reach', () => {
    const plan = planListQuery(DECLARATION, { clauses: [{ field: 'facet', op: 'equals', value: 'x' }] })
    expect(plan.served).toEqual([])
    expect(plan.filters).toEqual([])
    expect(plan.refused).toHaveLength(1)
  })

  it('compares a millisecond date as a number, the day the reader named', () => {
    const plan = planListQuery(DECLARATION, { clauses: [{ field: 'dueAtMs', op: 'is', value: '2026-09-17' }] })
    const [from, to] = plan.filters
    expect(typeof from.value).toBe('number')
    expect(new Date(from.value as number).getDate()).toBe(17)
    expect((to.value as number) - (from.value as number)).toBe(86_400_000)
  })

  it('takes only a sort the declaration offers', () => {
    expect(
      planListQuery(DECLARATION, { clauses: [], sort: { path: 'nameLower', direction: 'asc' } }).orderBy.path,
    ).toBe('nameLower')
    expect(
      planListQuery(DECLARATION, { clauses: [], sort: { path: 'secret', direction: 'asc' } }).orderBy.path,
    ).toBe('updatedAt')
  })
})

/*
 * EVERY COLUMN SORTS, AND THE INDEX FILE DOES NOT PAY FOR IT (AGL-3680).
 */
const ALONE: ListQueryDeclaration = {
  ...DECLARATION,
  sorts: [
    { path: 'updatedAt', direction: 'desc' },
    { path: 'createdAt', direction: 'desc', column: 'createdAt', label: 'Created' },
    { path: 'status', direction: 'asc', column: 'status', label: 'Status', alone: true },
    { path: 'nameLower', direction: 'asc', column: 'name', label: 'Name', alone: true },
  ],
}

describe('an alone sort', () => {
  it('is served while nothing narrows the list', () => {
    const plan = planListQuery(ALONE, { clauses: [], sort: { path: 'status', direction: 'asc' } })
    expect(plan.orderBy).toMatchObject({ path: 'status', direction: 'asc' })
    expect(plan.notices).toEqual([])
    expect(plan.sortFallback).toBeUndefined()
  })

  it('falls back to the default header order under a filter, and says so', () => {
    const plan = planListQuery(ALONE, {
      clauses: [{ field: 'owner', op: 'equals', value: 'u1' }],
      sort: { path: 'status', direction: 'asc' },
    })
    expect(plan.orderBy).toMatchObject({ path: 'createdAt', direction: 'desc' })
    expect(plan.notices).toEqual(['Sorted by Created: Status sorts only with no filter or search on.'])
    expect(plan.sortFallback).toMatchObject({ reason: 'alone', asked: { path: 'status' } })
  })

  it('falls back under the search too', () => {
    const plan = planListQuery(ALONE, { clauses: [], search: ['acme'], sort: { path: 'nameLower', direction: 'asc' } })
    expect(plan.orderBy.path).toBe('createdAt')
  })

  it('still holds when the only clause was refused, since nothing narrowed', () => {
    const plan = planListQuery(ALONE, {
      clauses: [{ field: 'facet', op: 'equals', value: 'x' }],
      sort: { path: 'status', direction: 'asc' },
    })
    expect(plan.orderBy.path).toBe('status')
  })

  it('is held beside the base scope, which is not a filter', () => {
    const plan = plan_(ALONE, {
      clauses: [],
      base: [{ path: 'orgId', op: '==', value: 'o1' }],
      sort: { path: 'status', direction: 'asc' },
    })
    expect(plan.orderBy.path).toBe('status')
  })

  it('names the range that took the order from a picked header', () => {
    const plan = planListQuery(ALONE, {
      clauses: [{ field: 'total', op: '>', value: '5' }],
      sort: { path: 'createdAt', direction: 'desc' },
    })
    expect(plan.orderBy.path).toBe('totalCents')
    // The default header order was not picked by anyone: no notice for it.
    expect(plan.notices).toEqual([])
  })

  it('defaults to the first header order that is not alone', () => {
    expect(defaultHeaderSort(ALONE)).toMatchObject({ path: 'createdAt' })
    expect(defaultHeaderSort({ fields: [], sorts: [] })).toMatchObject({ path: '__name__' })
  })

  it('costs no composite without a base, and one per base field with one', () => {
    const shapes = (base: { path: string; array?: boolean }[] = []) =>
      listQueryIndexes(ALONE, base).map((index) =>
        index.fields.map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`).join(','),
      )
    expect(shapes().some((shape) => shape.endsWith('status:ASCENDING'))).toBe(false)
    // An alone order a range ALSO imposes (Name starts with) pairs in full.
    expect(shapes()).toContain('ownerUid:ASCENDING,nameLower:ASCENDING')
    // The full orders keep their full pairing.
    expect(shapes()).toContain('ownerUid:ASCENDING,createdAt:DESCENDING')
    const based = shapes([{ path: 'orgId' }])
    expect(based).toContain('orgId:ASCENDING,status:ASCENDING')
    expect(based).not.toContain('ownerUid:ASCENDING,status:ASCENDING')
  })
})

describe('listQueryIndexes', () => {
  it('names one (predicate, order) composite per filterable field and order', () => {
    const shapes = listQueryIndexes(DECLARATION).map((index) =>
      index.fields.map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`).join(','),
    )
    expect(shapes).toEqual(
      expect.arrayContaining([
        'searchTokens:CONTAINS,updatedAt:DESCENDING',
        'status:ASCENDING,updatedAt:DESCENDING',
        'ownerUid:ASCENDING,nameLower:ASCENDING',
        'status:ASCENDING,createdAt:DESCENDING',
        'tags:CONTAINS,totalCents:ASCENDING',
      ]),
    )
    // Nothing for a field no query reaches.
    expect(shapes.some((shape) => shape.startsWith('facet'))).toBe(false)
  })

  it('reports what an index file lacks', () => {
    const needed = listQueryIndexes({ fields: [FIELDS[1]], sorts: [{ path: 'updatedAt', direction: 'desc' }] })
    expect(missingListQueryIndexes({ indexes: [] }, 'things', needed)).toHaveLength(1)
    expect(
      missingListQueryIndexes(
        {
          indexes: [
            {
              collectionGroup: 'things',
              queryScope: 'COLLECTION',
              fields: [
                { fieldPath: 'status', order: 'ASCENDING' },
                { fieldPath: 'updatedAt', order: 'DESCENDING' },
              ],
            },
          ],
        },
        'things',
        needed,
      ),
    ).toEqual([])
  })
})
