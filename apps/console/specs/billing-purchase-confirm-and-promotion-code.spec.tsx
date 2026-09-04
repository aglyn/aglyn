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
 * The code reaches the charge, and the charge is confirmed before it happens.
 *
 * ## Two defects, one seam
 *
 * The promotion code lived in the quote card's own `useState`. It reached the
 * PREVIEW and nothing else: the total on screen dropped, the card said the
 * total already included the code, and the body `startSubscribe` POSTed had no
 * `promotionCode` in it at all — so Stripe charged list price. And the click
 * that chose a plan was the click that charged the card: no statement of the
 * amount, no last chance, no way back.
 *
 * Both are the same seam — what the page knows at the moment it spends money —
 * so they are driven together, through the real page.
 *
 * ## What this file asserts
 *
 * The REQUEST, never the rendering. A suite that read the screen would pass on
 * a page that displayed a beautiful discount and charged full price, which is
 * precisely the shipped defect. So the assertions are on the bodies POSTed to
 * `/api/billing/checkout`, on the `Idempotency-Key` headers that went with
 * them, and on the options handed to the confirmation dialog.
 *
 * No live Stripe call happens here: `fetch` is replaced.
 */

import {
  PLATFORM_BRAND_NAME,
  PLATFORM_SUPPORT_URL,
} from '@aglyn/aglyn/app-utils/platform-brand'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockEnqueueSnackbar = jest.fn()

/** Every `confirm()` the page opened, in order. */
let mockConfirmCalls: Array<Record<string, any>>
/** What the next `confirm()` resolves to — accepted, or dismissed. */
let mockConfirmAccepts: boolean

/** A workspace with no plan — every paid tier reads `Upgrade`. */
const mockOrg = { $id: 'org-1', plan: 'free' as const, subscription: undefined }

jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useLoading: () => ({ queueLoading: () => () => undefined }),
  useConfirmationContext: () => ({
    confirm: (options: Record<string, any>) => {
      mockConfirmCalls.push(options)
      // The real provider RESOLVES on the confirm button and REJECTS on
      // cancel; the page reads `.then(() => true).catch(() => false)`, so a
      // dismissal has to be a rejection here or the dismissal case would be
      // tested against a shape the provider never produces.
      return mockConfirmAccepts
        ? Promise.resolve(undefined)
        : Promise.reject(new Error('dismissed'))
    },
  }),
}))

jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  ...jest.requireActual('@aglyn/aglyn/app-utils/analytics-events'),
  // Resolves immediately: the real one waits up to 500ms for gtag before a
  // subscribe POST, which would turn a driven click into a timer test.
  readGaClientId: async () => null,
  trackEvent: () => undefined,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

/** ONE user object for the whole suite — a fresh one per render loops the profile read. */
const mockUser = { data: { uid: 'u1', getIdToken: async () => 'token' } }
const mockFirestore = {}
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockFirestore,
  useUser: () => mockUser,
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
  getDocsFromServer: async () => ({ docs: [], size: 0 }),
}))

jest.mock('@stripe/react-stripe-js', () => ({
  __esModule: true,
  Elements: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PaymentElement: () => <div data-testid="stripe-payment-element" />,
  useElements: () => ({}),
  useStripe: () => ({
    confirmSetup: async () => ({ setupIntent: { id: 'seti_test_1' } }),
  }),
}))

jest.mock('../utils/browser-stripe', () => ({
  __esModule: true,
  getBrowserStripe: () => ({
    handleNextAction: async () => ({ paymentIntent: { status: 'succeeded' } }),
  }),
}))

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

/**
 * `?plan=starter`, so the page mounts the quote card for the same plan the
 * grid's first Upgrade button buys.
 *
 * `quotedPlan` is `planIntent?.plan` and the card renders only for it — which
 * is also why the purchase re-prices on the server rather than reading this
 * card: most purchases are made from the plan grid with no card on screen.
 */
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('plan=starter'),
  usePathname: () => '/acme/billing',
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}))
jest.mock('../hooks/use-org-scope', () => ({ useOrgSlug: () => 'acme' }))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: mockOrg, orgId: mockOrg.$id, ready: true }),
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
jest.mock('../components/billing/retention-funnel.dialog', () => ({
  __esModule: true,
  RetentionFunnelDialog: () => null,
}))

/**
 * The collection dialog, stood in for by the ONE thing this suite needs from
 * it: the button that calls back into the page's purchase.
 *
 * The dialog's own job — collecting a card and an address in the order tax
 * requires — is driven for real in `billing-upgrade-collects-in-flow.spec.tsx`
 * and is not re-tested here. What is under test is the page's wiring: the
 * second route into `startSubscribe` has to meet the same confirm the plan
 * grid does, and a stub is the most direct way to ask that question without
 * making the answer depend on a Stripe Elements form.
 */
