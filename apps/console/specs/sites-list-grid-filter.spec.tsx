/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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
 * The Sites list filters, searches, sorts and pages through ITS QUERY
 * (AGL-3321), and draws each page from the site documents the page holds.
 *
 * Before, the page matched the panel and the search over every site it had
 * read. Now every clause and the search's word are on one query over the
 * reader's membership rows (`utils/site-list-query.ts`), whose page is what
 * the grid draws — each row joined by id to its host document. The query is
 * stood in for here by its plan: `useListQuery` is replaced with the real
 * `planListQuery` over the request the page makes, answered with the rows a
 * test names, so each case asserts both what the page ASKED and what it DREW.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import {
  type ListQueryPlan,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'

const mockUseOrgHosts = jest.fn()
jest.mock('../hooks/use-org-hosts', () => ({
  __esModule: true,
  useOrgHosts: (...args: unknown[]) => mockUseOrgHosts(...args),
  default: (...args: unknown[]) => mockUseOrgHosts(...args),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u1' } }),
}))

/** The collection the page names, as its path, since the query never runs. */
jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_firestore: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
}))

/** What the "server" answers: the membership ids of the page, for a plan. */
const mockAnswer: jest.Mock<{ ids: string[]; status?: string; hasMore?: boolean }> = jest.fn()
/** Every call the page made, newest last. */
const mockCalls: Array<{ options: any; plan: ListQueryPlan }> = []
const mockSetPage = jest.fn()
jest.mock('@aglyn/tenant-feature-instance/hooks/use-list-query', () => ({
  __esModule: true,
  useListQuery: (options: any) => {
    const plan = mockPlan(options)
    mockCalls.push({ options, plan })
    const answer = mockAnswer(plan)
    const rows = answer.ids.map(($id) => ({ $id }))
    return {
      rows,
      data: rows,
      status: answer.status ?? 'success',
      error: undefined,
      fromCache: false,
      serverDenied: false,
      hasMore: answer.hasMore ?? false,
      page: 0,
      setPage: mockSetPage,
      pageSize: 10,
      setPageSize: jest.fn(),
      plan,
    }
  },
}))
const mockPlan = (options: any) =>
  planListQuery(options.declaration, options.request, nameSearchNormalizers)

const ORG = { $id: 'org-1', slug: 'acme', name: 'Acme', plan: 'enterprise' }

jest.mock('../hooks/use-org-scope', () => ({
  useOrgSlug: () => 'acme',
  useOrgScope: () => ({ currentOrg: ORG, loading: false, error: false }),
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: ORG, orgId: ORG.$id, ready: true }),
}))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({ permissions: { createHosts: true }, can: () => true, loaded: true }),
}))
jest.mock('../hooks/use-pending-invites', () => ({
  usePendingInvites: () => ({ invites: [], loading: false }),
}))

const mockBranding = {
  branding: { productName: 'Acme', supportUrl: 'https://example.com/support' },
  whiteLabel: false,
  ready: true,
}
jest.mock('../hooks/use-branding', () => ({
  __esModule: true,
  useBranding: () => mockBranding,
  default: () => mockBranding,
}))

const passthrough = {
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}
const nullComponent = { __esModule: true, default: () => null }
jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({
    children,
    headerRight,
  }: {
    children?: ReactNode
    headerRight?: ReactNode
  }) => (
    <div>
      <div data-testid="header-right">{headerRight}</div>
      {children}
    </div>
  ),
}))
jest.mock('../components/layouts/main.layout', () => passthrough)
jest.mock('../components/layouts/authenticated.layout', () => passthrough)
jest.mock('../components/create-host-dialog.component', () => nullComponent)
jest.mock('../components/org-invites-banner.component', () => nullComponent)
jest.mock('../components/host-icon.component', () => nullComponent)
jest.mock('../components/marketing-consent-prompt.component', () => nullComponent)
jest.mock('../components/org-dashboard-widgets.component', () => nullComponent)
jest.mock('../components/plugin-widget-slot.component', () => nullComponent)

/** The grid's props, as the page last handed them, to drive its panel. */
const mockGrid: { props?: Record<string, any> } = {}
jest.mock('@aglyn/shared-ui-jsx/components/list-table.component', () => {
  const actual = jest.requireActual(
    '@aglyn/shared-ui-jsx/components/list-table.component',
  )
  const Captured = (props: Record<string, any>) => {
    mockGrid.props = props
    return <actual.ListTable {...props} />
  }
  return { __esModule: true, ...actual, ListTable: Captured, default: Captured }
})

import HostsPage from '../app/(app)/[orgSlug]/hosts/page'

const stamp = (iso: string) => {
  const at = new Date(iso)
  return { seconds: at.getTime() / 1000, toDate: () => at }
}

/** Fifteen published sites; the fourteenth is the one the cases look for. */
const SITES = Array.from({ length: 15 }, (_, index) => {
  const n = index + 1
  return {
    $id: `host-${n}`,
    displayName: `Site ${String(n).padStart(2, '0')}`,
    subdomain: `site-${n}`,
    orgId: ORG.$id,
    screens: { home: '/' },
    createdAt: stamp('2026-01-05T12:00:00Z'),
    updatedAt: stamp('2026-02-05T12:00:00Z'),
  }
})
const TARGET = {
  ...SITES[13],
  displayName: 'Harbor Bakery',
  subdomain: 'harbor-bakery',
  cname: 'shop.harbor.example',
  suspendedAt: 1,
}
const HOSTS = [...SITES.slice(0, 13), TARGET, SITES[14]]
const FIRST_PAGE = HOSTS.slice(0, 10).map((host) => host.$id)

