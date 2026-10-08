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

import { renderHook } from '@testing-library/react'
import {
  CONTACT_LIST_DECLARATION,
  CONTACT_PREFIX_SEARCH,
  contactSoloClause,
} from '../constants/contact-filters'
import { useCrmListQuery } from './use-crm-list-query'

/**
 * What a CRM list asks for a reader whose access is some sites, and for a
 * range that stands alone (AGL-3321) — planned for real, answered by the
 * list-query double.
 */

jest.mock('@aglyn/tenant-feature-instance/hooks/use-list-query', () =>
  jest
    .requireActual('@aglyn/tenant-feature-instance/testing/list-query-double')
    .listQueryModule(
      () => [],
      jest.requireActual('@aglyn/tenant-feature-instance/hooks/use-list-query'),
    ),
)
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useScopeTokens: () => ({ tokens: ['host:a'], orgWide: false, loaded: true }),
}))
jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
}))

const SCOPE = ['orgs', 'org-1'] as const
const TOKENS = ['org', 'host:a']

const contacts = (options: {
  foldsScope: boolean
  clauses?: Array<{ field: string; op: string; value: string }>
  search?: string[]
}) =>
  renderHook(() =>
    useCrmListQuery({
      scope: SCOPE,
      collection: 'contacts',
      visibleTo: TOKENS,
      foldsScope: options.foldsScope,
      declaration: CONTACT_LIST_DECLARATION,
      clauses: options.clauses ?? [],
      search: options.search ?? [],
      soloClause: contactSoloClause,
      prefixSearch: CONTACT_PREFIX_SEARCH,
    }),
  ).result.current.plan

describe('a collaborator’s search', () => {
  it('is the start of the name, beside the scope clause the rules prove, and says so', () => {
    const plan = contacts({ foldsScope: false, search: ['Acm'] })
    expect(plan.filters).toEqual([
      { path: 'visibleTo', op: 'array-contains-any', value: TOKENS },
      { path: 'nameLower', op: '>=', value: 'acm' },
      { path: 'nameLower', op: '<=', value: 'acm' },
    ])
    expect(plan.orderBy).toMatchObject({ path: 'nameLower', direction: 'asc' })
    expect(plan.notices).toContain(CONTACT_PREFIX_SEARCH.notice)
    expect(plan.refused).toEqual([])
  })

  it('reads as the search when it cannot stand beside another filter', () => {
    const plan = contacts({
      foldsScope: false,
      search: ['acm'],
      clauses: [{ field: 'emailStatus', op: 'equals', value: 'none' }],
    })
    expect(plan.refused.map((entry) => entry.clause)).toEqual(['search'])
    expect(plan.filters.some((filter) => filter.path === 'nameLower')).toBe(false)
  })

  it('stays a token search, folded into the scope, for an org-wide reader', () => {
    const plan = contacts({ foldsScope: true, search: ['acm'] })
    expect(plan.filters).toEqual([
      { path: 'scopedSearchTokens', op: 'array-contains-any', value: ['org~acm', 'host:a~acm'] },
    ])
  })
})

describe('a range that stands alone', () => {
  const created = { field: 'createdAt', op: 'onOrAfter', value: '2026-09-01' }

  it('is served beside the scope clause alone, ordering the list by its field', () => {
    const plan = contacts({ foldsScope: true, clauses: [created] })
    expect(plan.refused).toEqual([])
    expect(plan.orderBy).toMatchObject({ path: 'createdAt', direction: 'desc' })
  })

  it('is refused by name beside another filter, which stands', () => {
    const plan = contacts({
      foldsScope: true,
      clauses: [created, { field: 'emailStatus', op: 'equals', value: 'none' }],
    })
    expect(plan.refused).toEqual([{ clause: created, reason: expect.stringMatching(/stands alone/) }])
    expect(plan.filters).toContainEqual({ path: 'emailStatus', op: '==', value: 'none' })
    expect(plan.orderBy).toMatchObject({ path: 'updatedAt', direction: 'desc' })
  })
})
