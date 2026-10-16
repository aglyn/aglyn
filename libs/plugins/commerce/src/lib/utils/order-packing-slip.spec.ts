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

import { buildPackingSlipHtml } from './order-packing-slip'

/*
 * The packing slip (AGL-3841 moved it out of the order dialog so the apps can
 * print the same page): nothing a shopper typed reaches it as markup
 * (AGL-2283), and it carries every line with its quantity and SKU.
 */

describe('buildPackingSlipHtml', () => {
  const order = {
    number: 7,
    shippingAddress: { name: 'Ada <script>', line1: '1 Main', line2: '', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
    lineItems: [
      { productId: 'p1', name: 'Mug & Co', variantLabel: 'Blue', sku: 'MUG-1', quantity: 2, unitAmountCents: 1250 },
      { productId: 'p2', name: 'Tee', quantity: 1, unitAmountCents: 2000 },
    ],
  }

  it('lays out the number, the address and each line, every value escaped', () => {
    expect(buildPackingSlipHtml(order as never, 'o1')).toBe(
      '<h2>Packing slip #7</h2>' +
        '<p>Ada &lt;script&gt;<br/>1 Main<br/>Austin TX 78701<br/>US</p>' +
        '<table border="0" cellpadding="6">' +
        '<tr><td>2×</td><td>Mug &amp; Co — Blue</td><td>MUG-1</td></tr>' +
        '<tr><td>1×</td><td>Tee</td><td></td></tr>' +
        '</table>',
    )
  })

  it('names an order with no number by its id, and leaves out a missing address', () => {
    expect(buildPackingSlipHtml({ lineItems: [] } as never, 'abcdef123456')).toBe(
      '<h2>Packing slip #123456</h2><table border="0" cellpadding="6"></table>',
    )
  })
})
