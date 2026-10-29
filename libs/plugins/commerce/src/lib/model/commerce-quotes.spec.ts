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
  computeQuoteTotals,
  describeQuoteTax,
  formatQuoteNumber,
  isQuote,
  isUnpaidQuote,
  parseQuoteInput,
  priceQuoteCatalogLine,
  priceQuoteCustomLine,
  quoteDiscountCents,
  quoteDisplayStatus,
  quoteLineAmounts,
  quoteLineRequestFromLine,
  quoteOrderTotals,
  quotePaymentBlockedByApproval,
  quoteRequiresProofApprovalByDefault,
  quoteTaxBasisFromSettings,
  quoteTaxMode,
  type QuoteTotalsLine,
} from './commerce-quotes'
import { ORDER_CHANNEL_LABELS, orderLineProductKey } from './commerce-orders'

/** Quotes (AGL-4093): the pure half every later surface reuses. */

const CANOPY: QuoteTotalsLine = { unitAmountCents: 120_000, quantity: 2 } // $2,400
const INSTALL: QuoteTotalsLine = { unitAmountCents: 30_000, quantity: 1 } // $300, a typed line
const BAG: QuoteTotalsLine = { unitAmountCents: 0, quantity: 2, included: true }

describe('computeQuoteTotals', () => {
  it('adds catalog and custom lines, charges nothing for included ones, and adds shipping', () => {
    const totals = computeQuoteTotals({
      lines: [CANOPY, INSTALL, BAG],
      shippingCents: 4_500,
      tax: { kind: 'none', reason: 'not-collected' },
    })
    expect(totals).toEqual({
      itemsCents: 270_000,
      discountCents: 0,
      shippingCents: 4_500,
      taxCents: 0,
      feeCents: 0,
      totalCents: 274_500,
      taxableCents: 270_000,
      taxAtPayment: false,
    })
  })

  it('charges nothing for an included line even when it carries a price', () => {
    const totals = computeQuoteTotals({
      lines: [{ unitAmountCents: 5_000, quantity: 3, included: true }],
      tax: { kind: 'none', reason: 'not-collected' },
    })
    expect(totals.itemsCents).toBe(0)
    expect(totals.totalCents).toBe(0)
  })

  it('takes a percent discount off before a store rate, and never taxes shipping', () => {
    const totals = computeQuoteTotals({
      lines: [CANOPY, INSTALL],
      discount: { kind: 'percent', pct: 10 },
      shippingCents: 4_500,
      tax: { kind: 'rate', pct: 8.25 },
    })
    // $2,700 − 10% = $2,430 taxable; 8.25% of it is $200.48.
    expect(totals.discountCents).toBe(27_000)
    expect(totals.taxableCents).toBe(243_000)
    expect(totals.taxCents).toBe(20_048)
    expect(totals.totalCents).toBe(270_000 - 27_000 + 4_500 + 20_048)
  })

  it('leaves a tax-exempt line out of the taxable base, with its share of the discount', () => {
    const totals = computeQuoteTotals({
      lines: [
        { unitAmountCents: 10_000, quantity: 1 },
        { unitAmountCents: 10_000, quantity: 1, taxExempt: true },
      ],
      discount: { kind: 'amount', amountCents: 2_000 },
      tax: { kind: 'rate', pct: 10 },
    })
    // The $20 discount splits $10 / $10, so $90 of the taxable line is taxed.
    expect(totals.taxableCents).toBe(9_000)
    expect(totals.taxCents).toBe(900)
    expect(totals.totalCents).toBe(20_000 - 2_000 + 900)
  })

  it('takes a tax service figure as given', () => {
    const totals = computeQuoteTotals({
      lines: [INSTALL],
      tax: { kind: 'service', taxCents: 2_475, providerLabel: 'Avalara AvaTax' },
    })
    expect(totals.taxCents).toBe(2_475)
    expect(totals.totalCents).toBe(32_475)
  })

  it('adds no tax under Stripe Tax and says it comes at payment', () => {
    const totals = computeQuoteTotals({ lines: [INSTALL], tax: { kind: 'at-payment' } })
    expect(totals.taxCents).toBe(0)
    expect(totals.taxAtPayment).toBe(true)
    expect(totals.totalCents).toBe(30_000)
  })

  it('adds no tax when the store does not collect it', () => {
    const totals = computeQuoteTotals({ lines: [INSTALL], tax: { kind: 'none', reason: 'not-collected' } })
    expect(totals.taxCents).toBe(0)
    expect(totals.taxAtPayment).toBe(false)
  })

  it('stores the order totals without the quote-only figures', () => {
    const totals = computeQuoteTotals({ lines: [INSTALL], tax: { kind: 'at-payment' } })
    expect(quoteOrderTotals(totals)).toEqual({
      itemsCents: 30_000,
      discountCents: 0,
      shippingCents: 0,
      taxCents: 0,
      feeCents: 0,
      totalCents: 30_000,
    })
  })
})

