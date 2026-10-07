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

import { buildOrderInvoiceHtml, invoiceMoney, invoicePaymentStatus } from './order-invoice'

/**
 * The printable invoice (AGL-3611). It is written into a popup that inherits
 * the console's origin, so the first property is that nothing a shopper typed
 * reaches it as markup (AGL-2283); the second, that its figures are the
 * order's own.
 */

const order = {
  number: 1042,
  status: 'fulfilled' as const,
  createdAtMs: Date.UTC(2026, 9, 6, 12),
  customerName: 'Ada',
  customerEmail: 'ada@example.com',
  shippingAddress: { name: '<img src=x onerror="alert(1)">', line1: '1 Main', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
  lineItems: [
    { productId: 'p1', name: 'Mug & <b>Co</b>', variantLabel: 'Blue', sku: 'MUG-1', quantity: 2, unitAmountCents: 1250 },
    { productId: 'p2', name: 'Tee', quantity: 1, unitAmountCents: 2000 },
  ],
  totals: { itemsCents: 4500, shippingCents: 500, taxCents: 360, discountCents: 450, totalCents: 4910, feeCents: 0 },
  refundedCents: 1250,
}
const store = { name: 'Ada’s "Shop"', currency: 'USD', footer: 'Thanks <3', termsUrl: 'https://shop.test/terms' }

it('escapes everything a shopper or merchant typed', () => {
  const html = buildOrderInvoiceHtml({ order, orderId: 'o1', store })
  expect(html).not.toContain('<img')
  expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
  expect(html).toContain('Mug &amp; &lt;b&gt;Co&lt;/b&gt;')
  expect(html).toContain('Thanks &lt;3')
  expect(html).toContain('Ada’s &quot;Shop&quot;')
})

it('lists each line with its unit price and amount, and the order’s own totals', () => {
  const html = buildOrderInvoiceHtml({ order, orderId: 'o1', store })
  expect(html).toContain('<title>Invoice #1042</title>')
  expect(html).toContain('Blue · SKU MUG-1')
  expect(html).toContain('<td align="right">2</td><td align="right">$12.50</td><td align="right">$25.00</td>')
  for (const figure of ['$45.00', '−$4.50', '$5.00', '$3.60', '<b>$49.10</b>', '−$12.50', '<b>$36.60</b>']) {
    expect(html).toContain(figure)
  }
  expect(html).toContain('Payment: Paid, partially refunded')
  expect(html).toContain('Ship to')
  expect(html).toContain('ada@example.com')
})

it('leaves out lines that are zero, and prices in the order’s currency', () => {
  const html = buildOrderInvoiceHtml({
    order: { ...order, currency: 'eur', refundedCents: 0, totals: { ...order.totals, discountCents: 0, shippingCents: 0, taxCents: 0, totalCents: 4500 } },
    orderId: 'o1',
    store,
  })
  expect(html).not.toContain('Discount')
  expect(html).not.toContain('Shipping')
  expect(html).not.toContain('Refunded')
  expect(html).toContain('€45.00')
  expect(html).toContain('Currency: EUR')
})

it('names the payment state', () => {
  expect(invoicePaymentStatus({ status: 'pending', totals: undefined })).toBe('Awaiting payment')
  expect(invoicePaymentStatus({ status: 'refunded', refundedCents: 4910, totals: order.totals })).toBe('Refunded')
  expect(invoicePaymentStatus({ status: 'cancelled' })).toBe('Canceled')
  expect(invoiceMoney(123, 'not-a-currency')).toBe('1.23 NOT-A-CURRENCY')
})
