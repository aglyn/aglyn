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
 * `fetch` is mocked at `/api/commerce/pos-order`, which is the ONLY boundary
 * this test crosses. Nothing here reaches Stripe: the payment URL is a string
 * of the right shape and length, and its length is load-bearing — a 317-char
 * Checkout URL is what sizes the symbol at 61x61 modules.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

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

jest.mock('firebase/firestore', () => ({
  // The path is the only thing the collection mock has to carry — the
  // listener mock below dispatches the four listens by their last segment.
  collection: (_db: unknown, ...path: string[]) => path.join('/'),
  query: (ref: string) => ref,
  limit: () => undefined,
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
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

jest.mock('@aglyn/aglyn', () => ({
  // The register cap has its own coverage (AGL-482/1064); here it just has to
  // admit the one register so the sale can proceed.
  checkQuota: () => ({ limit: 5 }),
}))

import { PosConsolePage } from './pos-page.component'

beforeEach(() => {
  requests = []
  global.fetch = jest.fn(async (input: any) => {
    requests.push(String(input))
    return {
      ok: true,
      json: async () => ({ url: PAYMENT_URL }),
    }
  }) as unknown as typeof fetch
})

/** Rings up one item and settles it by card, which opens the QR dialog. */
async function openCardDialog() {
  render(<PosConsolePage hostId="host-1" />)
  fireEvent.click(screen.getByText('Flat White'))
  // TWICE, deliberately. `settle` closes over `paying`, and the handler sets
  // it in the same tick — so the first click is swallowed by the
  // `if (… || !paying) return` guard and only the second reaches the API.
  // That is a real defect in this dialog and it is NOT this issue's to fix;
  // it is filed separately. Encoding it here keeps the test honest about the
  // component's actual behaviour instead of the behaviour it should have,
  // and the test will start failing loudly when it IS fixed.
  fireEvent.click(screen.getByText('Card (QR)'))
  fireEvent.click(screen.getByText('Card (QR)'))
  await waitFor(() => expect(screen.getByText('Customer pays by card')).toBeTruthy())
}

describe('POS card QR is rendered locally (AGL-1671)', () => {
  it('draws the QR as an inline SVG, not an image fetched from a vendor', async () => {
    await openCardDialog()

    const dialog = screen.getByRole('dialog')
    const qr = dialog.querySelector('svg[role="img"]')
    expect(qr).toBeTruthy()
    // 256px carrying a 4-module quiet zone around a 61x61 symbol. Asserting
    // the viewBox asserts the payload really was ENCODED here — a stub that
    // drew nothing would not know the URL is 317 characters long.
    expect(qr?.getAttribute('viewBox')).toBe('0 0 69 69')
    expect(qr?.getAttribute('width')).toBe('256')
    expect(qr?.getAttribute('height')).toBe('256')
    expect(qr?.querySelector('title')?.textContent).toBe('Payment QR')
  })

  // SUPPORTING, not load-bearing, and worth saying so: an `<img src>` is a
  // browser resource load, not a `fetch`, and jsdom issues neither — so this
  // case passes against the BROKEN component too. It is here to pin the one
  // request the flow is allowed to make, which is what would catch the
  // payment URL being posted somewhere new.
  it('sends the payment URL to no one — the only call is our own order API', async () => {
    await openCardDialog()

    expect(requests).toEqual(['/api/commerce/pos-order'])
    expect(requests.some((url) => url.includes('qrserver'))).toBe(false)
  })

  it('leaves no element in the dialog that loads a remote resource', async () => {
    await openCardDialog()

    // THE ASSERTION THIS ISSUE IS ABOUT, written so it holds against any
    // remote renderer rather than against goQR by name.
    const dialog = screen.getByRole('dialog')
    const loaders = dialog.querySelectorAll(
      'img, image, iframe, [src], [xlink\\:href]',
    )
    expect(Array.from(loaders).map((el) => el.tagName)).toEqual([])

    // The payment URL appears exactly once, in the escape-hatch link the
    // cashier can open on a customer display — an `href` the merchant
    // chooses to follow, not a request the browser makes unasked.
    const links = Array.from(dialog.querySelectorAll('a[href]'))
    expect(links.map((el) => el.getAttribute('href'))).toEqual([PAYMENT_URL])
  })
})
