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

import { posReturnLineValues } from '../model/commerce-pos-ops'
import { posOpsHarness, type PosOpsHarness } from '../testing/pos-ops-harness'
import { mintPosAssertion } from './pos-ops-gate'
import { handlePosReturn, type PosReturnDeps, type PosReturnSideEffects } from './pos-return'
import { handlePosShift } from './pos-shift'

jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: {} }))
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({ resolveOrgPermissions: jest.fn() }))
jest.mock('./gift-card-risk', () => ({ applyGiftCardRiskToOrder: jest.fn() }))
jest.mock('./order-notifications', () => ({ notifyOrderBuyer: jest.fn() }))
jest.mock('@aglyn/aglyn/plugin-manager/plugin-conversion-credit', () => ({ reverseOrderConversion: jest.fn() }))

/**
 * Returns at the register (AGL-3609): the refund goes back to the sale's own
 * payments — a card through Stripe, cash out of the drawer, a gift card
 * re-credited, a room charge reversed — the units go back on the register's
 * shelf, a cashier is held to the refund limit unless a manager's PIN stands
 * behind them, and a retry, a race or a refusal never moves money twice.
 *
 * Stripe is the harness's counted fetch; nothing reaches the network.
 */

let h: PosOpsHarness
let deps: PosReturnDeps
let effects: PosReturnSideEffects[]
let keySeq = 0
const ORIGINAL_STRIPE_KEY = process.env.STRIPE_SECRET_KEY

/** Items 61.00, 10% off, 8% tax: 54.90 + 4.39 = 59.29, paid 29.29 cash + 30.00 card. */
const SALE = {
  number: 1001,
  channel: 'pos',
  status: 'paid',
  registerId: 'front',
  customerEmail: 'dana@acme.com',
  customerEmailLower: 'dana@acme.com',
  createdAtMs: 1_799_000_000_000,
  lineItems: [
    { productId: 'p-mug', variantId: 'v1', name: 'Mug', unitAmountCents: 1200, quantity: 3 },
    { productId: 'p-tee', name: 'Tee', unitAmountCents: 2500, quantity: 1 },
  ],
  totals: { itemsCents: 6100, discountCents: 610, taxCents: 439, totalCents: 5929, feeCents: 0 },
  payments: [
    { id: 'pay-cash', method: 'cash', amountCents: 2929, status: 'succeeded', cashTenderedCents: 3000, changeCents: 71 },
    { id: 'pay-card', method: 'card_present', amountCents: 3000, status: 'succeeded', paymentIntentId: 'pi_card', last4: '4242', cardBrand: 'visa' },
  ],
}

const ret = (body: Record<string, unknown>, uid = 'cashier', key: string | null = `key-${++keySeq}`) =>
  handlePosReturn(
    deps,
    h.request(uid, { hostId: 'shop', registerId: 'front', action: 'refund', orderId: 'o1', ...body }, key ? { 'idempotency-key': key } : {}),
  )

const order = () => h.memory.read('hosts/shop/orders/o1')!

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_x'
  h = posOpsHarness()
  effects = []
  deps = { ...h.deps, afterRefund: async (input) => void effects.push(input) }
  h.config['posRefundLimit'] = 100
  h.memory.seed('hosts/shop/orders/o1', SALE)
  h.memory.seed('hosts/shop/products/p-mug', {
    name: 'Mug',
    variants: [{ id: 'v1', priceUsd: 12, inventory: 5, inventoryByLocation: { 'loc-1': 2, 'loc-2': 3 } }],
  })
  h.memory.seed('hosts/shop/products/p-tee', { name: 'Tee', variants: [{ id: 'default', priceUsd: 25 }] })
  h.memory.seed('hosts/other/orders/o-theirs', { ...SALE, number: 1 })
})

afterAll(() => {
  process.env.STRIPE_SECRET_KEY = ORIGINAL_STRIPE_KEY
})

