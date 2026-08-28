/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored (feedback_jest_environment_pragma_shadowed_by_license).
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
 * The billing page must not PAINT the ledger before it knows who is reading
 * it (AGL-243 gate, this file).
 *
 * ## What a member without `billing.view` sees
 *
 * The refusal itself is correct. What is wrong is that the plan, the
 * subscription status, the price and the renewal date paint first and stay on
 * screen for as long as the permission read takes — long enough for a
 * screenshot or a screen recording to keep them.
 *
 * ## The shape
 *
 * `useOrgPermissions` resolves through a `getDoc` on `orgs/{orgId}/members/
 * {uid}` — plus a SECOND read when the member carries a `roleId` — behind
 * `firestoreOneShotRetry`, so `loaded` can stay false for several seconds on a
 * retry. The org doc arrives on a listener that is routinely served from the
 * persistent cache. The two settle independently, and the page's guard read:
 *
 * ```jsx
 * {permissionsLoaded && !can('billing.view') ? <Refusal/> : …content…}
 * ```
 *
 * `permissionsLoaded &&` sits in the REFUSAL branch, so while the answer is in
 * flight the refusal is false and the else-branch — the whole page — renders.
 * The repo's own rule, `feedback_loading_default_answers_a_question`: gate on
 * `loaded`/`ready`, never let a pending answer BE an answer. `useOrgPermissions`
 * makes it sharper still by failing OPEN while loading, so every `can()` in
 * that window reads as an org admin's.
 *
 * ## What this file pins
 *
 * That the unresolved state renders NEITHER the ledger NOR the refusal — it
 * holds. Both halves matter: flipping the guard to show the refusal early
 * would accuse a legitimate admin of having no access on every navigation,
 * which is the AGL-2474 defect in the other direction.
 *
 * ⚠️ Every hold assertion below is paired with a negative control that drives
 * the SAME page to the state where the thing must appear — an "it is absent"
 * test also passes when the page renders nothing at all (AGL-2233), and this
 * page has a spinner branch that would swallow exactly that.
 */

import { PLAN_LABELS } from '@aglyn/aglyn'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

/**
 * The permission read's two independent axes, and the org doc beside them.
 *
 * `mock`-prefixed because jest hoists the `jest.mock` factories that read them
 * above these declarations.
 */
let mockPermissionsLoaded: boolean
let mockCanBillingView: boolean
let mockOrg: Record<string, any> | undefined
let mockReady: boolean

jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useLoading: () => ({ queueLoading: () => () => undefined }),
  useConfirmationContext: () => ({ confirm: async () => undefined }),
}))

jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  ...jest.requireActual('@aglyn/aglyn/app-utils/analytics-events'),
  readGaClientId: async () => null,
  trackEvent: () => undefined,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: () => undefined }),
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
  getDocsFromServer: async () => ({ docs: [], size: 0 }),
}))

const mockBranding = {
  branding: {
    productName: 'Aglyn',
    logoUrl: null,
    faviconUrl: null,
    primaryColor: null,
    supportUrl: null,
    fromName: 'Aglyn',
    emailLogoUrl: null,
    customConsoleDomain: null,
  },
  whiteLabel: false,
  ready: true,
}
jest.mock('../hooks/use-branding', () => ({
  __esModule: true,
  useBranding: () => mockBranding,
  default: () => mockBranding,
}))

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  // The section rail resolves the active tab from the path (AGL-693).
  usePathname: () => '/test-org/billing',
}))

/**
 * The section rail renders its own chrome — a card, a `Tabs`, a responsive
 * layout hook — none of which this suite is about. Stubbed to a passthrough so
 * these cases stay about the GATE: what the layout decides to render, not how
 * the navigation beside it is laid out. `hub-tabs` has its own tests.
 */
jest.mock('@aglyn/shared-ui-next/components/hub-tabs', () => ({
  __esModule: true,
  HubSections: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useActiveSection: () => null,
}))

jest.mock('../hooks/use-org-scope', () => ({ useOrgSlug: () => 'test-org' }))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: mockOrg, orgId: mockOrg?.$id, ready: mockReady }),
}))
/**
 * The `orgs/{orgId}/billing/stripe` listen. Left empty on purpose: the page
 * merges it OVER the org doc, and the fields this file reads back — status,
 * renewal, price — are supplied by `mockOrg` below so a single fixture
 * describes the whole workspace.
 */
