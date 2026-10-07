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
  buildPosReceipt,
  computePosShiftReport,
  planPosReturn,
  posCashVarianceCents,
  posExpectedCashCents,
  posOrderTenders,
  posPinProblem,
  posRefundableByTender,
  posReturnLineValues,
  posShiftsCsv,
  splitPosRefund,
  type PosShift,
} from './commerce-pos-ops'
import { posOpsSettings } from '../pos-ops-config'

/** The register's arithmetic (AGL-3609), each formula against worked numbers. */

describe('the drawer', () => {
  it('expects float + cash sales + paid in − paid out − drops − cash refunds', () => {
    expect(
      posExpectedCashCents({
        openingFloatCents: 20000,
        cashSalesCents: 15475,
        paidInCents: 1000,
        paidOutCents: 2350,
        dropsCents: 10000,
        cashRefundsCents: 1299,
      }),
    ).toBe(20000 + 15475 + 1000 - 2350 - 10000 - 1299)
  })

  it('reads variance as counted − expected: over is positive, short is negative', () => {
    expect(posCashVarianceCents(22826, 22826)).toBe(0)
    expect(posCashVarianceCents(23000, 22826)).toBe(174)
    expect(posCashVarianceCents(22800, 22826)).toBe(-26)
  })

  it('counts a cash tip into the drawer and leaves change out of the sale', () => {
    const report = computePosShiftReport({
      shift: { openingFloatCents: 5000, cashEvents: [] },
      sales: [
        {
          status: 'paid',
          totals: { totalCents: 1800, tipCents: 200 },
          payments: [{ id: 'p', method: 'cash', amountCents: 1800, tipCents: 200, cashTenderedCents: 2500, changeCents: 500, status: 'succeeded' }],
        },
      ],
      refunds: [],
    })
    expect(report.cashSalesCents).toBe(2000)
    expect(report.expectedCashCents).toBe(7000)
    expect(report.tipsCents).toBe(200)
  })
})

describe('reading the tender ledger', () => {
  it('reads only payments that succeeded', () => {
    const tenders = posOrderTenders({
      payments: [
        { id: 'a', method: 'card_present', amountCents: 1000, status: 'failed' },
        { id: 'b', method: 'gift_card', amountCents: 500, status: 'succeeded', giftCardId: 'G' },
        { id: 'c', method: 'cash', amountCents: 500, status: 'reversed' },
        { id: 'd', method: 'bitcoin', amountCents: 500, status: 'succeeded' },
      ],
    })
    expect(tenders.map((tender) => tender.id)).toEqual(['b'])
  })

  it('infers one payment for an order before the ledger', () => {
    expect(posOrderTenders({ channel: 'pos', status: 'paid', totals: { totalCents: 900 } })[0]).toMatchObject({ method: 'cash', amountCents: 900 })
    expect(posOrderTenders({ channel: 'pos', status: 'paid', reservationId: 'r', totals: { totalCents: 900 } })[0]!.method).toBe('folio')
    expect(posOrderTenders({ channel: 'pos', status: 'paid', checkoutSessionId: 'cs', totals: { totalCents: 900 } })[0]!.method).toBe('card_link')
    expect(posOrderTenders({ channel: 'online', status: 'paid', paymentIntentId: 'pi', totals: { totalCents: 900 } })[0]).toMatchObject({ method: 'card_link', paymentIntentId: 'pi' })
    expect(posOrderTenders({ channel: 'pos', status: 'pending', totals: { totalCents: 900 } })).toEqual([])
  })
})

