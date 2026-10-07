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
 * The POS card QR is drawn in the browser and the payment URL never becomes a
 * request (AGL-1671).
 *
 * As it shipped, this dialog rendered `<img src="https://api.qrserver.com/…?
 * data=${encodeURIComponent(cardUrl)}">`. `cardUrl` is a LIVE Stripe payment
 * link — the QR exists precisely because anyone holding it can pay the order —
 * so every card sale sent a working checkout link to goQR.me in a GET query
 * string, along with the merchant's IP and a `Referer` naming the console and
 * the org. No DPA, no vendor review, no register entry, and no gate: opening
 * the dialog was sufficient.
 *
 * The assertion that carries the issue is the LAST one: after the dialog is
 * open, the only URL the whole subtree contains is the one we chose to put in
 * an `href`, and no element in it fetches anything. That holds against any
 * remote renderer, including one nobody has thought of yet — which is why it
 * is written as "no element loads a remote resource" rather than "no
 * qrserver". The source-level half of the guarantee is the
 * `aglyn/no-remote-image-service` lint rule; this is the rendered half.
 *
 * `fetch` is mocked at the register's own routes (`/api/commerce/pos-order`,
 * `/api/commerce/pos-payment`, `/api/commerce/pos-display`), which are the ONLY
 * boundary this test crosses. Nothing here reaches Stripe: the payment URL is a string
 * of the right shape and length, and its length is load-bearing — a 317-char
 * Checkout URL is what sizes the symbol at 61x61 modules.
 *
 * The second describe below carries AGL-1682 — how many times the register has
 * to be tapped, and how many orders come out — and shares this harness rather
 * than standing up a second one. It was this file that found that defect: the
 * dialog could not be reached in one click.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

/** The shape and length of a real Stripe Checkout URL, invented payload. */
const PAYMENT_URL =
  'https://checkout.stripe.com/c/pay/cs_test_' +
  'b'.repeat(66) +
  '#fidkdWxOYHwnPyd1blpxYHZxWjA0' +
  'c'.repeat(180)

/** `status: 'active'` is what puts it in the grid; `variants` keeps it out of
 *  the legacy lift, so the row reaches the tile exactly as written here. */
const PRODUCT = {
  $id: 'prod-1',
  name: 'Flat White',
  status: 'active',
  variants: [{ id: 'v1', priceUsd: 4.5, options: {} }],
}
const REGISTER = { $id: 'reg-1', name: 'Front counter' }

/** Every request the component made, so the test can assert on all of them. */
let requests: string[] = []
/** The decoded JSON body of each of those, so a test can assert the tender. */
let payloads: any[] = []

// The register's operations (AGL-3609) have specs of their own; this one
// reads the page around them.
jest.mock('./pos-ops/register-ops', () => ({
  PosOperationsBar: () => null,
  PosCustomerLookup: () => null,
  PosLastReceipt: () => null,
  usePosOpsSettings: () => ({
    requireOpenShift: false,
    refundLimitCents: 0,
    autoLockMinutes: 0,
    receiptAddress: '',
    returnPolicy: '',
  }),
  usePosCashier: () => ({
    cashier: null,
    assertion: undefined,
    locked: false,
    switchTo: () => undefined,
    signOutCashier: () => undefined,
    lock: () => undefined,
    unlock: () => undefined,
  }),
}))

jest.mock('firebase/firestore', () => ({
  // The path is the only thing the collection mock has to carry — the
  // listener mock below dispatches the four listens by their last segment.
  collection: (_db: unknown, ...path: string[]) => path.join('/'),
  query: (ref: string) => ref,
  /*
   * Inert constraint builders. These are also what the REAL
   * `listFilterConstraints` calls, so leaving one out fails as "not a
   * function" from inside the translator rather than from the component.
   */
  limit: () => undefined,
  where: () => undefined,
  orderBy: () => undefined,
  startAt: () => undefined,
  endAt: () => undefined,
  documentId: () => '__name__',
  Timestamp: { fromDate: (date: Date) => date },
  // The scan path. Empty is the honest answer for a catalog these specs
  // never populate; a scan that found something here would be fiction.
  getDocs: async () => ({ docs: [] }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  /*
   * The real translator, not a stub. It is a pure function of the shared
   * declaration, and a mock that omits a barrel export does not fail as
   * "missing" — it fails as the component being broken.
   */
  listFilterConstraints: jest.requireActual('@aglyn/tenant-feature-instance')
    .listFilterConstraints,
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'token' } }),
  useOrgPlan: () => ({ org: { plan: 'business' }, ready: true }),
  useFirestoreCollection: (build: () => string) => {
    const path = build()
    if (path.endsWith('/products')) return { data: [PRODUCT] }
    if (path.endsWith('/registers')) return { data: [REGISTER] }
    return { data: [] }
  },
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/shared-ui-next/contexts/next-page-title-provider', () => ({
  NextPageTitle: () => null,
}))

