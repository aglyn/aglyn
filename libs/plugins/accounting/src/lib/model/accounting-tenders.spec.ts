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
 * HOW A SALE WAS PAID (AGL-3614): every tender lands where its money really
 * is. Card money is paid into clearing and leaves it with the payout; cash, a
 * room charge and a marketplace's sale move on from clearing to the account
 * that money sits in; a gift card spent comes off the gift card liability;
 * store credit is a discount; a tip is its own line. The daily summary posts
 * the same figures as the per-order documents.
 */

import type { AccountingOrderSnapshot, AccountingRefundSnapshot } from './accounting-sources'
import {
  AccountingTransformError,
  buildFeeDoc,
  buildRefundDoc,
  buildRefundSettlementDoc,
  buildSaleDoc,
  buildSettlementDoc,
  refundPostings,
  salePostings,
  settlementOf,
  type AccountingPosting,
} from './accounting-transforms'
import type { AccountingMapping } from './accounting.types'

const mapping: AccountingMapping = {
  accounts: {
    income: 'inc',
    clearing: 'clr',
    feeExpense: 'fee',
    payoutBank: 'bank',
    taxLiability: 'tax',
    tips: 'tips',
    otherPayments: 'cash',
    giftCards: 'gc',
  },
  taxCodes: { taxed: 'TAX', untaxed: 'NON' },
  syncMode: 'per-order',
  startDate: null,
  timeZone: 'America/Chicago',
}

/** A $50 + $5 tax register sale. */
function sale(overrides: Partial<AccountingOrderSnapshot> = {}): AccountingOrderSnapshot {
  return {
    orgId: 'org-1',
    hostId: 'host-1',
    orderId: 'order-1',
    number: 7,
    currency: 'usd',
    paidAtMs: Date.UTC(2026, 10, 14, 18),
    channel: 'pos',
    customerName: null,
    customerEmail: null,
    lines: [{ name: 'Lunch', quantity: 2, unitAmountCents: 2500 }],
    totals: { itemsCents: 5000, shippingCents: 0, taxCents: 500, discountCents: 0, totalCents: 5500, feeCents: 0 },
    taxInclusive: false,
    taxKey: null,
    ...overrides,
  }
}

const sumLines = (doc: { lines: { amountCents: number }[] }) => doc.lines.reduce((sum, line) => sum + line.amountCents, 0)
const byRole = (postings: AccountingPosting[]) =>
  postings.reduce<Record<string, number>>((acc, posting) => ({ ...acc, [posting.role]: (acc[posting.role] ?? 0) + posting.cents }), {})
const balanced = (postings: AccountingPosting[]) => postings.reduce((sum, posting) => sum + posting.cents, 0)

/** The per-order document and the summary postings agree on what enters clearing. */
function expectSummaryMatchesDoc(order: AccountingOrderSnapshot) {
  const doc = buildSaleDoc(order, mapping)
  const postings = salePostings(order)
  expect(balanced(postings)).toBe(0)
  const fee = buildFeeDoc(order, mapping)?.amountCents ?? 0
  expect(byRole(postings)['clearing']).toBe(doc.totalCents - fee)
  // An exclusive document's lines plus its tax are what it is paid.
  expect(sumLines(doc) + doc.taxCents).toBe(doc.totalCents)
}

describe('a sale with checkout extras', () => {
  const order = sale({
    channel: 'online',
    lines: [{ name: 'Lamp', quantity: 1, unitAmountCents: 4000 }],
    extras: [{ label: 'Shipping protection', amountCents: 500 }],
    totals: { itemsCents: 4000, shippingCents: 0, taxCents: 360, discountCents: 0, totalCents: 4860, feeCents: 146 },
  })

  it('posts each extra as a sales line instead of holding the sale as a mismatch', () => {
    const doc = buildSaleDoc(order, mapping)
    expect(doc.lines.map((line) => [line.description, line.amountCents, line.accountId])).toEqual([
      ['Lamp', 4000, 'inc'],
      ['Shipping protection', 500, 'inc'],
    ])
    expect(doc.totalCents).toBe(4860)
    expect(doc.lines.reduce((sum, line) => sum + line.taxCents, 0)).toBe(360)
    expectSummaryMatchesDoc(order)
  })
})