describe('finding the order', () => {
  const find = (text: string, hostId = 'shop') =>
    handlePosReturn(deps, h.request('cashier', { hostId, action: 'find', text }))

  it('finds it by number, by the scanned barcode, by email and by id', async () => {
    for (const text of ['1001', '#1001', 'Dana@Acme.com', 'o1']) {
      const found = (await find(text)).body['orders'] as Array<{ id: string }>
      expect(found.map((entry) => entry.id)).toEqual(['o1'])
    }
  })

  it('lists each line with what is left to return, and each payment with what it can take back', async () => {
    const [summary] = (await find('1001')).body['orders'] as Array<Record<string, any>>
    expect(summary!['lines'].map((line: any) => [line.name, line.quantity, line.returned])).toEqual([
      ['Mug', 3, 0],
      ['Tee', 1, 0],
    ])
    expect(summary!['tenders'].map((tender: any) => [tender.label, tender.refundableCents])).toEqual([
      ['Cash', 2929],
      ['Visa •• 4242', 3000],
    ])
  })

  it("never finds another site's order", async () => {
    expect((await find('o-theirs')).body['orders']).toEqual([])
    expect((await ret({ orderId: 'o-theirs', lines: [{ index: 0, quantity: 1 }] })).status).toBe(404)
  })
})