// The void confirmation's provider is the console shell's; the register
// never reaches it in these cases.
jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))

jest.mock('@aglyn/aglyn', () => ({
  // The register cap has its own coverage (AGL-482/1064/1775); here it just
  // has to admit the one register so the sale can proceed. Per SITE since
  // AGL-1775 — the page reads `checkHostRegisterQuota(org, hostId, …)`, and a
  // double that still only answered `checkQuota` would leave this suite
  // failing on an undefined function rather than on anything it tests.
  checkHostRegisterQuota: () => ({ limit: 5 }),
  checkQuota: () => ({ limit: 5 }),
}))

import { PosConsolePage } from './pos-page.component'

const SALE = {
  orderId: 'sale-1',
  status: 'pending',
  totalCents: 450,
  paidCents: 0,
  dueCents: 450,
  tenderableCents: 0,
  tipCents: 0,
}

/** The register's routes, answered the way the server answers them. */
function answer(url: string, body: any): any {
  if (url.startsWith('/api/commerce/pos-payment?')) {
    return {
      settings: {
        tippingEnabled: false,
        tipPercentages: [15, 18, 20, 25],
        receiptDefault: 'none',
        displayMessage: '',
        displayMarketingOptIn: true,
      },
      terminal: { available: false, testMode: true },
      readers: [],
      publishableKey: '',
      smsReceipts: false,
    }
  }
  if (url.startsWith('/api/commerce/pos-display')) return { state: null, connected: false }
  if (url === '/api/commerce/pos-order') {
    return { orderId: 'sale-1', totals: { totalCents: 450 }, dueCents: 450 }
  }
  if (url === '/api/commerce/pos-payment' && body?.action === 'card-link') {
    return {
      sale: {
        ...SALE,
        payments: [
          { id: 'pay-1', method: 'card_link', amountCents: 450, status: 'pending', checkoutUrl: PAYMENT_URL },
        ],
      },
      paymentId: 'pay-1',
      completed: false,
    }
  }
  if (url === '/api/commerce/pos-payment' && body?.action === 'cash') {
    return {
      sale: {
        ...SALE,
        status: 'paid',
        paidCents: 450,
        dueCents: 0,
        payments: [{ id: 'pay-2', method: 'cash', amountCents: 450, status: 'succeeded', changeCents: 50 }],
      },
      paymentId: 'pay-2',
      completed: true,
    }
  }
  return { sale: { ...SALE, tenderableCents: 450, payments: [] } }
}

beforeAll(() => {
  // A tablet in landscape: the register sits beside the grid.
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

beforeEach(() => {
  requests = []
  payloads = []
  global.fetch = jest.fn(async (input: any, init?: any) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) : null
    requests.push(url)
    payloads.push(body)
    return { ok: true, status: 200, json: async () => answer(url, body) }
  }) as unknown as typeof fetch
})

/** The requests that start a sale or a payment, in order. */
function moneyRequests() {
  return requests
    .map((url, index) => ({ url, body: payloads[index] }))
    .filter((entry) => entry.url === '/api/commerce/pos-order' || entry.url === '/api/commerce/pos-payment')
}

/** Rings up one item and charges it, which opens the sale's tender panel. */
async function openSale() {
  render(<PosConsolePage hostId="host-1" entitled />)
  fireEvent.click(screen.getByText('Flat White'))
  fireEvent.click(screen.getByText('Charge $4.50'))
  await waitFor(() => expect(screen.getByText('Balance due')).toBeTruthy())
}

/** Takes the card by QR, which opens the QR dialog. */
async function openCardDialog() {
  await openSale()
  fireEvent.click(screen.getByText('Card (QR)'))
  await waitFor(() => expect(screen.getByText('Scan to pay $4.50')).toBeTruthy())
}

