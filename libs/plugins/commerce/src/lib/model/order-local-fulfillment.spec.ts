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
  canTransitionLocalDelivery,
  canTransitionPickup,
  orderIsLocallyFulfilled,
  orderLocalFulfillmentListFields,
} from './order-local-fulfillment'
import { availableVariantUnits, canReserveStock, heldVariantUnits } from './commerce-stock-holds'
import { orderRequiresShipping } from './order-shipping-export'
import {
  LOCAL_FULFILLMENT_QUEUE_TABS,
  localFulfillmentQueueQuery,
} from '../constants/local-fulfillment-list-query'

/**
 * The order side of pickup and local delivery (AGL-3624): which steps are
 * allowed, the fields the queue queries, and stock reserved by location.
 */

describe('transitions', () => {
  it('lets a pickup be marked ready, taken back, and picked up — and nothing after', () => {
    expect(canTransitionPickup('preparing', 'ready')).toBe(true)
    expect(canTransitionPickup('ready', 'preparing')).toBe(true)
    expect(canTransitionPickup('ready', 'picked_up')).toBe(true)
    expect(canTransitionPickup('preparing', 'picked_up')).toBe(true)
    expect(canTransitionPickup('picked_up', 'ready')).toBe(false)
    expect(canTransitionPickup(undefined, 'ready')).toBe(true)
  })

  it('lets a failed delivery go out again, and a delivered one nowhere', () => {
    expect(canTransitionLocalDelivery('scheduled', 'out_for_delivery')).toBe(true)
    expect(canTransitionLocalDelivery('out_for_delivery', 'failed')).toBe(true)
    expect(canTransitionLocalDelivery('failed', 'out_for_delivery')).toBe(true)
    expect(canTransitionLocalDelivery('delivered', 'failed')).toBe(false)
    expect(canTransitionLocalDelivery('scheduled', 'scheduled')).toBe(false)
  })
})

describe('queue fields', () => {
  it('keys a pickup by its status and location, due when it was ordered', () => {
    expect(
      orderLocalFulfillmentListFields({
        fulfillmentMethod: 'pickup',
        pickup: { locationId: 'main', locationName: 'Main', status: 'ready' },
        createdAtMs: 1000,
      }),
    ).toEqual({ fulfillmentKey: 'pickup_ready', fulfillmentLocationId: 'main', fulfillmentDueMs: 1000 })
  })

  it('keys a delivery by its window start, and reads a malformed status as where it starts', () => {
    expect(
      orderLocalFulfillmentListFields({
        fulfillmentMethod: 'local_delivery',
        localDelivery: { status: 'lost' as never, windowStartMs: 5000 },
        createdAtMs: 1000,
      }),
    ).toEqual({ fulfillmentKey: 'delivery_scheduled', fulfillmentLocationId: '', fulfillmentDueMs: 5000 })
  })

  it('stamps nothing on a shipped order', () => {
    expect(orderLocalFulfillmentListFields({ fulfillmentMethod: 'shipping' })).toBeNull()
    expect(orderLocalFulfillmentListFields({})).toBeNull()
    expect(orderIsLocallyFulfilled({ fulfillmentMethod: 'pickup' })).toBe(true)
    expect(orderIsLocallyFulfilled(null)).toBe(false)
  })

  it('builds each tab as one query: location, key, open statuses, soonest first', () => {
    expect(localFulfillmentQueueQuery('pickup_ready', 'main')).toEqual({
      where: [
        { field: 'fulfillmentLocationId', op: '==', value: 'main' },
        { field: 'fulfillmentKey', op: '==', value: 'pickup_ready' },
        { field: 'status', op: 'in', value: ['paid', 'partially_fulfilled', 'fulfilled'] },
      ],
      orderBy: { field: 'fulfillmentDueMs', direction: 'asc' },
      limit: 50,
    })
    expect(localFulfillmentQueueQuery('delivery_scheduled').where).toHaveLength(2)
    expect(LOCAL_FULFILLMENT_QUEUE_TABS.map((tab) => tab.key)).toEqual([
      'pickup_preparing',
      'pickup_ready',
      'delivery_scheduled',
      'delivery_out_for_delivery',
      'delivery_failed',
    ])
  })

  it('is served by the two composites in the index file', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const indexes = require('../../../../../../cloud/firebase-firestore.indexes.json').indexes as Array<{
      collectionGroup: string
      fields: Array<{ fieldPath: string; order?: string }>
    }>
    const shapes = indexes
      .filter((index) => index.collectionGroup === 'orders')
      .map((index) => index.fields.map((field) => `${field.fieldPath}:${field.order}`).join(','))
    expect(shapes).toContain('fulfillmentKey:ASCENDING,status:ASCENDING,fulfillmentDueMs:ASCENDING')
    expect(shapes).toContain(
      'fulfillmentLocationId:ASCENDING,fulfillmentKey:ASCENDING,status:ASCENDING,fulfillmentDueMs:ASCENDING',
    )
  })
})

