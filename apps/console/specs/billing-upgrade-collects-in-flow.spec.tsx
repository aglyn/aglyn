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
 * Upgrade collects what it needs, in the order tax needs it.
 *
 * The plan grid used to disable Upgrade for a workspace with no card and no
 * billing address, and name two cards on another screen. It now takes the
 * customer through the missing pieces on the way to the purchase.
 *
 * ## What this file asserts, and what it deliberately does not
 *
 * CALLS AND STORED STATE, never rendered output. A suite that read the screen
 * would pass on a flow that rendered every step beautifully and subscribed
 * nothing, and it would pass on one that collected a card as a one-off token
 * for a single charge — which is the specific thing the owner asked not to
 * happen. So the fake Stripe customer below is mutated by the same
 * `/api/billing/profile` actions the real route implements, and the
 * assertions are on that record and on what was POSTed.
 *
 * ## The fake server refuses exactly what the real one refuses
 *
 * `/api/billing/checkout` answers 409 `payment_method_required` and 409
 * `billing_address_required`, and those refusals are the enforcement — this
 * flow is how a customer satisfies them, never a replacement for them. The
 * double below reproduces both, so a flow that subscribed early fails here
 * rather than silently working against a permissive stub. The REAL route's
 * refusals are pinned separately, against the real handler, in
 * `billing-upgrade-server-refusal.spec.ts` — that is the control that proves
 * the enforcement survived this change, and it is a different file because it
 * needs a node environment.
 *
 * ## Sequencing is a tax rule
 *
 * `automatic_tax` computes from the customer's address and answers
 * `requires_location_inputs` — a tax of zero under a total that looks final —
 * when there is not one. So the ORDER of the calls is asserted, not just the
 * set of them: nothing asks Stripe for a price until the address write has
 * landed.
 */

import {
  PLATFORM_BRAND_NAME,
  PLATFORM_SUPPORT_URL,
} from '@aglyn/aglyn/app-utils/platform-brand'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockEnqueueSnackbar = jest.fn()

/** A workspace with no plan — every paid tier reads `Upgrade`. */
const mockOrg = { $id: 'org-1', plan: 'free' as const, subscription: undefined }

jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useLoading: () => ({ queueLoading: () => () => undefined }),
  useConfirmationContext: () => ({ confirm: async () => undefined }),
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

/**
 * ONE user object for the whole suite, not a fresh one per render.
 *
 * `useBillingProfile` memoizes its POST helper on `user`, and its effect on
 * that helper. A double that returned a new object each render therefore
 * re-ran the profile read on every render it caused — an unbounded loop that
 * makes "how many times was this read" unassertable, which is the one thing
 * a test of an on-mount read most needs to be able to say.
 */
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

/**
 * Stripe Elements, stubbed at the LIBRARY boundary rather than by replacing
 * our card form.
 *
 * The card form itself stays real, so the `create-setup-intent` →
 * `confirmSetup` → `finalize-card-setup` sequence under test is the one that
 * ships. What is faked is the part that cannot run in jsdom: Stripe's
 * cross-origin iframes. That the fields are Stripe's and not ours is a
 * separate guarantee with its own guard
 * (`billing-card-entry-stays-in-stripe.spec.ts`), and it is not weakened by
 * standing in for them here.
 */
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

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  // `AppLink` reads the current path to decide its active state; a page with
  // no plan renders links this one does not.
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

import BillingPage from '../app/(app)/[orgSlug]/billing/(sections)/page'

/** The org's Stripe customer, as the fake `/api/billing/profile` maintains it. */
interface FakeCustomer {
  address: Record<string, string> | null
  name: string
  taxIds: Array<{ id: string; type: string; value: string; verification: null }>
  paymentMethods: Array<{
    id: string
    type: string
    brand: string
    last4: string
    expMonth: number
    expYear: number
    email: null
    isDefault: boolean
  }>
  /** `invoice_settings.default_payment_method` — what a subscription charges. */
  defaultPaymentMethod: string | null
}

let customer: FakeCustomer
/** Every call, in order, as `"<surface>:<action>"`. The sequencing surface. */
let callLog: string[]
/** Bodies POSTed to `/api/billing/checkout`, in order. */
let checkoutBodies: Array<Record<string, any>>
/** Bodies POSTed to `/api/billing/profile`, in order. */
let profileBodies: Array<Record<string, any>>
/**
 * True once the page has actually READ a profile response body.
 *
 * The request landing is not the same event: `missingBillingPieces` is null
 * until the payload is in state, and null means "unknown", which falls through
 * to the subscribe. A test that clicked in that window would find no purchase
 * yet and call it a collection flow.
 */
