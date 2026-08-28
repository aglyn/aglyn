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
 * WHAT THE BILLING HISTORY CARD SAYS WHEN IT HAS NOTHING TO SHOW (AGL-2486).
 *
 * `billing-invoices-other-stripe-mode.spec.ts` pins what the two routes
 * REPORT. This file pins what the two surfaces SAY, which is the half the
 * defect actually lived in: the route had been answering `{invoices: []}`
 * honestly enough, and the card turned it into the sentence "No invoices yet."
 * over `test-org`'s intact, paid, live-mode history.
 *
 * Three states, asserted on their COPY and never merely on "an empty table",
 * because an assertion that only counts rows passes in all three:
 *
 *   a. invoices exist            → the table, and NEITHER message
 *   b. other-mode customer       → the notice, and NOT "No invoices yet."
 *   c. no customer anywhere      → "No invoices yet.", and NOT the notice
 *
 * Each state asserts the absence of the other state's copy as well as the
 * presence of its own. That pairing is the whole point: showing the honest
 * notice is worth nothing if the misleading sentence is still on the page
 * beside it, and (b) and (c) are indistinguishable to any test that only looks
 * for the string it expects.
 *
 * The staff panel is asserted through its pure decision function rather than by
 * rendering `admin/orgs/[orgId]/page.tsx`, which no spec renders — plus a
 * CALL-SITE assertion that the page actually routes its empty state through
 * that function. A helper nothing calls is the `written_but_never_read` shape,
 * and it would leave the staff surface exactly as wrong as it was.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'

import {
  staffBillingCustomerChipLabel,
  staffBillingHistoryEmptyState,
  stripeOtherModeInvoiceNotice,
} from '../utils/stripe-mode-notice'

export {}

/** The `/api/billing/invoices` body for the case under test. */
let mockInvoicePayload: Record<string, unknown>

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
    supportUrl: 'https://aglyn.com/support',
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
}))

jest.mock('../hooks/use-org-scope', () => ({ useOrgSlug: () => 'test-org' }))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({
    // A workspace that BOUGHT and cancelled — `test-org`'s shape. An org that
    // had never subscribed would make case (b) unreachable by construction.
    org: {
      $id: 'org-1',
      plan: 'free',
      billingStatus: 'canceled',
      subscription: { status: 'canceled', interval: 'month' },
    },
    orgId: 'org-1',
    ready: true,
  }),
}))
jest.mock('../hooks/use-confirmed-doc', () => ({
  __esModule: true,
  default: () => ({ data: undefined }),
}))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({
    permissions: { editBilling: true },
    can: () => true,
    loaded: true,
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

/**
 * Chrome and every sibling card. Each stubbed card reads an endpoint of its
 * own and would render its own "couldn't load" Alert against the fetch stub
 * below — noise this file's assertions would have to pick through.
 */
const passthrough = {
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}
const nullCard = { __esModule: true, default: () => null }
jest.mock('../components/layouts/dashboard.layout', () => passthrough)
jest.mock('../components/layouts/authenticated.layout', () => passthrough)
jest.mock('../components/layouts/main.layout', () => passthrough)
jest.mock('../components/billing/billing-usage.component', () => nullCard)
jest.mock('../components/billing/billing-usage-history.component', () => nullCard)
jest.mock(
  '../components/billing/billing-metered-estimate.component',
  () => nullCard,
)
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

// The invoice history moved to its own section when billing was split
// (AGL-2501). Same card, same states — this suite follows it rather than
// asserting against a Plan page that no longer lists invoices.
import BillingPage from '../app/(app)/[orgSlug]/billing/(sections)/invoices/page'

/** The honest sentence, read from the source of truth rather than retyped. */
const NOTICE = stripeOtherModeInvoiceNotice('test')
const NEVER_BILLED = 'No invoices yet.'

beforeEach(() => {
  mockInvoicePayload = { invoices: [], hasMore: false }
  global.fetch = jest.fn(async (input: any) => ({
    ok: true,
    status: 200,
    json: async () =>
      String(input).startsWith('/api/billing/invoices')
        ? mockInvoicePayload
        : {},
  })) as any
})

afterEach(() => {
  jest.restoreAllMocks()
})

/** Renders the page and waits for the invoice fetch to have landed. */
async function renderBilling() {
  render(<BillingPage />)
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalled()
  })
}

