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
 * The Sites list filters through the grid's own toolbar (AGL-3321), over
 * EVERY site it read rather than the page on screen.
 *
 * The page holds the whole workspace's sites (`useOrgHosts` reads each by id,
 * with no query to narrow and no page to stop at), so a site past the grid's
 * first page must still be found by a filter or a search. Each case below
 * aims at such a site: the fourteenth of fifteen, which the unfiltered grid
 * does not draw.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

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

/** Fifteen published sites; the fourteenth is the one every case looks for. */
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

const setFilterModel = (model: Record<string, unknown>) =>
  act(() => {
    mockGrid.props?.onFilterModelChange(model)
  })

beforeEach(() => {
  mockGrid.props = undefined
  mockUseOrgHosts.mockReturnValue({
    hosts: HOSTS,
    ready: true,
    error: false,
    retry: jest.fn(),
  })
})

describe('the Sites list filters through the grid (AGL-3321)', () => {
  it('is the shared grid, with Filters and Search, and its first page leaves the target undrawn', () => {
    render(<HostsPage />)
    expect(screen.getByRole('grid', { name: 'Sites' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Filters/ })).toBeTruthy()
    expect(screen.getByRole('searchbox')).toBeTruthy()
    expect(screen.getByText('Site 01')).toBeTruthy()
    // The control for both cases below: unfiltered, the target sits past the
    // first page, so finding it proves the list, not the page, answered.
    expect(screen.queryByText('Harbor Bakery')).toBeNull()
    // Every row keeps its two actions under their own names.
    expect(screen.getAllByText('Manage')).toHaveLength(10)
    expect(screen.getAllByText('Visit')).toHaveLength(10)
    // A panel-only field is a hidden column, not a column of its own.
    expect(
      screen.queryByRole('columnheader', { name: /Custom domain status/ }),
    ).toBeNull()
  })

  it('finds a site past the first page by its slug through the quick search', async () => {
    render(<HostsPage />)
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'harbor-bakery' },
    })
    await waitFor(() => expect(screen.getByText('Harbor Bakery')).toBeTruthy())
    expect(screen.queryByText('Site 01')).toBeNull()
  })

  it('searches the custom domain too', async () => {
    render(<HostsPage />)
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'shop.harbor' },
    })
    await waitFor(() => expect(screen.getByText('Harbor Bakery')).toBeTruthy())
    expect(screen.queryByText('Site 15')).toBeNull()
  })

  it('narrows to a Status past the first page, with a chip naming it', async () => {
    render(<HostsPage />)
    setFilterModel({
      items: [{ id: 1, field: 'status', operator: 'is', value: 'suspended' }],
    })
    await waitFor(() => expect(screen.getByText('Harbor Bakery')).toBeTruthy())
    expect(screen.queryByText('Site 01')).toBeNull()
    expect(mockGrid.props?.rows.map((row: { $id: string }) => row.$id)).toEqual([
      'host-14',
    ])
    const chips = screen.getByRole('list', { name: 'Filters' })
    expect(chips.textContent).toContain('Status')
    expect(chips.textContent).toContain('Suspended')
  })

  it('narrows by whether a custom domain is set', async () => {
    render(<HostsPage />)
    setFilterModel({
      items: [
        { id: 1, field: 'customDomainState', operator: 'not', value: 'none' },
      ],
    })
    await waitFor(() => expect(screen.getByText('Harbor Bakery')).toBeTruthy())
    expect(mockGrid.props?.rows).toHaveLength(1)
  })

  it('offers the Status choices the pill can show, and no others', () => {
    render(<HostsPage />)
    const status = mockGrid.props?.columns.find(
      (column: { field: string }) => column.field === 'status',
    )
    expect(status.type).toBe('singleSelect')
    expect(status.valueOptions.map((option: { value: string }) => option.value)).toEqual([
      'suspended',
      'maintenance',
      'live',
      'draft',
    ])
  })

  it('says a filter matched nothing, and still counts every site in the meter', async () => {
    render(<HostsPage />)
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'no-such-site' },
    })
    await waitFor(() =>
      expect(screen.getByText('No sites match these filters')).toBeTruthy(),
    )
    expect(screen.getByTestId('header-right').textContent).toContain('15')
  })
})
