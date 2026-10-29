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

import type { HostOrder } from './commerce-orders'
import {
  buildQuotePageView,
  paidQuoteOrder,
  quoteCheckoutCharge,
  quoteLinkVersion,
  quotePaymentDisposition,
  quotePayRefusal,
  quotePayRefusalMessage,
  quoteUnmatchedPayment,
  type QuotePaymentFacts,
} from './commerce-quote-pay'

/**
 * Paying a quote (AGL-4094), the pure half: what the customer's page may
 * show, what a payment charges, when a quote cannot be paid, and the order a
 * paid quote becomes.
 */

/** A canopy with an add-on, an installation typed for the job, an exempt sign, a bag included. */
function quote(overrides: Partial<HostOrder> = {}, section: Record<string, unknown> = {}): HostOrder {
  return {
    number: 1042,
    status: 'pending',
    channel: 'quote',
    lineItems: [
      {
        productId: 'canopy',
        variantId: 'red',
        name: 'Canopy 10x10',
        variantLabel: 'Red, Logo print',
        sku: 'CAN-R',
        productType: 'physical',
        quantity: 2,
        unitAmountCents: 120_000,
        description: 'Full-color logo on all four sides',
      },
      {
        productId: '',
        custom: true,
        name: 'Installation',
        productType: 'service',
        quantity: 1,
        unitAmountCents: 30_000,
      },
      {
        productId: 'sign',
        name: 'Sign',
        productType: 'physical',
        quantity: 1,
        unitAmountCents: 10_000,
        taxExempt: true,
      },
      {
        productId: 'bag',
        name: 'Carry bag',
        productType: 'physical',
        quantity: 1,
        unitAmountCents: 0,
        included: true,
      },
    ],
    // Deliberately wrong: nothing here is read for what a payment charges.
    totals: { itemsCents: 1, discountCents: 0, shippingCents: 0, taxCents: 0, feeCents: 0, totalCents: 1 },
    timeline: [{ atMs: 1_000, event: 'quote', detail: 'Quote created by owner@example.com' }],
    checkoutSessionId: 'cs_test_secret_session',
    quote: {
      stage: 'draft',
      revision: 1,
      customer: {
        name: 'Jordan Lee',
        company: 'Lee Events',
        email: 'jordan@example.com',
        emailLower: 'jordan@example.com',
        phone: '+1 512 555 0100',
        record: { kind: 'contact', id: 'c-1' },
      },
      billTo: { name: 'Lee Events', line1: '9 Bill St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US', phone: '+1 512 555 0199' },
      shipTo: { name: 'Jordan Lee', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78702', country: 'US' },
      notes: 'Thanks for asking',
      terms: 'Half up front',
      discount: { kind: 'percent', pct: 10 },
      shipping: { amountCents: 4_500 },
      tax: { kind: 'rate', pct: 8.25, label: 'Texas sales tax' },
      createdAtMs: 1_000,
      updatedAtMs: 2_000,
      createdBy: 'owner@example.com',
      updatedBy: 'editor@example.com',
      ...section,
    } as HostOrder['quote'],
    ...overrides,
  } as HostOrder
}

describe('the link version', () => {
  it('reads absent and junk as the first, and a stored one as itself', () => {
    expect(quoteLinkVersion(undefined)).toBe(1)
    expect(quoteLinkVersion({})).toBe(1)
    expect(quoteLinkVersion({ linkVersion: 0 })).toBe(1)
    expect(quoteLinkVersion({ linkVersion: 'x' as never })).toBe(1)
    expect(quoteLinkVersion({ linkVersion: 3 })).toBe(3)
  })
})

describe('what a payment charges', () => {
  it('prices the goods from the stored lines, taxed and exempt apart, after the discount', () => {
    const charge = quoteCheckoutCharge(quote(), 'q-1')
    // 240,000 + 30,000 + 10,000 = 280,000; 10% off = 28,000, spread by charge.
    expect(charge.itemsCents).toBe(280_000)
    expect(charge.discountCents).toBe(28_000)
    expect(charge.goodsCents).toBe(252_000)
    expect(charge.taxableCents).toBe(243_000)
    expect(charge.lines).toEqual([
      {
        name: 'Quote #1042',
        description: '2 × Canopy 10x10 (Red, Logo print), 1 × Installation',
        amountCents: 243_000,
        taxable: true,
      },
      { name: 'Quote #1042 (tax-exempt items)', description: '1 × Sign', amountCents: 9_000, taxable: false },
    ])
    // The store's rate on exactly the amount the quote taxed: 8.25% of 243,000.
    expect(charge.taxPct).toBe(8.25)
    expect(charge.taxCents).toBe(20_048)
    expect(charge.shippingCents).toBe(4_500)
    expect(charge.totalCents).toBe(252_000 + 4_500 + 20_048)
    expect(charge.feeProductType).toBe('physical')
  })

  it('never sends an included line, and never reads the stored totals', () => {
    const charge = quoteCheckoutCharge(quote(), 'q-1')
    expect(JSON.stringify(charge.lines)).not.toContain('Carry bag')
    expect(charge.totalCents).not.toBe(1)
  })

  it('carries a tax service’s figure as the percentage of the taxed line it amounts to', () => {
    const charge = quoteCheckoutCharge(quote({}, { tax: { kind: 'service', taxCents: 19_000, providerLabel: 'TaxCo' } }), 'q-1')
    expect(charge.taxCents).toBe(19_000)
    expect(charge.taxPct).toBeCloseTo((19_000 / 243_000) * 100, 4)
    expect(Math.round((243_000 * Number(charge.taxPct)) / 100)).toBe(19_000)
  })

  it('charges a tax service’s figure as its own line when no line is taxed', () => {
    const exemptOnly = quote(
      { lineItems: [{ productId: 'sign', name: 'Sign', quantity: 1, unitAmountCents: 10_000, taxExempt: true } as never] },
      { discount: null, tax: { kind: 'service', taxCents: 400, providerLabel: 'TaxCo' } },
    )
    const charge = quoteCheckoutCharge(exemptOnly, 'q-1')
    expect(charge.taxPct).toBeNull()
    expect(charge.lines.at(-1)).toEqual({ name: 'Sales tax (TaxCo)', description: 'Quote #1042', amountCents: 400, taxable: false })
    expect(charge.totalCents).toBe(10_000 + 4_500 + 400)
  })

  it('adds nothing for tax under Stripe Tax, which works it out at payment, or with no tax', () => {
    const atPayment = quoteCheckoutCharge(quote({}, { tax: { kind: 'at-payment' } }), 'q-1')
    expect(atPayment).toMatchObject({ taxAtPayment: true, taxCents: 0, taxPct: null, totalCents: 256_500 })
    const none = quoteCheckoutCharge(quote({}, { tax: { kind: 'none', reason: 'not-collected' } }), 'q-1')
    expect(none).toMatchObject({ taxAtPayment: false, taxCents: 0, taxPct: null, totalCents: 256_500 })
  })

  it('prices the fee as a service when nothing charged ships', () => {
    const work = quote({ lineItems: [{ productId: '', custom: true, name: 'Design', productType: 'service', quantity: 1, unitAmountCents: 5_000 }] })
    expect(quoteCheckoutCharge(work, 'q-1').feeProductType).toBe('service')
  })
})

describe('when a quote cannot be paid', () => {
  it('can be paid as it stands', () => {
    expect(quotePayRefusal(quote(), 'q-1')).toBeNull()
  })

  it('refuses a paid quote, and a closed one', () => {
    expect(quotePayRefusal(quote({ status: 'paid' }), 'q-1')).toBe('paid')
    expect(quotePayRefusal(quote({ status: 'fulfilled' }), 'q-1')).toBe('paid')
    expect(quotePayRefusal(quote({ status: 'cancelled' }), 'q-1')).toBe('closed')
  })

  it('waits on the proof only when the switch is on and this revision has an unapproved proof', () => {
    expect(quotePayRefusal(quote({}, { requireProofApproval: true }), 'q-1')).toBeNull()
    expect(
      quotePayRefusal(quote({}, { requireProofApproval: true, proofs: [{ id: 'p1', revision: 1 }] }), 'q-1'),
    ).toBe('approval-required')
    expect(
      quotePayRefusal(
        quote({}, { requireProofApproval: true, proofs: [{ id: 'p1', revision: 1 }], approvedRevision: 1 }),
        'q-1',
      ),
    ).toBeNull()
    expect(quotePayRefusal(quote({}, { requireProofApproval: false, proofs: [{ id: 'p1', revision: 1 }] }), 'q-1')).toBeNull()
  })

  it('refuses a store that never decided its tax, and a quote with nothing to charge', () => {
    expect(quotePayRefusal(quote({}, { tax: { kind: 'none', reason: 'undecided' } }), 'q-1')).toBe('tax-undecided')
    const free = quote(
      { lineItems: [{ productId: 'bag', name: 'Carry bag', quantity: 1, unitAmountCents: 0, included: true }] },
      { shipping: null },
    )
    expect(quotePayRefusal(free, 'q-1')).toBe('nothing-to-pay')
  })

  it('tells the customer in plain words, naming the business', () => {
    expect(quotePayRefusalMessage('approval-required', 'Acme Tents')).toBe(
      'Acme Tents asks you to approve the proof before you pay.',
    )
    expect(quotePayRefusalMessage('tax-undecided', '')).toMatch(/^the business has not finished/)
  })
})

describe('the customer’s page', () => {
  const view = (order: HostOrder, receiptUrl: string | null = null) =>
    buildQuotePageView({ order, orderId: 'q-1', storeName: 'Acme Tents', currency: 'USD', receiptUrl })

  it('shows the quote and nothing the business keeps for itself', () => {
    const page = view(quote())
    expect(Object.keys(page).sort()).toEqual(
      [
        'approvalRequired',
        'billTo',
        'company',
        'currency',
        'customerName',
        'dateMs',
        'discountLabel',
        'lines',
        'notes',
        'number',
        'payable',
        'paidAtMs',
        'receiptUrl',
        'shipTo',
        'state',
        'status',
        'statusLabel',
        'storeName',
        'taxAtPayment',
        'taxLabel',
        'terms',
        'totals',
        'version',
      ].sort(),
    )
    const wire = JSON.stringify(page)
    for (const secret of [
      'jordan@example.com',
      '+1 512 555 0100',
      '+1 512 555 0199',
      'owner@example.com',
      'editor@example.com',
      'cs_test_secret_session',
      'c-1',
      'Quote created by',
      'canopy',
    ]) {
      expect(wire).not.toContain(secret)
    }
    expect(Object.keys(page.lines[0]).sort()).toEqual(
      ['amountCents', 'description', 'included', 'name', 'quantity', 'sku', 'unitAmountCents', 'variantLabel'].sort(),
    )
    expect(page.billTo).toEqual({
      name: 'Lee Events',
      line1: '9 Bill St',
      line2: null,
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
      country: 'US',
    })
  })

  it('reads the quote as the customer needs it', () => {
    const page = view(quote())
    expect(page).toMatchObject({
      state: 'quote',
      storeName: 'Acme Tents',
      number: 'Quote #1042',
      dateMs: 2_000,
      version: 2_000,
      customerName: 'Jordan Lee',
      company: 'Lee Events',
      discountLabel: '10% off',
      taxLabel: 'Texas sales tax (8.25%)',
      notes: 'Thanks for asking',
      terms: 'Half up front',
      status: 'unpaid',
      statusLabel: 'Unpaid',
      payable: true,
      approvalRequired: false,
      receiptUrl: null,
    })
    expect(page.totals).toEqual({
      itemsCents: 280_000,
      discountCents: 28_000,
      shippingCents: 4_500,
      taxCents: 20_048,
      totalCents: 276_548,
    })
    expect(page.lines[0]).toEqual({
      name: 'Canopy 10x10',
      variantLabel: 'Red, Logo print',
      description: 'Full-color logo on all four sides',
      sku: 'CAN-R',
      quantity: 2,
      unitAmountCents: 120_000,
      amountCents: 240_000,
      included: false,
    })
    expect(page.lines[3]).toMatchObject({ name: 'Carry bag', included: true, amountCents: 0 })
  })

  it('says tax is added at payment under Stripe Tax', () => {
    expect(view(quote({}, { tax: { kind: 'at-payment' } }))).toMatchObject({
      taxAtPayment: true,
      taxLabel: 'Tax is added at payment',
    })
  })

  it('asks for approval in place of Pay when the business requires it', () => {
    const page = view(quote({}, { requireProofApproval: true, proofs: [{ id: 'p1', revision: 1 }] }))
    expect(page).toMatchObject({ approvalRequired: true, payable: false })
  })

  it('shows a paid quote as paid, with its date, the charged totals and the receipt', () => {
    const paid = quote(
      {
        status: 'paid',
        totals: { itemsCents: 280_000, discountCents: 28_000, shippingCents: 4_500, taxCents: 20_048, feeCents: 9_000, totalCents: 276_548 },
      },
      { paidAtMs: 9_000 },
    )
    const page = view(paid, 'https://acme.aglyn.app/order-status?o=q-1&t=abc')
    expect(page).toMatchObject({
      status: 'paid',
      statusLabel: 'Paid',
      paidAtMs: 9_000,
      payable: false,
      receiptUrl: 'https://acme.aglyn.app/order-status?o=q-1&t=abc',
    })
    expect(page.totals.totalCents).toBe(276_548)
    expect(JSON.stringify(page)).not.toContain('feeCents')
  })
})

describe('when a payment completes', () => {
  const facts = (overrides: Partial<QuotePaymentFacts> = {}): QuotePaymentFacts => ({
    sessionId: 'cs_test_paid',
    paymentIntentId: 'pi_1',
    linkVersion: '1',
    quoteUpdatedAtMs: '2000',
    paidAtMs: 50_000,
    email: 'Payer@Example.com',
    name: 'Pat Payer',
    amountTotalCents: 276_548,
    shippingCents: 4_500,
    taxCents: 20_048,
    feeCents: 8_321,
    taxMode: 'manual',
    shippingAddress: null,
    ...overrides,
  })

  it('pays the quote as it stands', () => {
    expect(quotePaymentDisposition(quote(), facts())).toBe('pay')
  })

  it('takes no payment made through a replaced link, or for an earlier edit', () => {
    expect(quotePaymentDisposition(quote({}, { linkVersion: 2 }), facts())).toBe('superseded')
    expect(quotePaymentDisposition(quote({}, { updatedAtMs: 3_000 }), facts())).toBe('superseded')
  })

  it('tells a second payment from Stripe sending the first again', () => {
    const paid = quote({ status: 'paid', checkoutSessionId: 'cs_test_paid', paymentIntentId: 'pi_1' })
    expect(quotePaymentDisposition(paid, facts())).toBe('redelivery')
    expect(quotePaymentDisposition(paid, facts({ sessionId: 'cs_test_other', paymentIntentId: 'pi_2' }))).toBe('already-paid')
    const noted = quote(
      { status: 'paid', checkoutSessionId: 'cs_test_paid' },
      { unmatchedPayments: [quoteUnmatchedPayment(facts({ sessionId: 'cs_test_other' }), 'already-paid')] },
    )
    expect(quotePaymentDisposition(noted, facts({ sessionId: 'cs_test_other', paymentIntentId: 'pi_2' }))).toBe('redelivery')
  })

  it('becomes the order, with every field the order readers ask', () => {
    const order = paidQuoteOrder(quote(), 'q-1', facts())
    expect(order).toMatchObject({
      status: 'paid',
      channel: 'quote',
      number: 1042,
      createdAtMs: 50_000,
      updatedAtMs: 50_000,
      customerEmail: 'Payer@Example.com',
      customerName: 'Jordan Lee',
      customerPhone: '+1 512 555 0100',
      customerRecord: { kind: 'contact', id: 'c-1' },
      shippingAddress: { name: 'Jordan Lee', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78702', country: 'US' },
      billingAddress: { name: 'Lee Events', line1: '9 Bill St' },
      taxMode: 'manual',
      paymentIntentId: 'pi_1',
      checkoutSessionId: 'cs_test_paid',
      totals: {
        itemsCents: 1,
        discountCents: 0,
        shippingCents: 4_500,
        taxCents: 20_048,
        feeCents: 8_321,
        totalCents: 276_548,
      },
      // The list fields (`withOrderListFields`).
      customerEmailLower: 'payer@example.com',
      productIds: ['canopy', 'sign', 'bag'],
      requiresShipping: true,
    })
    expect(order.searchTokens).toEqual(expect.arrayContaining(['#1042', '1042']))
    expect(order.quote).toMatchObject({ paidAtMs: 50_000, stage: 'draft', revision: 1 })
    expect(order.timeline?.at(-1)).toEqual({ atMs: 50_000, event: 'paid', detail: '#1042 paid through its pay link' })
  })

  it('ships to the address Stripe collected, and takes the quote’s email when the payer gave none', () => {
    const order = paidQuoteOrder(
      quote(),
      'q-1',
      facts({ email: null, shippingAddress: { name: 'Pat', line1: '2 Other Rd', country: 'US' } }),
    )
    expect(order.customerEmail).toBe('jordan@example.com')
    expect(order.shippingAddress).toEqual({ name: 'Pat', line1: '2 Other Rd', country: 'US' })
  })

  it('records a payment it could not take, for the business to refund', () => {
    expect(quoteUnmatchedPayment(facts(), 'superseded')).toEqual({
      sessionId: 'cs_test_paid',
      paymentIntentId: 'pi_1',
      amountCents: 276_548,
      atMs: 50_000,
      reason: 'superseded',
    })
  })
})