describe('a register sale', () => {
  it('posts a card tip as its own line to the tips account, and only the fee Stripe took', () => {
    const order = sale({
      totals: { itemsCents: 5000, shippingCents: 0, taxCents: 500, discountCents: 0, totalCents: 5500, feeCents: 999, tipCents: 800 },
      payments: [{ method: 'card_present', amountCents: 5500, tipCents: 800, feeCents: 190 }],
    })
    const doc = buildSaleDoc(order, mapping)
    expect(doc.lines.at(-1)).toMatchObject({ kind: 'tip', amountCents: 800, accountId: 'tips', taxCents: 0, taxCodeId: 'NON' })
    expect(doc.totalCents).toBe(6300)
    expect(buildFeeDoc(order, mapping)?.amountCents).toBe(190)
    expect(buildSettlementDoc(order, mapping)).toBeNull()
    expectSummaryMatchesDoc(order)
  })

  it('posts a tip to sales income when no tips account is chosen', () => {
    const order = sale({ payments: [{ method: 'card_present', amountCents: 5500, tipCents: 300, feeCents: 0 }] })
    const { tips: _tips, ...accounts } = mapping.accounts
    expect(buildSaleDoc(order, { ...mapping, accounts }).lines.at(-1)).toMatchObject({ kind: 'tip', accountId: 'inc' })
  })

  it('moves a cash sale, its tip too, from clearing to the cash account, with no fee', () => {
    const order = sale({ payments: [{ method: 'cash', amountCents: 5500, tipCents: 200, feeCents: 0 }] })
    expect(buildSaleDoc(order, mapping).totalCents).toBe(5700)
    expect(buildFeeDoc(order, mapping)).toBeNull()
    expect(buildSettlementDoc(order, mapping)).toMatchObject({
      kind: 'settlement',
      externalId: expect.stringMatching(/-S$/),
      amountCents: 5700,
      fromAccountId: 'clr',
      toAccountId: 'cash',
      memo: 'Order #7, paid by cash',
    })
    expectSummaryMatchesDoc(order)
  })

  it('splits a sale paid partly by card and partly by room charge', () => {
    const order = sale({
      payments: [
        { method: 'card_present', amountCents: 3000, tipCents: 0, feeCents: 120 },
        { method: 'folio', amountCents: 2500, tipCents: 0, feeCents: 0 },
      ],
    })
    expect(settlementOf(order)).toMatchObject({ stripeCents: 3000, otherCents: 2500, stripeFeeCents: 120 })
    expect(buildSettlementDoc(order, mapping)).toMatchObject({ amountCents: 2500, memo: 'Order #7, paid by room charge' })
    expectSummaryMatchesDoc(order)
  })

  it('takes a gift card spent off the gift card liability rather than into clearing', () => {
    const order = sale({
      payments: [
        { method: 'gift_card', amountCents: 2000, tipCents: 0, feeCents: 0 },
        { method: 'card_present', amountCents: 3500, tipCents: 0, feeCents: 140 },
      ],
    })
    const doc = buildSaleDoc(order, mapping)
    expect(doc.lines.at(-1)).toMatchObject({ kind: 'giftCardSpent', amountCents: -2000, accountId: 'gc', taxCents: 0 })
    expect(doc.totalCents).toBe(3500)
    expect(byRole(salePostings(order))['giftCards']).toBe(2000)
    expect(buildSettlementDoc(order, mapping)).toBeNull()
    expectSummaryMatchesDoc(order)
  })

  it('takes store credit off the sale as a discount', () => {
    const order = sale({
      payments: [
        { method: 'credit', amountCents: 500, tipCents: 0, feeCents: 0 },
        { method: 'card_present', amountCents: 5000, tipCents: 0, feeCents: 0 },
      ],
    })
    const doc = buildSaleDoc(order, mapping)
    expect(doc.lines.at(-1)).toMatchObject({ kind: 'discount', description: 'Paid with store credit', amountCents: -500 })
    expect(doc.totalCents).toBe(5000)
    expectSummaryMatchesDoc(order)
  })

  it('asks for the cash account by name when a cash sale arrives before one is chosen', () => {
    const order = sale({ payments: [{ method: 'cash', amountCents: 5500, tipCents: 0, feeCents: 0 }] })
    const { otherPayments: _cash, ...accounts } = mapping.accounts
    expect(() => buildSettlementDoc(order, { ...mapping, accounts })).toThrow(
      new AccountingTransformError('unmapped', 'Choose the account for cash and other payments in Accounting settings.'),
    )
  })

  it('reads a sale recorded before its tenders as all card, as before', () => {
    expect(settlementOf(sale({ totals: { ...sale().totals, feeCents: 165 } }))).toEqual({
      stripeCents: 5500,
      otherCents: 0,
      giftCardCents: 0,
      creditCents: 0,
      tipCents: 0,
      stripeFeeCents: 165,
    })
  })
})