describe('a pickup or local delivery never goes to a shipping tool', () => {
  it('does not require shipping, whatever is in it', () => {
    const lines = [{ productId: 'p', name: 'Mug', quantity: 1, unitAmountCents: 100, productType: 'physical' as const }]
    expect(orderRequiresShipping({ lineItems: lines })).toBe(true)
    expect(orderRequiresShipping({ lineItems: lines, fulfillmentMethod: 'pickup' })).toBe(false)
    expect(orderRequiresShipping({ lineItems: lines, fulfillmentMethod: 'local_delivery' })).toBe(false)
  })
})

describe('stock reserved by location', () => {
  const now = 1_000_000
  const product = {
    oversellPolicy: 'deny' as const,
    variants: [{ id: 'v', priceUsd: 10, inventory: 5, inventoryByLocation: { a: 2, b: 3 } }],
    stockHolds: {
      pickupAtA: { expiresAtMs: now + 60_000, units: { v: 1 }, locationId: 'a' },
      shipped: { expiresAtMs: now + 60_000, units: { v: 1 } },
      lapsed: { expiresAtMs: now - 1, units: { v: 4 }, locationId: 'a' },
    },
  }

  it('counts only the holds taken at a location for that location', () => {
    expect(heldVariantUnits(product as never, 'v', now)).toBe(2)
    expect(heldVariantUnits(product as never, 'v', now, undefined, 'a')).toBe(1)
    expect(heldVariantUnits(product as never, 'v', now, undefined, 'b')).toBe(0)
  })

  it('answers the smaller of what the location and the whole variant have free', () => {
    // Total: 5 on the shelf − 2 held = 3. At a: 2 − 1 = 1. At b: 3 − 0 = 3.
    expect(availableVariantUnits(product as never, 'v', now)).toBe(3)
    expect(availableVariantUnits(product as never, 'v', now, undefined, 'a')).toBe(1)
    expect(availableVariantUnits(product as never, 'v', now, undefined, 'b')).toBe(3)
    expect(canReserveStock(product as never, 'v', 2, now, undefined, 'a')).toBe(false)
    expect(canReserveStock(product as never, 'v', 2, now, undefined, 'b')).toBe(true)
    // A shipped hold ties up the total, so b cannot sell all three of its own
    // and the other location's too.
    expect(canReserveStock(product as never, 'v', 4, now, undefined, 'b')).toBe(false)
  })

  it('lets an attempt re-claim its own hold at the location', () => {
    expect(availableVariantUnits(product as never, 'v', now, 'pickupAtA', 'a')).toBe(2)
  })

  it('falls back to the total for a variant that is not split by location', () => {
    const flat = { variants: [{ id: 'v', priceUsd: 10, inventory: 4 }], stockHolds: product.stockHolds }
    expect(availableVariantUnits(flat as never, 'v', now, undefined, 'a')).toBe(2)
  })
})