describe('quote discounts', () => {
  it('caps an amount at the charged lines and rounds a percent to the cent', () => {
    expect(quoteDiscountCents(5_000, { kind: 'amount', amountCents: 9_000 })).toBe(5_000)
    expect(quoteDiscountCents(999, { kind: 'percent', pct: 15 })).toBe(150)
    expect(quoteDiscountCents(999, { kind: 'percent', pct: 150 })).toBe(999)
    expect(quoteDiscountCents(999, null)).toBe(0)
  })

  it('spreads the discount over the charged lines and none over an included one', () => {
    const amounts = quoteLineAmounts([CANOPY, BAG, INSTALL], { kind: 'amount', amountCents: 27_000 })
    expect(amounts.discountCents).toEqual([24_000, 0, 3_000])
    expect(amounts.netCents).toEqual([216_000, 0, 27_000])
    expect(amounts.totalDiscountCents).toBe(27_000)
  })
})

describe('quote tax basis', () => {
  const manual = {
    mode: 'manual' as const,
    origin: { country: 'US', state: 'TX' },
    rates: [
      { country: 'US', state: 'TX', pct: 8.25, label: 'TX sales tax' },
      { country: 'US', state: 'OK', pct: 4.5 },
    ],
  }

  it('reads the store rate for where the quote ships', () => {
    expect(quoteTaxBasisFromSettings(manual, { country: 'US', state: 'OK' })).toEqual({ kind: 'rate', pct: 4.5 })
  })

  it('falls back to the store address when the quote names no ship-to country', () => {
    expect(quoteTaxBasisFromSettings(manual, null)).toEqual({ kind: 'rate', pct: 8.25, label: 'TX sales tax' })
    expect(quoteTaxBasisFromSettings(manual, { state: 'OK' })).toEqual({ kind: 'rate', pct: 8.25, label: 'TX sales tax' })
  })

  it('says when no rate covers the address', () => {
    expect(quoteTaxBasisFromSettings(manual, { country: 'CA' })).toEqual({ kind: 'none', reason: 'no-rate' })
  })

  it('adds nothing when prices already include tax', () => {
    expect(quoteTaxBasisFromSettings({ ...manual, pricesIncludeTax: true }, null)).toEqual({
      kind: 'none',
      reason: 'prices-include-tax',
    })
  })

  it('leaves Stripe Tax to the payment, honors "none" and flags an undecided store', () => {
    expect(quoteTaxBasisFromSettings({ mode: 'stripe' }, null)).toEqual({ kind: 'at-payment' })
    expect(quoteTaxBasisFromSettings({ mode: 'none' }, null)).toEqual({ kind: 'none', reason: 'not-collected' })
    expect(quoteTaxBasisFromSettings(undefined, null)).toEqual({ kind: 'none', reason: 'undecided' })
  })

  it('labels each basis and gives the order its tax mode', () => {
    expect(describeQuoteTax({ kind: 'rate', pct: 8.25, label: 'TX sales tax' })).toBe('TX sales tax (8.25%)')
    expect(describeQuoteTax({ kind: 'at-payment' })).toBe('Tax is added at payment')
    expect(describeQuoteTax({ kind: 'service', taxCents: 1, providerLabel: 'TaxJar' })).toBe('Tax (TaxJar)')
    expect(describeQuoteTax({ kind: 'none', reason: 'undecided' })).toBe('Sales tax is not set up')
    expect(quoteTaxMode({ kind: 'at-payment' }, 0)).toBe('stripe-automatic')
    expect(quoteTaxMode({ kind: 'rate', pct: 8 }, 120)).toBe('manual')
    expect(quoteTaxMode({ kind: 'rate', pct: 8 }, 0)).toBe('none')
    expect(quoteTaxMode({ kind: 'none', reason: 'undecided' }, 0)).toBeUndefined()
  })
})