describe('POS card QR is rendered locally (AGL-1671)', () => {
  it('draws the QR as an inline SVG, not an image fetched from a vendor', async () => {
    await openCardDialog()

    const dialog = screen.getByRole('dialog')
    const qr = dialog.querySelector('svg[role="img"]')
    expect(qr).toBeTruthy()
    // 256px carrying a 4-module quiet zone around a 61x61 symbol. Asserting
    // the viewBox asserts the payload really was ENCODED here.
    expect(qr?.getAttribute('viewBox')).toBe('0 0 69 69')
    expect(qr?.getAttribute('width')).toBe('256')
    expect(qr?.getAttribute('height')).toBe('256')
    expect(qr?.querySelector('title')?.textContent).toBe('Payment QR')
  })

  // SUPPORTING: pins that every request the flow makes is to our own API, so
  // the payment URL being posted somewhere new would be caught.
  it('sends the payment URL to no one — every call is our own register API', async () => {
    await openCardDialog()

    expect(requests.every((url) => url.startsWith('/api/commerce/'))).toBe(true)
    expect(requests.some((url) => url.includes('qrserver'))).toBe(false)
    expect(moneyRequests().map((entry) => entry.body?.action ?? entry.body?.payment)).toEqual([
      'open',
      'card-link',
    ])
  })

  it('leaves no element in the dialog that loads a remote resource', async () => {
    await openCardDialog()

    const dialog = screen.getByRole('dialog')
    const loaders = dialog.querySelectorAll('img, image, iframe, [src], [xlink\\:href]')
    expect(Array.from(loaders).map((el) => el.tagName)).toEqual([])
    // The payment URL appears exactly once, in the escape-hatch link.
    const links = Array.from(dialog.querySelectorAll('a[href]'))
    expect(links.map((el) => el.getAttribute('href'))).toEqual([PAYMENT_URL])
  })
})

/**
 * One tap, one sale (AGL-1682, carried onto the open sale of AGL-3607): a
 * double-tapped Charge opens one sale, and a dismissed QR leaves the sale open
 * on the register rather than a full basket that bills again.
 */
describe('POS settlement takes one tap and makes one sale (AGL-1682)', () => {
  it('opens ONE sale when two taps land inside a single React batch', async () => {
    render(<PosConsolePage hostId="host-1" entitled />)
    fireEvent.click(screen.getByText('Flat White'))
    const charge = screen.getByText('Charge $4.50')
    await act(async () => {
      charge.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      charge.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await waitFor(() => expect(screen.getByText('Balance due')).toBeTruthy())
    expect(moneyRequests()).toHaveLength(1)
    expect(moneyRequests()[0].body.payment).toBe('open')
  })

  it('sends one card payment when the cashier double-taps Card (QR)', async () => {
    await openSale()
    const card = screen.getByText('Card (QR)')
    await act(async () => {
      card.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      card.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await waitFor(() => expect(screen.getByText('Scan to pay $4.50')).toBeTruthy())
    expect(moneyRequests().filter((entry) => entry.body?.action === 'card-link')).toHaveLength(1)
  })

  it('does not leave the same basket chargeable after the QR is dismissed', async () => {
    await openCardDialog()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText('Scan to pay $4.50')).toBeNull())
    // The sale stays open with its payment waiting; there is no Charge to
    // press again, and the waiting payment can still show its QR.
    expect(screen.queryByText(/^Charge /)).toBeNull()
    expect(screen.getByText('Show QR')).toBeTruthy()
    expect(moneyRequests().filter((entry) => entry.body?.payment === 'open')).toHaveLength(1)
  })

  it('sends the cash tender as cash, with what the customer handed over', async () => {
    await openSale()
    fireEvent.click(screen.getByText('Cash'))
    fireEvent.change(screen.getByLabelText('Cash received ($)'), { target: { value: '5' } })
    fireEvent.click(screen.getByText('Take cash'))

    await waitFor(() => expect(screen.getByText('Change due: $0.50')).toBeTruthy())
    const cash = moneyRequests().find((entry) => entry.body?.action === 'cash')
    expect(cash?.body).toMatchObject({ action: 'cash', tenderedCents: 500, orderId: 'sale-1' })
  })
})