let profileBodyRead: boolean

const COLLECTED_CARD = {
  id: 'pm_collected_1',
  type: 'card',
  brand: 'visa',
  last4: '4242',
  expMonth: 12,
  expYear: 2030,
  email: null,
  isDefault: true,
}

const ADDRESS = {
  line1: '1 Example St',
  line2: '',
  city: 'Austin',
  state: 'TX',
  postalCode: '78701',
  country: 'US',
}

function profileView() {
  return {
    configured: true,
    customer: {
      email: 'owner@example.com',
      name: customer.name,
      address: customer.address,
    },
    taxIds: customer.taxIds,
    paymentMethods: customer.paymentMethods,
  }
}

/** The subscribe POSTs — a checkout body with no `action` is the purchase. */
const subscribes = () => checkoutBodies.filter((body) => !body.action)
const previews = () =>
  checkoutBodies.filter((body) => body.action === 'preview')
const profileAction = (action: string) =>
  profileBodies.filter((body) => body.action === action)

function installFetch() {
  global.fetch = jest.fn(async (input: any, init?: any) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) : {}

    if (url.startsWith('/api/billing/profile')) {
      profileBodies.push(body)
      callLog.push(`profile:${body.action}`)
      if (body.action === 'set-billing-address') {
        customer.name = String(body.name ?? '')
        customer.address = {
          line1: String(body.line1 ?? ''),
          line2: String(body.line2 ?? ''),
          city: String(body.city ?? ''),
          state: String(body.state ?? ''),
          postalCode: String(body.postalCode ?? ''),
          country: String(body.country ?? ''),
        }
      }
      if (body.action === 'create-setup-intent') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ clientSecret: 'seti_test_1_secret' }),
        }
      }
      if (body.action === 'finalize-card-setup') {
        // What `finalize-card-setup` really does: ATTACH the confirmed
        // intent's method to the customer and make a first one the default.
        // That is the persistence this feature turns on — not a token used
        // once for this charge and thrown away.
        customer.paymentMethods = [COLLECTED_CARD]
        customer.defaultPaymentMethod ??= COLLECTED_CARD.id
      }
      if (body.action === 'add-tax-id') {
        customer.taxIds = [
          {
            id: 'txi_1',
            type: String(body.taxIdType ?? ''),
            value: String(body.taxIdValue ?? ''),
            verification: null,
          },
        ]
      }
      return {
        ok: true,
        status: 200,
        json: async () => {
          profileBodyRead = true
          return profileView()
        },
      }
    }

    if (url.startsWith('/api/billing/checkout')) {
      checkoutBodies.push(body)
      callLog.push(`checkout:${body.action ?? 'subscribe'}`)
      if (body.action === 'preview') {
        // The route's own contract: no address, no total. The quote renders a
        // dash under "Total before tax" rather than a confident number.
        if (!customer.address?.country) {
          return { ok: true, status: 200, json: async () => ({ needsBillingAddress: true }) }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            preview: {
              subtotalCents: 2500,
              taxCents: 206,
              totalCents: 2706,
              currency: 'usd',
              taxComplete: true,
              taxReason: 'standard_rated',
            },
            customerTaxExempt: 'none',
            hasTaxId: customer.taxIds.length > 0,
            promotionCodeApplied: null,
          }),
        }
      }
      // The SUBSCRIBE, refusing exactly what the real route refuses.
      if (!customer.defaultPaymentMethod) {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            error: 'Add a payment method before subscribing.',
            code: 'payment_method_required',
          }),
        }
      }
      if (!customer.address?.country) {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            error: 'Add a billing address before subscribing.',
            code: 'billing_address_required',
          }),
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          subscriptionStatus: 'active',
          invoice: {
            subtotalCents: 2500,
            taxCents: 206,
            totalCents: 2706,
            currency: 'usd',
            taxComplete: true,
            taxReason: 'standard_rated',
          },
        }),
      }
    }
    return { ok: true, status: 200, json: async () => ({ invoices: [] }) }
  }) as any
}