describe('gift cards sold and spent online', () => {
  it('books a gift card sold as owed, untaxed, beside the taxed goods', () => {
    const order = sale({
      channel: 'online',
      lines: [
        { name: 'Mug', quantity: 1, unitAmountCents: 2000 },
        { name: 'Gift card', quantity: 1, unitAmountCents: 5000, giftCard: true },
      ],
      totals: { itemsCents: 7000, shippingCents: 0, taxCents: 160, discountCents: 0, totalCents: 7160, feeCents: 0 },
    })
    const doc = buildSaleDoc(order, mapping)
    expect(doc.lines[1]).toMatchObject({ kind: 'giftCard', accountId: 'gc', taxCents: 0, taxCodeId: 'NON' })
    expect(doc.lines[0].taxCents).toBe(160)
    expect(byRole(salePostings(order))).toMatchObject({ giftCards: -5000, income: -2000 })
    expectSummaryMatchesDoc(order)
  })

  it('takes the gift card part of a discount off the liability, not off revenue', () => {
    const order = sale({
      channel: 'online',
      giftCardRedeemedCents: 1500,
      totals: { itemsCents: 5000, shippingCents: 0, taxCents: 500, discountCents: 2000, totalCents: 3500, feeCents: 0 },
    })
    const doc = buildSaleDoc(order, mapping)
    expect(doc.lines.filter((line) => line.amountCents < 0).map((line) => [line.kind, line.amountCents, line.accountId])).toEqual([
      ['discount', -500, 'inc'],
      ['giftCardSpent', -1500, 'gc'],
    ])
    expect(doc.totalCents).toBe(3500)
    expect(byRole(salePostings(order))).toMatchObject({ giftCards: 1500, income: -(5000 - 500) })
    expectSummaryMatchesDoc(order)
  })
})

describe('a marketplace sale', () => {
  it('moves the whole sale on from clearing to the account the marketplace pays into', () => {
    const order = sale({ channel: 'marketplace', settledOutsideStripe: true })
    expect(buildFeeDoc(order, mapping)).toBeNull()
    expect(buildSettlementDoc(order, mapping)).toMatchObject({ amountCents: 5500, memo: 'Order #7, paid through a marketplace' })
  })
})

describe('refunds come back the way the sale was paid', () => {
  const refund = (order: AccountingOrderSnapshot, amountCents: number): AccountingRefundSnapshot => ({
    order,
    refundId: 're_1',
    amountCents,
    refundedAtMs: order.paidAtMs + 60_000,
    feeRefundedCents: 0,
  })

  it('pays a cash refund out of clearing and moves it back from the cash account', () => {
    const order = sale({ payments: [{ method: 'cash', amountCents: 5500, tipCents: 0, feeCents: 0 }] })
    const doc = buildRefundDoc(refund(order, 2200), mapping)
    expect(doc.totalCents).toBe(2200)
    expect(buildRefundSettlementDoc(refund(order, 2200), mapping)).toMatchObject({
      kind: 'settlement',
      externalId: expect.stringMatching(/-RS[0-9A-Z]{3}$/),
      amountCents: 2200,
      fromAccountId: 'cash',
      toAccountId: 'clr',
    })
    expect(balanced(refundPostings(refund(order, 2200)))).toBe(0)
  })

  it('puts a gift card share back on the card, not out of clearing', () => {
    const order = sale({
      payments: [
        { method: 'gift_card', amountCents: 2750, tipCents: 0, feeCents: 0 },
        { method: 'card_present', amountCents: 2750, tipCents: 0, feeCents: 0 },
      ],
    })
    const doc = buildRefundDoc(refund(order, 5500), mapping)
    expect(doc.lines.at(-1)).toMatchObject({ kind: 'giftCardSpent', amountCents: -2750, accountId: 'gc' })
    expect(doc.totalCents).toBe(2750)
    const postings = refundPostings(refund(order, 5500))
    expect(balanced(postings)).toBe(0)
    expect(byRole(postings)).toMatchObject({ clearing: -2750, giftCards: -2750 })
  })

  it('hands a tip back on its own line, and refuses more than the sale and tip', () => {
    const order = sale({ payments: [{ method: 'card_present', amountCents: 5500, tipCents: 500, feeCents: 0 }] })
    const doc = buildRefundDoc(refund(order, 6000), mapping)
    expect(doc.lines.map((line) => [line.kind, line.amountCents])).toEqual([
      ['refund', 5000],
      ['tip', 500],
    ])
    expect(doc.taxCents).toBe(500)
    expect(doc.totalCents).toBe(6000)
    expect(balanced(refundPostings(refund(order, 6000)))).toBe(0)
    expect(() => buildRefundDoc(refund(order, 6001), mapping)).toThrow(AccountingTransformError)
  })
})