describe('refunding a return', () => {
  it('sends the value of the returned units back to the card first, and restocks the register location', async () => {
    const lineValue = posReturnLineValues(SALE)[0]!
    const oneMug = Math.round(lineValue / 3)
    const outcome = await ret({ lines: [{ index: 0, quantity: 1 }] })
    expect(outcome.status).toBe(200)
    expect(outcome.body['refundedCents']).toBe(oneMug)
    expect(h.stripeCalls).toHaveLength(1)
    const call = h.stripeCalls[0]!
    expect(call.url).toBe('https://api.stripe.com/v1/refunds')
    expect(call.body.get('payment_intent')).toBe('pi_card')
    expect(call.body.get('amount')).toBe(String(oneMug))
    expect(call.body.get('reverse_transfer')).toBe('true')
    expect(call.body.get('refund_application_fee')).toBe('true')
    expect(call.idempotencyKey).toMatch(/:pay-card$/)
    expect(order()['refundedCents']).toBe(oneMug)
    expect(order()['returnedQuantities']).toEqual({ '0': 1 })
    expect(order()['posPaymentRefunds']).toEqual({ 'pay-card': oneMug })
    const mug = h.memory.read('hosts/shop/products/p-mug')!
    expect(mug['variants'][0].inventoryByLocation).toEqual({ 'loc-1': 3, 'loc-2': 3 })
    expect(mug['variants'][0].inventory).toBe(6)
    const adjustments = [...h.memory.docs.entries()].filter(([path]) => path.startsWith('hosts/shop/inventoryAdjustments/'))
    expect(adjustments.map(([, row]) => [row['delta'], row['reason'], row['locationId']])).toEqual([[1, 'refund', 'loc-1']])
    expect(effects).toHaveLength(1)
    expect(effects[0]).toMatchObject({ orderId: 'o1', refundCents: oneMug, closedTheOrder: false, email: 'dana@acme.com' })
  })

  it('splits the money to the tenders the cashier names, and pays cash out of the open drawer', async () => {
    await handlePosShift(h.deps, h.request('cashier', { hostId: 'shop', registerId: 'front', action: 'open', openingFloatCents: 10000 }))
    const value = posReturnLineValues(SALE)[1]!
    const outcome = await ret({
      lines: [{ index: 1, quantity: 1 }],
      tenders: [
        { paymentId: 'pay-cash', amountCents: value - 1000 },
        { paymentId: 'pay-card', amountCents: 1000 },
      ],
    })
    expect(outcome.status).toBe(200)
    expect(outcome.body['cashOutCents']).toBe(value - 1000)
    const shiftId = String(h.memory.read('hosts/shop/registers/front')!['openShiftId'])
    const shift = h.memory.read(`hosts/shop/registers/front/shifts/${shiftId}`)!
    expect(shift['cashEvents']).toEqual([
      expect.objectContaining({ type: 'refund', amountCents: value - 1000, orderId: 'o1', by: 'cashier' }),
    ])
    const returns = [...h.memory.docs.entries()].filter(([path]) => path.startsWith('hosts/shop/registers/front/returns/'))
    expect(returns).toHaveLength(1)
    expect(returns[0]![1]).toMatchObject({ shiftId, refundedCents: value, status: 'refunded', restocked: true })
    // The tee tracks no stock, so nothing moved for it.
    expect(outcome.body['restockedUnits']).toBe(0)
    // The X report sees the cash going out.
    const report = (await handlePosShift(h.deps, h.request('cashier', { hostId: 'shop', registerId: 'front', action: 'x-report' }))).body['report'] as any
    expect(report.cashRefundsCents).toBe(value - 1000)
    expect(report.refundsByTender).toEqual({ cash: value - 1000, card_present: 1000 })
  })

  it('opens the drawer for the cash handed back, keyed on the return, and not for a card-only return', async () => {
    await handlePosShift(h.deps, h.request('cashier', { hostId: 'shop', registerId: 'front', action: 'open', openingFloatCents: 10000 }))
    await ret({ lines: [{ index: 0, quantity: 1 }] })
    expect(h.printed).toEqual([])
    const value = posReturnLineValues(SALE)[1]!
    const outcome = await ret({
      lines: [{ index: 1, quantity: 1 }],
      tenders: [{ paymentId: 'pay-cash', amountCents: value }],
    })
    expect(h.printed).toEqual([
      {
        kind: 'drawer',
        input: {
          hostId: 'shop',
          registerId: 'front',
          reason: 'cash_refund',
          causeId: outcome.body['returnId'],
          createdBy: 'cashier',
        },
      },
    ])
  })

  it('refuses a split that does not add up, or names a payment the sale was not paid with', async () => {
    expect((await ret({ lines: [{ index: 1, quantity: 1 }], tenders: [{ paymentId: 'pay-cash', amountCents: 1 }] })).status).toBe(400)
    expect((await ret({ lines: [{ index: 1, quantity: 1 }], tenders: [{ paymentId: 'pay-other', amountCents: 2500 }] })).status).toBe(400)
    expect((await ret({ lines: [{ index: 0, quantity: 3 }], tenders: [{ paymentId: 'pay-cash', amountCents: posReturnLineValues(SALE)[0]! }] })).status).toBe(400)
    expect(h.stripeCalls).toHaveLength(0)
    expect(order()['refundedCents']).toBeUndefined()
  })

  it('returns a line a unit at a time to exactly what returning it whole refunds, then refuses one more', async () => {
    for (let unit = 0; unit < 3; unit += 1) {
      expect((await ret({ lines: [{ index: 0, quantity: 1 }], restock: false })).status).toBe(200)
    }
    expect(order()['refundedCents']).toBe(posReturnLineValues(SALE)[0])
    expect(order()['refundedLineItemIds']).toEqual([0])
    const again = await ret({ lines: [{ index: 0, quantity: 1 }] })
    expect(again.status).toBe(400)
    expect(again.body['error']).toMatch(/already been returned/)
  })

  it('closes the order as refunded when the last of it comes back', async () => {
    const outcome = await ret({ lines: [{ index: 0, quantity: 3 }, { index: 1, quantity: 1 }] }, 'owner')
    expect(outcome.status).toBe(200)
    expect(outcome.body['refundedCents']).toBe(5929)
    expect(order()['status']).toBe('refunded')
    expect(effects[0]).toMatchObject({ closedTheOrder: true, fullyRefunded: true })
    // Card first: 30.00 to the card, the rest from the drawer.
    expect(h.stripeCalls[0]!.body.get('amount')).toBe('3000')
    expect(outcome.body['cashOutCents']).toBe(2929)
  })

  it('replays a retried tap instead of refunding twice', async () => {
    const first = await ret({ lines: [{ index: 0, quantity: 1 }] }, 'cashier', 'same-key')
    const second = await ret({ lines: [{ index: 0, quantity: 1 }] }, 'cashier', 'same-key')
    expect(second).toEqual(first)
    expect(h.stripeCalls).toHaveLength(1)
    expect(order()['returnedQuantities']).toEqual({ '0': 1 })
  })

  it('refuses a refund with no idempotency key', async () => {
    expect((await ret({ lines: [{ index: 0, quantity: 1 }] }, 'cashier', null)).status).toBe(400)
  })

  it('lets exactly one of two registers return the last unit', async () => {
    await ret({ lines: [{ index: 0, quantity: 2 }], restock: false })
    const [a, b] = await Promise.all([
      ret({ lines: [{ index: 0, quantity: 1 }], restock: false }),
      ret({ lines: [{ index: 0, quantity: 1 }], restock: false, registerId: 'back' }),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(order()['returnedQuantities']).toEqual({ '0': 3 })
  })
})

describe('the refund limit and the manager PIN', () => {
  it('holds a cashier to the limit and names the manager approval it needs', async () => {
    h.config['posRefundLimit'] = 10
    const refused = await ret({ lines: [{ index: 1, quantity: 1 }] })
    expect(refused.status).toBe(403)
    expect(refused.body).toMatchObject({ needsManager: true, limitCents: 1000 })
    expect(h.stripeCalls).toHaveLength(0)
  })

  it("defaults to a manager's PIN for every cashier refund", async () => {
    delete h.config['posRefundLimit']
    const refused = await ret({ lines: [{ index: 0, quantity: 1 }] })
    expect(refused.status).toBe(403)
    expect(refused.body['error']).toMatch(/need a manager/)
  })

  it("takes a workspace admin's PIN for that register, and records who approved", async () => {
    h.config['posRefundLimit'] = 0
    const { token } = mintPosAssertion(h.deps, { hostId: 'shop', registerId: 'front', memberUid: 'owner', purpose: 'manager' })
    const outcome = await ret({ lines: [{ index: 1, quantity: 1 }], managerAssertion: token })
    expect(outcome.status).toBe(200)
    const [, record] = [...h.memory.docs.entries()].find(([path]) => path.startsWith('hosts/shop/registers/front/returns/'))!
    expect(record['approvedBy']).toBe('owner')
    expect(record['cashierId']).toBe('cashier')
  })

  it("refuses a cashier's own PIN as a manager's, and a manager PIN for another register", async () => {
    h.config['posRefundLimit'] = 0
    const cashierAsManager = mintPosAssertion(h.deps, { hostId: 'shop', registerId: 'front', memberUid: 'cashier', purpose: 'manager' })
    expect((await ret({ lines: [{ index: 1, quantity: 1 }], managerAssertion: cashierAsManager.token })).status).toBe(403)
    const otherRegister = mintPosAssertion(h.deps, { hostId: 'shop', registerId: 'back', memberUid: 'owner', purpose: 'manager' })
    expect((await ret({ lines: [{ index: 1, quantity: 1 }], managerAssertion: otherRegister.token })).status).toBe(403)
  })

  it('lets a workspace admin refund without a limit, but not a cashier PIN-switched onto their device', async () => {
    h.config['posRefundLimit'] = 0
    expect((await ret({ lines: [{ index: 1, quantity: 1 }] }, 'owner')).status).toBe(200)
    const { token } = mintPosAssertion(h.deps, { hostId: 'shop', registerId: 'front', memberUid: 'cashier', purpose: 'cashier' })
    expect((await ret({ lines: [{ index: 0, quantity: 1 }], cashierAssertion: token }, 'owner')).status).toBe(403)
  })
})

describe('each tender gets its own money back', () => {
  it('re-credits a gift card, and refuses a voided one without moving anything', async () => {
    h.memory.seed('hosts/shop/orders/o1', {
      ...SALE,
      payments: [{ id: 'pay-gift', method: 'gift_card', amountCents: 5929, status: 'succeeded', giftCardId: 'GIFT-ABCD-1234' }],
    })
    h.memory.seed('hosts/shop/giftCards/GIFT-ABCD-1234', { balanceCents: 100 })
    const value = posReturnLineValues(SALE)[1]!
    expect((await ret({ lines: [{ index: 1, quantity: 1 }] })).status).toBe(200)
    expect(h.memory.read('hosts/shop/giftCards/GIFT-ABCD-1234')!['balanceCents']).toBe(100 + value)
    h.memory.seed('hosts/shop/giftCards/GIFT-ABCD-1234', { balanceCents: 0, voidedAtMs: 1 })
    const refused = await ret({ lines: [{ index: 0, quantity: 1 }] })
    expect(refused.status).toBe(409)
    expect(order()['returnedQuantities']).toEqual({ '1': 1 })
    expect(order()['refundedCents']).toBe(value)
  })

  it('reverses a room charge on the stay folio', async () => {
    h.memory.seed('hosts/shop/orders/o1', {
      ...SALE,
      payments: [{ id: 'pay-room', method: 'folio', amountCents: 5929, status: 'succeeded', reservationId: 'res-1' }],
    })
    h.memory.seed('hosts/shop/reservations/res-1', { folio: [{ orderId: 'o1', amountCents: 5929, atMs: 1 }] })
    const value = posReturnLineValues(SALE)[1]!
    expect((await ret({ lines: [{ index: 1, quantity: 1 }] })).status).toBe(200)
    const folio = h.memory.read('hosts/shop/reservations/res-1')!['folio'] as Array<{ amountCents: number }>
    expect(folio.map((entry) => entry.amountCents)).toEqual([5929, -value])
  })

  it('refunds a legacy cash sale (no payment ledger) from the drawer', async () => {
    const { payments: _payments, ...legacy } = SALE
    h.memory.seed('hosts/shop/orders/o1', legacy)
    const outcome = await ret({ lines: [{ index: 1, quantity: 1 }] })
    expect(outcome.status).toBe(200)
    expect(outcome.body['tenders']).toEqual([expect.objectContaining({ method: 'cash', status: 'refunded' })])
    expect(h.stripeCalls).toHaveLength(0)
  })

  it('refuses cash out of the drawer when the site requires a shift and none is open', async () => {
    h.config['posRequireOpenShift'] = true
    const outcome = await ret({ lines: [{ index: 1, quantity: 1 }], tenders: [{ paymentId: 'pay-cash', amountCents: posReturnLineValues(SALE)[1]! }] })
    expect(outcome.status).toBe(409)
    expect(order()['refundedCents']).toBeUndefined()
  })
})

describe('when Stripe says no', () => {
  it('hands the whole reservation back when the first refund fails, so the same return can be tried again', async () => {
    h.stripeReplies.push({ status: 402, body: { error: { code: 'insufficient_funds', message: 'Not enough balance' } } })
    const failed = await ret({ lines: [{ index: 0, quantity: 1 }] }, 'cashier', 'retry-key')
    expect(failed.status).toBe(502)
    expect(failed.body['error']).toBe('Not enough balance')
    expect(order()['refundedCents']).toBe(0)
    expect(order()['returnedQuantities']).toEqual({})
    expect(h.memory.read('hosts/shop/products/p-mug')!['variants'][0].inventory).toBe(5)
    expect((await ret({ lines: [{ index: 0, quantity: 1 }] }, 'cashier', 'retry-key')).status).toBe(200)
  })

  it('names a disputed charge', async () => {
    h.stripeReplies.push({ status: 400, body: { error: { code: 'charge_disputed' } } })
    const failed = await ret({ lines: [{ index: 0, quantity: 1 }] })
    expect(failed.status).toBe(409)
    expect(failed.body['error']).toMatch(/disputed/)
  })

  it('records a partial return when a second card fails after the first went back', async () => {
    h.memory.seed('hosts/shop/orders/o1', {
      ...SALE,
      payments: [
        { id: 'pay-a', method: 'card_present', amountCents: 3000, status: 'succeeded', paymentIntentId: 'pi_a' },
        { id: 'pay-b', method: 'card_keyed', amountCents: 2929, status: 'succeeded', paymentIntentId: 'pi_b' },
      ],
    })
    h.stripeReplies.push({ status: 200, body: { id: 're_a' } }, { status: 402, body: { error: { message: 'Card closed' } } })
    const outcome = await ret({ lines: [{ index: 0, quantity: 3 }, { index: 1, quantity: 1 }] }, 'owner')
    expect(outcome.status).toBe(200)
    expect(outcome.body).toMatchObject({ partial: true, refundedCents: 3000, outstandingCents: 2929 })
    expect(order()['refundedCents']).toBe(3000)
    expect(order()['posPaymentRefunds']).toEqual({ 'pay-a': 3000, 'pay-b': 0 })
    expect(order()['status']).toBe('paid')
  })

  it('refuses an order under an open chargeback before asking Stripe', async () => {
    h.memory.seed('hosts/shop/orders/o1', { ...SALE, dispute: { id: 'dp_1', status: 'needs_response' } })
    expect((await ret({ lines: [{ index: 0, quantity: 1 }] }, 'owner')).status).toBe(409)
    expect(h.stripeCalls).toHaveLength(0)
  })
})
