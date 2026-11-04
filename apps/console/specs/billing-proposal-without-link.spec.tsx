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
 * A standing proposal is priced on Billing without its link (AGL-4154).
 *
 * The hand-off's link carries the proposed plan, cadence, add-ons and code
 * (AGL-3955/3956), and the quote tries that code on its first price. An owner
 * who opens Billing from the menu instead used to get no quote and no code,
 * so the proposed plan was bought at list price unless they typed the code.
 * This mounts the real page with the quote card replaced by a probe, and
 * asserts what the page hands it.
 */

import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const PROPOSAL = {
  plan: 'pro',
  interval: 'year',
  coupon: 'ELITE40',
  proposedBy: 'staff-1',
  proposedAt: 1_700_000_000_000,
}
let mockOrg: Record<string, unknown>
let mockParams = new URLSearchParams()

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
// The barrel stays real apart from the two contexts the page needs a host for.
jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useLoading: () => ({ queueLoading: () => () => undefined }),
  useConfirmationContext: () => ({ confirm: async () => undefined }),
}))
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  ...jest.requireActual('@aglyn/aglyn/app-utils/analytics-events'),
  readGaClientId: async () => null,
  trackEvent: jest.fn(),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u1', getIdToken: async () => 'token' } }),
}))
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), back: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => mockParams,
  usePathname: () => '/acme/billing',
}))
jest.mock('../hooks/use-org-scope', () => {
  // One object, as in the sibling billing specs: a fresh one per call is
  // what manufactured the AGL-2105 render loop.
  const scope = {
    orgs: [],
    currentOrg: null,
    selectOrg: () => undefined,
    orgSlug: null,
    pathOrgSlug: 'acme',
    loading: false,
    confirmed: true,
    slugExists: true,
    error: false,
    retry: () => undefined,
    hasMoreOrgs: false,
    loadMoreOrgs: () => undefined,
  }
  return {
    __esModule: true,
    useOrgSlug: () => 'acme',
    useOrgScope: () => scope,
    default: () => scope,
  }
})
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: mockOrg, orgId: 'org-1', ready: true }),
}))
// The billing doc has landed and holds no subscription: the state in which a
// proposal stands.
const mockBillingDoc = { data: undefined, ready: true }
jest.mock('@aglyn/tenant-feature-instance/hooks/use-confirmed-doc', () => ({
  __esModule: true,
  default: () => mockBillingDoc,
}))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({
    permissions: { editBilling: true },
    can: () => true,
    loaded: true,
  }),
}))
jest.mock('../hooks/use-org-hosts', () => ({
  useOrgHosts: () => ({ hosts: [] }),
}))
jest.mock('../hooks/use-release-flags', () => ({
  useReleaseFlag: () => ({ visible: false }),
  useReleaseFlags: () => ({ ready: true, isStaff: false, flags: {} }),
}))
jest.mock('../utils/fetch-seat-counts', () => ({
  __esModule: true,
  default: async () => ({ managerSeats: 1, collaboratorSeats: 0 }),
}))

const passthrough = {
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}
const nullCard = { __esModule: true, default: () => null }
jest.mock('../components/layouts/dashboard.layout', () => passthrough)
jest.mock('../components/layouts/authenticated.layout', () => passthrough)
jest.mock('../components/layouts/main.layout', () => passthrough)
jest.mock('../components/billing/billing-usage.component', () => nullCard)
jest.mock('../components/billing/billing-metered-estimate.component', () => nullCard)
jest.mock('../components/billing/billing-addons-card.component', () => ({
  __esModule: true,
  default: () => null,
  ADDON_LABELS: {},
}))
jest.mock('../components/billing/billing-storage-overage-card.component', () => nullCard)
jest.mock('../components/billing/billing-usage-budget-card.component', () => nullCard)
jest.mock('../components/org-upgrade-proposal-card.component', () => nullCard)
// The probe: what the page hands the quote is the whole question here. The
// quote's own handling of `initialCoupon` is driven in
// `billing-quote-bundle-addons.spec.tsx`.
jest.mock('../components/billing/billing-plan-quote.component', () => ({
  __esModule: true,
  default: (props: { plan: string; interval: string; initialCoupon?: string | null }) => (
    <div
      data-testid="quote"
      data-plan={props.plan}
      data-interval={props.interval}
      data-coupon={props.initialCoupon ?? ''}
    />
  ),
}))

import BillingPage from '../app/(app)/[orgSlug]/billing/(sections)/page'

beforeEach(() => {
  mockParams = new URLSearchParams()
  mockOrg = { $id: 'org-1', plan: 'starter', upgradeProposal: PROPOSAL }
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ invoices: [] }),
  })) as never
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('AGL-4154 · Billing prices a standing proposal without its link', () => {
  it('opened from the menu, quotes the proposed plan, cadence and code', async () => {
    render(<BillingPage />)
    const quote = await screen.findByTestId('quote')
    expect(quote.dataset.plan).toBe('pro')
    expect(quote.dataset.interval).toBe('year')
    expect(quote.dataset.coupon).toBe('ELITE40')
  })

  it('lets a link say what the visitor came to buy', async () => {
    mockParams = new URLSearchParams('plan=starter&interval=month')
    render(<BillingPage />)
    const quote = await screen.findByTestId('quote')
    expect(quote.dataset.plan).toBe('starter')
    expect(quote.dataset.interval).toBe('month')
    expect(quote.dataset.coupon).toBe('')
  })

  it('quotes nothing on an ordinary visit with no proposal', async () => {
    mockOrg = { $id: 'org-1', plan: 'starter' }
    render(<BillingPage />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByTestId('quote')).toBeNull()
  })

  it('quotes nothing once a subscription is live, which settles the proposal', async () => {
    mockOrg = { $id: 'org-1', plan: 'pro', billingStatus: 'active', upgradeProposal: PROPOSAL }
    render(<BillingPage />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByTestId('quote')).toBeNull()
  })
})
