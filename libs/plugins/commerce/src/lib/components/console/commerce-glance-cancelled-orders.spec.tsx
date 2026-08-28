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
 * A cancelled order is not revenue, and the glance card was counting it.
 *
 * `OrderStatus` persists the British `cancelled`; the card's window tested
 * `status !== 'canceled'`. One L apart, so the test never matched a stored
 * status and every cancelled order flowed into the 30-day revenue, the order
 * count and the average order value. Nothing looked wrong — the figure was a
 * plausible number, just too big, and it drifted further from Stripe with
 * every cancellation.
 *
 * The sibling `commerce-analytics-card` on the same dashboard, reading the
 * same `hosts/{hostId}/orders` collection over the same window, spells it
 * `cancelled` and always excluded them. The two cards therefore quoted
 * different revenue for one store; the disagreement, not either number alone,
 * is what makes this a defect rather than a preference.
 *
 * SCOPE, NOW SETTLED (AGL-2516). This file first pinned the cancellation rule
 * and deliberately left two neighbouring questions unasserted, because they
 * were open: this card counted `pending` orders that have taken no money while
 * the analytics card excluded them, and it dropped only fully-refunded orders
 * by status while the analytics card subtracts `refundedCents`, so a
 * 99%-refunded sale counted here in full.
 *
 * Both were decided in favour of the analytics card, which was right on all
 * three counts, and this file now pins them too. The point was never which
 * number is prettier — it is that one dashboard must not show a store two
 * different revenues for the same thirty days.
 *
 * ASSERTED AS THE FIGURE, not the layout: the money string is the number under
 * audit. The arithmetic is not extracted from the component, so the rendered
 * figure is the only surface it has — but the assertion is on the value, never
 * on where or how it is drawn. Amounts are chosen so the revenue total is
 * distinct from the AOV and from every per-order caption, or the matcher would
 * pass on the wrong element.
 *
 * The CONTROL is the same basket with the cancelled order paid instead.
 * Without it a card that had simply stopped counting revenue — a filter
 * matching nothing, a zeroed reduce — would satisfy the first assertion
 * perfectly. Both arms are what show the filter discriminates rather than
 * merely excludes.
 */

import { cleanup, render } from '@testing-library/react'

const RECENT = Date.now() - 24 * 60 * 60 * 1000

/** Swapped per case. The card reads it through `useFirestoreCollection`. */
let orderRows: unknown[] = []

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useOrgPlan: () => ({ org: { plan: 'pro' }, ready: true }),
  useConsoleHostRoute: () => ({ base: '/o/h', orgSlug: 'o' }),
  useFirestoreCollection: () => ({ data: orderRows }),
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: () => ({}),
  query: () => ({}),
  limit: () => ({}),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AppLink: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

import CommerceGlanceCard from './commerce-glance-card.component'

const order = (status: string, totalCents: number) => ({
  $id: `order-${status}-${totalCents}`,
  status,
  createdAtMs: RECENT,
  refundedCents: 0,
  totals: { totalCents },
  lineItems: [],
})

beforeEach(() => {
  orderRows = []
})

// Queries below run against the subtree THIS render produced, never the global
// `screen`. Two suites in one worker share a jsdom document, so a global query
// can match a node another suite left behind — which is a false pass as easily
// as a false failure.
afterEach(cleanup)