describe('a return', () => {
  const ORDER = {
    lineItems: [
      { name: 'Mug', unitAmountCents: 1000, quantity: 3 },
      { name: 'Tee', unitAmountCents: 2000, quantity: 1 },
    ],
    totals: { discountCents: 500, taxCents: 360, totalCents: 4860 },
  }

  it('values each line with its share of the discount and of the tax, adding to the total', () => {
    const values = posReturnLineValues(ORDER)
    expect(values.reduce((sum, cents) => sum + cents, 0)).toBe(4860)
  })

  it('refunds a line unit by unit to exactly the whole line', () => {
    let order: typeof ORDER & { refundedCents?: number; returnedQuantities?: Record<string, number> } = { ...ORDER }
    let total = 0
    for (let unit = 0; unit < 3; unit += 1) {
      const plan = planPosReturn(order, [{ index: 0, quantity: 1 }])
      if ('error' in plan) throw new Error(plan.error)
      total += plan.refundCents
      order = { ...order, refundedCents: total, returnedQuantities: plan.returnedQuantities }
      if (unit === 2) expect(plan.completedLines).toEqual([0])
    }
    expect(total).toBe(posReturnLineValues(ORDER)[0])
  })

  it('refuses more than is left, a line twice, a fraction and a line that is not there', () => {
    expect(planPosReturn(ORDER, [{ index: 0, quantity: 4 }])).toMatchObject({ ok: false })
    expect(planPosReturn(ORDER, [{ index: 0, quantity: 1 }, { index: 0, quantity: 1 }])).toMatchObject({ ok: false })
    expect(planPosReturn(ORDER, [{ index: 0, quantity: 1.5 }])).toMatchObject({ ok: false })
    expect(planPosReturn(ORDER, [{ index: 7, quantity: 1 }])).toMatchObject({ ok: false })
    expect(planPosReturn(ORDER, [])).toMatchObject({ ok: false })
    expect(planPosReturn({ ...ORDER, refundedLineItemIds: [1] }, [{ index: 1, quantity: 1 }])).toMatchObject({ ok: false })
  })

  it('caps the refund at what the order has left after a refund from the dialog', () => {
    const plan = planPosReturn({ ...ORDER, refundedCents: 4800 }, [{ index: 1, quantity: 1 }])
    expect(plan).toMatchObject({ ok: true, refundCents: 60 })
  })
})

describe('splitting a refund over the payments', () => {
  const ORDER = {
    totals: { totalCents: 6000 },
    payments: [
      { id: 'cash', method: 'cash', amountCents: 2000, status: 'succeeded' },
      { id: 'gift', method: 'gift_card', amountCents: 1000, status: 'succeeded', giftCardId: 'G' },
      { id: 'card', method: 'card_present', amountCents: 3000, status: 'succeeded', paymentIntentId: 'pi' },
    ],
  }

  it('sends it to the card first, then store credit, and the drawer last', () => {
    const split = splitPosRefund(ORDER, 4500)
    expect(split).toEqual({
      ok: true,
      allocations: [
        { paymentId: 'card', method: 'card_present', amountCents: 3000 },
        { paymentId: 'gift', method: 'gift_card', amountCents: 1000 },
        { paymentId: 'cash', method: 'cash', amountCents: 500 },
      ],
    })
  })

  it('subtracts what earlier returns sent to each payment, and a dialog refund from the card', () => {
    const tenders = posRefundableByTender({ ...ORDER, refundedCents: 1500, posPaymentRefunds: { cash: 500 } })
    expect(Object.fromEntries(tenders.map((tender) => [tender.id, tender.refundableCents]))).toEqual({
      cash: 1500,
      gift: 1000,
      card: 2000,
    })
  })

  it("refuses a split that overdraws a payment or misses the total", () => {
    expect(splitPosRefund(ORDER, 1000, [{ paymentId: 'gift', amountCents: 1500 }])).toMatchObject({ ok: false })
    expect(splitPosRefund(ORDER, 1000, [{ paymentId: 'cash', amountCents: 900 }])).toMatchObject({ ok: false })
    expect(splitPosRefund(ORDER, 7000)).toMatchObject({ ok: false })
  })
})

describe('staff PINs', () => {
  it('takes 4 to 6 digits that are not a guess', () => {
    expect(posPinProblem('2580')).toBeNull()
    expect(posPinProblem('904213')).toBeNull()
    for (const weak of ['', '123', '1234567', '0000', '999999', '1234', '3456', '6543', 'abcd', 12345]) {
      expect(posPinProblem(weak)).not.toBeNull()
    }
  })
})

