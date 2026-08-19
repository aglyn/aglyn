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
 * A store with no orders can still draft one (AGL-1805).
 *
 * The whole toolbar — four filters, Export CSV and the **Draft order**
 * button — used to live inside the `orders.length > 0` arm of a ternary, so
 * the one state a draft order exists for (no sales yet, invoice the customer
 * you already have) was the one state that could not reach it. Every other
 * route into the dialog needs an order to already exist.
 *
 * The `<Dialog>` itself was never inside that arm, so nothing but the trigger
 * was missing — which is why these tests drive the dialog all the way to its
 * request: the proof that matters is that a zero-order store can produce a
 * payment link, not merely that a button rendered.
 *
 * Driven through the rendered card rather than by poking state, per the
 * standing "drive the FORM, not the endpoint" rule. `fetch` is mocked at
 * `/api/commerce/draft-order`, the only boundary crossed — nothing reaches
 * Stripe, which on localhost carries the LIVE key.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

/** Every draft-order request the dialog made, decoded. */
let payloads: any[] = []

const PRODUCT = {
  $id: 'prod-1',
  name: 'Kettle',
  status: 'active',
  variants: [{ id: 'v1', priceUsd: 30, options: {} }],
}

/**
 * Flipped per test: `products` is what a day-one store has, `orders` is
 * empty in every test in this file — that emptiness IS the fixture.
 */
let products: any[] = []

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => path.join('/'),
  query: (ref: string) => ref,
  limit: () => undefined,
}))

/** Settled, unentitled — the tiles stay off and the table still renders. */
const ORG_PLAN = { org: { plan: 'starter' }, ready: true }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  /**
   * AGL-2136 added the `commerceAnalytics`-gated money tiles to this card,
   * so the module's closed-world mock has to carry `useOrgPlan` or the
   * component throws before it renders a row. A STABLE object, not a fresh
   * one per call: the real hook memoises, and handing back a new identity
   * every render is how a mock turns a failing assertion into a hang.
   */
  useOrgPlan: () => ORG_PLAN,
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'token' } }),
  useFirestoreCollection: (build: () => string) => {
    const path = build()
    if (path.endsWith('/products')) return { data: products }
    // The point of the fixture: this host has never taken an order.
    if (path.endsWith('/orders')) return { data: [] }
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
  products = [PRODUCT]
  snackbars.length = 0
  global.fetch = jest.fn(async (_input: any, init?: any) => {
    payloads.push(init?.body ? JSON.parse(String(init.body)) : null)
    return {
      ok: true,
      json: async () => ({
        orderId: 'order-1',
        url: 'https://checkout.stripe.com/pay/x',
      }),
    }
  }) as unknown as typeof fetch
  Object.assign(navigator, {
    clipboard: { writeText: async () => undefined },
  })
})

describe('orders empty state (AGL-1805)', () => {
  it('offers the Draft order button to a store with no orders', () => {
    // THE ASSERTION THIS SPEC IS ABOUT. Red before the fix: the button was
    // rendered only in the non-empty arm.
    render(<HostOrdersCard hostId="host-1" />)
    expect(
      screen.getByRole('button', { name: 'Draft order' }),
    ).toBeTruthy()
  })

  it('says where orders come from, including the paths that are not the storefront', () => {
    // The old sentence named Product blocks only. POS, cart and draft orders
    // all land in this same list, so it described about half of them.
    render(<HostOrdersCard hostId="host-1" />)
    // Read the sentence itself, not its container: the "Draft order" button
    // sits in the same box and would satisfy a /draft/ match on its own.
    const sentence = screen.getByText(/No orders yet/i).textContent ?? ''
    expect(sentence).toMatch(/POS/i)
    expect(sentence).toMatch(/draft order/i)
  })

  it('carries a zero-order store all the way to a payment link', async () => {
    render(<HostOrdersCard hostId="host-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Draft order' }))

    const dialog = await screen.findByRole('dialog')
    fireEvent.mouseDown(within(dialog).getByLabelText('Product'))
    fireEvent.click(await screen.findByRole('option', { name: 'Kettle' }))
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Create & copy link' }),
    )

    // The dialog was never inside the ternary, so once the trigger exists the
    // rest of the path is intact — asserted rather than assumed.
    await waitFor(() => expect(payloads).toHaveLength(1))
    expect(payloads[0]).toMatchObject({
      hostId: 'host-1',
      productId: 'prod-1',
      quantity: 1,
    })
  })

  it('leaves the filters behind — they belong to a list that has rows', () => {
    // A behaviour pin, not a new feature: hoisting the button must not drag
    // four selects over a list with nothing in it to filter.
    render(<HostOrdersCard hostId="host-1" />)
    expect(screen.queryByLabelText('Product')).toBeNull()
    expect(screen.queryByLabelText('Status')).toBeNull()
    expect(screen.queryByLabelText('Period')).toBeNull()
    expect(screen.queryByLabelText('Channel')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull()
  })

  it('explains the empty Product select instead of showing a dead dropdown', async () => {
    // The second dead end behind the first: a day-one store may have no
    // products either, and "Create & copy link" is disabled without one. The
    // dialog has to say why rather than offer an empty menu.
    products = []
    render(<HostOrdersCard hostId="host-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Draft order' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toMatch(/add a product/i)
    expect(
      within(dialog)
        .getByRole('button', { name: 'Create & copy link' })
        .hasAttribute('disabled'),
    ).toBe(true)
  })
})