jest.mock('../components/billing/billing-upgrade.dialog', () => ({
  __esModule: true,
  default: ({ plan, onConfirm }: { plan: string | null; onConfirm: () => void }) =>
    plan ? (
      <button type="button" onClick={() => void onConfirm()}>
        {'Stub dialog subscribe'}
      </button>
    ) : null,
}))

import BillingPage from '../app/(app)/[orgSlug]/billing/(sections)/page'

/** Bodies POSTed to `/api/billing/checkout`, in order. */
let checkoutBodies: Array<Record<string, any>>
/** `Idempotency-Key` headers of the SUBSCRIBE posts, in order. */
let subscribeKeys: Array<string | undefined>
/** True once the page has read a profile response body. */
let profileBodyRead: boolean
/** Whether the org's Stripe customer has a card and an address on file. */
let hasBillingDetails: boolean
/** What the fake `/v1/promotion_codes` equivalent resolves for a typed code. */
let mockResolvableCodes: Record<string, { duration: string | null; months: number | null }>
/** Status the next SUBSCRIBE post answers with. */
let subscribeStatus: number
/** Status and body the PREVIEW posts answer with; 200 serves a real quote. */
let mockPreviewStatus: number
let mockPreviewPayload: Record<string, unknown>

const LIST_CENTS = 2500
const DISCOUNT_CENTS = 2425
const TAX_CENTS = 5

const subscribes = () => checkoutBodies.filter((body) => !body.action)
const previews = () => checkoutBodies.filter((body) => body.action === 'preview')

function pricedPreview(code: string) {
  const known = mockResolvableCodes[code]
  const applied = code && known ? code : ''
  const discount = applied ? DISCOUNT_CENTS : 0
  return {
    preview: {
      subtotalCents: LIST_CENTS,
      discountCents: discount,
      taxCents: TAX_CENTS,
      totalCents: LIST_CENTS - discount + TAX_CENTS,
      currency: 'usd',
      taxComplete: true,
      taxReason: 'standard_rated',
    },
    customerTaxExempt: 'none',
    hasTaxId: true,
    promotionCodeApplied: applied || null,
    promotionCodeDuration: applied ? known.duration : null,
    promotionCodeDurationInMonths: applied ? known.months : null,
  }
}

function installFetch() {
  global.fetch = jest.fn(async (input: any, init?: any) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) : {}

    if (url.startsWith('/api/billing/profile')) {
      return {
        ok: true,
        status: 200,
        json: async () => {
          profileBodyRead = true
          return {
            configured: true,
            customer: {
              email: 'owner@example.com',
              name: 'Acme',
              address: hasBillingDetails ? { country: 'US' } : null,
            },
            taxIds: [],
            paymentMethods: hasBillingDetails
              ? [{ id: 'pm_1', type: 'card', brand: 'visa', last4: '4242', isDefault: true }]
              : [],
          }
        },
      }
    }

    if (url.startsWith('/api/billing/checkout')) {
      checkoutBodies.push(body)
      if (body.action === 'preview') {
        if (mockPreviewStatus !== 200) {
          return {
            ok: false,
            status: mockPreviewStatus,
            json: async () => mockPreviewPayload,
          }
        }
        const code = String(body.promotionCode ?? '')
        if (code && !mockResolvableCodes[code]) {
          return {
            ok: false,
            status: 400,
            json: async () => ({ error: `We do not recognize the code “${code}”.` }),
          }
        }
        return { ok: true, status: 200, json: async () => pricedPreview(code) }
      }
      subscribeKeys.push(init?.headers?.['Idempotency-Key'])
      if (subscribeStatus !== 200) {
        return {
          ok: false,
          status: subscribeStatus,
          json: async () => ({ error: 'Could not start the subscription.' }),
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          subscriptionStatus: 'active',
          invoice: pricedPreview(String(body.promotionCode ?? '')).preview,
        }),
      }
    }
    return { ok: true, status: 200, json: async () => ({ invoices: [] }) }
  }) as any
}

beforeEach(() => {
  mockEnqueueSnackbar.mockClear()
  mockConfirmCalls = []
  mockConfirmAccepts = true
  checkoutBodies = []
  subscribeKeys = []
  profileBodyRead = false
  hasBillingDetails = true
  subscribeStatus = 200
  mockPreviewStatus = 200
  mockPreviewPayload = {}
  mockResolvableCodes = { LAUNCH97: { duration: 'once', months: null } }
  installFetch()
})

