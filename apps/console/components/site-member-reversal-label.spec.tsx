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
 * AGL-1810: the site-member drawer stops calling a chargeback a refund.
 *
 * `refundedCents` carries a lost chargeback as well as a refund (AGL-1787
 * puts both there deliberately), and the drawer rendered the whole figure as
 * "refunded" — the one word that says the merchant chose it — on the third
 * surface AGL-1796 did not name. The split is the local
 * `splitReversalCents`, a deliberate duplicate of the commerce model's
 * `splitOrderReversal` because `scope:app` must not import `aglyn:addons`
 * (the nx edge AGL-417/419 forbids); its own spec pins the shared clamp
 * semantics.
 *
 * The LIFETIME TOTAL is pinned unchanged: money reversed is money reversed
 * whichever door it left by, so the netting keeps reading the whole
 * `refundedCents` while only the label splits.
 */

import { render, screen } from '@testing-library/react'
import SiteMemberDrawer from './site-member-drawer.component'

/** Orders the mocked collection hook serves for the member's email. */
let mockOrders: Array<Record<string, unknown>> = []

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (path: string) => ({ path }),
  where: () => undefined,
  limit: () => undefined,
  updateDoc: jest.fn(async () => undefined),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-admin', getIdToken: async () => 'tok' } }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => ({ confirm: jest.fn(async () => undefined) }),
}))

jest.mock('../hooks/use-host-activity-logger', () => ({
  __esModule: true,
  default: () => jest.fn(),
}))

jest.mock('./password-admin-controls.component', () => ({
  __esModule: true,
  default: () => null,
}))

// Routed by the queried collection's path: the drawer asks for orders,
// subscriptions and (only when subscriptions exist) products.
jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: (factory: () => { path?: string } | null) => {
    const path = factory?.()?.path ?? ''
    if (path.endsWith('/orders')) {
      return { data: mockOrders, status: 'success' }
    }
    return { data: [], status: 'success' }
  },
}))

const member = {
  $id: 'member-1',
  email: 'buyer@example.com',
  displayName: 'Buyer',
}

const show = () =>
  render(
    <SiteMemberDrawer hostId="host-1" member={member} onClose={jest.fn()} />,
  )

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

describe('the member drawer splits a reversal by its door (AGL-1810)', () => {
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
    // The lifetime netting is CORRECT as it stands (money reversed is money
    // reversed) and must keep reading the whole figure: $62.00 charged minus
    // $62.00 reversed.
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
    mockOrders = [
      { ...baseOrder, status: 'paid', refundedCents: undefined },
    ]
    show()
    expect(screen.queryByText(/refunded \$/)).toBeNull()
    expect(screen.queryByText(/charged back/)).toBeNull()
    expect(screen.getByText('$62.00')).toBeTruthy()
  })
})
