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
 * The Site users card hands its query every clause the Filters panel holds
 * and the search's word, on one query beneath its newest-first order, and
 * says what it could not put there (AGL-3321).
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

/** A built query, as the doubles below spell it: its path and constraints. */
type MockQuery = { path: string; constraints: unknown[] }

/** Every query the card handed its pager, newest last. */
const mockBuilt: MockQuery[] = []

const mockRows = [
  { $id: 'a-1', email: 'ann@example.test', displayName: 'Ann', suspended: true },
]

/**
 * The clauses the Filters panel would hold, set directly: the free grid's
 * panel is not something jsdom can drive. Undefined leaves the hook its own.
 */
let mockClauses: Array<{ field: string; op: string; value: string }> | undefined

jest.mock('@aglyn/shared-ui-jsx/hooks/use-list-grid-filter', () => {
  const actual = jest.requireActual('@aglyn/shared-ui-jsx/hooks/use-list-grid-filter')
  const useListGridFilter = (options: Record<string, unknown>) =>
    actual.useListGridFilter(
      mockClauses ? { ...options, clauses: mockClauses, onChange: () => undefined } : options,
    )
  return { __esModule: true, useListGridFilter, default: useListGridFilter }
})

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (path: string, ...constraints: unknown[]) => ({ path, constraints }),
  where: (path: unknown, op: string, value: unknown) => ['where', path, op, value],
  orderBy: (path: unknown, direction?: string) => ['orderBy', path, direction ?? 'asc'],
  startAt: (value: unknown) => ['startAt', value],
  endAt: (value: unknown) => ['endAt', value],
  limit: (value: number) => ['limit', value],
  documentId: () => '__name__',
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  ...jest.requireActual('@aglyn/tenant-feature-instance'),
  useFirestore: () => ({}),
}))
/*
 * The pager `useListQuery` pages the plan's query with, doubled where it
 * lives: the list-query hook reaches it by its own module, not the barrel.
 */
jest.mock('@aglyn/tenant-feature-instance/hooks/use-paged-collection', () => ({
  __esModule: true,
  usePagedCollection: (build: (pageLimit: number) => unknown) => {
    mockBuilt.push(build(11) as MockQuery)
    return {
      rows: mockRows,
      hasMore: false,
      page: 0,
      setPage: () => undefined,
      pageSize: 10,
      setPageSize: () => undefined,
      data: mockRows,
    }
  },
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
}))
jest.mock('../hooks/use-org-scope', () => ({ __esModule: true, useOrgSlug: () => 'acme' }))
jest.mock('../hooks/use-release-flags', () => ({
  __esModule: true,
  useReleaseFlag: () => ({ ready: true, visible: false }),
}))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  useOrgPermissions: () => ({ loaded: true, can: () => false }),
}))
jest.mock('./host-id-provider', () => ({ __esModule: true, useHostSubdomain: () => 'bakery' }))
jest.mock('./site-member-drawer.component', () => ({ __esModule: true, default: () => null }))

import SiteAccountsCard from './site-accounts-card.component'

const lastQuery = () => mockBuilt[mockBuilt.length - 1]

beforeEach(() => {
  mockBuilt.length = 0
  mockClauses = undefined
})

describe('the Site users card serves every clause and the search (AGL-3321)', () => {
  it('reads newest first, unfiltered, with the Filters panel and the search box', async () => {
    render(<SiteAccountsCard hostId="host-1" />)
    expect(lastQuery()).toEqual({
      path: 'hosts/host-1/siteMembers',
      constraints: [['orderBy', 'createdAt', 'desc'], ['limit', 11]],
    })
    expect(screen.getByRole('grid', { name: 'Site users' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Filters/ })).toBeTruthy()
    expect(screen.getByRole('searchbox')).toBeTruthy()
    // The Status column draws its chip from the stored boolean.
    expect(screen.getAllByText('Suspended').length).toBeGreaterThan(0)
    await act(async () => undefined)
  })

  it('hands the query Status and an address together, beneath the same order', async () => {
    mockClauses = [
      { field: 'email', op: 'equals', value: 'Ann@Example.test' },
      { field: 'suspended', op: 'equals', value: 'true' },
    ]
    render(<SiteAccountsCard hostId="host-1" />)
    expect(lastQuery()?.constraints).toEqual([
      ['where', 'email', '==', 'ann@example.test'],
      ['where', 'suspended', '==', true],
      ['orderBy', 'createdAt', 'desc'],
      ['limit', 11],
    ])
    // Both clauses show, Status by its label.
    expect(screen.getByText('Status is Suspended')).toBeTruthy()
    await act(async () => undefined)
  })

  it('serves the search as a word of the name, beside Status', async () => {
    mockClauses = [{ field: 'suspended', op: 'equals', value: 'false' }]
    render(<SiteAccountsCard hostId="host-1" />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Rae' } })
    await waitFor(() =>
      expect(lastQuery()?.constraints).toEqual([
        ['where', 'displayNameTokens', 'array-contains', 'rae'],
        ['where', 'suspended', '==', false],
        ['orderBy', 'createdAt', 'desc'],
        ['limit', 11],
      ]),
    )
  })

  it('says, above the grid, what the query could not take', async () => {
    mockClauses = [{ field: 'email', op: 'startsWith', value: 'ann' }]
    render(<SiteAccountsCard hostId="host-1" />)
    // Not applied to the rows on screen: refused, by name.
    expect(lastQuery()?.constraints).toEqual([['orderBy', 'createdAt', 'desc'], ['limit', 11]])
    expect(screen.getByRole('status', { name: 'Filter notices' }).textContent).toContain(
      'Email starts with ann is not applied',
    )
    await act(async () => undefined)
  })
})