describe('proof approval before payment', () => {
  it('is off when the quote does not ask for it, or the setting is absent', () => {
    expect(quotePaymentBlockedByApproval(null)).toBe(false)
    expect(quotePaymentBlockedByApproval({ revision: 1, proofs: [{ id: 'p', revision: 1 }] })).toBe(false)
    expect(quoteRequiresProofApprovalByDefault(undefined)).toBe(false)
    expect(quoteRequiresProofApprovalByDefault({})).toBe(false)
    expect(quoteRequiresProofApprovalByDefault({ requireProofApproval: true })).toBe(true)
  })

  it('never holds a payment for a revision with no proof', () => {
    expect(quotePaymentBlockedByApproval({ requireProofApproval: true, revision: 1 })).toBe(false)
    expect(
      quotePaymentBlockedByApproval({ requireProofApproval: true, revision: 2, proofs: [{ id: 'p', revision: 1 }] }),
    ).toBe(false)
  })

  it('holds it until the customer approves the current revision', () => {
    const quote = { requireProofApproval: true, revision: 2, proofs: [{ id: 'p2', revision: 2 }] }
    expect(quotePaymentBlockedByApproval(quote)).toBe(true)
    expect(quotePaymentBlockedByApproval({ ...quote, approvedRevision: 1 })).toBe(true)
    expect(quotePaymentBlockedByApproval({ ...quote, approvedRevision: 2 })).toBe(false)
  })
})

describe('what a quote is', () => {
  it('is an order on the quote channel, unpaid while pending', () => {
    expect(ORDER_CHANNEL_LABELS.quote).toBe('Quote')
    expect(isQuote({ channel: 'quote' })).toBe(true)
    expect(isUnpaidQuote({ channel: 'quote', status: 'pending' })).toBe(true)
    expect(isUnpaidQuote({ channel: 'quote', status: 'paid' })).toBe(false)
    expect(isUnpaidQuote({ channel: 'draft', status: 'pending' })).toBe(false)
  })

  it('is numbered as the order it becomes and shows its stage until paid', () => {
    expect(formatQuoteNumber({ number: 1042 })).toBe('Quote #1042')
    expect(quoteDisplayStatus({ status: 'pending', quote: { stage: 'draft' } })).toEqual({ key: 'draft', label: 'Draft' })
    expect(quoteDisplayStatus({ status: 'pending', quote: { stage: 'changes_requested' } }).label).toBe('Changes requested')
    expect(quoteDisplayStatus({ status: 'fulfilled', quote: { stage: 'approved' } })).toEqual({ key: 'paid', label: 'Paid' })
  })

  it('groups a typed line by its name in reports, never under an empty product id', () => {
    expect(orderLineProductKey({ productId: 'p1', name: 'Canopy' })).toBe('p1')
    expect(orderLineProductKey({ productId: '', name: 'Installation' })).toBe('custom:Installation')
  })
})