jest.mock('../hooks/use-confirmed-doc', () => ({
  __esModule: true,
  default: () => ({ data: undefined }),
}))
/**
 * The hook under test, driven on BOTH axes.
 *
 * `permissions` and `can` mirror the real hook's fail-open contract: while
 * `loaded` is false it hands back an ADMIN's map, which is precisely why the
 * page may not consult it yet.
 */
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({
    permissions: mockPermissionsLoaded
      ? { editBilling: mockCanBillingView }
      : { editBilling: true },
    can: () => (mockPermissionsLoaded ? mockCanBillingView : true),
    loaded: mockPermissionsLoaded,
  }),
}))
jest.mock('../hooks/use-org-hosts', () => ({ useOrgHosts: () => ({ hosts: [] }) }))
jest.mock('../hooks/use-release-flags', () => ({
  useReleaseFlag: () => ({ visible: false }),
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
jest.mock(
  '../components/billing/billing-metered-estimate.component',
  () => nullCard,
)
jest.mock('../components/billing/billing-usage-history.component', () => nullCard)
jest.mock('../components/billing/billing-addons-card.component', () => ({
  __esModule: true,
  default: () => null,
  ADDON_LABELS: {},
}))
jest.mock(
  '../components/billing/billing-storage-overage-card.component',
  () => nullCard,
)
jest.mock(
  '../components/billing/billing-usage-budget-card.component',
  () => nullCard,
)
jest.mock(
  '../components/billing/billing-register-allocations-card.component',
  () => nullCard,
)
jest.mock(
  '../components/billing/billing-collaborator-allocations-card.component',
  () => nullCard,
)
jest.mock('../components/billing/retention-funnel.dialog', () => ({
  __esModule: true,
  RetentionFunnelDialog: () => null,
}))

import BillingPage from '../app/(app)/[orgSlug]/billing/(sections)/page'
import BillingSectionsLayout from '../app/(app)/[orgSlug]/billing/(sections)/layout'
import BillingInvoicesPage from '../app/(app)/[orgSlug]/billing/(sections)/invoices/page'

/**
 * The gate moved to the LAYOUT when billing became four routed sections
 * (AGL-693), so the invariant is only observable through it.
 *
 * Rendering the page bare would exercise a component that, in production, is
 * never reached until the layout has decided — and would quietly stop testing
 * the thing this suite is named after. Wrapping is what keeps these cases
 * about the gate rather than about one section's internals.
 */
const Billing = () => (
  <BillingSectionsLayout>
    <BillingPage />
  </BillingSectionsLayout>
)

/**
 * The invoice history moved to its own section (AGL-693), so the cases about
 * the invoice READ have to render THAT one. Left on the Plan section they
 * would pass for the wrong reason — Plan no longer asks for invoices at all,
 * so "it did not ask" would be true whatever the gate did.
 */
const BillingInvoices = () => (
  <BillingSectionsLayout>
    <BillingInvoicesPage />
  </BillingSectionsLayout>
)

/**
 * A REAL paying workspace — the fixture is the point.
 *
 * Every field below renders as a visible figure on the page: the tier name,
 * the live subscription status chip, and the renewal date. These are what a
 * screenshot of the flicker window captures.
 */
const PAYING_PRO_ORG = {
  $id: 'org-1',
  plan: 'pro' as const,
  subscription: {
    status: 'active',
    interval: 'month',
    currentPeriodEnd: Date.UTC(2027, 0, 14),
  },
}

/**
 * The renewal sentence exactly as the page formats it.
 *
 * Derived from `subscriptionPeriodNotice` rather than restated, so this stays
 * true when the copy changes — and, more importantly, so it cannot keep
 * asserting "Renews" on a subscription that is cancelling. The old literal
 * would have done exactly that: the date is the same field in both states and
 * only the verb differs.
 */
const RENEWAL_TEXT = subscriptionPeriodNotice({
  status: PAYING_PRO_ORG.subscription.status,
  cancelAtPeriodEnd: (PAYING_PRO_ORG.subscription as { cancelAtPeriodEnd?: boolean })
    .cancelAtPeriodEnd,
  currentPeriodEnd: PAYING_PRO_ORG.subscription.currentPeriodEnd,
}).sentence as string

const REFUSAL =
  'You do not have permission to view billing for this ' +
  'organization — ask an organization admin for access.'

let fetchMock: jest.Mock

beforeEach(() => {
  mockOrg = PAYING_PRO_ORG
  mockReady = true
  mockPermissionsLoaded = true
  mockCanBillingView = true
  fetchMock = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ invoices: [] }),
  })) as any
  global.fetch = fetchMock as any
})

afterEach(() => {
  jest.restoreAllMocks()
})

