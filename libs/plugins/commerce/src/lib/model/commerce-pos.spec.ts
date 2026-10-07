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

import {
  orderPayments,
  posBalanceDueCents,
  posDisplayPublicState,
  posFeeCollection,
  posInvoiceTakeCents,
  posSettledCents,
  posTakeShareCents,
  posTenderableCents,
  posTipCents,
  posTipFromPercent,
  posTipPercentages,
  sanitizePosDisplayResponse,
  sanitizePosDisplayState,
  type OrderPayment,
} from './commerce-pos'
import { orderNetCents } from './commerce-orders'

const pay = (over: Partial<OrderPayment>): OrderPayment => ({
  id: over.id ?? 'p',
  method: 'cash',
  amountCents: 0,
  status: 'succeeded',
  atMs: 1,
  ...over,
})

describe('the tender ledger (AGL-3607)', () => {
  it('sums settled payments toward the sale, and never the tip', () => {
    const payments = [
      pay({ id: 'a', method: 'gift_card', amountCents: 2500 }),
      pay({ id: 'b', method: 'card_present', amountCents: 4000, tipCents: 800 }),
      pay({ id: 'c', method: 'cash', amountCents: 1000, status: 'failed' }),
    ]
    expect(posSettledCents(payments)).toBe(6500)
    expect(posTipCents(payments)).toBe(800)
    expect(posBalanceDueCents(10000, payments)).toBe(3500)
  })

  it('reserves in-flight payments so a second tender cannot take the same dollars', () => {
    const payments = [
      pay({ id: 'a', amountCents: 3000 }),
      pay({ id: 'b', method: 'card_present', amountCents: 5000, status: 'pending' }),
    ]
    expect(posBalanceDueCents(10000, payments)).toBe(7000)
    expect(posTenderableCents(10000, payments)).toBe(2000)
  })

  it('splits the take so card shares plus the invoiced remainder equal it exactly', () => {
    const take = 333
    const total = 10001
    const first = posTakeShareCents({ takeFeeCents: take, totalCents: total, amountCents: 3333 })
    const second = posTakeShareCents({ takeFeeCents: take, totalCents: total, amountCents: 3333 })
    const payments = [
      pay({ id: 'a', method: 'card_keyed', amountCents: 3333, takeFeeCents: first }),
      pay({ id: 'b', method: 'card_present', amountCents: 3333, takeFeeCents: second }),
      pay({ id: 'c', method: 'cash', amountCents: 3335, takeFeeCents: 999 }),
    ]
    expect(first + second + posInvoiceTakeCents({ takeFeeCents: take, payments })).toBe(take)
    expect(posFeeCollection(payments)).toBe('split')
  })

  it('takes nothing from a tip: the share is of the sale amount only', () => {
    expect(
      posTakeShareCents({ takeFeeCents: 200, totalCents: 10000, amountCents: 10000 }),
    ).toBe(200)
  })

  it('reads a legacy single-tender order as one inferred payment', () => {
    expect(
      orderPayments({ channel: 'pos', status: 'paid', totals: { totalCents: 1200 } })[0],
    ).toMatchObject({ method: 'cash', amountCents: 1200, status: 'succeeded' })
    expect(
      orderPayments({
        channel: 'pos',
        status: 'pending',
        checkoutSessionId: 'cs_1',
        totals: { totalCents: 900 },
      })[0],
    ).toMatchObject({ method: 'card_link', status: 'pending' })
    expect(
      orderPayments({ channel: 'pos', status: 'paid', reservationId: 'r1', totals: { totalCents: 500 } })[0],
    ).toMatchObject({ method: 'folio' })
    expect(orderPayments({ channel: 'pos', status: 'paid', payments: [] })).toEqual([])
  })

  it('keeps a refunded tip out of the sale revenue', () => {
    expect(
      orderNetCents({ totals: { totalCents: 1000, tipCents: 200 } as any, refundedCents: 1200 }),
    ).toBe(0)
    expect(orderNetCents({ totals: { totalCents: 1000 } as any, refundedCents: 300 })).toBe(700)
  })
})

describe('tips', () => {
  it('reads presets from the setting and falls back to the defaults', () => {
    expect(posTipPercentages('15, 20,25')).toEqual([15, 20, 25])
    expect(posTipPercentages('junk')).toEqual([15, 18, 20, 25])
    expect(posTipPercentages('10,10,0,150,12,14,16')).toEqual([10, 12, 14, 16])
    expect(posTipFromPercent(4250, 18)).toBe(765)
  })
})

describe('the customer display state (AGL-3608)', () => {
  const tipState = sanitizePosDisplayState(
    { mode: 'tip', promptId: 'p1', tip: { baseCents: 1000, percentages: [15, 20] } },
    1,
  )

  it('accepts only an answer to the current prompt, with a preset it offered', () => {
    expect(sanitizePosDisplayResponse(tipState, { promptId: 'p0', tipChoice: 'none' }, 2)).toBeNull()
    expect(
      sanitizePosDisplayResponse(tipState, { promptId: 'p1', tipChoice: 'percent', tipPercent: 50 }, 2),
    ).toBeNull()
    expect(
      sanitizePosDisplayResponse(tipState, { promptId: 'p1', tipChoice: 'percent', tipPercent: 20 }, 2),
    ).toMatchObject({ tipCents: 200, tipPercent: 20 })
    expect(
      sanitizePosDisplayResponse(tipState, { promptId: 'p1', tipChoice: 'custom', tipCents: 5000 }, 2),
    ).toBeNull()
  })

  it('takes an email receipt only with a real address and a ticked opt-in only when offered', () => {
    const receipt = sanitizePosDisplayState(
      { mode: 'receipt', promptId: 'r1', receipt: { channels: ['email', 'none'], offerMarketing: false } },
      1,
    )
    expect(
      sanitizePosDisplayResponse(receipt, { promptId: 'r1', receiptChannel: 'email', email: 'nope' }, 2),
    ).toBeNull()
    expect(
      sanitizePosDisplayResponse(
        receipt,
        { promptId: 'r1', receiptChannel: 'email', email: 'Ann@Example.com', marketingOptIn: true },
        2,
      ),
    ).toEqual({ promptId: 'r1', receiptChannel: 'email', email: 'ann@example.com', atMs: 2 })
  })

  it('never sends the customer answer back to the screen, and idles after thanks', () => {
    const answered = posDisplayPublicState(
      { ...tipState, response: { promptId: 'p1', email: 'a@b.co', atMs: 2 } },
      3,
    )
    expect(answered).not.toHaveProperty('response')
    expect(answered.answered).toBe(true)
    expect(posDisplayPublicState({ mode: 'thanks', updatedAtMs: 0 }, 60_000).mode).toBe('idle')
  })

  it('drops cart data from an idle state', () => {
    expect(
      sanitizePosDisplayState({ mode: 'idle', cart: { lines: [{ name: 'x' }] } }, 1),
    ).toEqual({ mode: 'idle', updatedAtMs: 1 })
  })
})