describe('CommerceGlanceCard revenue window', () => {
  it('leaves a cancelled order out of 30-day revenue', () => {
    // The persisted spelling, which is the whole defect: the old test compared
    // against 'canceled' and let this $250 row through. Two paid orders keep
    // the $140.00 total distinct from the $70.00 average.
    orderRows = [
      order('paid', 10000),
      order('paid', 4000),
      order('cancelled', 25000),
    ]

    const { getByText, queryByText } = render(
      <CommerceGlanceCard hostId="host-1" />,
    )

    expect(getByText('$140.00')).toBeTruthy()
    expect(queryByText('$390.00')).toBeNull()
  })

  it('counts that same order once it is paid rather than cancelled', () => {
    // CONTROL. Only the status differs from the case above, so a card that
    // counted nothing — or everything — is told apart from one that reads the
    // status at all.
    orderRows = [
      order('paid', 10000),
      order('paid', 4000),
      order('paid', 25000),
    ]

    const { getByText } = render(<CommerceGlanceCard hostId="host-1" />)

    expect(getByText('$390.00')).toBeTruthy()
  })

  it('leaves an unpaid pending order out', () => {
    // A `pending` order has taken no money. It was counted here and excluded by
    // the analytics card, which is half of why the two disagreed.
    orderRows = [
      order('paid', 10000),
      order('paid', 4000),
      order('pending', 25000),
    ]

    const { getByText, queryByText } = render(
      <CommerceGlanceCard hostId="host-1" />,
    )

    expect(getByText('$140.00')).toBeTruthy()
    expect(queryByText('$390.00')).toBeNull()
  })

  it('nets a partial refund instead of counting the order whole', () => {
    // The other half. A 99%-refunded sale used to count in full here because
    // the drop was keyed on status; the money that came back is now subtracted.
    orderRows = [
      order('paid', 10000),
      { ...order('paid', 4000), refundedCents: 3900 },
    ]

    const { getByText } = render(<CommerceGlanceCard hostId="host-1" />)

    expect(getByText('$101.00')).toBeTruthy()
  })

  it('nets a fully refunded order to nothing, but still counts the sale', () => {
    // Dropping it whole and netting it to zero agree on revenue and disagree
    // on the order count. The analytics card counts it, so this one does too.
    // Three orders so the $140.00 total is distinct from the $46.67 average
    // and from every per-order caption, or the matcher would pass on the
    // wrong element.
    orderRows = [
      order('paid', 10000),
      order('paid', 4000),
      { ...order('refunded', 2500), refundedCents: 2500 },
    ]

    const { getByText, queryByText } = render(
      <CommerceGlanceCard hostId="host-1" />,
    )

    expect(getByText('$140.00')).toBeTruthy()
    expect(queryByText('$165.00')).toBeNull()
  })

  /**
   * A REHEARSAL IS NOT REVENUE, AND IS NOT HIDDEN EITHER (AGL-2520).
   *
   * The one order in production is a `cs_test_…` smoke-test checkout that
   * Stripe never moved money for, and it was counted here as $18.00 of
   * storefront revenue. Every case below carries a LIVE order alongside the
   * test one, because with only a test order in the fixture a filter that
   * zeroed everything would look identical to a filter that worked.
   */
  describe('a test-mode order (AGL-2520)', () => {
    // Two live orders so the $140.00 revenue is distinct from the $70.00
    // average and from every per-order caption.
    const live = { ...order('paid', 10000), $id: 'cs_live_realsale' }
    const live2 = { ...order('paid', 4000), $id: 'cs_live_alsoreal' }
    const test = { ...order('paid', 25000), $id: 'cs_test_smoke' }

    it('is left out of revenue while the live order still counts', () => {
      orderRows = [live, live2, test]

      const { getByText, queryByText } = render(
        <CommerceGlanceCard hostId="host-1" />,
      )

      expect(getByText('$140.00')).toBeTruthy()
      expect(queryByText('$390.00')).toBeNull()
    })

    it('CONTROL: the same order counts once it is a live session', () => {
      // Only the session id differs. Without this the assertion above would
      // pass against a card that had stopped counting orders altogether.
      orderRows = [live, live2, { ...test, $id: 'cs_live_thirdsale' }]

      const { getByText } = render(<CommerceGlanceCard hostId="host-1" />)

      expect(getByText('$390.00')).toBeTruthy()
    })

    it('CONTROL: a recorded livemode beats the id', () => {
      // A test-shaped id on an order the webhook recorded as live must still
      // count — the recorded fact is the stronger signal.
      orderRows = [live, live2, { ...test, livemode: true }]

      const { getByText } = render(<CommerceGlanceCard hostId="host-1" />)

      expect(getByText('$390.00')).toBeTruthy()
    })

    it('EXCLUDED, NOT HIDDEN: it still appears in the order list', () => {
      // It happened, and the merchant should be able to see it. Only the
      // revenue total may not claim it.
      orderRows = [live, live2, test]

      const { getByText } = render(<CommerceGlanceCard hostId="host-1" />)

      // The latest-orders list renders the id when there is no order number.
      expect(getByText(/cs_test_/)).toBeTruthy()
    })
  })
})