/** The plan grid's own container — absent entirely while the page holds. */
const grid = () => document.querySelector('#plans')

/** Every invoice-history request this render actually put on the wire. */
const invoiceCalls = () =>
  fetchMock.mock.calls.filter((call) =>
    String(call[0] ?? '').includes('/api/billing/invoices'),
  )

import { subscriptionPeriodNotice } from '../utils/subscription-period-notice'

describe('THE FLICKER: no ledger paints before the permission read lands', () => {
  beforeEach(() => {
    // The state that produces the flicker: the org doc has arrived (it is
    // served from the persistent cache and needs no round trip), the member
    // doc has not.
    mockPermissionsLoaded = false
    mockCanBillingView = false
  })

  it('renders no plan tier, no status chip and no renewal date', () => {
    render(<Billing />)
    // `queryAllByText`, not `queryByText`: the tier name appears both on the
    // Current plan card and on its grid card, and the singular query THROWS on
    // a multiple match instead of failing the assertion it was written for.
    expect(screen.queryAllByText(PLAN_LABELS.pro)).toHaveLength(0)
    expect(screen.queryAllByText('active')).toHaveLength(0)
    expect(screen.queryAllByText(RENEWAL_TEXT)).toHaveLength(0)
  })

  it('renders no plan grid and no upgrade path', () => {
    render(<Billing />)
    expect(grid()).toBeNull()
    expect(screen.queryByText('Current plan')).toBeNull()
    expect(screen.queryAllByRole('button', { name: 'Upgrade' })).toHaveLength(0)
  })

  it('offers none of the money CONTROLS either', () => {
    render(<Billing />)
    expect(
      screen.queryByRole('button', { name: 'Manage payment methods' }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Cancel subscription' }),
    ).toBeNull()
  })

  it('does not even ASK for the invoice history', async () => {
    // The route 403s without `billing.view`, so this is not the leak — it is
    // the same mistake one layer down: the effect's guard is also written
    // `permissionsLoaded && !can(...)`, so the request goes out while the
    // answer is unknown. Do not ask a question you are not yet entitled to.
    render(<BillingInvoices />)
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled())
    expect(invoiceCalls()).toHaveLength(0)
  })

  it('does not ACCUSE the reader either — it holds', () => {
    // The other direction, and it is a real defect too (AGL-2474): showing
    // the refusal on a pending read tells every legitimate admin they have no
    // access, on every navigation.
    render(<Billing />)
    expect(screen.queryByText(REFUSAL)).toBeNull()
    expect(screen.getByRole('progressbar')).toBeTruthy()
  })
})

describe('NEGATIVE CONTROLS: the page still works once the read lands', () => {
  it('a permitted reader sees the tier, the status and the renewal date', async () => {
    mockPermissionsLoaded = true
    mockCanBillingView = true
    render(<Billing />)
    // Without this, every assertion in the block above is satisfied by a page
    // that renders nothing at all.
    expect(screen.getAllByText(PLAN_LABELS.pro).length).toBeGreaterThan(0)
    expect(screen.getByText('active')).toBeTruthy()
    expect(screen.getByText(RENEWAL_TEXT)).toBeTruthy()
    expect(grid()).not.toBeNull()
    expect(
      screen.getByRole('button', { name: 'Manage payment methods' }),
    ).toBeTruthy()
  })

  it('a permitted reader’s invoice section does ask for the history', async () => {
    // The other half of the control, on the section that owns the read. Plan
    // no longer asks for invoices, so asserting it there would be vacuous.
    mockPermissionsLoaded = true
    mockCanBillingView = true
    render(<BillingInvoices />)
    await waitFor(() => expect(invoiceCalls().length).toBeGreaterThan(0))
  })

  it('a refused reader sees the refusal, and none of the ledger', () => {
    mockPermissionsLoaded = true
    mockCanBillingView = false
    render(<Billing />)
    expect(screen.getByText(REFUSAL)).toBeTruthy()
    expect(screen.queryAllByText(PLAN_LABELS.pro)).toHaveLength(0)
    expect(screen.queryAllByText(RENEWAL_TEXT)).toHaveLength(0)
    expect(grid()).toBeNull()
  })

  it('the org read still gets its own hold, permission or not', () => {
    // The AGL-1422 hold this page already had, re-asserted here so a fix to
    // the permission gate cannot quietly consume it.
    mockPermissionsLoaded = true
    mockCanBillingView = true
    mockReady = false
    mockOrg = undefined
    render(<Billing />)
    expect(grid()).toBeNull()
    expect(screen.getByRole('progressbar')).toBeTruthy()
  })
})