describe('parseQuoteInput', () => {
  const custom = { kind: 'custom', name: 'Installation', unitAmountCents: 30_000, quantity: 1 }

  it('keeps what the business typed, trimmed', () => {
    const parsed = parseQuoteInput({
      lines: [
        { kind: 'catalog', productId: 'p1', variantId: 'v1', quantity: 2, modifiers: [{ groupId: 'g', optionId: 'o' }] },
        { ...custom, name: '  Installation  ', sku: ' INST-1 ', ships: false, description: 'On site' },
      ],
      customer: { name: ' Jordan Lee ', email: 'Jordan@Example.com', record: { kind: 'contact', id: 'c1' } },
      shipTo: { line1: '1 Main St', country: 'us', state: 'TX' },
      discount: { kind: 'percent', pct: 12.5 },
      shipping: { amountCents: 4_500 },
      notes: 'Thanks',
      terms: 'Net 30',
      requireProofApproval: true,
    })
    expect(parsed).toEqual({
      ok: true,
      input: {
        lines: [
          { kind: 'catalog', productId: 'p1', variantId: 'v1', quantity: 2, modifiers: [{ groupId: 'g', optionId: 'o' }] },
          {
            kind: 'custom',
            name: 'Installation',
            description: 'On site',
            sku: 'INST-1',
            unitAmountCents: 30_000,
            quantity: 1,
            ships: false,
          },
        ],
        customer: {
          record: { kind: 'contact', id: 'c1' },
          name: 'Jordan Lee',
          email: 'Jordan@Example.com',
          emailLower: 'jordan@example.com',
        },
        billTo: null,
        shipTo: { line1: '1 Main St', state: 'TX', country: 'US' },
        notes: 'Thanks',
        terms: 'Net 30',
        discount: { kind: 'percent', pct: 12.5 },
        shipping: { amountCents: 4_500 },
        requireProofApproval: true,
      },
    })
  })

  it('stores an included typed line at no charge', () => {
    const parsed = parseQuoteInput({ lines: [{ ...custom, included: true, unitAmountCents: 99_999 }] })
    expect('input' in parsed && parsed.input.lines[0]).toMatchObject({ unitAmountCents: 0, included: true })
  })

  it.each([
    [{ lines: [] }, 'Add at least one line to the quote.'],
    [{ lines: [{ ...custom, quantity: 0 }] }, 'Line 1: enter a quantity from 1 to 9,999.'],
    [{ lines: [{ ...custom, name: ' ' }] }, 'Line 1: name the item.'],
    [{ lines: [{ ...custom, unitAmountCents: -1 }] }, 'Line 1: enter a price from $0 to $1,000,000.'],
    [{ lines: [{ ...custom, unitAmountCents: 10.5 }] }, 'Line 1: enter a price from $0 to $1,000,000.'],
    [{ lines: [{ kind: 'catalog', productId: '', quantity: 1 }] }, 'Line 1: choose a product.'],
    [{ lines: [{ kind: 'catalog', productId: '__x__', quantity: 1 }] }, 'Line 1: choose a product.'],
    [{ lines: [{ kind: 'other', quantity: 1 }] }, 'Line 1: add a product or type an item.'],
    [{ lines: [custom], customer: { email: 'nope' } }, 'Enter a valid email for the customer.'],
    [{ lines: [custom], discount: { kind: 'percent', pct: 101 } }, 'Enter a discount from 0% to 100%.'],
    [{ lines: [custom], shipping: { amountCents: -5 } }, 'Enter shipping from $0 to $1,000,000.'],
  ])('refuses %j', (raw, error) => {
    expect(parseQuoteInput(raw)).toEqual({ ok: false, error })
  })

  it('refuses more lines than a quote holds', () => {
    expect(parseQuoteInput({ lines: Array.from({ length: 101 }, () => custom) })).toEqual({
      ok: false,
      error: 'A quote holds up to 100 lines.',
    })
  })
})