describe('the customer billing card (AGL-2486)', () => {
  it('b. says which Stripe mode is in the way instead of "No invoices yet."', async () => {
    mockInvoicePayload = {
      invoices: [],
      hasMore: false,
      otherModeOnly: true,
      deploymentMode: 'test',
    }
    await renderBilling()
    await waitFor(() => {
      expect(screen.getByText(NOTICE)).toBeTruthy()
    })
    // The load-bearing half. The notice is worth nothing if the sentence it
    // replaces is still on the page.
    expect(screen.queryByText(NEVER_BILLED)).toBeNull()
  })

  it('b. names both modes and points at where to look', async () => {
    // Asserted on the CONTENT, not merely on an alert being present: the
    // wrong-but-plausible message here is a vague "we could not load your
    // invoices", which is indistinguishable from a failure and would send a
    // developer looking for a broken endpoint.
    mockInvoicePayload = {
      invoices: [],
      hasMore: false,
      otherModeOnly: true,
      deploymentMode: 'test',
    }
    await renderBilling()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('live mode')
    expect(alert.textContent).toContain('test mode')
    // It points AT the other mode without claiming what is there. The copy
    // used to say the history was "intact", which was safe while this only
    // fired for a MISSING customer — the other mode was then the only place
    // anything could have been billed. It now also fires when both modes have
    // a customer, and this deployment cannot query the other mode's key, so
    // "intact" would be a claim about records nothing here has read.
    expect(alert.textContent).toMatch(/expecting invoices|cannot be listed/i)
    expect(alert.textContent).not.toContain('intact')
  })

  it('b. takes the deployment mode from the RESPONSE, not from a constant', async () => {
    // Only the server knows which Stripe key it holds. A page that assumed
    // "test" would be right on localhost — the only place this appears today —
    // and would quietly print the wrong pair of modes the first time a live
    // deployment met a test-only org.
    mockInvoicePayload = {
      invoices: [],
      hasMore: false,
      otherModeOnly: true,
      deploymentMode: 'live',
    }
    await renderBilling()
    await waitFor(() => {
      expect(screen.getByText(stripeOtherModeInvoiceNotice('live'))).toBeTruthy()
    })
    expect(screen.queryByText(NOTICE)).toBeNull()
  })

  it('c. an org that was never billed still reads "No invoices yet."', async () => {
    mockInvoicePayload = {
      invoices: [],
      hasMore: false,
      otherModeOnly: false,
      deploymentMode: 'test',
    }
    await renderBilling()
    await waitFor(() => {
      expect(screen.getByText(NEVER_BILLED)).toBeTruthy()
    })
    expect(screen.queryByText(NOTICE)).toBeNull()
  })

  it('c. a response with no mode fields at all is treated as truly empty', async () => {
    // Whatever a cache or an older deployment serves, the DEFAULT must be the
    // old sentence — a notice shown to a customer who really has no invoices
    // would be a new lie in the other direction.
    mockInvoicePayload = { invoices: [], hasMore: false }
    await renderBilling()
    await waitFor(() => {
      expect(screen.getByText(NEVER_BILLED)).toBeTruthy()
    })
    expect(screen.queryByText(NOTICE)).toBeNull()
  })

  it('a. a workspace WITH invoices shows them and neither message', async () => {
    mockInvoicePayload = {
      invoices: [
        {
          id: 'in_1',
          number: 'AGL-0001',
          status: 'paid',
          amountDueCents: 1900,
          totalCents: 1900,
          currency: 'usd',
          created: '2026-07-01T00:00:00.000Z',
          paidAt: '2026-07-01T00:00:00.000Z',
          periodEnd: null,
          hostedInvoiceUrl: 'https://invoice.stripe.com/i/1',
          invoicePdf: null,
          receiptUrl: null,
        },
      ],
      hasMore: false,
    }
    await renderBilling()
    await waitFor(() => {
      expect(screen.getByText('AGL-0001')).toBeTruthy()
    })
    expect(screen.queryByText(NEVER_BILLED)).toBeNull()
    expect(screen.queryByText(NOTICE)).toBeNull()
  })
})

