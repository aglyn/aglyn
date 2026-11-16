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

import { orderPaymentsView, orderViewFromData } from './order-view'

/**
 * How a sale was paid, in the public order view (AGL-3614): a ledger needs
 * the register's tenders, its tip and the gift card part of a discount,
 * because only card money went through Stripe.
 */
describe('how a sale was paid, in the public order view', () => {
  it('lists the register’s succeeded tenders with their tips and Stripe fees', () => {
    const view = orderViewFromData('o-1', {
      channel: 'pos',
      totals: { totalCents: 5500, tipCents: 300 },
      payments: [
        { id: 'p1', method: 'card_present', status: 'succeeded', amountCents: 3000, tipCents: 300, feeCents: 120 },
        { id: 'p2', method: 'card_keyed', status: 'failed', amountCents: 2500 },
        { id: 'p3', method: 'cash', status: 'succeeded', amountCents: 2500, cashTenderedCents: 3000, changeCents: 500 },
      ],
    })
    expect(view.totals.tipCents).toBe(300)
    expect(view.payments).toEqual([
      { method: 'card_present', amountCents: 3000, tipCents: 300, feeCents: 120 },
      { method: 'cash', amountCents: 2500, tipCents: 0, feeCents: 0 },
    ])
  })

  it('reads a register sale from before the tender ledger as one payment, with the order’s tip and fee', () => {
    expect(orderPaymentsView({ channel: 'pos', status: 'paid', totals: { totalCents: 1800, tipCents: 200 } })).toEqual([
      { method: 'cash', amountCents: 1800, tipCents: 200, feeCents: 0 },
    ])
    expect(
      orderPaymentsView({ channel: 'pos', status: 'paid', paymentIntentId: 'pi_1', totals: { totalCents: 1800, feeCents: 70 } }),
    ).toEqual([{ method: 'card_link', amountCents: 1800, tipCents: 0, feeCents: 70 }])
  })

  it('lists no tenders for an online sale, and carries the gift card part of its discount', () => {
    const view = orderViewFromData('o-2', {
      channel: 'online',
      checkoutSessionId: 'cs_live_1',
      giftCardRedeemedCents: 1500,
      totals: { totalCents: 3500, discountCents: 2000 },
    })
    expect(view.payments).toEqual([])
    expect(view.giftCardRedeemedCents).toBe(1500)
    expect(view.totals.tipCents).toBe(0)
  })
})