describe('pricing a quote line', () => {
  const product = {
    name: 'Canopy 10x10',
    type: 'physical' as const,
    variants: [
      { id: 'red', options: { Color: 'Red' }, priceUsd: 1_200, sku: 'CAN-R' },
      { id: 'blank', options: { Color: 'Blank' } },
    ],
    modifierGroups: [
      {
        id: 'walls',
        name: 'Walls',
        min: 0,
        max: 2,
        options: [
          { id: 'back', name: 'Back wall', priceCents: 15_000 },
          { id: 'side', name: 'Side wall', priceCents: 12_000 },
        ],
      },
    ],
  }

  it('prices a product line from the product, add-ons included', () => {
    const priced = priceQuoteCatalogLine(product as never, {
      kind: 'catalog',
      productId: 'p1',
      variantId: 'red',
      quantity: 2,
      modifiers: [{ groupId: 'walls', optionId: 'back' }],
    })
    expect(priced).toEqual({
      ok: true,
      line: {
        productId: 'p1',
        variantId: 'red',
        name: 'Canopy 10x10',
        variantLabel: 'Red / Back wall',
        sku: 'CAN-R',
        productType: 'physical',
        quantity: 2,
        unitAmountCents: 135_000,
        modifiers: [{ groupId: 'walls', optionId: 'back', group: 'Walls', name: 'Back wall', priceCents: 15_000 }],
      },
    })
  })

  it('includes a product at no charge, even one with no price yet', () => {
    const priced = priceQuoteCatalogLine(product as never, {
      kind: 'catalog',
      productId: 'p1',
      variantId: 'blank',
      quantity: 1,
      included: true,
    })
    expect('line' in priced && priced.line).toMatchObject({ unitAmountCents: 0, included: true })
  })

  it('refuses a deleted product, a missing variant, an unpriced variant and an unknown add-on', () => {
    const line = { kind: 'catalog' as const, productId: 'p1', quantity: 1 }
    expect(priceQuoteCatalogLine({ ...product, deletedAt: 1 } as never, line).ok).toBe(false)
    expect(priceQuoteCatalogLine(product as never, { ...line, variantId: 'gone' }).ok).toBe(false)
    expect(priceQuoteCatalogLine(product as never, { ...line, variantId: 'blank' })).toEqual({
      ok: false,
      error: 'Set a price for Canopy 10x10 before quoting it.',
    })
    expect(
      priceQuoteCatalogLine(product as never, { ...line, modifiers: [{ groupId: 'walls', optionId: 'roof' }] }).ok,
    ).toBe(false)
  })

  it('carries a tax-exempt product onto its line', () => {
    const priced = priceQuoteCatalogLine({ ...product, taxExempt: true } as never, {
      kind: 'catalog',
      productId: 'p1',
      quantity: 1,
    })
    expect('line' in priced && priced.line.taxExempt).toBe(true)
  })

  it('stores a typed line with no product, as a service when it does not ship', () => {
    expect(
      priceQuoteCustomLine({ kind: 'custom', name: 'Design', unitAmountCents: 9_000, quantity: 1, ships: false }),
    ).toEqual({ productId: '', custom: true, name: 'Design', productType: 'service', quantity: 1, unitAmountCents: 9_000 })
  })

  it('edits a stored line as the request that made it', () => {
    const custom = priceQuoteCustomLine({ kind: 'custom', name: 'Sign', sku: 'S1', unitAmountCents: 500, quantity: 3 })
    expect(quoteLineRequestFromLine(custom)).toEqual({
      kind: 'custom',
      name: 'Sign',
      sku: 'S1',
      unitAmountCents: 500,
      quantity: 3,
      ships: true,
    })
    const priced = priceQuoteCatalogLine(product as never, {
      kind: 'catalog',
      productId: 'p1',
      variantId: 'red',
      quantity: 1,
      modifiers: [{ groupId: 'walls', optionId: 'side' }],
      included: true,
    })
    expect('line' in priced && quoteLineRequestFromLine(priced.line)).toEqual({
      kind: 'catalog',
      productId: 'p1',
      variantId: 'red',
      quantity: 1,
      modifiers: [{ groupId: 'walls', optionId: 'side' }],
      included: true,
    })
  })
})