afterEach(() => {
  jest.restoreAllMocks()
})

/** Click the first button whose accessible name matches, anywhere. */
async function press(name: string | RegExp) {
  const button = (await screen.findAllByRole('button', { name }))[0]
  fireEvent.click(button)
  return button
}

/**
 * Mount the page and WAIT until it has actually read the billing profile.
 *
 * `missingBillingPieces` is null while the profile is in flight and null means
 * "unknown", which falls through to the subscribe. Clicking in that window
 * takes a different branch than the one under test.
 */
async function mountLoaded() {
  render(<BillingPage />)
  await waitFor(() => expect(profileBodyRead).toBe(true))
  await waitFor(() => expect(screen.getAllByText('Subtotal').length).toBe(1))
}

/** Type a promotion code into the quote card and apply it. */
async function applyCode(code: string) {
  fireEvent.change(screen.getByLabelText('Promotion code'), {
    target: { value: code },
  })
  await press('Apply')
  await waitFor(() =>
    expect(previews().some((body) => body.promotionCode === code)).toBe(true),
  )
}

/** Press the first Upgrade button — the Starter card — and let it settle. */
async function upgradeToStarter() {
  const before = checkoutBodies.length
  await press(/^Upgrade/)
  await waitFor(() => expect(checkoutBodies.length).toBeGreaterThan(before))
}

describe('a promotion code reaches the charge', () => {
  it('is in the body that buys, not only in the one that quotes', async () => {
    await mountLoaded()
    await applyCode('LAUNCH97')
    await upgradeToStarter()
    await waitFor(() => expect(subscribes()).toHaveLength(1))

    // THE DEFECT. `grep -n promotionCode` over the whole page returned nothing
    // and the customer was charged $26.65 against a quote of $0.80.
    expect(subscribes()[0].promotionCode).toBe('LAUNCH97')
    // And the rest of the body is unchanged — the code was added to the
    // purchase, it did not replace anything the purchase already carried.
    expect(subscribes()[0].plan).toBe('starter')
    expect(subscribes()[0].orgId).toBe('org-1')
  })

  it('sends no code at all when none was applied', async () => {
    await mountLoaded()
    await upgradeToStarter()
    await waitFor(() => expect(subscribes()).toHaveLength(1))
    expect(subscribes()[0].promotionCode).toBeUndefined()
  })

  it('carries what the SERVER resolved, never what was typed', async () => {
    await mountLoaded()
    // A code the server refuses. The quote reports the refusal and applies
    // nothing, so nothing may be carried into the purchase either — a page
    // that trusted its own input would send a code Stripe has already said it
    // does not recognize.
    fireEvent.change(screen.getByLabelText('Promotion code'), {
      target: { value: 'NOPE' },
    })
    await press('Apply')
    await waitFor(() =>
      expect(screen.getByText(/do not recognize the code/i)).toBeTruthy(),
    )
    await upgradeToStarter()
    await waitFor(() => expect(subscribes()).toHaveLength(1))
    expect(subscribes()[0].promotionCode).toBeUndefined()
  })
})

describe('the promotion code is part of the idempotency attempt', () => {
  it('reuses ONE key when the same code is re-submitted', async () => {
    // The guarantee AGL-1697 bought: a double-click, or a retry after a lost
    // response, must present the same key so Stripe replays the one
    // subscription instead of opening a second.
    subscribeStatus = 502
    await mountLoaded()
    await applyCode('LAUNCH97')
    await upgradeToStarter()
    await waitFor(() => expect(subscribeKeys).toHaveLength(1))
    await upgradeToStarter()
    await waitFor(() => expect(subscribeKeys).toHaveLength(2))

    expect(subscribeKeys[0]).toBeTruthy()
    expect(subscribeKeys[1]).toBe(subscribeKeys[0])
  })

  it('mints a NEW key when the code changes', async () => {
    // The defect the scope hid. Stripe replays the previous response for a
    // repeated key, so a retry under a changed code was answered with the
    // terms the customer had just changed — the new code silently ignored.
    mockResolvableCodes = {
      LAUNCH97: { duration: 'once', months: null },
      HALFOFF: { duration: 'forever', months: null },
    }
    subscribeStatus = 502
    await mountLoaded()
    await applyCode('LAUNCH97')
    await upgradeToStarter()
    await waitFor(() => expect(subscribeKeys).toHaveLength(1))

    await applyCode('HALFOFF')
    await upgradeToStarter()
    await waitFor(() => expect(subscribeKeys).toHaveLength(2))

    expect(subscribeKeys[1]).not.toBe(subscribeKeys[0])
    expect(subscribes()[1].promotionCode).toBe('HALFOFF')
  })

  it('mints a NEW key when a code is REMOVED', async () => {
    // Removal is a change like any other, and the direction that costs the
    // customer nothing to get wrong and us everything: replaying a discounted
    // attempt for an undiscounted purchase.
    subscribeStatus = 502
    await mountLoaded()
    await applyCode('LAUNCH97')
    await upgradeToStarter()
    await waitFor(() => expect(subscribeKeys).toHaveLength(1))

    // Remove re-prices at list, and the server reports nothing applied.
    const priced = previews().length
    await press('Remove')
    await waitFor(() => expect(previews().length).toBeGreaterThan(priced))
    await upgradeToStarter()
    await waitFor(() => expect(subscribeKeys).toHaveLength(2))

    expect(subscribeKeys[1]).not.toBe(subscribeKeys[0])
  })
})