const lastCall = () => mockCalls[mockCalls.length - 1]
const setFilterModel = (model: Record<string, unknown>) =>
  act(() => {
    mockGrid.props?.onFilterModelChange(model)
  })

beforeEach(() => {
  mockGrid.props = undefined
  mockCalls.length = 0
  mockSetPage.mockReset()
  mockUseOrgHosts.mockReturnValue({
    hosts: HOSTS,
    ready: true,
    error: false,
    retry: jest.fn(),
  })
  // Unfiltered, the query's first page; the search or a filter, the target.
  mockAnswer.mockImplementation((plan) =>
    plan.served.length || plan.searched ? { ids: ['host-14'] } : { ids: FIRST_PAGE, hasMore: true },
  )
})

describe('the Sites list is served by its query (AGL-3321)', () => {
  it('asks for the workspace\'s membership rows, by name, and draws the page it gets', () => {
    render(<HostsPage />)
    expect(screen.getByRole('grid', { name: 'Sites' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Filters/ })).toBeTruthy()
    expect(screen.getByRole('searchbox')).toBeTruthy()
    const { options, plan } = lastCall()
    expect(options.collection).toEqual({ path: 'users/u1/hostMemberships' })
    expect(plan.filters).toEqual([{ path: 'orgId', op: '==', value: 'org-1' }])
    expect(plan.orderBy).toMatchObject({ path: 'nameLower', direction: 'asc' })
    expect(screen.getByText('Site 01')).toBeTruthy()
    // The control for every case below: the target is not on this page.
    expect(screen.queryByText('Harbor Bakery')).toBeNull()
    expect(screen.getAllByText('Manage')).toHaveLength(10)
    expect(screen.getAllByText('Visit')).toHaveLength(10)
  })

  it('puts the search\'s word on the query, and draws what it answers', async () => {
    render(<HostsPage />)
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'shop.harbor' },
    })
    await waitFor(() => expect(screen.getByText('Harbor Bakery')).toBeTruthy())
    expect(lastCall().plan.filters).toContainEqual({
      path: 'searchTokens',
      op: 'array-contains',
      value: 'shop.harbor',
    })
    expect(screen.queryByText('Site 01')).toBeNull()
  })

  it('puts a Site filter on the query, with a chip naming it', async () => {
    render(<HostsPage />)
    setFilterModel({
      items: [{ id: 1, field: 'displayName', operator: 'startsWith', value: 'Harbor' }],
    })
    await waitFor(() => expect(screen.getByText('Harbor Bakery')).toBeTruthy())
    expect(lastCall().plan.served).toEqual([
      { field: 'displayName', op: 'startsWith', value: 'Harbor' },
    ])
    expect(lastCall().plan.filters).toContainEqual({ path: 'nameLower', op: '>=', value: 'harbor' })
    const chips = screen.getByRole('list', { name: 'Filters' })
    expect(chips.textContent).toContain('Site')
    expect(chips.textContent).toContain('Harbor')
  })

  it('offers only what the query can answer: Site and Created', () => {
    render(<HostsPage />)
    const filterable = (mockGrid.props?.columns ?? [])
      .filter((column: { filterable?: boolean }) => column.filterable !== false)
      .map((column: { field: string }) => column.field)
    expect(filterable.sort()).toEqual(['createdAt', 'displayName'])
    const sortable = (mockGrid.props?.columns ?? [])
      .filter((column: { sortable?: boolean }) => column.sortable !== false)
      .map((column: { field: string }) => column.field)
    expect(sortable.sort()).toEqual(['createdAt', 'displayName'])
    expect(mockGrid.props?.filterMode).toBe('server')
    expect(mockGrid.props?.sortingMode).toBe('server')
  })

  it('orders by Created on the query when the header asks, and says so on the grid', async () => {
    render(<HostsPage />)
    act(() => {
      mockGrid.props?.onSortModelChange([{ field: 'createdAt', sort: 'desc' }])
    })
    await waitFor(() =>
      expect(lastCall().plan.orderBy).toMatchObject({ path: 'createdAt', direction: 'desc' }),
    )
    expect(mockGrid.props?.sortModel).toEqual([{ field: 'createdAt', sort: 'desc' }])
  })

  it('leaves out a membership row whose site the page could not read', () => {
    mockAnswer.mockReturnValue({ ids: ['host-1', 'host-gone', 'host-2'] })
    render(<HostsPage />)
    expect(mockGrid.props?.rows.map((row: { $id: string }) => row.$id)).toEqual([
      'host-1',
      'host-2',
    ])
  })

  it('says a filter matched nothing, and still counts every site in the meter', async () => {
    mockAnswer.mockImplementation((plan) =>
      plan.searched ? { ids: [] } : { ids: FIRST_PAGE, hasMore: true },
    )
    render(<HostsPage />)
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'no-such-site' },
    })
    await waitFor(() =>
      expect(screen.getByText('No sites match these filters')).toBeTruthy(),
    )
    expect(screen.getByTestId('header-right').textContent).toContain('15')
  })

  it('says the page could not be read rather than that nothing matched', () => {
    mockAnswer.mockReturnValue({ ids: [], status: 'error' })
    render(<HostsPage />)
    expect(screen.getByText('These sites could not be loaded')).toBeTruthy()
    expect(screen.queryByText('No sites match these filters')).toBeNull()
  })
})