beforeEach(() => {
  mockEnqueueSnackbar.mockClear()
  callLog = []
  checkoutBodies = []
  profileBodies = []
  profileBodyRead = false
  customer = {
    address: null,
    name: '',
    taxIds: [],
    paymentMethods: [],
    defaultPaymentMethod: null,
  }
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

/** Click a button inside the collection dialog. */
async function pressIn(scope: HTMLElement, name: string | RegExp) {
  const button = (await within(scope).findAllByRole('button', { name }))[0]
  fireEvent.click(button)
  return button
}

/**
 * Mount the page and WAIT until it has actually read the billing profile.
 *
 * Not an assertion — a readiness gate, and a load-bearing one. Awaiting only
 * the `get` REQUEST leaves the page one microtask short of knowing what the
 * customer has, and `missingBillingPieces` is deliberately null in that window
 * (an unknown is not a missing piece). Clicking then falls through to the
 * subscribe, and every "nothing was bought yet" assertion passes for the wrong
 * reason: the purchase was merely still in flight.
 */
async function mountLoaded() {
  render(<BillingPage />)
  await waitFor(() => expect(profileBodyRead).toBe(true))
  // A second poll, so the setState the body read schedules is committed
  // before anything is clicked. `waitFor` flushes effects between polls.
  await waitFor(() => expect(profileAction('get')).toHaveLength(1))
}

/** Fill the dialog's real billing-address card and save it. */
async function saveAddress(dialog: HTMLElement) {
  const scope = within(dialog)
  const country = await scope.findByLabelText('Country or region')
  // Typed, then the option CLICKED BY NAME. ArrowDown+Enter takes whatever is
  // highlighted, which on this list is Afghanistan — a green test that saved
  // the wrong country.
  fireEvent.change(country, { target: { value: 'United States' } })
  fireEvent.click(await screen.findByRole('option', { name: 'United States' }))
  fireEvent.change(scope.getByLabelText('Address line 1'), {
    target: { value: ADDRESS.line1 },
  })
  fireEvent.change(scope.getByLabelText('City'), {
    target: { value: ADDRESS.city },
  })
  fireEvent.change(scope.getByLabelText('State or province'), {
    target: { value: ADDRESS.state },
  })
  fireEvent.change(scope.getByLabelText('Postal code'), {
    target: { value: ADDRESS.postalCode },
  })
  await pressIn(dialog, 'Save')
}

describe('Upgrade with nothing on file', () => {
  it('starts collecting instead of subscribing, and quotes only after the address', async () => {
    await mountLoaded()

    await press(/^Upgrade/)

    // THE REVERSAL. The button was disabled here; clicking it now opens the
    // collection flow. The dialog's presence is the proof the branch was
    // taken — without it, "nothing was bought yet" would also describe a
    // purchase that is merely still in flight.
    const dialog = await screen.findByRole('dialog')
    expect(subscribes()).toHaveLength(0)
    // And nothing has been priced. A quote before the address is a total with
    // the tax quietly missing from it.
    expect(previews()).toHaveLength(0)

    // ── 1. the address ──
    await saveAddress(dialog)
    await waitFor(() =>
      expect(profileAction('set-billing-address')).toHaveLength(1),
    )
    expect(profileAction('set-billing-address')[0]).toMatchObject({
      country: 'US',
      city: ADDRESS.city,
      postalCode: ADDRESS.postalCode,
    })
    expect(customer.address?.country).toBe('US')

    // ── 2. and only then the price ──
    await waitFor(() => expect(previews()).toHaveLength(1))
    expect(callLog.indexOf('profile:set-billing-address')).toBeLessThan(
      callLog.indexOf('checkout:preview'),
    )
    expect(previews()[0]).toMatchObject({ interval: 'month' })

    // ── 3. the payment method, SAVED to the customer ──
    await pressIn(dialog, 'Add new card')
    await waitFor(() =>
      expect(profileAction('create-setup-intent')).toHaveLength(1),
    )
    await pressIn(dialog, 'Save card')
    await waitFor(() =>
      expect(profileAction('finalize-card-setup')).toHaveLength(1),
    )
    expect(profileAction('finalize-card-setup')[0]).toMatchObject({
      setupIntentId: 'seti_test_1',
    })
    // STORED STATE, which is the owner's actual requirement: the method is on
    // the customer and is the default a renewal charges — not a one-off for
    // this invoice.
    expect(customer.paymentMethods.map((method) => method.id)).toContain(
      'pm_collected_1',
    )
    expect(customer.defaultPaymentMethod).toBe('pm_collected_1')

    // ── 4. and now it buys ──
    await pressIn(dialog, /^Subscribe to/)
    await waitFor(() => expect(subscribes()).toHaveLength(1))
    expect(subscribes()[0]).toMatchObject({
      interval: 'month',
      orgId: 'org-1',
    })
    expect(typeof subscribes()[0].plan).toBe('string')
    // The purchase is last. Every collection call precedes it.
    expect(callLog.indexOf('checkout:subscribe')).toBe(callLog.length - 1)
  }, 20000)

  it('a tax ID given during the flow is on file BEFORE the quote it changes', async () => {
    await mountLoaded()
    await press(/^Upgrade/)
    const dialog = await screen.findByRole('dialog')
    await saveAddress(dialog)
    await waitFor(() => expect(previews()).toHaveLength(1))

    await pressIn(dialog, /Registered for VAT/)
    const scope = within(dialog)
    const type = await scope.findByLabelText('Type')
    fireEvent.change(type, { target: { value: 'us_ein' } })
    fireEvent.click(
      await screen.findByRole('option', { name: 'United States EIN' }),
    )
    fireEvent.change(scope.getByLabelText('Tax ID'), {
      target: { value: '12-3456789' },
    })
    await pressIn(dialog, 'Save')
    await waitFor(() => expect(profileAction('add-tax-id')).toHaveLength(1))
    expect(customer.taxIds).toHaveLength(1)

    // Re-priced. A registration that lands after the charge changes nothing
    // about the charge, so the quote has to be asked again — and it has to be
    // asked with the ID already on the customer.
    await waitFor(() => expect(previews().length).toBeGreaterThan(1))
    expect(callLog.indexOf('profile:add-tax-id')).toBeLessThan(
      callLog.lastIndexOf('checkout:preview'),
    )
    // Nothing has been bought yet — the ID was collected before the purchase,
    // which is the whole point of where it sits.
    expect(subscribes()).toHaveLength(0)
  }, 20000)
})

describe('Upgrade with everything on file', () => {
  beforeEach(() => {
    customer = {
      address: { ...ADDRESS },
      name: 'Acme',
      taxIds: [],
      paymentMethods: [COLLECTED_CARD],
      defaultPaymentMethod: COLLECTED_CARD.id,
    }
  })

  it('takes the short path — one click, no collection', async () => {
    // The CONTROL for the whole feature. Without it, a flow that opened the
    // dialog for everyone would satisfy every assertion above while making
    // the common case worse.
    //
    // Its timing rests on the same `mountLoaded` gate the first case proves:
    // there, an unloaded profile is visibly the difference between a dialog
    // and a purchase, so a gate that let the click land early would fail
    // there first rather than pass quietly here.
    await mountLoaded()

    await press(/^Upgrade/)

    await waitFor(() => expect(subscribes()).toHaveLength(1))
    // Nothing was collected, because nothing was missing — and no dialog was
    // put between the customer and the plan they asked for.
    expect(profileAction('set-billing-address')).toHaveLength(0)
    expect(profileAction('create-setup-intent')).toHaveLength(0)
    expect(screen.queryByRole('dialog')).toBeNull()
  }, 20000)
})

describe('the client does not decide what the server refuses', () => {
  it('honours a 409 the server raises anyway', async () => {
    // The profile says there is a card; Stripe says there is not — a stale
    // read, a detached method, a race with the settings page. The subscribe
    // is refused server-side and the page must report the refusal rather than
    // congratulate anybody. The gate moved; it did not go away.
    customer = {
      address: { ...ADDRESS },
      name: 'Acme',
      taxIds: [],
      paymentMethods: [COLLECTED_CARD],
      // What the SERVER checks — and it is empty.
      defaultPaymentMethod: null,
    }
    await mountLoaded()

    await press(/^Upgrade/)
    await waitFor(() => expect(subscribes()).toHaveLength(1))
    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())

    const messages = mockEnqueueSnackbar.mock.calls.map((call) =>
      String(call[0]),
    )
    expect(messages.some((text) => /payment method/i.test(text))).toBe(true)
    expect(
      messages.some((text) => /workspace updates as soon as/i.test(text)),
    ).toBe(false)
  }, 20000)
})