describe('the purchase is confirmed before it happens', () => {
  it('asks first on the plan-grid route, and charges nothing until accepted', async () => {
    mockConfirmAccepts = false
    await mountLoaded()
    await upgradeToStarter()

    expect(mockConfirmCalls).toHaveLength(1)
    // Dismissed: no purchase, on a page whose Upgrade button used to charge a
    // stored card on the click that chose the plan.
    await waitFor(() => expect(previews().length).toBeGreaterThan(1))
    expect(subscribes()).toHaveLength(0)
    expect(subscribeKeys).toHaveLength(0)
  })

  it('asks first on the collection-dialog route too', async () => {
    // The second way into `startSubscribe`. The reason that function is a
    // single function is that SCA, declines and the lockdown notice cannot be
    // handled on one path and forgotten on the other; the confirm is the same
    // kind of thing and lives in the same place.
    hasBillingDetails = false
    mockConfirmAccepts = false
    await mountLoaded()
    await press(/^Upgrade/)
    // The grid diverted to the collection dialog rather than buying.
    const dialogButton = await screen.findByRole('button', {
      name: 'Stub dialog subscribe',
    })
    expect(subscribes()).toHaveLength(0)

    fireEvent.click(dialogButton)
    await waitFor(() => expect(mockConfirmCalls).toHaveLength(1))
    expect(subscribes()).toHaveLength(0)
  })

  it('charges once the confirm is accepted', async () => {
    await mountLoaded()
    await upgradeToStarter()
    await waitFor(() => expect(subscribes()).toHaveLength(1))
    expect(mockConfirmCalls).toHaveLength(1)
  })

  it('states the plan, the cadence, the discounted total and the RENEWAL', async () => {
    await mountLoaded()
    await applyCode('LAUNCH97')
    await upgradeToStarter()
    await waitFor(() => expect(mockConfirmCalls).toHaveLength(1))

    const { title, description, confirmationText } = mockConfirmCalls[0]
    expect(title).toBe('Subscribe to Starter?')
    expect(description).toContain('Starter, billed monthly.')
    // Today's charge, from the server's priced preview: $25.00 − $24.25 +
    // $0.05 of tax.
    expect(description).toContain('$0.80 will be charged to your card now.')
    expect(description).toContain('$24.25 off with code LAUNCH97')
    expect(confirmationText).toBe('Pay $0.80')
    // RENEWAL HONESTY. A `once` coupon discounts the first invoice and
    // nothing after it. A customer who confirms $0.80 and is enrolled at
    // $25.00 a month has been told the truth about today and misled about the
    // subscription.
    expect(description).toContain(
      'applies to this first invoice only',
    )
    expect(description).toContain('renews at $25.00 per month plus tax')
  })

  it('quotes a permanent discount as permanent', async () => {
    mockResolvableCodes = { HALFOFF: { duration: 'forever', months: null } }
    await mountLoaded()
    await applyCode('HALFOFF')
    await upgradeToStarter()
    await waitFor(() => expect(mockConfirmCalls).toHaveLength(1))
    expect(mockConfirmCalls[0].description).toContain('applies to every invoice')
    expect(mockConfirmCalls[0].description).toContain('renews at $0.80 per month')
  })

  it('names the month count of a repeating discount', async () => {
    mockResolvableCodes = { THREEOFF: { duration: 'repeating', months: 3 } }
    await mountLoaded()
    await applyCode('THREEOFF')
    await upgradeToStarter()
    await waitFor(() => expect(mockConfirmCalls).toHaveLength(1))
    expect(mockConfirmCalls[0].description).toContain(
      'applies for 3 months',
    )
    expect(mockConfirmCalls[0].description).toContain(
      'renews at $25.00 per month plus tax',
    )
  })

  it('says the duration is UNKNOWN rather than guessing it', async () => {
    // Guessing `forever` promises a price nobody verified; guessing `once`
    // frightens a customer off a discount they actually keep. The customer is
    // told the price the subscription reverts to if it does not persist.
    mockResolvableCodes = { MYSTERY: { duration: null, months: null } }
    await mountLoaded()
    await applyCode('MYSTERY')
    await upgradeToStarter()
    await waitFor(() => expect(mockConfirmCalls).toHaveLength(1))
    expect(mockConfirmCalls[0].description).toContain(
      'cannot confirm that code MYSTERY applies to later invoices',
    )
    expect(mockConfirmCalls[0].description).toContain(
      'Without it, Starter is $25.00 per month plus tax.',
    )
  })

  it('quotes the plain price when no code is applied', async () => {
    await mountLoaded()
    await upgradeToStarter()
    await waitFor(() => expect(mockConfirmCalls).toHaveLength(1))
    const { description } = mockConfirmCalls[0]
    expect(description).toContain('$25.05 will be charged to your card now.')
    expect(description).toContain('renews at $25.05 per month')
    expect(description).not.toContain('code')
  })

  it('prices the confirm on the SERVER, not on the quote card', async () => {
    // The amount is re-quoted immediately before the confirm, for the plan
    // actually being bought. The quote card is mounted for `?plan=`'s plan
    // alone, so a confirm that read it would speak only on the path where a
    // visitor arrived from a pricing CTA.
    await mountLoaded()
    const before = previews().length
    await upgradeToStarter()
    const priced = previews().slice(before)
    expect(priced).toHaveLength(1)
    expect(priced[0].plan).toBe('starter')
    expect(priced[0].interval).toBe('month')
  })

  it('renders the lockdown notice a LOCKED preview answers with', async () => {
    // The refusals moved a step earlier along with the pricing call: the
    // route's checkout feature gate sits above its preview branch, so a
    // locked platform now refuses here rather than at the purchase. That
    // notice is inline and persistent for the reason it always was — "could
    // not start checkout" tells a customer their PAYMENT failed, and a
    // customer who believes that retries, panics, then emails support.
    await mountLoaded()
    // Locked AFTER the mount, so the quote card's own read is not the thing
    // being asserted — this is about the purchase meeting the refusal.
    mockPreviewStatus = 423
    mockPreviewPayload = {
      error: 'locked',
      scope: 'feature',
      feature: 'checkout',
      reason: 'manual',
      title: 'Checkout is temporarily unavailable',
      message: 'We have paused new subscriptions while we fix a billing issue.',
    }
    await press(/^Upgrade/)
    await waitFor(() => expect(previews().length).toBeGreaterThan(1))

    expect(
      await screen.findByText('Checkout is temporarily unavailable'),
    ).toBeTruthy()
    // And no charge, and no dialog that would have implied one was coming.
    expect(mockConfirmCalls).toHaveLength(0)
    expect(subscribes()).toHaveLength(0)
  })

  it('refuses to charge when the plan cannot be priced', async () => {
    // No authoritative total, no confirm, no purchase. Saying less is
    // recoverable; charging a card behind a dialog that could not name the
    // amount is not.
    global.fetch = jest.fn(async (input: any, init?: any) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (url.startsWith('/api/billing/profile')) {
        return {
          ok: true,
          status: 200,
          json: async () => {
            profileBodyRead = true
            return {
              configured: true,
              customer: { email: 'o@e.com', name: 'Acme', address: { country: 'US' } },
              taxIds: [],
              paymentMethods: [{ id: 'pm_1', type: 'card', brand: 'visa', last4: '4242', isDefault: true }],
            }
          },
        }
      }
      if (url.startsWith('/api/billing/checkout')) {
        checkoutBodies.push(body)
        if (body.action === 'preview') {
          return { ok: false, status: 502, json: async () => ({ error: 'nope' }) }
        }
        subscribeKeys.push(init?.headers?.['Idempotency-Key'])
        return { ok: true, status: 200, json: async () => ({ subscriptionStatus: 'active' }) }
      }
      return { ok: true, status: 200, json: async () => ({ invoices: [] }) }
    }) as any

    render(<BillingPage />)
    await waitFor(() => expect(profileBodyRead).toBe(true))
    await waitFor(() => expect(previews().length).toBeGreaterThan(0))
    await press(/^Upgrade/)
    await waitFor(() => expect(previews().length).toBeGreaterThan(1))

    expect(mockConfirmCalls).toHaveLength(0)
    expect(subscribes()).toHaveLength(0)
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      expect.stringContaining('nothing has been charged'),
      expect.anything(),
    )
  })
})
