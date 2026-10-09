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

import { coveredLineItemIds, statusAfterFulfilling, type HostOrder } from './commerce-orders'
import {
  fulfilledQuantities,
  fulfillmentLineQuantities,
  orderFulfillmentsEditable,
  remainingFulfillmentLines,
  parseShippingCostInput,
  resolveFulfillmentLines,
  shippingCostCentsProblem,
  SHIPPING_COST_MAX_CENTS,
  statusFromFulfillments,
} from './order-fulfillment'

/** The quantity math every fulfillment door shares (AGL-3611). */

const order = (overrides: Partial<HostOrder> = {}): HostOrder => ({
  status: 'paid',
  lineItems: [
    { productId: 'tee', name: 'Tee', quantity: 3, unitAmountCents: 1400, productType: 'physical' },
    { productId: 'mug', name: 'Mug', quantity: 2, unitAmountCents: 1000 },
    { productId: 'ebook', name: 'E-book', quantity: 1, unitAmountCents: 500, productType: 'digital' },
  ],
  ...overrides,
})

describe('reading fulfillments', () => {
  it('reads a legacy fulfillment as every unit of the lines it names', () => {
    const subject = order()
    expect(fulfillmentLineQuantities(subject, { id: 'f', lineItemIds: [0, 1], atMs: 1 })).toEqual([
      { lineItemId: 0, quantity: 3 },
      { lineItemId: 1, quantity: 2 },
    ])
  })

  it('reads quantities when they are recorded, and drops lines not on the order', () => {
    const subject = order()
    expect(
      fulfillmentLineQuantities(subject, {
        id: 'f',
        lineItemIds: [0, 9],
        lines: [
          { lineItemId: 0, quantity: 2 },
          { lineItemId: 9, quantity: 1 },
        ],
        atMs: 1,
      }),
    ).toEqual([{ lineItemId: 0, quantity: 2 }])
  })

  it('sums active fulfillments and ignores a cancelled one', () => {
    const subject = order({
      fulfillments: [
        { id: 'a', lineItemIds: [0], lines: [{ lineItemId: 0, quantity: 1 }], atMs: 1 },
        { id: 'b', lineItemIds: [0], lines: [{ lineItemId: 0, quantity: 1 }], atMs: 2 },
        { id: 'c', lineItemIds: [0], lines: [{ lineItemId: 0, quantity: 1 }], status: 'cancelled', atMs: 3 },
      ],
    })
    expect(fulfilledQuantities(subject).get(0)).toBe(2)
    expect(remainingFulfillmentLines(subject)).toEqual([
      { lineItemId: 0, quantity: 1 },
      { lineItemId: 1, quantity: 2 },
    ])
  })
})

describe('the status fulfillments put an order in', () => {
  it('is paid with nothing shipped, partial with some, fulfilled with every shippable unit', () => {
    expect(statusFromFulfillments(order())).toBe('paid')
    expect(
      statusFromFulfillments(
        order({ fulfillments: [{ id: 'a', lineItemIds: [0], lines: [{ lineItemId: 0, quantity: 1 }], atMs: 1 }] }),
      ),
    ).toBe('partially_fulfilled')
    // The digital line is never shipped and never holds the order open.
    expect(
      statusFromFulfillments(order({ fulfillments: [{ id: 'a', lineItemIds: [0, 1], atMs: 1 }] })),
    ).toBe('fulfilled')
  })

  it('treats a line with no recorded type as physical', () => {
    expect(
      statusFromFulfillments(order({ fulfillments: [{ id: 'a', lineItemIds: [0], atMs: 1 }] })),
    ).toBe('partially_fulfilled')
  })

  it('covers a line only once every unit is out, for the supplier route too', () => {
    const subject = order({
      fulfillments: [{ id: 'a', lineItemIds: [0], lines: [{ lineItemId: 0, quantity: 2 }], atMs: 1 }],
    })
    expect(coveredLineItemIds(subject).has(0)).toBe(false)
    expect(statusAfterFulfilling(subject, new Set([0, 1]))).toBe('fulfilled')
    expect(statusAfterFulfilling(subject, new Set([0]))).toBe('partially_fulfilled')
  })
})

