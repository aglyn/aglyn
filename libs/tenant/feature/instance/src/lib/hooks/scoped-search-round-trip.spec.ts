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
  nameSearchNormalizers,
  nameSearchTokens,
  SCOPED_SEARCH_JOIN,
  scopedSearch,
  scopedSearchTokens,
} from '@aglyn/aglyn/app-utils/name-search'
import {
  LIST_QUERY_DISJUNCTIONS,
  type ListQueryDeclaration,
  type ListQueryFilter,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'

/**
 * A scoped search, written and read (AGL-3321).
 *
 * The writer (`scopedSearchTokens`, stamped on the record) and the reader
 * (`planListQuery` folding the typed word into the scope clause) live in two
 * libraries. A record stamped by the one must be found by the other, for
 * every scope it is visible to and every word a reader can type — or a
 * site collaborator's search quietly finds nothing while the list still
 * lists the record.
 */

const DECLARATION: ListQueryDeclaration = {
  fields: [{ column: 'status', kind: 'exact', path: 'status', operators: ['equals', 'isAnyOf'] }],
  sorts: [{ path: 'createdAtMs', direction: 'desc' }],
  search: { tokensPath: 'nameTokens', scoped: scopedSearch('nameScopedTokens') },
}

/** Whether a stored document satisfies one `array-contains(-any)` predicate. */
const satisfies = (stored: readonly string[], filter: ListQueryFilter): boolean => {
  const asked = Array.isArray(filter.value) ? filter.value : [filter.value]
  return asked.some((value) => stored.includes(String(value)))
}

describe('a scoped search round-trips from the writer to the plan', () => {
  const name = 'Spring Sale — Acme Coffee'
  const visibleTo = ['org', 'host:site-a', 'host:site-b']
  const stored = scopedSearchTokens(visibleTo, nameSearchTokens(name))

  it('uses the one join both halves import', () => {
    expect(scopedSearch('x').join).toBe(SCOPED_SEARCH_JOIN)
    expect(stored).toContain(`host:site-a${SCOPED_SEARCH_JOIN}acme`)
  })

  it('finds the record for every scope it is visible to and every word a reader can type', () => {
    const words = ['spring', 'Sale', 'ACME', 'cof', 'c', 'coffee']
    for (const scope of visibleTo) {
      for (const word of words) {
        const plan = planListQuery(
          DECLARATION,
          {
            clauses: [],
            search: [word],
            base: [{ path: 'visibleTo', op: 'array-contains-any', value: [scope] }],
          },
          nameSearchNormalizers,
        )
        expect(plan.searched).toBe(nameSearchNormalizers.token(word))
        expect(plan.refused).toEqual([])
        const clause = plan.filters.find((filter) => filter.path === 'nameScopedTokens')
        expect(clause).toBeDefined()
        expect(satisfies(stored, clause as ListQueryFilter)).toBe(true)
      }
    }
  })

  it('does not find it under a scope it is not visible to, or for a word it does not hold', () => {
    const outside = planListQuery(
      DECLARATION,
      {
        clauses: [],
        search: ['acme'],
        base: [{ path: 'visibleTo', op: 'array-contains-any', value: ['host:site-z'] }],
      },
      nameSearchNormalizers,
    )
    expect(satisfies(stored, outside.filters[0])).toBe(false)
    const absent = planListQuery(
      DECLARATION,
      {
        clauses: [],
        search: ['offee'],
        base: [{ path: 'visibleTo', op: 'array-contains-any', value: ['org'] }],
      },
      nameSearchNormalizers,
    )
    expect(satisfies(stored, absent.filters[0])).toBe(false)
  })

  it('reads the first word of several, and a long word by its stored prefix', () => {
    const plan = planListQuery(
      DECLARATION,
      {
        clauses: [],
        search: ['Acme', 'Coffee'],
        base: [{ path: 'visibleTo', op: 'array-contains-any', value: ['org'] }],
      },
      nameSearchNormalizers,
    )
    expect(satisfies(stored, plan.filters[0])).toBe(true)
    expect(plan.notices.join(' ')).toMatch(/one word/)
    const long = scopedSearchTokens(['org'], nameSearchTokens('Extraordinarily'))
    const longPlan = planListQuery(
      DECLARATION,
      {
        clauses: [],
        search: ['extraordinarily'],
        base: [{ path: 'visibleTo', op: 'array-contains-any', value: ['org'] }],
      },
      nameSearchNormalizers,
    )
    expect(satisfies(long, longPlan.filters[0])).toBe(true)
  })

  it('stays inside thirty disjunctions as the scopes grow, and refuses an any-of past them', () => {
    const scopes = Array.from({ length: LIST_QUERY_DISJUNCTIONS }, (_unused, at) => `host:s${at}`)
    const wide = scopedSearchTokens(scopes, nameSearchTokens(name))
    const plan = planListQuery(
      DECLARATION,
      {
        clauses: [{ field: 'status', op: 'isAnyOf', value: 'draft,sent' }],
        search: ['acme'],
        base: [{ path: 'visibleTo', op: 'array-contains-any', value: scopes }],
      },
      nameSearchNormalizers,
    )
    const clause = plan.filters.find((filter) => filter.path === 'nameScopedTokens') as ListQueryFilter
    expect((clause.value as readonly string[]).length).toBe(LIST_QUERY_DISJUNCTIONS)
    expect(satisfies(wide, clause)).toBe(true)
    // Thirty scopes times two statuses is sixty: the any-of is refused by name.
    expect(plan.served).toEqual([])
    expect(plan.refused[0].reason).toMatch(String(LIST_QUERY_DISJUNCTIONS))
  })
})

describe('scopedSearchTokens', () => {
  it('keeps every non-empty scope once, in order, and nothing for a record visible to nobody', () => {
    expect(scopedSearchTokens(['org', '', 'org', 'host:a', 7], ['a', 'a', 'ab'])).toEqual([
      'org~a',
      'org~ab',
      'host:a~a',
      'host:a~ab',
    ])
    expect(scopedSearchTokens(undefined, ['a'])).toEqual([])
    expect(scopedSearchTokens([], ['a'])).toEqual([])
    expect(scopedSearchTokens(['org'], [])).toEqual([])
  })
})
