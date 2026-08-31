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
 * WHAT THE MARGIN PAGE SAYS WHEN IT KNOWS NOTHING.
 *
 * The figures are the model's and are tested there. What only the page can get
 * wrong is the three states that look alike and mean opposite things:
 *
 *  * NOTHING HAS BEEN READ. The scan has not run. An empty table here would
 *    read as "no organization is unprofitable", which is the one sentence this
 *    surface must never say by accident.
 *  * THE SCAN RAN AND FOUND NO ORGANIZATIONS. A real answer, and a different
 *    one.
 *  * THE SCAN RAN AND IS INCOMPLETE. A median over part of the fleet, which is
 *    useful only while it is labelled as one.
 *
 * And the two band readings that have no percentage — uncapped, and no
 * allowance — which must render as neither 0% nor 100%.
 *
 * The scan is deliberately NOT run on mount: four Firestore reads per
 * organization is not a cost to pay for a page nobody asked a question of.
 * That is asserted first, because a regression there is silent and expensive.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockPush = jest.fn()
const mockFetch = jest.fn()
/** ONE stable reference: the page's scan callback depends on `user`. */
const mockUserData = { uid: 'staff-1', getIdToken: async () => 'tok' }
let mockIsStaff: boolean | null = true

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  Container: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CardDisplay: ({ header, children }: { header?: ReactNode; children?: ReactNode }) => (
    <section>
      <h2>{header}</h2>
      {children}
    </section>
  ),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUserData }),
  // REAL. It is the truncation disclosure on the per-org table, and a stub
  // returning every row would delete the disclosure while the page still
  // rendered.
  ceilingedWindow: jest.requireActual(
    '../../../libs/tenant/feature/instance/src/lib/hooks/host-collection-queries',
  ).ceilingedWindow,
}))

jest.mock('../hooks/use-is-staff', () => ({
  __esModule: true,
  useIsStaff: () => mockIsStaff,
}))

jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <main>{children}</main>,
}))

jest.mock('../components/staff-only.component', () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))

import Page from '../app/(app)/admin/margin-utilization/page'

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response

/** A row in the shape `/api/admin/margin-utilization` serves. */
const rowFor = (overrides: Record<string, unknown> = {}) => ({
  orgId: 'org-1',
  name: 'Acme',
  plan: 'pro',
  month: '2026-07',
  bands: {
    hosts: { band: 'hosts', included: 3, used: 1, state: 'measured', fraction: 1 / 3 },
    storageGb: {
      band: 'storageGb',
      included: 30,
      used: 15,
      state: 'measured',
      fraction: 0.5,
    },
    pageViews: {
      band: 'pageViews',
      included: 400000,
      used: 200000,
      state: 'measured',
      fraction: 0.5,
    },
    formSubmissions: {
      band: 'formSubmissions',
      included: 3000,
      used: 300,
      state: 'measured',
      fraction: 0.1,
    },
    dataStorageMb: {
      band: 'dataStorageMb',
      included: 5120,
      used: 512,
      state: 'measured',
      fraction: 0.1,
    },
    // The two readings with no percentage. `included` arrives as null for an
    // uncapped band because `JSON.stringify(Infinity)` is null — the STATE is
    // what the page reads.
    apiRequests: {
      band: 'apiRequests',
      included: 0,
      used: 40,
      state: 'noAllowance',
      fraction: null,
    },
    contactsCount: {
      band: 'contactsCount',
      included: null,
      used: 900000,
      state: 'uncapped',
      fraction: null,
    },
    emailSends: {
      band: 'emailSends',
      included: 5000,
      used: 500,
      state: 'measured',
      fraction: 0.1,
    },
    assistCredits: {
      band: 'assistCredits',
      included: 7500,
      used: 7500,
      state: 'measured',
      fraction: 1,
    },
    workflowRuns: {
      band: 'workflowRuns',
      included: 5000,
      used: 500,
      state: 'measured',
      fraction: 0.1,
    },
    actionRuns: {
      band: 'actionRuns',
      included: 5000,
      used: 500,
      state: 'measured',
      fraction: 0.1,
    },
  },
  cogs: {
    cogsUsd: 6,
    basis: 'measured',
    measuredUsd: 6,
    floorUsd: 2,
    breakdown: {},
  },
  listPriceUsd: 39,
  mrrUsd: 39,
  netRevenueUsd: 37.58,
  marginPct: 0.8403,
  rating: 'ok',
  ...overrides,
})

beforeEach(() => {
  jest.clearAllMocks()
  mockIsStaff = true
  global.fetch = mockFetch as never
})

describe('the scan is an ask, not a mount', () => {
  it('reads NOTHING until the button is pressed', async () => {
    render(<Page />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /scan organizations/i })).toBeTruthy(),
    )
    // Four Firestore reads per organization is not a price to pay for opening
    // a page. A regression here bills silently and grows with the customer
    // base.
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('CONTROL: pressing it DOES read', async () => {
    // Without this the assertion above is satisfied by a page whose button
    // does nothing at all.
    mockFetch.mockResolvedValue(
      jsonResponse({ rows: [rowFor()], nextCursor: null, scanned: 1, reads: 4 }),
    )
    render(<Page />)
    fireEvent.click(screen.getByRole('button', { name: /scan organizations/i }))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    expect(String(mockFetch.mock.calls[0][0])).toContain('/api/admin/margin-utilization')
  })
})