describe('validating a requested shipment', () => {
  it('refuses more than is left, naming the line and the count', () => {
    const subject = order({
      fulfillments: [{ id: 'a', lineItemIds: [0], lines: [{ lineItemId: 0, quantity: 2 }], atMs: 1 }],
    })
    expect(resolveFulfillmentLines(subject, [{ lineItemId: 0, quantity: 2 }])).toEqual({
      problem: 'over_fulfilled',
      lineItemId: 0,
      remaining: 1,
      requested: 2,
    })
  })

  it('refuses empty, unknown and non-whole requests', () => {
    expect(resolveFulfillmentLines(order(), [])).toEqual({ problem: 'empty' })
    expect(resolveFulfillmentLines(order(), [{ lineItemId: 5, quantity: 1 }])).toMatchObject({
      problem: 'unknown_line',
    })
    expect(resolveFulfillmentLines(order(), [{ lineItemId: 0, quantity: -1 }])).toMatchObject({
      problem: 'bad_quantity',
    })
  })

  it('merges duplicates and sorts by line', () => {
    expect(
      resolveFulfillmentLines(order(), [
        { lineItemId: 1, quantity: 1 },
        { lineItemId: 0, quantity: 1 },
        { lineItemId: 1, quantity: 1 },
      ]),
    ).toEqual({
      lines: [
        { lineItemId: 0, quantity: 1 },
        { lineItemId: 1, quantity: 2 },
      ],
    })
  })
})

it('keeps fulfillments open to edits only while the order is open', () => {
  expect(orderFulfillmentsEditable({ status: 'partially_fulfilled' })).toBe(true)
  expect(orderFulfillmentsEditable({ status: 'fulfilled' })).toBe(true)
  expect(orderFulfillmentsEditable({ status: 'delivered' })).toBe(false)
  expect(orderFulfillmentsEditable({ status: 'refunded' })).toBe(false)
})

describe('a hand-entered shipping cost (AGL-3705)', () => {
  it('reads an amount in the store currency as whole minor units', () => {
    expect(parseShippingCostInput('8.45', 'USD')).toEqual({ cents: 845 })
    expect(parseShippingCostInput('$12.5', 'usd')).toEqual({ cents: 1250 })
    expect(parseShippingCostInput('1,250.00', 'EUR')).toEqual({ cents: 125000 })
    expect(parseShippingCostInput('12', 'USD')).toEqual({ cents: 1200 })
    expect(parseShippingCostInput('.5', 'USD')).toEqual({ cents: 50 })
    // A zero-decimal currency has no minor unit to multiply in.
    expect(parseShippingCostInput('850', 'JPY')).toEqual({ cents: 850 })
    expect(parseShippingCostInput('850.5', 'JPY')).toEqual({ error: 'Enter a whole amount, like 850' })
  })

  it('reads an empty field as not known, and zero as free', () => {
    expect(parseShippingCostInput('', 'USD')).toEqual({ cents: null })
    expect(parseShippingCostInput('   ', 'USD')).toEqual({ cents: null })
    expect(parseShippingCostInput('0', 'USD')).toEqual({ cents: 0 })
  })

  it('refuses a negative, a word, too many decimals and an absurd amount', () => {
    expect(parseShippingCostInput('-3', 'USD')).toEqual({ error: 'Shipping cost cannot be negative' })
    expect(parseShippingCostInput('abc', 'USD')).toEqual({ error: 'Enter an amount like 8.45' })
    expect(parseShippingCostInput('8.456', 'USD')).toEqual({ error: 'Enter an amount like 8.45' })
    expect(parseShippingCostInput('10000.01', 'USD')).toEqual({ error: 'Shipping cost is too large' })
  })

  it('the server bound: absent is fine, a present cost is whole, non-negative cents', () => {
    for (const ok of [undefined, null, '', 0, 845, SHIPPING_COST_MAX_CENTS]) expect(shippingCostCentsProblem(ok)).toBeNull()
    expect(shippingCostCentsProblem(8.45)).toBe('Shipping cost must be a whole number of cents')
    expect(shippingCostCentsProblem('845')).toBe('Shipping cost must be a whole number of cents')
    expect(shippingCostCentsProblem(-1)).toBe('Shipping cost cannot be negative')
    expect(shippingCostCentsProblem(SHIPPING_COST_MAX_CENTS + 1)).toBe('Shipping cost is too large')
  })
})
