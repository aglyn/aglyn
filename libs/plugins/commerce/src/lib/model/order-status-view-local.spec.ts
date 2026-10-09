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

import { buildOrderStatusView } from './order-status-view'

/**
 * The guest order-status page for a pickup or a local delivery (AGL-3624):
 * where to collect it and when, the steps a pickup or delivery takes instead
 * of "shipped", and no handover listed as a parcel.
 */

const lines = [{ productId: 'p', name: 'Bread', quantity: 2, unitAmountCents: 500, productType: 'physical' as const }]

describe('buildOrderStatusView for pickup and local delivery', () => {
  it('shows where to collect a pickup, and its steps', () => {
    const view = buildOrderStatusView({
      order: {
        status: 'paid',
        fulfillmentMethod: 'pickup',
        lineItems: lines,
        pickup: {
          locationId: 'main',
          locationName: 'Main Street',
          address: '1 Main St',
          hours: 'Mo-Fr 09:00-17:00',
          status: 'ready',
          readyAtMs: 50,
        },
        createdAtMs: 10,
        timeline: [{ atMs: 10, event: 'paid' }],
      },
      orderId: 'o',
      storeName: 'Bakery',
      number: '#1',
    })
    expect(view.statusLabel).toBe('Ready for pickup')
    expect(view.pickup).toEqual({
      locationName: 'Main Street',
      address: '1 Main St',
      hours: 'Mo-Fr 09:00-17:00',
      instructions: null,
      status: 'ready',
      statusLabel: 'Ready for pickup',
    })
    expect(view.steps.map((step) => [step.key, step.done])).toEqual([
      ['placed', true],
      ['paid', true],
      ['ready_for_pickup', true],
      ['picked_up', false],
    ])
  })

  it('counts a handover as received but lists no parcel for it', () => {
    const view = buildOrderStatusView({
      order: {
        status: 'delivered',
        fulfillmentMethod: 'local_delivery',
        lineItems: lines,
        fulfillments: [{ id: 'f', lineItemIds: [0], lines: [{ lineItemId: 0, quantity: 2 }], handover: 'local_delivery', atMs: 90 }],
        localDelivery: {
          zoneId: 'z',
          zoneName: 'Downtown',
          feeCents: 500,
          windowStartMs: 1,
          windowEndMs: 2,
          windowLabel: 'Tue, Oct 13, 9:00 AM – 12:00 PM',
          status: 'delivered',
          outForDeliveryAtMs: 80,
          deliveredAtMs: 90,
        },
      },
      orderId: 'o',
      storeName: 'Bakery',
      number: '#2',
    })
    expect(view.shipments).toEqual([])
    expect(view.lines[0].shippedQuantity).toBe(2)
    expect(view.localDelivery).toEqual({
      windowLabel: 'Tue, Oct 13, 9:00 AM – 12:00 PM',
      status: 'delivered',
      statusLabel: 'Delivered',
    })
    expect(view.steps.slice(2).map((step) => [step.key, step.done, step.atMs])).toEqual([
      ['out_for_delivery', true, 80],
      ['delivered', true, 90],
    ])
  })

  it('keeps the money status for a refunded pickup', () => {
    const view = buildOrderStatusView({
      order: {
        status: 'refunded',
        fulfillmentMethod: 'pickup',
        lineItems: lines,
        pickup: { locationId: 'main', locationName: 'Main Street', status: 'preparing' },
      },
      orderId: 'o',
      storeName: 'Bakery',
      number: '#3',
    })
    expect(view.statusLabel).toBe('Refunded')
  })
})

describe('buildOrderStatusView with an outside courier (AGL-3695)', () => {
  const delivery = {
    zoneId: 'z',
    zoneName: 'Downtown',
    feeCents: 500,
    windowStartMs: 1,
    windowEndMs: 2,
    status: 'out_for_delivery' as const,
  }

  it('shows the courier, its tracking page and arrival while it is on the way', () => {
    const view = buildOrderStatusView({
      order: {
        status: 'paid',
        fulfillmentMethod: 'local_delivery',
        lineItems: lines,
        localDelivery: {
          ...delivery,
          courier: {
            provider: 'doordash',
            providerLabel: 'DoorDash',
            deliveryRef: 'aglyn-o-1',
            state: 'picked_up',
            trackingUrl: 'https://doordash.com/drive/portal/track/abc',
            etaMs: 5000,
            testMode: true,
            updatedAtMs: 3,
          },
        },
      },
      orderId: 'o',
      storeName: 'Bakery',
      number: '#3',
    })
    expect(view.localDelivery?.courier).toEqual({
      providerLabel: 'DoorDash',
      stateLabel: 'On its way',
      trackingUrl: 'https://doordash.com/drive/portal/track/abc',
      etaMs: 5000,
    })
  })

  it('shows no courier once the run is over, and never a link that is not https', () => {
    const over = buildOrderStatusView({
      order: {
        status: 'paid',
        fulfillmentMethod: 'local_delivery',
        lineItems: lines,
        localDelivery: {
          ...delivery,
          courier: { provider: 'doordash', providerLabel: 'DoorDash', deliveryRef: 'r', state: 'cancelled', updatedAtMs: 1 },
        },
      },
      orderId: 'o',
      storeName: 'Bakery',
      number: '#4',
    })
    expect(over.localDelivery?.courier).toBeUndefined()
    const unsafe = buildOrderStatusView({
      order: {
        status: 'paid',
        fulfillmentMethod: 'local_delivery',
        lineItems: lines,
        localDelivery: {
          ...delivery,
          courier: {
            provider: 'doordash',
            providerLabel: 'DoorDash',
            deliveryRef: 'r',
            state: 'assigned',
            trackingUrl: 'javascript:alert(1)',
            updatedAtMs: 1,
          },
        },
      },
      orderId: 'o',
      storeName: 'Bakery',
      number: '#5',
    })
    expect(unsafe.localDelivery?.courier?.trackingUrl).toBeNull()
  })
})