describe('the three states that look alike', () => {
  it('says nothing has been READ, rather than showing an empty table', async () => {
    render(<Page />)
    await waitFor(() =>
      expect(screen.getByText(/Nothing has been read yet/i)).toBeTruthy(),
    )
    // The sentence this page must never say by accident.
    expect(screen.queryByText(/No organizations exist/i)).toBeNull()
    expect(screen.queryByText(/Median margin/i)).toBeNull()
  })

  it('distinguishes "no organizations exist" from "not scanned"', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ rows: [], nextCursor: null, scanned: 0, reads: 1 }),
    )
    render(<Page />)
    fireEvent.click(screen.getByRole('button', { name: /scan organizations/i }))
    await waitFor(() =>
      expect(screen.getByText(/No organizations exist/i)).toBeTruthy(),
    )
    expect(screen.queryByText(/Nothing has been read yet/i)).toBeNull()
  })

  it('labels an INCOMPLETE fleet before it shows a figure from it', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ rows: [rowFor()], nextCursor: 'org-1', scanned: 1, reads: 4 }),
    )
    render(<Page />)
    fireEvent.click(screen.getByRole('button', { name: /scan organizations/i }))
    await waitFor(() =>
      expect(screen.getByText(/part of the fleet, not all of it/i)).toBeTruthy(),
    )
    // And it offers the way to finish it.
    expect(screen.getByRole('button', { name: /scan the next page/i })).toBeTruthy()
  })

  it('drops the banner once the walk reaches the end', async () => {
    // Both directions: a banner that never clears is as misleading as one that
    // never appears.
    mockFetch.mockResolvedValue(
      jsonResponse({ rows: [rowFor()], nextCursor: null, scanned: 1, reads: 4 }),
    )
    render(<Page />)
    fireEvent.click(screen.getByRole('button', { name: /scan organizations/i }))
    await waitFor(() => expect(screen.getByText(/Median margin/i)).toBeTruthy())
    expect(screen.queryByText(/part of the fleet, not all of it/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /scan the next page/i })).toBeNull()
  })

  it('reports the read cost it incurred', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ rows: [rowFor()], nextCursor: null, scanned: 1, reads: 4 }),
    )
    render(<Page />)
    fireEvent.click(screen.getByRole('button', { name: /scan organizations/i }))
    await waitFor(() =>
      expect(screen.getByText(/4 Firestore document reads/i)).toBeTruthy(),
    )
  })
})

describe('a band with no percentage', () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue(
      jsonResponse({ rows: [rowFor()], nextCursor: null, scanned: 1, reads: 4 }),
    )
  })

  it('renders UNCAPPED as a word, and never as 0% or 100%', async () => {
    render(<Page />)
    fireEvent.click(screen.getByRole('button', { name: /scan organizations/i }))
    await waitFor(() => expect(screen.getByText('Uncapped')).toBeTruthy())
    // The usage is still shown — an uncapped band is a missing denominator,
    // not a missing measurement.
    expect(screen.getByText(/900,000 used/)).toBeTruthy()
  })

  it('renders NO ALLOWANCE as its own word, distinct from uncapped', async () => {
    render(<Page />)
    fireEvent.click(screen.getByRole('button', { name: /scan organizations/i }))
    await waitFor(() => expect(screen.getByText('No allowance')).toBeTruthy())
    expect(screen.getByText(/40 used/)).toBeTruthy()
  })

  it('shows a real percentage where a band HAS one', async () => {
    // The positive control for both: the page can render a percentage, so the
    // two words above are a choice about those bands rather than the only
    // thing it does.
    render(<Page />)
    fireEvent.click(screen.getByRole('button', { name: /scan organizations/i }))
    await waitFor(() => expect(screen.getAllByText('50%').length).toBeGreaterThan(0))
  })
})

describe('a row from an older route', () => {
  it('renders the missing band as unreported instead of crashing', async () => {
    // Version skew: a deployed route that predates a band this bundle knows
    // about. The whole margin table going blank is a worse answer than one
    // column saying nothing.
    const row = rowFor()
    delete (row.bands as Record<string, unknown>)['actionRuns']
    mockFetch.mockResolvedValue(
      jsonResponse({ rows: [row], nextCursor: null, scanned: 1, reads: 4 }),
    )
    render(<Page />)
    fireEvent.click(screen.getByRole('button', { name: /scan organizations/i }))
    await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy())
    // The rest of the row still reads.
    expect(screen.getByText('Uncapped')).toBeTruthy()
  })
})

describe('an org that bills nothing', () => {
  it('shows no margin rather than a bad one', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        rows: [
          rowFor({
            orgId: 'free-1',
            name: 'Freebie',
            plan: 'free',
            marginPct: null,
            rating: null,
            netRevenueUsd: 0,
            listPriceUsd: 0,
            mrrUsd: 0,
          }),
        ],
        nextCursor: null,
        scanned: 1,
        reads: 4,
      }),
    )
    render(<Page />)
    fireEvent.click(screen.getByRole('button', { name: /scan organizations/i }))
    await waitFor(() => expect(screen.getByText('Not billing')).toBeTruthy())
    // …and the fleet says so rather than reporting a median of nothing.
    expect(screen.getByText(/no margin to report/i)).toBeTruthy()
  })
})
