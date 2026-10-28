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

import type { OrderTotals } from '../model'
import { posOfflineCardOrderMoney, type PosOfflineCardSettled } from './pos-offline-card-order'

/**
 * The money on an order for a card taken offline (AGL-4039): the fee it
 * settled, the shortfall it invoices, the order-level intent the refund and
 * the dispute lookup read, and the take an unpaid one keeps for collection.
 */

const totals: OrderTotals = {
  itemsCents: 4900,
  shippingCents: 0,
  taxCents: 353,
  discountCents: 490,
  feeCents: 0,
  totalCents: 4763,
}

const captured = (overrides: Partial<Extract<PosOfflineCardSettled, { kind: 'captured' }>> = {}) =>
  ({
    kind: 'captured',
    intentId: 'pi_offline_1',
    amountCents: 4763,
    feeCents: 256,
    expectedFeeCents: 256,
    takeShareCents: 88,
    livemode: false,
    brand: 'visa',
    last4: '4242',
    ...overrides,
  }) as PosOfflineCardSettled

const money = (settled: PosOfflineCardSettled, feeOrgId = 'org-1') =>
  posOfflineCardOrderMoney({
    settled,
    totals,
    planTakeCents: 88,
    soldAtMs: 1_000,
    nowMs: 5_000,
    cashierId: 'cashier',
    feeOrgId,
  })

describe('posOfflineCardOrderMoney', () => {
  it('records a captured card as an online card sale records it: the intent on the order, the settled fee in the totals', () => {
    const result = money(captured())
    expect(result.status).toBe('paid')
    expect(result.fields).toEqual({
      feeCollection: 'payout',
      paymentIntentId: 'pi_offline_1',
      paymentIntentIds: ['pi_offline_1'],
      paidAtMs: 1_000,
      livemode: false,
    })
    // Take share plus Stripe's processing, exactly the application fee.
    expect(result.totals.feeCents).toBe(256)
    expect(result.payment).toEqual({
      id: 'pay_card_offline',
      method: 'card_present',
      amountCents: 4763,
      status: 'succeeded',
      atMs: 1_000,
      settledAtMs: 5_000,
      takeFeeCents: 88,
      feeCents: 256,
      livemode: false,
      paymentIntentId: 'pi_offline_1',
      cardBrand: 'visa',
      last4: '4242',
      cashierId: 'cashier',
    })
    expect(result.invoiceCents).toBe(0)
    expect(result.flags).toEqual([])
  })

  it('invoices the whole fee of an intent captured with none, and flags it', () => {
    const result = money(captured({ feeCents: 0 }))
    expect(result.invoiceCents).toBe(256)
    expect(result.totals.feeCents).toBe(256)
    expect(result.fields['feeCollection']).toBe('invoice')
    expect(result.payment).toMatchObject({ feeCents: 0, takeFeeCents: 88 })
    expect(result.flags).toEqual(['card-fee-short'])
  })

  it('invoices only the part a short application fee missed, as a split', () => {
    const result = money(captured({ feeCents: 100 }))
    expect(result.invoiceCents).toBe(156)
    expect(result.totals.feeCents).toBe(256)
    expect(result.fields['feeCollection']).toBe('split')
    expect(result.flags).toEqual(['card-fee-short'])
  })

  it('flags a shortfall it cannot invoice for a site with no workspace, and counts only what Stripe kept', () => {
    const result = money(captured({ feeCents: 0 }), '')
    expect(result.invoiceCents).toBe(0)
    expect(result.totals.feeCents).toBe(0)
    expect(result.fields['feeCollection']).toBeUndefined()
    expect(result.flags).toEqual(['card-fee-short'])
  })

  it('records what Stripe took when it is not the server’s total, and flags it', () => {
    const result = money(captured({ amountCents: 4800 }))
    expect(result.payment.amountCents).toBe(4800)
    expect(result.totals.totalCents).toBe(4763)
    expect(result.flags).toEqual(['card-amount-differs'])
  })

  it('leaves an unpaid card pending, with the plan take for the register to collect it by', () => {
    const result = money({
      kind: 'unpaid',
      flag: 'card-declined',
      intentId: 'pi_offline_2',
      message: 'Your card was declined.',
      brand: 'visa',
      last4: '4242',
    })
    expect(result.status).toBe('pending')
    expect(result.fields).toEqual({ posTakeFeeCents: 88, posFeeOrgId: 'org-1' })
    expect(result.fields['paymentIntentId']).toBeUndefined()
    expect(result.totals.feeCents).toBe(0)
    expect(result.payment).toMatchObject({
      status: 'failed',
      amountCents: 4763,
      takeFeeCents: 0,
      feeCents: 0,
      failureMessage: 'Your card was declined.',
      paymentIntentId: 'pi_offline_2',
    })
    expect(result.invoiceCents).toBe(0)
    expect(result.flags).toEqual(['card-declined'])
  })
})
