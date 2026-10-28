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
  paymentCarriesPlatformFee,
  posFeeCollection,
  posInvoiceTakeCents,
  posOwedTakeCents,
  posPaymentTakeShareCents,
  posSettledCents,
  posTakeShareCents,
  posTenderableCents,
  posTenderTakeCents,
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

/*
 * NO PLATFORM FEE ON CASH OR GIFT CARD (AGL-4036). A $100.00 sale whose plan
 * takes $2.00: every combination of tenders, by what the tenders owe, what
 * the cards net from their payouts, and what goes on the invoice.
 */
describe('which tenders carry the platform fee (AGL-4036)', () => {
  const TAKE = 200
  const TOTAL = 10_000
  /** A succeeded payment with the share the register would record for it. */
  const part = (id: string, method: OrderPayment['method'], amountCents: number) =>
    pay({
      id,
      method,
      amountCents,
      takeFeeCents: posPaymentTakeShareCents({ method, takeFeeCents: TAKE, totalCents: TOTAL, amountCents }),
    })
  const owed = (payments: OrderPayment[], takeFeeCents = TAKE) => ({
    owed: posOwedTakeCents({ takeFeeCents, totalCents: TOTAL, payments }),
    invoice: posInvoiceTakeCents({ takeFeeCents, totalCents: TOTAL, payments }),
    netted: payments
      .filter(
        (payment) =>
          payment.status === 'succeeded' && ['card_present', 'card_keyed', 'card_link'].includes(payment.method),
      )
      .reduce((sum, payment) => sum + Number(payment.takeFeeCents ?? 0), 0),
  })

  it('names cash, gift card and store credit as the only fee-free tenders', () => {
    expect(paymentCarriesPlatformFee('cash')).toBe(false)
    expect(paymentCarriesPlatformFee('gift_card')).toBe(false)
    expect(paymentCarriesPlatformFee('credit')).toBe(false)
    for (const method of ['card_present', 'card_keyed', 'card_link', 'folio'] as const) {
      expect(paymentCarriesPlatformFee(method)).toBe(true)
    }
  })

  it('a single tender owes the whole take, or nothing for cash and gift card', () => {
    expect(posTenderTakeCents('cash', TAKE)).toBe(0)
    expect(posTenderTakeCents('gift_card', TAKE)).toBe(0)
    expect(posTenderTakeCents('credit', TAKE)).toBe(0)
    expect(posTenderTakeCents('folio', TAKE)).toBe(TAKE)
    expect(posTenderTakeCents('card_link', TAKE)).toBe(TAKE)
  })

  it('cash only: owes nothing, invoices nothing', () => {
    const payments = [part('a', 'cash', TOTAL)]
    expect(payments[0]!.takeFeeCents).toBe(0)
    expect(owed(payments)).toEqual({ owed: 0, invoice: 0, netted: 0 })
  })

  it('gift card only: owes nothing, invoices nothing', () => {
    expect(owed([part('a', 'gift_card', TOTAL)])).toEqual({ owed: 0, invoice: 0, netted: 0 })
  })

  it('room charge only: the whole take, on the invoice', () => {
    const payments = [part('a', 'folio', TOTAL)]
    expect(owed(payments)).toEqual({ owed: TAKE, invoice: TAKE, netted: 0 })
    expect(posFeeCollection(payments)).toBe('invoice')
  })

  it('card only: the whole take, netted from the payout', () => {
    const payments = [part('a', 'card_present', TOTAL)]
    expect(owed(payments)).toEqual({ owed: TAKE, invoice: 0, netted: TAKE })
    expect(posFeeCollection(payments)).toBe('payout')
  })

  it('card + cash: the card share only, all of it from the payout', () => {
    const payments = [part('a', 'card_keyed', 6_000), part('b', 'cash', 4_000)]
    expect(owed(payments)).toEqual({ owed: 120, invoice: 0, netted: 120 })
    expect(posFeeCollection(payments)).toBe('payout')
  })

  it('card + gift card: the card share only, all of it from the payout', () => {
    const payments = [part('a', 'gift_card', 2_500), part('b', 'card_present', 7_500)]
    expect(owed(payments)).toEqual({ owed: 150, invoice: 0, netted: 150 })
    expect(posFeeCollection(payments)).toBe('payout')
  })

  it('room charge + cash: the room-charge share, on the invoice', () => {
    const payments = [part('a', 'folio', 3_000), part('b', 'cash', 7_000)]
    expect(owed(payments)).toEqual({ owed: 60, invoice: 60, netted: 0 })
    expect(posFeeCollection(payments)).toBe('invoice')
  })

  it('card + room charge + cash: the card nets its share, the room charge is invoiced, cash owes none', () => {
    const payments = [part('a', 'card_present', 5_000), part('b', 'folio', 2_000), part('c', 'cash', 3_000)]
    expect(owed(payments)).toEqual({ owed: 140, invoice: 40, netted: 100 })
    expect(posFeeCollection(payments)).toBe('split')
  })

  it('stays exact when the shares round, however many cards split it', () => {
    const take = 333
    const total = 10_001
    const share = (method: OrderPayment['method'], amountCents: number) =>
      posPaymentTakeShareCents({ method, takeFeeCents: take, totalCents: total, amountCents })
    const payments = [
      pay({ id: 'a', method: 'card_keyed', amountCents: 3333, takeFeeCents: share('card_keyed', 3333) }),
      pay({ id: 'b', method: 'card_present', amountCents: 3333, takeFeeCents: share('card_present', 3333) }),
      pay({ id: 'c', method: 'cash', amountCents: 3335, takeFeeCents: share('cash', 3335) }),
    ]
    const invoice = posInvoiceTakeCents({ takeFeeCents: take, totalCents: total, payments })
    const owedTake = posOwedTakeCents({ takeFeeCents: take, totalCents: total, payments })
    // Two cards of 3333 on 10001 owe 222 of the 333, and nothing of it goes
    // on the invoice beyond what the cards' own rounding left.
    expect(owedTake).toBe(posTakeShareCents({ takeFeeCents: take, totalCents: total, amountCents: 6666 }))
    expect(share('card_keyed', 3333) + share('card_present', 3333) + invoice).toBe(owedTake)
  })

  it('ignores a take a cash payment recorded under the old rule', () => {
    // An open sale started before AGL-4036 and finished after it.
    const payments = [pay({ id: 'a', method: 'cash', amountCents: TOTAL, takeFeeCents: TAKE })]
    expect(owed(payments)).toEqual({ owed: 0, invoice: 0, netted: 0 })
  })

  it('ignores failed and canceled payments', () => {
    const payments = [
      pay({ id: 'a', method: 'card_present', amountCents: TOTAL, status: 'failed', takeFeeCents: TAKE }),
      part('b', 'cash', TOTAL),
    ]
    expect(owed(payments)).toEqual({ owed: 0, invoice: 0, netted: 0 })
  })

  it('a 0% plan owes nothing on any tender', () => {
    for (const payments of [
      [part('a', 'cash', TOTAL)],
      [part('a', 'folio', TOTAL)],
      [part('a', 'folio', 4_000), part('b', 'gift_card', 6_000)],
    ]) {
      expect(owed(payments, 0)).toMatchObject({ owed: 0, invoice: 0 })
    }
    expect(posPaymentTakeShareCents({ method: 'card_present', takeFeeCents: 0, totalCents: TOTAL, amountCents: TOTAL })).toBe(0)
  })

  it('store credit carries no share, alone or beside cash', () => {
    expect(owed([part('a', 'credit', TOTAL)])).toEqual({ owed: 0, invoice: 0, netted: 0 })
    expect(owed([part('a', 'credit', 5_000), part('b', 'cash', 5_000)])).toEqual({ owed: 0, invoice: 0, netted: 0 })
  })

  it('store credit beside a room charge: only the room charge share is invoiced', () => {
    expect(owed([part('a', 'credit', 5_000), part('b', 'folio', 5_000)])).toEqual({ owed: 100, invoice: 100, netted: 0 })
  })
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
      pay({ id: 'c', method: 'folio', amountCents: 3335, takeFeeCents: 999 }),
    ]
    expect(first + second + posInvoiceTakeCents({ takeFeeCents: take, totalCents: total, payments })).toBe(take)
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

  it('keeps another plugin’s screen only as the checker shapes it, with a prompt (AGL-4042)', () => {
    const screen = { pluginId: 'acme-forms', path: '/display-fill', params: { grant: 'g' } }
    const checker = (raw: unknown) => ((raw as { pluginId?: string })?.pluginId === 'acme-forms' ? screen : null)
    expect(
      sanitizePosDisplayState({ mode: 'screen', promptId: 's1', screen: { ...screen, extra: 1 } }, 1, { screen: checker }),
    ).toEqual({ mode: 'screen', updatedAtMs: 1, promptId: 's1', screen })
    // No checker, a refused screen, or no prompt: nothing opens.
    expect(sanitizePosDisplayState({ mode: 'screen', promptId: 's1', screen }, 1).mode).toBe('idle')
    expect(
      sanitizePosDisplayState({ mode: 'screen', promptId: 's1', screen: { pluginId: 'other' } }, 1, { screen: checker }),
    ).toEqual({ mode: 'idle', updatedAtMs: 1, promptId: 's1' })
    expect(sanitizePosDisplayState({ mode: 'screen', screen }, 1, { screen: checker }).mode).toBe('idle')
  })

  it('keeps a screen on the display until staff close it: no timer (AGL-4042)', () => {
    const state = { mode: 'screen' as const, updatedAtMs: 0, promptId: 's1', screen: { pluginId: 'a', path: '/b', params: {} } }
    expect(posDisplayPublicState(state, 60_000).mode).toBe('screen')
    expect(posDisplayPublicState(state, 31 * 60 * 1000).mode).toBe('screen')
    expect(posDisplayPublicState(state, 24 * 60 * 60 * 1000).mode).toBe('screen')
  })
})