describe('settings', () => {
  it('reads the refund limit in cents and bounds every value', () => {
    expect(posOpsSettings({ posRefundLimit: 25.5, posAutoLockMinutes: 9999, posRequireOpenShift: true })).toMatchObject({
      refundLimitCents: 2550,
      autoLockMinutes: 240,
      requireOpenShift: true,
    })
    expect(posOpsSettings({})).toMatchObject({ refundLimitCents: 0, autoLockMinutes: 0, requireOpenShift: false })
  })
})

describe('the receipt', () => {
  const ORDER = {
    number: 1042,
    createdAtMs: 0,
    customerName: 'Dana',
    lineItems: [{ name: 'Mug', variantLabel: 'Blue', unitAmountCents: 1200, quantity: 2 }],
    totals: { itemsCents: 2400, discountCents: 240, taxCents: 173, totalCents: 2333, tipCents: 300 },
    payments: [
      { id: 'a', method: 'card_present', amountCents: 1333, tipCents: 300, status: 'succeeded', last4: '4242', cardBrand: 'visa' },
      { id: 'b', method: 'cash', amountCents: 1000, cashTenderedCents: 2000, changeCents: 1000, status: 'succeeded' },
    ],
  }
  const store = { name: 'Corner Shop', address: '1 Main St\nSpringfield', footer: 'Thanks!', returnPolicy: '30 days' }

  it('prints the sale, its tenders, the tip and the change', () => {
    const receipt = buildPosReceipt({ orderId: 'o1', order: ORDER, store, cashierName: 'Cal', registerName: 'Front', formatDate: () => 'today' })
    expect(receipt).toMatchObject({
      orderNumber: '#1042',
      barcodeValue: '1042',
      addressLines: ['1 Main St', 'Springfield'],
      subtotalCents: 2400,
      discountCents: 240,
      taxCents: 173,
      totalCents: 2333,
      tipCents: 300,
      changeCents: 1000,
      // The cash line prints what was handed over; the change prints below.
      tenders: [
        { label: 'visa **** 4242', amountCents: 1633 },
        { label: 'Cash', amountCents: 2000 },
      ],
      cashierName: 'Cal',
      registerName: 'Front',
      footer: 'Thanks!',
      returnPolicy: '30 days',
      gift: false,
    })
  })

  it('prints a gift receipt with the items and the barcode, and no money', () => {
    const receipt = buildPosReceipt({ orderId: 'o1', order: ORDER, store, gift: true })
    expect(receipt.lines).toEqual([{ name: 'Mug', variantLabel: 'Blue', quantity: 2, unitAmountCents: 0, lineCents: 0 }])
    expect(receipt).toMatchObject({ totalCents: 0, taxCents: 0, tipCents: 0, changeCents: 0, tenders: [], barcodeValue: '1042', gift: true })
  })
})

describe('the shift history export', () => {
  it('writes one row per shift in dollars, and never a formula', () => {
    const shift: PosShift & { id: string } = {
      id: 's1',
      hostId: 'h',
      registerId: 'r',
      status: 'closed',
      openedBy: 'u1',
      openedAtMs: Date.UTC(2026, 9, 6, 14),
      openingFloatCents: 10000,
      cashEvents: [],
      closedBy: 'u1',
      closedAtMs: Date.UTC(2026, 9, 6, 22),
      countedCashCents: 13800,
      expectedCashCents: 13860,
      varianceCents: -60,
      report: computePosShiftReport({ shift: { openingFloatCents: 10000, cashEvents: [] }, sales: [], refunds: [] }),
    }
    const csv = posShiftsCsv([{ ...shift, registerName: '=HYPERLINK("x")' }], () => 'Cal')
    const [header, row] = csv.split('\r\n')
    expect(header!.split(',')[0]).toBe('Shift')
    expect(row).toContain(`"'=HYPERLINK(""x"")"`)
    expect(row).toContain('138.00')
    expect(row).toContain('-0.60')
  })
})
