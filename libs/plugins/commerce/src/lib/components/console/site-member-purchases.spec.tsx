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
 * A site user's purchases, in the `siteMember` zone of their drawer
 * (AGL-546, AGL-3080).
 *
 * AGL-1810: a chargeback is not called a refund. `refundedCents` carries a
 * lost chargeback as well as a refund (AGL-1787 puts both there
 * deliberately), and the drawer rendered the whole figure as "refunded" —
 * the one word that says the merchant chose it. The split is the order
 * model's own `splitOrderReversal`.
 *
 * The LIFETIME TOTAL is pinned unchanged: money reversed is money reversed
 * whichever door it left by, so the netting keeps reading the whole
 * `refundedCents` while only the label splits.
 */

import { render, screen } from '@testing-library/react'

/** Orders the mocked collection hook serves for the member's email. */
let mockOrders: Array<Record<string, unknown>> = []
/** Every collection path the section asked for. */
const mockAsked: string[] = []

/*
 * The double has to answer every constraint the section builds. The factory
 * replaces the whole module, so a missing export is not a soft failure: it
 * comes back `undefined` and the component throws on render.
 */
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (path: string) => ({ path }),
  where: () => undefined,
  orderBy: () => undefined,
  documentId: () => '__name__',
  limit: () => undefined,
}))

/**
 * Stable identities, deliberately (AGL-2374): a mock returning a fresh
 * literal per call loops an effect that lists it forever. `ceilingedWindow`
 * is a pure function and is the real one — a hand-written stand-in would be
 * free to slice differently from the thing that ships.
 */
const mockFirestore = {}
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockFirestore,
  ceilingedWindow: jest.requireActual(
    '@aglyn/tenant-feature-instance/hooks/host-collection-queries',
  ).ceilingedWindow,
  // Routed by the queried collection's path: orders, subscriptions and
  // (only when subscriptions exist) products.
  useFirestoreCollection: (factory: () => { path?: string } | null) => {
    const path = factory?.()?.path ?? ''
    if (path) mockAsked.push(path)
    if (path.endsWith('/orders')) return { data: mockOrders, status: 'success' }
    return { data: [], status: 'success' }
  },
}))

import { SiteMemberPurchases } from './site-member-purchases.component'

const member = {
  $id: 'member-1',
  email: 'buyer@example.com',
  displayName: 'Buyer',
}

const show = () => render(<SiteMemberPurchases hostId="host-1" member={member} />)

/** A $62.00 order, the figure the AGL-1796 fixtures use. */
const baseOrder = {
  $id: 'order-abc',
  number: 1042,
  status: 'refunded',
  customerEmail: 'buyer@example.com',
  createdAtMs: Date.UTC(2026, 7, 10, 12, 0),
  totals: { totalCents: 6200 },
  refundedCents: 6200,
}

const lostDispute = {
  id: 'dp_1TESTlost',
  status: 'lost',
  outcome: 'lost',
  reason: 'product_not_received',
  amountCents: 6200,
  openedAtMs: Date.UTC(2026, 9, 2, 14, 30),
  closedAtMs: Date.UTC(2026, 9, 20, 9, 15),
  reversedCents: 6200,
}

beforeEach(() => {
  mockOrders = []
  mockAsked.length = 0
})

describe('a site user’s purchases', () => {
  it('reads the site’s orders by the account’s address, and its subscriptions', () => {
    mockOrders = [baseOrder]
    show()
    expect(mockAsked).toEqual(
      expect.arrayContaining(['hosts/host-1/orders', 'hosts/host-1/subscriptions']),
    )
    expect(screen.getByText('Lifetime purchases')).toBeTruthy()
    expect(screen.getByText(/#1042 · \$62\.00/)).toBeTruthy()
  })

  it('says there are none, and asks for no product names without subscriptions', () => {
    show()
    expect(screen.getByText('No orders yet.')).toBeTruthy()
    expect(mockAsked).not.toContain('hosts/host-1/products')
  })
})

describe('the purchases split a reversal by its door (AGL-1810)', () => {
  it('still says "refunded" for a refund the merchant chose', () => {
    // The control: without a dispute the wording must not move.
    mockOrders = [baseOrder]
    show()
    expect(screen.getByText(/· refunded \$62\.00/)).toBeTruthy()
    expect(screen.queryByText(/charged back/)).toBeNull()
  })

  it('says "charged back", not "refunded", for a lost chargeback', () => {
    mockOrders = [{ ...baseOrder, dispute: lostDispute }]
    show()
    expect(screen.getByText(/· charged back \$62\.00/)).toBeTruthy()
    expect(screen.queryByText(/refunded \$/)).toBeNull()
    // The lifetime netting keeps reading the whole figure: $62.00 charged
    // minus $62.00 reversed.
    expect(screen.getByText('$0.00')).toBeTruthy()
  })

  it('shows both doors when a refund and a chargeback each took a piece', () => {
    // $17 refunded by the merchant, then the $62 dispute lost and capped by
    // AGL-1787 to the remaining $45; `refundedCents` holds the $62 total.
    mockOrders = [
      { ...baseOrder, dispute: { ...lostDispute, reversedCents: 4500 } },
    ]
    show()
    expect(screen.getByText(/· refunded \$17\.00/)).toBeTruthy()
    expect(screen.getByText(/· charged back \$45\.00/)).toBeTruthy()
    expect(screen.queryByText(/refunded \$62\.00/)).toBeNull()
  })

  it('renders no reversal suffix at all on an untouched order', () => {
    mockOrders = [{ ...baseOrder, status: 'paid', refundedCents: undefined }]
    show()
    expect(screen.queryByText(/refunded \$/)).toBeNull()
    expect(screen.queryByText(/charged back/)).toBeNull()
    expect(screen.getByText('$62.00')).toBeTruthy()
  })
})
