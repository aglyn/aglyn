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
 * THE BILLING LANDING HAS AN "UPDATE PAYMENT METHOD" BUTTON (AGL-3442).
 *
 * A failed-payment email and the past-due banner tell the reader to update
 * the payment method in Billing. This mounts the real Billing page and
 * checks the button they mean is there, plainly labeled, in the Current plan
 * card's header; that pressing it asks the subscription route for the
 * portal's payment-method flow and goes where the route answers; and that a
 * link carrying its anchor lands with the button in view and focused.
 *
 * The control is a workspace with no Stripe customer, where the route would
 * answer 409: the button is not offered there, so a page that rendered it
 * unconditionally fails here.
 */

import {
  PLATFORM_BRAND_NAME,
  PLATFORM_SUPPORT_URL,
} from '@aglyn/aglyn/app-utils/platform-brand'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

/** A paying Pro org whose last renewal failed. */
const ORG = {
  $id: 'org-1',
  plan: 'pro' as const,
  subscription: { status: 'past_due' },
}

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
// One user object for every render, as the real hook returns: a fresh one
// per call re-runs every effect keyed on the user, and the profile read
// would loop.
const mockUser = { data: { uid: 'u1', getIdToken: async () => 'token' } }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => mockUser,
}))
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
  getDocsFromServer: async () => ({ docs: [], size: 0 }),
}))

/** See `billing-downgrade-confirm.spec.tsx` for why this is mocked narrowly. */
const mockBranding = {
  branding: {
    productName: PLATFORM_BRAND_NAME,
    logoUrl: null,
    faviconUrl: null,
    primaryColor: null,
    supportUrl: PLATFORM_SUPPORT_URL,
    fromName: PLATFORM_BRAND_NAME,
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
  useSearchParams: () => new URLSearchParams(),
  // `AppLink` (Manage payment methods) reads the current path for its
  // active state.
  usePathname: () => '/acme/billing',
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}))
jest.mock('../hooks/use-org-scope', () => ({ useOrgSlug: () => 'acme' }))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: ORG, orgId: ORG.$id, ready: true }),
}))
jest.mock('../hooks/use-confirmed-doc', () => ({
  __esModule: true,
  default: () => ({ data: undefined, ready: true }),
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
jest.mock('../utils/browser-stripe', () => ({
  __esModule: true,
  getBrowserStripe: () => Promise.resolve({}),
  browserStripeConfigured: () => true,
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
jest.mock('../components/plugin-widget-slot.component', () => ({
  __esModule: true,
  default: () => null,
  useSlotWidgets: () => ({ widgets: [], ready: true }),
}))
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
jest.mock(
  '../components/billing/billing-register-allocations-card.component',
  () => nullCard,
)
jest.mock('../components/billing/retention-funnel.dialog', () => ({
  __esModule: true,
  RetentionFunnelDialog: () => null,
}))

import BillingPage from '../app/(app)/[orgSlug]/billing/(sections)/page'

/** Every `/api/billing/subscription` body, in order. */
let subscriptionCalls: Array<Record<string, any>>
/** Whether the profile read finds a Stripe customer for the workspace. */
let hasCustomer: boolean

beforeEach(() => {
  subscriptionCalls = []
  hasCustomer = true
  window.history.replaceState(null, '', '/acme/billing')
  global.fetch = jest.fn(async (input: any, init?: any) => {
    const url = String(input)
    if (url.startsWith('/api/billing/profile')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          configured: true,
          customer: hasCustomer
            ? {
                email: 'owner@example.com',
                name: 'Acme',
                address: { line1: '1 Example St', line2: '', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
              }
            : null,
          taxIds: [],
          paymentMethods: hasCustomer
            ? [{ id: 'pm_1', type: 'card', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030, email: null, isDefault: true }]
            : [],
        }),
      }
    }
    if (url.startsWith('/api/billing/subscription')) {
      const body = JSON.parse(String(init?.body ?? '{}'))
      subscriptionCalls.push(body)
      return {
        ok: true,
        status: 200,
        // A same-document URL, because jsdom navigates only those: landing on
        // it proves the page went where the route answered.
        json: async () => ({ url: '#stripe-portal-session' }),
      }
    }
    return { ok: true, status: 200, json: async () => ({ invoices: [] }) }
  }) as any
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
  jest.restoreAllMocks()
})

describe('the Update payment method button (AGL-3442)', () => {
  it('is in the Current plan card header, plainly labeled', async () => {
    render(<BillingPage />)
    const button = await screen.findByRole('button', { name: 'Update payment method' })
    expect(button.id).toBe('update-payment-method')
    // In the card header's action slot, beside "Current plan".
    const header = button.closest('.MuiCardHeader-root')
    expect(header?.textContent).toContain('Current plan')
    expect(button.closest('.MuiCardHeader-action')).not.toBeNull()
  })

  it('opens the portal on the payment-method flow, and goes where the route answers', async () => {
    render(<BillingPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Update payment method' }))
    await waitFor(() =>
      expect(subscriptionCalls).toEqual([
        { orgId: 'org-1', action: 'portal', flow: 'payment_method_update' },
      ]),
    )
    await waitFor(() => expect(window.location.hash).toBe('#stripe-portal-session'))
  })

  it('a link carrying its anchor lands with the button in view and focused', async () => {
    const scrolled: Element[] = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      window.history.replaceState(null, '', '/acme/billing#update-payment-method')
      render(<BillingPage />)
      const button = await screen.findByRole('button', { name: 'Update payment method' })
      await waitFor(() => expect(document.activeElement).toBe(button))
      expect(scrolled).toContain(button)
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('CONTROL — without the anchor nothing is scrolled to it or focused', async () => {
    const scrolled: Element[] = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      render(<BillingPage />)
      const button = await screen.findByRole('button', { name: 'Update payment method' })
      expect(document.activeElement).not.toBe(button)
      expect(scrolled).not.toContain(button)
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('CONTROL — not offered to a workspace with no Stripe customer', async () => {
    hasCustomer = false
    render(<BillingPage />)
    // The page has rendered the plan card, and its in-app card management.
    expect(await screen.findByText('Manage payment methods')).toBeTruthy()
    await waitFor(() =>
      expect((global.fetch as jest.Mock).mock.calls.some(([url]) =>
        String(url).startsWith('/api/billing/profile'),
      )).toBe(true),
    )
    expect(screen.queryByRole('button', { name: 'Update payment method' })).toBeNull()
  })
})
