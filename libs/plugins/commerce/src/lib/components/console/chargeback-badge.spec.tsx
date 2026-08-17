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
 * AGL-1796: what the order dialog SAYS about money the merchant did not
 * choose to give back.
 *
 * AGL-1787 put a lost chargeback into `status: 'refunded'` and
 * `refundedCents` deliberately — five entitlement gates match that literal
 * and a distinct status would have escaped all of them. The consequence is
 * this screen: the dialog rendered "Refunded $62.00" over money a bank took,
 * which is the merchant's own decision spelled the same way.
 *
 * The assertions are paired throughout: the new wording must be present AND
 * the old wording absent. Asserting only the first would pass on a dialog that
 * printed both lines, which is the same lie with an extra sentence.
 *
 * Read through the rendered dialog and its real tooltip rather than through
 * the helper's return value — `commerce-dispute.spec.ts` already pins the
 * helper, and the defect being fixed was that the console never CALLED it.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import * as CommerceModel from '../../model'
import OrderDetailDialog from './order-detail-dialog.component'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-admin', getIdToken: jest.fn() } }),
}))

jest.mock('firebase/firestore', () => ({
  doc: () => ({}),
  updateDoc: jest.fn(async () => undefined),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => ({ confirm: jest.fn(async () => undefined) }),
}))

const OPENED_AT = Date.UTC(2026, 9, 2, 14, 30)
const DUE_BY = Date.UTC(2026, 9, 16, 23, 59)
const CLOSED_AT = Date.UTC(2026, 9, 20, 9, 15)

/** A $62.00 order, the figure AGL-1796 quotes. */
const baseOrder = {
  $id: 'order-abc',
  number: 1042,
  status: 'paid',
  customerEmail: 'buyer@example.com',
  lineItems: [
    {
      productId: 'p1',
      name: 'Ceramic mug',
      quantity: 2,
      unitAmountCents: 3100,
    },
  ],
  totals: {
    itemsCents: 6200,
    shippingCents: 0,
    taxCents: 0,
    discountCents: 0,
    feeCents: 0,
    totalCents: 6200,
  },
  timeline: [],
}

const openDispute = {
  id: 'dp_1TESTopened',
  status: 'needs_response',
  reason: 'product_not_received',
  amountCents: 6200,
  openedAtMs: OPENED_AT,
  evidenceDueByMs: DUE_BY,
}

const lostDispute = {
  ...openDispute,
  status: 'lost',
  outcome: 'lost',
  closedAtMs: CLOSED_AT,
  reversedCents: 6200,
}

const show = (order: Record<string, unknown>) =>
  render(
    <OrderDetailDialog
      hostId="host-1"
      order={order as never}
      onClose={jest.fn()}
    />,
  )

describe('the order dialog distinguishes a chargeback from a refund (AGL-1796)', () => {
  it('shows no dispute badge on an ordinary refund', () => {
    // The control. A refund the merchant chose still reads "Refunded", and no
    // dispute wording appears anywhere — so every assertion below is about the
    // dispute record and not about the dialog having been rewritten.
    show({ ...baseOrder, status: 'refunded', refundedCents: 6200 })
    expect(screen.getByText('Refunded $62.00')).toBeTruthy()
    expect(screen.queryByText(/Charged back/)).toBeNull()
    expect(screen.queryByText(/Chargeback/)).toBeNull()
    expect(screen.queryByText(/Dispute/)).toBeNull()
  })

  it('labels a lost chargeback as taken back, not refunded', () => {
    show({
      ...baseOrder,
      status: 'refunded',
      refundedCents: 6200,
      dispute: lostDispute,
    })
    // The status chip is unchanged — that is AGL-1787's decision and the five
    // entitlement gates depend on it.
    expect(screen.getByText('refunded')).toBeTruthy()
    // …and the badge beside it carries what the status cannot say.
    expect(screen.getByText('Charged back')).toBeTruthy()
    expect(screen.getByText('Charged back $62.00')).toBeTruthy()
    expect(screen.queryByText('Refunded $62.00')).toBeNull()
  })

  it('shows both figures when a refund and a chargeback each took a piece', () => {
    // $17 refunded by the merchant, then a $62 dispute lost and capped by
    // AGL-1787 to the remaining $45. `refundedCents` holds the $62 total.
    show({
      ...baseOrder,
      status: 'refunded',
      refundedCents: 6200,
      dispute: { ...lostDispute, reversedCents: 4500 },
    })
    expect(screen.getByText('Refunded $17.00')).toBeTruthy()
    expect(screen.getByText('Charged back $45.00')).toBeTruthy()
    expect(screen.queryByText('Refunded $62.00')).toBeNull()
  })

  it('flags an OPEN dispute on an order that is still plainly paid', () => {
    // The time-critical case, and the one with no other tell: nothing has
    // moved, so `status`, `refundedCents` and the totals are all exactly what
    // a healthy paid order looks like.
    show({ ...baseOrder, dispute: openDispute })
    expect(screen.getByText('paid')).toBeTruthy()
    expect(screen.getByText('Chargeback open')).toBeTruthy()
    expect(screen.queryByText(/Charged back \$/)).toBeNull()
    expect(screen.queryByText(/Refunded \$/)).toBeNull()
  })

  it('puts the reason and the evidence deadline in the badge tooltip', async () => {
    show({ ...baseOrder, dispute: openDispute })
    // Driven by hovering the real chip, not by reading a bespoke attribute:
    // a tooltip that never opens is not a tooltip.
    fireEvent.mouseOver(screen.getByText('Chargeback open'))
    const tip = await screen.findByRole('tooltip')
    expect(tip.textContent).toContain('$62.00 disputed (product not received)')
    expect(tip.textContent).toContain('due to Stripe by 2026-10-16')
  })

  it('says a won dispute cost nothing', () => {
    show({
      ...baseOrder,
      dispute: {
        ...lostDispute,
        status: 'won',
        outcome: 'won',
        reversedCents: 0,
      },
    })
    expect(screen.getByText('Dispute won')).toBeTruthy()
    expect(screen.queryByText(/Charged back \$/)).toBeNull()
    expect(screen.queryByText(/Refunded \$/)).toBeNull()
  })

  it('reads the dispute off a LEGACY flat order too', () => {
    // Legacy Commerce Starter orders carry `amountCents` and no `lineItems`,
    // and the dialog runs them through `liftLegacyOrder`. A lift that dropped
    // `dispute` would have hidden the badge on exactly the oldest orders.
    const lifted = CommerceModel.liftLegacyOrder({
      status: 'refunded',
      amountCents: 6200,
      refundedCents: 6200,
      dispute: lostDispute,
    } as never)
    expect(lifted.dispute?.id).toBe('dp_1TESTopened')
    show({
      $id: 'order-legacy',
      status: 'refunded',
      productId: 'p1',
      amountCents: 6200,
      refundedCents: 6200,
      dispute: lostDispute,
      timeline: [],
    })
    expect(screen.getByText('Charged back')).toBeTruthy()
    expect(screen.getByText('Charged back $62.00')).toBeTruthy()
  })
})