describe('the staff panel decides between the same three states', () => {
  it('b. a live-only customer on a test deployment gets the notice', () => {
    const state = staffBillingHistoryEmptyState({
      hasCustomer: false,
      otherModeOnly: true,
      deploymentMode: 'test',
    })
    expect(state.tone).toBe('notice')
    expect(state.message).toBe(stripeOtherModeInvoiceNotice('test'))
    // `hasCustomer: false` is true of this org and MUST NOT win — that is
    // precisely the reading that called a paying workspace unsubscribed.
    expect(state.message).not.toContain('never subscribed')
  })

  it('b. and the chip beside it stops claiming "Never subscribed"', () => {
    expect(
      staffBillingCustomerChipLabel({ hasCustomer: false, otherModeOnly: true }),
    ).toBe('Other Stripe mode')
  })

  it('c. an org with no customer in either mode is still never subscribed', () => {
    const state = staffBillingHistoryEmptyState({
      hasCustomer: false,
      otherModeOnly: false,
      deploymentMode: 'test',
    })
    expect(state.tone).toBe('plain')
    expect(state.message).toBe('This organization has never subscribed.')
    expect(staffBillingCustomerChipLabel({ hasCustomer: false })).toBe(
      'Never subscribed',
    )
  })

  it('a. a customer this deployment CAN see, with no invoices, is plain', () => {
    const state = staffBillingHistoryEmptyState({ hasCustomer: true })
    expect(state.tone).toBe('plain')
    expect(state.message).toBe('No invoices yet.')
    expect(staffBillingCustomerChipLabel({ hasCustomer: true })).toBe(
      'No payment method',
    )
  })

  it('the mirror direction is worded from the deployment, not hardcoded', () => {
    const state = staffBillingHistoryEmptyState({
      otherModeOnly: true,
      deploymentMode: 'live',
    })
    expect(state.message).toBe(stripeOtherModeInvoiceNotice('live'))
    expect(state.message).not.toBe(stripeOtherModeInvoiceNotice('test'))
  })
})

describe('the staff page is WIRED to that decision', () => {
  const source = readFileSync(
    join(__dirname, '..', 'app/(app)/admin/orgs/[orgId]/page.tsx'),
    'utf8',
  )

  it('reads a real file', () => {
    expect(source.length).toBeGreaterThan(10000)
  })

  it('routes its empty billing history through the shared decision', () => {
    // Without this, the function above could be perfectly correct and never
    // called — the staff panel would go on saying "never subscribed" and every
    // assertion in the block above would still be green.
    expect(source).toContain('staffBillingHistoryEmptyState(billing)')
    expect(source).toContain('staffBillingCustomerChipLabel(billing)')
  })

  it('no longer decides the empty-state copy inline', () => {
    // The two literals the helper now owns. Left behind in the page, they are
    // a second answer that would silently win in whichever branch kept them.
    expect(source).not.toContain("'This organization has never subscribed.'")
    expect(source).not.toContain("? 'Never subscribed'")
  })
})

/**
 * The button that says "manage payment methods" goes to the surface that
 * manages payment methods.
 *
 * It opened the Stripe Billing Portal — a different product, in a new tab —
 * because the portal used to be the only place a card could be changed. It is
 * not: the Settings section has those cards in our own design.
 *
 * The portal is NOT removed. It stays reachable from `Outstanding`, where a
 * failed payment is actually recovered, and labelled as what it is. One button
 * was doing two jobs.
 */
describe('the payment-methods button and the portal are different jobs', () => {
  const source = readFileSync(
    join(
      __dirname,
      '..',
      'app/(app)/[orgSlug]/billing/(sections)/page.tsx',
    ),
    'utf8',
  )
  const outstanding = readFileSync(
    join(
      __dirname,
      '..',
      'components/billing/billing-open-invoices-card.component.tsx',
    ),
    'utf8',
  )

  it('CONTROL — the files being read are the right ones', () => {
    expect(source).toContain('Manage payment methods')
    expect(outstanding).toContain('Outstanding')
  })

  it('resolves to the Settings section, not the portal', () => {
    const at = source.indexOf('Manage payment methods')
    // The route, near the button rather than anywhere in a 1300-line file.
    const around = source.slice(Math.max(0, at - 700), at)
    expect(around).toContain('Route.MANAGE_BILLING_SETTINGS')
    expect(around).not.toContain('handleOpenPortal')
  })

  it('does NOT remove the portal — it moves it to dunning recovery', () => {
    // Removing it in the same change would take a customer in dunning from an
    // inconsistent button to no fallback at all, while the native pay button
    // is still unproven against a real decline.
    expect(source).toContain('handleOpenPortal')
    expect(outstanding).toContain('onOpenPortal')
    expect(outstanding).toContain('Open the Stripe billing portal')
  })
})
