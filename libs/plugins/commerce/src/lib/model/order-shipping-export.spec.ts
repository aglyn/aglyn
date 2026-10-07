/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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

import { withOrderListFields } from './order-list-fields'
import {
  fulfillmentWithTracking,
  gramsToOunces,
  normalizeTrackingNumber,
  orderRequiresShipping,
  orderShippingRecord,
  orderSyncFields,
  parseShippingOrderRef,
  shippingOrderRefs,
} from './order-shipping-export'

/**
 * One reading of an order for every shipping tool (AGL-3613): which orders
 * ship at all, what is still owed, what it weighs, and how a tool's
 * reference finds the order again.
 */

const line = (overrides: Record<string, unknown> = {}) => ({
  productId: 'tee',
  variantId: 'm',
  name: 'Tee',
  quantity: 2,
  unitAmountCents: 1000,
  ...overrides,
})

describe('which orders ship', () => {
  it('ships an order with a physical line, or a line of no recorded type', () => {
    expect(orderRequiresShipping({ lineItems: [line({ productType: 'physical' })] as never })).toBe(true)
    expect(orderRequiresShipping({ lineItems: [line()] as never })).toBe(true)
  })

  it('never ships downloads and services', () => {
    expect(
      orderRequiresShipping({ lineItems: [line({ productType: 'digital' }), line({ productType: 'service' })] as never }),
    ).toBe(false)
  })

  it('ships a register sale only when it was given an address', () => {
    expect(orderRequiresShipping({ channel: 'pos', lineItems: [line()] as never })).toBe(false)
    expect(
      orderRequiresShipping({ channel: 'pos', lineItems: [line()] as never, shippingAddress: { line1: '1 Main' } }),
    ).toBe(true)
  })

  it('ships a legacy order with no lines only when it carries an address', () => {
    expect(orderRequiresShipping({ productId: 'p' } as never)).toBe(false)
    expect(orderRequiresShipping({ productId: 'p', shippingAddress: { line1: '1 Main' } } as never)).toBe(true)
  })

  it('is stamped by every creator, with the creation as the last change', () => {
    const stamped = withOrderListFields('o1', { status: 'paid', lineItems: [line()], createdAtMs: 42 })
    expect(stamped.requiresShipping).toBe(true)
    expect(stamped.updatedAtMs).toBe(42)
    expect(orderSyncFields({ lineItems: [line({ productType: 'digital' })] })).toEqual({ requiresShipping: false })
  })
})

describe('what a tool is sent', () => {
  it('names the remaining units, their weight and the address parts', () => {
    const record = orderShippingRecord(
      'o1',
      {
        number: 1042,
        customerEmail: 'ada@example.com',
        customerName: 'Ada',
        shippingAddress: { name: 'Ada Buyer', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
        lineItems: [line({ quantity: 3, sku: 'TEE-M', variantLabel: 'M' }), line({ productId: 'mug', variantId: undefined, name: 'Mug', quantity: 1 })] as never,
        fulfillments: [{ id: 'f', lineItemIds: [0], lines: [{ lineItemId: 0, quantity: 1 }], atMs: 1 }],
      },
      { tee: { m: 100 }, mug: { '': 350 } },
    )
    expect(record).toEqual({
      orderRef: '1042',
      shipName: 'Ada Buyer',
      shipLine1: '1 Main St',
      shipLine2: null,
      shipCity: 'Austin',
      shipState: 'TX',
      shipPostalCode: '78701',
      shipCountry: 'US',
      shipPhone: null,
      shipEmail: 'ada@example.com',
      itemsToShip: '2 × Tee (M), SKU TEE-M; 1 × Mug',
      unitsToShip: 3,
      weightOz: gramsToOunces(550),
      weightLb: Math.round((gramsToOunces(550) / 16) * 100) / 100,
      weightUnit: 'oz',
    })
  })

  it('sends no weight rather than zero when no product records one', () => {
    const record = orderShippingRecord('o1', { lineItems: [line()] as never }, {})
    expect(record['weightOz']).toBeNull()
    expect(record['weightUnit']).toBeNull()
  })
})

describe('references and tracking numbers', () => {
  it('finds an order by 1042, #1042 or its id', () => {
    expect(shippingOrderRefs({ number: 1042 }, 'doc1')).toEqual(['1042', '#1042', 'doc1'])
    expect(shippingOrderRefs({}, 'doc1')).toEqual(['doc1'])
    expect(parseShippingOrderRef('#1042')).toEqual({ number: 1042, id: '1042' })
    expect(parseShippingOrderRef(' 1042 ')).toEqual({ number: 1042, id: '1042' })
    expect(parseShippingOrderRef('cs_live_abc')).toEqual({ id: 'cs_live_abc' })
    expect(parseShippingOrderRef('a/b')).toBeNull()
    expect(parseShippingOrderRef('__x__')).toBeNull()
    expect(parseShippingOrderRef('')).toBeNull()
  })

  it('treats spacing and case as the same parcel, and a cancelled shipment as none', () => {
    expect(normalizeTrackingNumber(' 9400 1000-ab ')).toBe('94001000AB')
    const order = {
      fulfillments: [
        { id: 'a', lineItemIds: [0], trackingNumber: '1Z 999', atMs: 1 },
        { id: 'b', lineItemIds: [0], trackingNumber: 'GONE', status: 'cancelled' as const, atMs: 2 },
      ],
    }
    expect(fulfillmentWithTracking(order, '1z999')?.id).toBe('a')
    expect(fulfillmentWithTracking(order, 'GONE')).toBeUndefined()
    expect(fulfillmentWithTracking(order, '')).toBeUndefined()
  })
})
