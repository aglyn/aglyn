/**
 * @jest-environment node
 */
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
 * Commerce's orders through core's `core.shipment-records` (AGL-3612): what a
 * label buyer reads, and that every write it asks for is this plugin's own —
 * `recordOrderShipment` with the label's key, so a retried label records one
 * shipment, and `delivered` only once every parcel of a fully shipped order
 * has arrived. Firestore and the shipment transaction are doubles.
 */

const docs = new Map<string, Record<string, any>>()
const shipmentCalls: any[] = []

function snapshot(path: string) {
  const data = docs.get(path)
  return { id: path.split('/').pop(), exists: data !== undefined, data: () => data, get: (field: string) => data?.[field] }
}

function docRef(path: string): any {
  return {
    path,
    get: async () => snapshot(path),
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): any {
  return {
    doc: (id: string) => docRef(`${path}/${id}`),
    limit: () => ({
      get: async () => ({
        docs: [...docs.keys()]
          .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
          .map(snapshot),
      }),
    }),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => collectionRef(name),
        runTransaction: async (fn: (transaction: any) => Promise<unknown>) => {
          const writes: Array<() => void> = []
          const result = await fn({
            get: (ref: any) => ref.get(),
            update: (ref: any, value: Record<string, unknown>) =>
              writes.push(() => docs.set(ref.path, { ...docs.get(ref.path), ...value })),
          })
          writes.forEach((write) => write())
          return result
        },
      }),
    }),
  },
}))

jest.mock('./fulfill-order', () => ({
  recordOrderShipment: async (request: any) => {
    shipmentCalls.push(request)
    if (request.to === 'delivered') return { outcome: 'recorded', status: 'delivered' }
    return { outcome: 'recorded', status: 'fulfilled', fulfillment: { id: 'ful-label', atMs: 1 } }
  },
}))

import { commerceShipmentRecords } from './shipment-records'

const ORDER = 'hosts/host-1/orders/order-1'

beforeEach(() => {
  docs.clear()
  shipmentCalls.length = 0
  docs.set('hosts/host-1/products/p-candle', {
    name: 'Candle',
    type: 'physical',
    status: 'active',
    variants: [{ id: 'v1', priceUsd: 15, weightGrams: 300 }],
    shipping: { lengthCm: 10, widthCm: 8, heightCm: 8, hsCode: '3406.00', originCountry: 'US' },
  })
  docs.set(ORDER, {
    number: 1042,
    status: 'partially_fulfilled',
    customerEmail: 'ann@example.com',
    customerName: 'Ann Lee',
    shippingAddress: { line1: '2 B St', city: 'Boston', state: 'MA', postalCode: '02108', country: 'us' },
    lineItems: [
      { productId: 'p-candle', variantId: 'v1', name: 'Candle', quantity: 3, unitAmountCents: 1_500, productType: 'physical' },
      { productId: 'p-pdf', name: 'Guide', quantity: 1, unitAmountCents: 500, productType: 'digital' },
    ],
    fulfillments: [
      { id: 'ful-1', lineItemIds: [0], lines: [{ lineItemId: 0, quantity: 1 }], carrier: 'USPS', trackingNumber: 'TRK1', status: 'active', atMs: 5 },
    ],
  })
})

describe('reading an order as a shipper', () => {
  it('lists what ships, what is left, the weights, sizes and customs facts, and the address', async () => {
    const record = await commerceShipmentRecords.read('host-1', 'order-1')
    expect(record).toMatchObject({
      displayRef: '#1042',
      status: 'partially_fulfilled',
      shippable: true,
      currency: 'usd',
      customerEmail: 'ann@example.com',
      shipTo: { country: 'US', line1: '2 B St', postalCode: '02108', name: 'Ann Lee' },
      lines: [
        {
          lineIndex: 0,
          name: 'Candle',
          quantity: 3,
          quantityUnshipped: 2,
          unitValueCents: 1_500,
          weightGrams: 300,
          lengthCm: 10,
          widthCm: 8,
          heightCm: 8,
          hsCode: '3406.00',
          originCountry: 'US',
        },
      ],
      shipments: [{ id: 'ful-1', trackingNumber: 'TRK1', lineIndexes: [0] }],
    })
    await expect(commerceShipmentRecords.read('host-1', 'missing')).resolves.toBeNull()
  })
})

describe('writing a label’s shipment', () => {
  it('goes through recordOrderShipment keyed by the label', async () => {
    const outcome = await commerceShipmentRecords.recordShipment({
      hostId: 'host-1',
      recordId: 'order-1',
      lines: [{ lineIndex: 0, quantity: 2 }],
      carrier: 'USPS',
      trackingNumber: 'TRK2',
      labelUrl: 'https://labels.example/l.pdf',
      labelRef: 'lbl_abc',
    })
    expect(outcome).toEqual({ outcome: 'recorded', shipmentId: 'ful-label' })
    expect(shipmentCalls).toEqual([
      {
        hostId: 'host-1',
        orderId: 'order-1',
        to: 'fulfilled',
        carrier: 'USPS',
        trackingNumber: 'TRK2',
        lineItems: [{ lineItemId: 0, quantity: 2 }],
        labelUrl: 'https://labels.example/l.pdf',
        labelRef: 'lbl_abc',
        idempotencyKey: 'label:lbl_abc',
      },
    ])
  })
})

describe('tracking', () => {
  it('records each status once and delivers a fully shipped order when every parcel arrived', async () => {
    const update = { hostId: 'host-1', recordId: 'order-1', trackingNumber: 'trk1', atMs: 10 }
    await expect(commerceShipmentRecords.recordTracking({ ...update, status: 'in_transit' })).resolves.toEqual({ outcome: 'recorded' })
    await expect(commerceShipmentRecords.recordTracking({ ...update, status: 'in_transit' })).resolves.toEqual({ outcome: 'unchanged' })
    expect(docs.get(ORDER)?.fulfillments[0]).toMatchObject({ trackingStatus: 'in_transit', trackingStatusAtMs: 10 })
    expect(docs.get(ORDER)?.timeline.at(-1)).toMatchObject({ event: 'tracking', detail: 'In transit' })
    // Partially fulfilled: the parcel arrived, the order is not done.
    await commerceShipmentRecords.recordTracking({ ...update, status: 'delivered', detail: 'Front door' })
    expect(shipmentCalls).toHaveLength(0)
    docs.set(ORDER, { ...docs.get(ORDER), status: 'fulfilled' })
    await commerceShipmentRecords.recordTracking({ ...update, status: 'exception' })
    await commerceShipmentRecords.recordTracking({ ...update, status: 'delivered' })
    expect(shipmentCalls).toEqual([{ hostId: 'host-1', orderId: 'order-1', to: 'delivered' }])
    await expect(
      commerceShipmentRecords.recordTracking({ ...update, trackingNumber: 'NOPE', status: 'delivered' }),
    ).resolves.toEqual({ outcome: 'no_such_shipment' })
  })
})

describe('ship-from places', () => {
  it('lists the locations with a complete postal address', async () => {
    docs.set('hosts/host-1/locations/loc-a', { name: 'Studio', postalAddress: { line1: '1 A St', city: 'Austin', postalCode: '78701', country: 'US' } })
    docs.set('hosts/host-1/locations/loc-b', { name: 'Pop-up', address: 'somewhere' })
    await expect(commerceShipmentRecords.shipFromAddresses('host-1')).resolves.toEqual([
      { id: 'loc-a', name: 'Studio', address: { line1: '1 A St', city: 'Austin', postalCode: '78701', country: 'US', name: 'Studio' } },
    ])
  })
})
