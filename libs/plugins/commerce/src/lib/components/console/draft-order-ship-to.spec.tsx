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
 * The draft dialog can answer the destination question (AGL-1792).
 *
 * `draft-order.ts` now prices a parcel, and a merchant whose rates differ by
 * zone is refused with `needsShippingCountry` until they declare one — the
 * same refusal the storefront cart and PDP answer with a "Ship to" select.
 * Without a matching field here the console would show that merchant an error
 * snackbar they could do nothing about, and no draft order could be created at
 * all on a store with a US zone and a rest-of-world zone.
 *
 * Driven through the FORM rather than by calling the handler: the dialog is
 * where a merchant is stuck, and the assertion that carries the issue is the
 * SECOND request's body — the first is the one that gets refused.
 *
 * `fetch` is mocked at `/api/commerce/draft-order`, the only boundary crossed.
 * Nothing reaches Stripe; localhost carries the LIVE key.
 */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'

/** Every draft-order request the dialog made, decoded. */
let payloads: any[] = []
/** Queued responses, shifted one per request. */
let responses: { ok: boolean; body: any }[] = []

const PRODUCT = {
  $id: 'prod-1',
  name: 'Kettle',
  status: 'active',
  variants: [{ id: 'v1', priceUsd: 30, options: {} }],
}

/**
 * One existing order. The card renders its filters and the "Draft order"
 * button only when the list is non-empty, so a host with no orders at all
 * cannot reach this dialog — a separate defect, not this one's to fix.
 */
const ORDER = {
  $id: 'order-1',
  number: 1,
  status: 'paid',
  channel: 'online',
  lineItems: [
    { productId: 'prod-1', name: 'Kettle', quantity: 1, unitAmountCents: 3000 },
  ],
  totals: {
    itemsCents: 3000,
    shippingCents: 0,
    taxCents: 0,
    discountCents: 0,
    feeCents: 0,
    totalCents: 3000,
  },
}

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => path.join('/'),
  query: (ref: string) => ref,
  limit: () => undefined,
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'token' } }),
  useFirestoreCollection: (build: () => string) => {
    const path = build()
    if (path.endsWith('/products')) return { data: [PRODUCT] }
    if (path.endsWith('/orders')) return { data: [ORDER] }
    return { data: [] }
  },
}))

const snackbars: any[] = []

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({
    enqueueSnackbar: (message: string, options: any) => {
      snackbars.push({ message, ...options })
    },
  }),
}))

import { HostOrdersCard } from './host-orders-card.component'

beforeEach(() => {
  payloads = []
  responses = []
  snackbars.length = 0
  global.fetch = jest.fn(async (_input: any, init?: any) => {
    payloads.push(init?.body ? JSON.parse(String(init.body)) : null)
    const next = responses.shift() ?? {
      ok: true,
      body: { orderId: 'order-2', url: 'https://checkout.stripe.com/pay/x' },
    }
    return { ok: next.ok, json: async () => next.body }
  }) as unknown as typeof fetch
  Object.assign(navigator, {
    clipboard: { writeText: async () => undefined },
  })
})

/** The refusal `planCheckoutShipping` produces for zone-varying rates. */
const NEEDS_COUNTRY = {
  ok: false,
  body: {
    error: 'Choose where this order ships to.',
    needsShippingCountry: true,
    shippingCountries: ['US', 'CA', 'GB', 'AU', 'DE', 'FR'],
  },
}

/** Opens the draft dialog with the one product chosen. */
async function openDraftDialog() {
  render(<HostOrdersCard hostId="host-1" />)
  fireEvent.click(screen.getByText('Draft order'))
  const dialog = await screen.findByRole('dialog')
  fireEvent.mouseDown(within(dialog).getByLabelText('Product'))
  fireEvent.click(await screen.findByRole('option', { name: 'Kettle' }))
  return dialog
}

function createButton(dialog: HTMLElement) {
  return within(dialog).getByRole('button', { name: 'Create & copy link' })
}

describe('draft order “Ships to” (AGL-1792)', () => {
  it('never shows the field to a merchant the server does not ask', async () => {
    // The common configuration — one zone, one '*' zone, or none at all. The
    // request carries no `shippingCountry`, and the dialog gains no field.
    const dialog = await openDraftDialog()
    fireEvent.click(createButton(dialog))
    await waitFor(() => expect(payloads).toHaveLength(1))
    expect(payloads[0].shippingCountry).toBeUndefined()
    expect(within(dialog).queryByLabelText('Ships to')).toBeNull()
  })

  it('reveals the field when the server refuses for want of a destination', async () => {
    responses = [NEEDS_COUNTRY]
    const dialog = await openDraftDialog()
    fireEvent.click(createButton(dialog))

    await waitFor(() =>
      expect(within(dialog).queryByLabelText('Ships to')).toBeTruthy(),
    )
    // The dialog stays open with the merchant's work in it — being asked a
    // question is not a reason to make them re-enter the order.
    expect(snackbars.map((entry) => entry.message)).toEqual([
      'Choose where this order ships to.',
    ])
  })

  it('offers the destinations the server named, by name', async () => {
    responses = [NEEDS_COUNTRY]
    const dialog = await openDraftDialog()
    fireEvent.click(createButton(dialog))
    await waitFor(() =>
      expect(within(dialog).queryByLabelText('Ships to')).toBeTruthy(),
    )

    fireEvent.mouseDown(within(dialog).getByLabelText('Ships to'))
    const options = await screen.findAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'United States',
      'Canada',
      'United Kingdom',
      'Australia',
      'Germany',
      'France',
    ])
  })

  it('will not resubmit until the question is answered', async () => {
    responses = [NEEDS_COUNTRY]
    const dialog = await openDraftDialog()
    fireEvent.click(createButton(dialog))
    await waitFor(() =>
      expect(within(dialog).queryByLabelText('Ships to')).toBeTruthy(),
    )
    // Pressing it again would be refused again — the server treats a missing
    // destination as the same refusal, so the button would only look broken.
    expect(createButton(dialog).hasAttribute('disabled')).toBe(true)
    fireEvent.click(createButton(dialog))
    expect(payloads).toHaveLength(1)
  })

  /**
   * THE ASSERTION THIS SPEC IS ABOUT. The second body is what makes the
   * refusal answerable, and `shippingCountry` is the field the server pairs
   * its rates AND its allowed countries with (AGL-1721) — so this is also what
   * stops the merchant's cheap zone being pickable from anywhere else.
   */
  it('posts the chosen destination on the retry', async () => {
    responses = [NEEDS_COUNTRY]
    const dialog = await openDraftDialog()
    fireEvent.click(createButton(dialog))
    await waitFor(() =>
      expect(within(dialog).queryByLabelText('Ships to')).toBeTruthy(),
    )

    fireEvent.mouseDown(within(dialog).getByLabelText('Ships to'))
    fireEvent.click(await screen.findByRole('option', { name: 'France' }))
    fireEvent.click(createButton(dialog))

    await waitFor(() => expect(payloads).toHaveLength(2))
    expect(payloads[1]).toMatchObject({
      hostId: 'host-1',
      productId: 'prod-1',
      shippingCountry: 'FR',
    })
    // And the rest of the order is unchanged — the merchant answered a
    // question, they did not re-compose the draft.
    expect(payloads[1].quantity).toBe(payloads[0].quantity)
  })
})
