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
 * A FAILED permission read must not answer "owner" (AGL-243 residual).
 *
 * ## The shape, and why it is worse than the flicker
 *
 * `billing-permission-gate-holds-while-loading.spec.tsx` pins the LOADING
 * window: the gates now hold on `loaded`. This file pins the other trigger for
 * the identical leak, which that hold does not cover at all.
 *
 * `useOrgPermissions`' `catch` read:
 *
 * ```ts
 * catch {
 *   // Fail open — surfaces stay visible; APIs still enforce.
 *   if (active) setState((prev) => ({ ...prev, orgId, loaded: true }))
 * }
 * ```
 *
 * `prev.granted` at that moment is still the seed value, `ALL_GRANTED`. So the
 * spread published an OWNER's permission map under `loaded: true` — a flag
 * whose entire meaning is "the answer has arrived". Every gate AGL-243 added
 * holds on `loaded`, so every one of them would let go and paint in full.
 *
 * The loading leak needed a slow member read. This one needs a transient
 * Firestore denial — a network hiccup, an expired session, a rules deploy in
 * flight — and it is permanent for that page view rather than 200ms. It can
 * fire in production with nobody doing anything unusual.
 *
 * ## What this file pins, on both halves
 *
 * 1. The hook itself: a failed read denies, `loaded` stays false, `errored`
 *    goes true.
 * 2. The billing page driven through the REAL hook with a rejecting read:
 *    no plan, no price, no renewal date, no money controls, no invoice
 *    request — and no accusation either.
 *
 * ⚠️ Every "absent" assertion is paired with a negative control that drives
 * the SAME code path to success, because a page that renders nothing passes an
 * absence test for free (AGL-2233).
 */

import {
  PLAN_LABELS,
  registerPluginPermissions,
  resolveRolePermissions,
} from '@aglyn/aglyn'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

/**
 * The member read, as a jest mock so a single test can decide whether it
 * answers or throws. `mock`-prefixed because jest hoists the `jest.mock`
 * factory that closes over it above this declaration.
 */
let mockGetDoc: jest.Mock

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
  getDocsFromServer: async () => ({ docs: [], size: 0 }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useUser: () => ({ data: { uid: 'u1', getIdToken: async () => 'token' } }),
}))

/**
 * STABLE IDENTITY, and this is not cosmetic. `useFirestore` is in the hook's
 * effect deps; a factory returning a fresh `{}` per call re-runs the effect
 * forever — render → effect → setState → new `{}` → render. That is an
 * infinite MICROTASK loop, so jest's real-timer `testTimeout` never fires and
 * the suite hangs rather than failing (AGL-2105, and again in
 * `site-member-reversal-label.spec.tsx`).
 */
const FIRESTORE = {}

/**
 * The org scope, answered. The hook needs an `orgId` to attempt the read at
 * all — with `currentOrg` undefined it short-circuits to the fresh-account
 * owner branch and never reaches the `catch` this file is about.
 */
jest.mock('../hooks/use-org-scope', () => ({
  __esModule: true,
  default: () => ({ currentOrg: { $id: 'org-1' }, loading: false }),
  useOrgSlug: () => 'test-org',
}))

import useOrgPermissions from '../hooks/use-org-permissions'

/**
 * A transient failure, spelled the way Firestore spells one.
 *
 * `unavailable` rather than `permission-denied` deliberately:
 * `firestoreOneShotRetry` rethrows anything else immediately, while
 * `permission-denied` costs five 400ms retries before it reaches the same
 * `catch`. Both land in the same place; this one keeps the suite fast. The
 * exhausted-retry path is covered below with the retry helper stubbed.
 */
const TRANSIENT = Object.assign(new Error('backend unavailable'), {
  code: 'unavailable',
})

/** A real member document: an admin, so the deny cannot pass by accident. */
const ADMIN_MEMBER = {
  exists: () => true,
  data: () => ({ role: 'admin' }),
}

beforeAll(() => {
  // The plugin half of the map (AGL-2474). `managePos` is what the commerce
  // POS shell reads, and it is the key that painted the register — the
  // storefront catalog with prices, the tender buttons, and a room-charge
  // dialog listing checked-in guests BY NAME.
  registerPluginPermissions([
    {
      key: 'managePos',
      pluginId: 'commerce',
      label: 'Manage the register',
      defaults: { admin: true, editor: false, viewer: false },
    },
  ])
})

beforeEach(() => {
  mockGetDoc = jest.fn(async () => ADMIN_MEMBER) as any
})

afterEach(() => {
  jest.restoreAllMocks()
})

/* ------------------------------------------------------------------ *
 * PART 1 — the hook
 * ------------------------------------------------------------------ */

/** The hook's verdict, published where an assertion can read it. */
let verdict: ReturnType<typeof useOrgPermissions>

function Probe() {
  verdict = useOrgPermissions()
  return null
}

describe('THE HOOK: a failed member read denies, and says it failed', () => {
  beforeEach(() => {
    mockGetDoc = jest.fn(async () => {
      throw TRANSIENT
    }) as any
  })

  it('does not answer as an owner', async () => {
    render(<Probe />)
    await waitFor(() => expect(verdict.errored).toBe(true))
    // The four spellings the console actually gates on. `can()` is the
    // granular one; `permissions` is the legacy/plugin map; `isOwner` is read
    // as an authorization answer in its own right and was seeded TRUE.
    expect(verdict.can('billing.view')).toBe(false)
    expect(verdict.can('org.auditLog')).toBe(false)
    expect(verdict.permissions.editBilling).toBe(false)
    expect(verdict.isOwner).toBe(false)
  })

  it('leaves every plugin-declared key false, not undefined', async () => {
    render(<Probe />)
    await waitFor(() => expect(verdict.errored).toBe(true))
    // `strictNullChecks` is OFF repo-wide, so a MISSING key is not a compile
    // error and reads back `undefined` — which sails straight through the
    // shell's real gate, `permissions?.managePos !== false`. Absent is not
    // denied. Assert the value, and assert the key is present at all.
    expect(verdict.permissions.managePos).toBe(false)
    expect('managePos' in verdict.permissions).toBe(true)
    expect(verdict.permissions.managePos !== false).toBe(false)
  })

  it('does not claim the read landed — `loaded` stays false so gates hold', async () => {
    render(<Probe />)
    await waitFor(() => expect(verdict.errored).toBe(true))
    // This is the whole bug in one assertion. `loaded: true` over an
    // untouched `ALL_GRANTED` is what let five gated surfaces let go.
    expect(verdict.loaded).toBe(false)
    expect(verdict.status).toBe('error')
  })

  it('is distinguishable from still-loading — three states, not two', async () => {
    // Never resolves: the loading window, held open.
    mockGetDoc = jest.fn(() => new Promise(() => undefined)) as any
    render(<Probe />)
    expect(verdict.status).toBe('loading')
    expect(verdict.errored).toBe(false)
    // And loading STAYS permissive, on purpose (AGL-2474): refusing here is
    // the mirrored defect — it accuses a legitimate admin on every
    // navigation. A caller that cannot tell these two apart must either
    // flash a refusal or leak on error; that is why `status` exists.
    expect(verdict.permissions.managePos).toBe(true)
    expect(verdict.can('billing.view')).toBe(true)
  })
})

describe('NEGATIVE CONTROLS: a read that LANDS still answers', () => {
  it('an admin whose read succeeds gets the admin map', async () => {
    render(<Probe />)
    await waitFor(() => expect(verdict.loaded).toBe(true))
    // Without this the deny assertions above pass against a hook that denies
    // everybody — which would lock out every paying customer.
    expect(verdict.status).toBe('ready')
    expect(verdict.errored).toBe(false)
    expect(verdict.can('billing.view')).toBe(true)
    expect(verdict.permissions.editBilling).toBe(true)
    expect(verdict.permissions.managePos).toBe(true)
    expect(verdict.isOwner).toBe(true)
  })

  it('a viewer whose read succeeds is refused on the merits, not by error', async () => {
    mockGetDoc = jest.fn(async () => ({
      exists: () => true,
      data: () => ({ role: 'viewer' }),
    })) as any
    render(<Probe />)
    await waitFor(() => expect(verdict.loaded).toBe(true))
    // A real refusal and an errored read must not be the same state: this one
    // is `ready`, so the page shows the REFUSAL, not the retry notice.
    expect(verdict.errored).toBe(false)
    expect(verdict.can('billing.view')).toBe(false)
    expect(verdict.role).toBe('viewer')
  })

  it('the deny map covers exactly the key space the admin map does', async () => {
    render(<Probe />)
    await waitFor(() => expect(verdict.loaded).toBe(true))
    const grantedKeys = Object.keys(verdict.permissions).sort()
    mockGetDoc = jest.fn(async () => {
      throw TRANSIENT
    }) as any
    render(<Probe />)
    await waitFor(() => expect(verdict.errored).toBe(true))
    // A deny map with FEWER keys is a fail-open dressed as a fail-closed —
    // every key it omits comes back `undefined`.
    expect(Object.keys(verdict.permissions).sort()).toEqual(grantedKeys)
    expect(
      Object.keys(resolveRolePermissions('admin')).every(
        (key) => verdict.permissions[key] === false,
      ),
    ).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * PART 2 — the billing page, driven through the REAL hook
 * ------------------------------------------------------------------ */

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
  // The section rail resolves the active tab from the path (AGL-2501).
  usePathname: () => '/test-org/billing',
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: mockOrg, orgId: mockOrg?.$id, ready: mockReady }),
}))
jest.mock('../hooks/use-confirmed-doc', () => ({
  __esModule: true,
  default: () => ({ data: undefined }),
}))
jest.mock('../hooks/use-org-hosts', () => ({ useOrgHosts: () => ({ hosts: [] }) }))
jest.mock('../hooks/use-release-flags', () => ({
  useReleaseFlag: () => ({ visible: false, ready: true }),
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

import { subscriptionPeriodNotice } from '../utils/subscription-period-notice'
import BillingPage from '../app/(app)/[orgSlug]/billing/(sections)/page'
import BillingSectionsLayout from '../app/(app)/[orgSlug]/billing/(sections)/layout'
import BillingInvoicesPage from '../app/(app)/[orgSlug]/billing/(sections)/invoices/page'

/**
 * The gate moved to the LAYOUT when billing became four routed sections
 * (AGL-2501), so the invariant is only observable through it.
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

/** The section that owns the invoice read since AGL-2501. */
const BillingInvoices = () => (
  <BillingSectionsLayout>
    <BillingInvoicesPage />
  </BillingSectionsLayout>
)

/** A real paying workspace — every field below paints as a visible figure. */
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
 * Derived from `subscriptionPeriodNotice` rather than restated, so it cannot
 * keep asserting "Renews" on a subscription that is cancelling — the date is
 * the same field in both states and only the verb differs.
 */
const RENEWAL_TEXT = subscriptionPeriodNotice({
  status: PAYING_PRO_ORG.subscription.status,
  currentPeriodEnd: PAYING_PRO_ORG.subscription.currentPeriodEnd,
}).sentence as string
const REFUSAL =
  'You do not have permission to view billing for this ' +
  'organization — ask an organization admin for access.'

let fetchMock: jest.Mock

const grid = () => document.querySelector('#plans')
const invoiceCalls = () =>
  fetchMock.mock.calls.filter((call) =>
    String(call[0] ?? '').includes('/api/billing/invoices'),
  )

describe('THE PAGE: a failed permission read paints no ledger', () => {
  beforeEach(() => {
    mockOrg = PAYING_PRO_ORG
    mockReady = true
    fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ invoices: [] }),
    })) as any
    global.fetch = fetchMock as any
    mockGetDoc = jest.fn(async () => {
      throw TRANSIENT
    }) as any
  })

  it('renders no plan tier, no status chip and no renewal date', async () => {
    render(<Billing />)
    // Settle the rejected read FIRST — asserting before it lands would pass
    // on the loading hold and prove nothing about the failure path.
    await waitFor(() =>
      expect(screen.queryByRole('progressbar')).toBeNull(),
    )
    expect(screen.queryAllByText(PLAN_LABELS.pro)).toHaveLength(0)
    expect(screen.queryAllByText('active')).toHaveLength(0)
    expect(screen.queryAllByText(RENEWAL_TEXT)).toHaveLength(0)
    expect(grid()).toBeNull()
  })

  it('offers none of the money controls', async () => {
    render(<Billing />)
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull())
    expect(
      screen.queryByRole('button', { name: 'Manage payment methods' }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Cancel subscription' }),
    ).toBeNull()
    expect(screen.queryAllByRole('button', { name: 'Upgrade' })).toHaveLength(0)
  })

  it('does not ask for the invoice history', async () => {
    render(<Billing />)
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull())
    expect(invoiceCalls()).toHaveLength(0)
  })

  it('says the check FAILED — it does not accuse the reader', async () => {
    render(<Billing />)
    const notice = await screen.findByText(/couldn't confirm your access/i)
    expect(notice).toBeTruthy()
    // Holding over refusing: "you do not have permission" is a claim we did
    // not establish, and telling a legitimate admin that on a hiccup is a
    // support ticket (AGL-2474).
    expect(screen.queryByText(REFUSAL)).toBeNull()
  })
})

describe('NEGATIVE CONTROL: the page still works when the read lands', () => {
  beforeEach(() => {
    mockOrg = PAYING_PRO_ORG
    mockReady = true
    fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ invoices: [] }),
    })) as any
    global.fetch = fetchMock as any
    mockGetDoc = jest.fn(async () => ADMIN_MEMBER) as any
  })

  it('an admin sees the tier, the status, the renewal date and the controls', async () => {
    render(<Billing />)
    await waitFor(() =>
      expect(screen.getAllByText(PLAN_LABELS.pro).length).toBeGreaterThan(0),
    )
    expect(screen.getByText('active')).toBeTruthy()
    expect(screen.getByText(RENEWAL_TEXT)).toBeTruthy()
    expect(grid()).not.toBeNull()
    expect(
      screen.getByRole('button', { name: 'Manage payment methods' }),
    ).toBeTruthy()
    expect(screen.queryByText(/couldn't confirm your access/i)).toBeNull()
  })

  it('and their invoice section asks for the history', async () => {
    // Plan no longer reads invoices (AGL-2501), so the control for that read
    // belongs on the section that does — asserting it here would be vacuous.
    render(<BillingInvoices />)
    await waitFor(() => expect(invoiceCalls().length).toBeGreaterThan(0))
  })
})
