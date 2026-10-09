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

import type { PluginRecordCourier } from '@aglyn/aglyn/plugin-manager/plugin-local-deliveries'
import { readLocalDeliveryRecord, recordLocalDeliveryCourier } from './local-delivery-records'

/**
 * Commerce's local deliveries as a courier plugin reads and writes them
 * (AGL-3695), through core's `core.local-delivery-records`. The Firestore
 * double applies a transaction's writes at commit; the buyer notifier and the
 * event outbox are mocked at their module boundary, so what is asserted is
 * which step a courier's run brings and that a repeat writes nothing.
 */

const docs = new Map<string, Record<string, any>>()

function snapshot(path: string): any {
  const data = docs.get(path)
  return { id: path.split('/').pop(), exists: data !== undefined, data: () => data, get: (field: string) => data?.[field] }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    get: async () => snapshot(path),
    update: async (value: Record<string, any>) => {
      const existing = docs.get(path)
      if (!existing) throw new Error(`NOT_FOUND ${path}`)
      docs.set(path, { ...existing, ...value })
    },
    set: async (value: Record<string, any>) => docs.set(path, value),
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): any {
  const children = () =>
    [...docs.keys()].filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
  return {
    doc: (id: string) => docRef(`${path}/${id}`),
    where: (field: string, _op: string, value: unknown) => ({
      limit: () => ({
        get: async () => {
          const matches = children().filter((key) => docs.get(key)?.[field] === value)
          return { empty: matches.length === 0, docs: matches.map(snapshot) }
        },
      }),
    }),
  }
}

let queue: Promise<unknown> = Promise.resolve()
const fakeFirestore = {
  collection: (name: string) => collectionRef(name),
  runTransaction: <T>(fn: (transaction: any) => Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      const writes: Array<() => Promise<void>> = []
      const result = await fn({
        get: (ref: any) => ref.get(),
        update: (ref: any, value: any) => writes.push(() => ref.update(value)),
        set: (ref: any, value: any) => writes.push(() => ref.set(value)),
        create: (ref: any, value: any) => writes.push(() => ref.set(value)),
      })
      for (const write of writes) await write()
      return result
    })
    queue = run.catch(() => undefined)
    return run
  },
}

const mockNotify = jest.fn(async () => ({ outcome: 'handled', channels: [] }))
const mockStage = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => fakeFirestore }) },
  getOrgForHost: async () => ({ org: { id: 'org-1' } }),
}))
jest.mock('./order-notifications', () => ({
  notifyOrderBuyer: (...args: unknown[]) => mockNotify(...(args as [])),
}))
jest.mock('./order-events', () => ({
  stageOrderEvent: (...args: unknown[]) => mockStage(...args),
  fulfillmentEventView: () => ({ id: 'view' }),
}))

const HOST = 'host-1'
const ORDER = 'order-1'
const ORDER_PATH = `hosts/${HOST}/orders/${ORDER}`

function seed(overrides: Record<string, any> = {}, delivery: Record<string, any> = {}): void {
  docs.set(`hosts/${HOST}`, { businessName: 'Northwind Bakery' })
  docs.set(`hosts/${HOST}/settings/store`, { currency: 'USD', localDelivery: { enabled: true, locationId: 'main' } })
  docs.set(`hosts/${HOST}/locations/main`, {
    name: 'Main Street',
    postalAddress: { line1: '1 Main St', city: 'Springfield', state: 'IL', postalCode: '62701', country: 'US', phone: '(217) 555-0100' },
  })
  docs.set(ORDER_PATH, {
    number: 1042,
    status: 'paid',
    channel: 'online',
    fulfillmentMethod: 'local_delivery',
    customerName: 'Ada Lovelace',
    customerPhone: '+12175550199',
    shippingAddress: { name: 'Ada Lovelace', line1: '9 Elm St', city: 'Springfield', state: 'IL', postalCode: '62704', country: 'US' },
    localDelivery: {
      zoneId: 'near',
      zoneName: 'Downtown',
      feeCents: 500,
      windowStartMs: 5000,
      windowEndMs: 9000,
      status: 'scheduled',
      ...delivery,
    },
    lineItems: [{ productId: 'p1', name: 'Bread', quantity: 2, unitAmountCents: 500, productType: 'physical' }],
    totals: { itemsCents: 1000, shippingCents: 500, taxCents: 0, discountCents: 0, totalCents: 1500 },
    timeline: [{ atMs: 1, event: 'paid' }],
    livemode: true,
    createdAtMs: 1,
    ...overrides,
  })
}

const run = (overrides: Partial<PluginRecordCourier> = {}): PluginRecordCourier => ({
  provider: 'doordash',
  providerLabel: 'DoorDash',
  deliveryRef: 'aglyn-order-1-1',
  state: 'requested',
  trackingUrl: 'https://doordash.com/track/abc',
  etaMs: 7000,
  updatedAtMs: 10,
  ...overrides,
})

beforeEach(() => {
  docs.clear()
  mockNotify.mockClear()
  mockStage.mockClear()
})

describe('reading a local delivery (AGL-3695)', () => {
  it('reads both ends of the drop, the window and the value', async () => {
    seed()
    const record = await readLocalDeliveryRecord(HOST, ORDER)
    expect(record).toMatchObject({
      displayRef: '#1042',
      status: 'scheduled',
      dispatchable: true,
      currency: 'usd',
      valueCents: 1000,
      itemCount: 2,
      windowStartMs: 5000,
      windowEndMs: 9000,
      testMode: false,
      courier: null,
      pickup: {
        name: 'Northwind Bakery — Main Street',
        phone: '+12175550100',
        address: { line1: '1 Main St', postalCode: '62701', country: 'US' },
      },
      dropoff: {
        name: 'Ada Lovelace',
        phone: '+12175550199',
        address: { line1: '9 Elm St', postalCode: '62704', country: 'US' },
      },
    })
  })

  it('answers null for a shipped order and an unknown one', async () => {
    seed({ fulfillmentMethod: 'shipping' })
    await expect(readLocalDeliveryRecord(HOST, ORDER)).resolves.toBeNull()
    await expect(readLocalDeliveryRecord(HOST, 'missing')).resolves.toBeNull()
    await expect(readLocalDeliveryRecord(HOST, '__bad__')).resolves.toBeNull()
  })

  it('refuses a courier for a refunded or delivered order', async () => {
    seed({ status: 'refunded' })
    expect((await readLocalDeliveryRecord(HOST, ORDER))?.dispatchable).toBe(false)
    seed({}, { status: 'delivered' })
    expect((await readLocalDeliveryRecord(HOST, ORDER))?.dispatchable).toBe(false)
    seed({}, { status: 'failed' })
    expect((await readLocalDeliveryRecord(HOST, ORDER))?.dispatchable).toBe(true)
  })

  it('names no pickup when the location has no street address', async () => {
    seed()
    docs.set(`hosts/${HOST}/locations/main`, { name: 'Main Street', address: 'Somewhere' })
    expect((await readLocalDeliveryRecord(HOST, ORDER))?.pickup).toBeNull()
  })
})

describe('recording a courier run (AGL-3695)', () => {
  it('writes the run onto the delivery and its timeline, once', async () => {
    seed()
    await expect(recordLocalDeliveryCourier({ hostId: HOST, recordId: ORDER, courier: run() }, 20)).resolves.toEqual({
      outcome: 'recorded',
      status: 'scheduled',
    })
    const order = docs.get(ORDER_PATH) as any
    expect(order.localDelivery.courier).toMatchObject({ provider: 'doordash', state: 'requested', etaMs: 7000 })
    expect(order.localDelivery.status).toBe('scheduled')
    expect(order.timeline.at(-1)).toMatchObject({ event: 'courier', detail: 'DoorDash: Courier requested' })
    // The same run again writes nothing.
    await expect(recordLocalDeliveryCourier({ hostId: HOST, recordId: ORDER, courier: run() }, 30)).resolves.toEqual({
      outcome: 'unchanged',
      status: 'scheduled',
    })
    expect((docs.get(ORDER_PATH) as any).timeline).toHaveLength(2)
  })

  it('moves the delivery out the door, then delivers and fulfills it, with the buyer told each once', async () => {
    seed()
    await recordLocalDeliveryCourier({ hostId: HOST, recordId: ORDER, courier: run({ state: 'picked_up' }), move: 'out_for_delivery' }, 20)
    expect((docs.get(ORDER_PATH) as any).localDelivery.status).toBe('out_for_delivery')
    expect(mockNotify).toHaveBeenCalledWith({ hostId: HOST, orderId: ORDER }, 'out_for_delivery')

    const outcome = await recordLocalDeliveryCourier(
      { hostId: HOST, recordId: ORDER, courier: run({ state: 'delivered' }), move: 'delivered' },
      30,
    )
    expect(outcome).toEqual({ outcome: 'recorded', status: 'delivered' })
    const order = docs.get(ORDER_PATH) as any
    expect(order.localDelivery.status).toBe('delivered')
    expect(order.status).toBe('delivered')
    expect(order.fulfillments).toHaveLength(1)
    expect(order.fulfillments[0]).toMatchObject({ handover: 'local_delivery' })
    expect(mockNotify).toHaveBeenLastCalledWith({ hostId: HOST, orderId: ORDER }, 'delivered')

    // A redelivered "delivered" webhook changes nothing and tells nobody.
    mockNotify.mockClear()
    await expect(
      recordLocalDeliveryCourier({ hostId: HOST, recordId: ORDER, courier: run({ state: 'delivered' }), move: 'delivered' }, 40),
    ).resolves.toEqual({ outcome: 'unchanged', status: 'delivered' })
    expect(mockNotify).not.toHaveBeenCalled()
    expect((docs.get(ORDER_PATH) as any).fulfillments).toHaveLength(1)
  })

  it('marks the delivery failed with the courier’s reason', async () => {
    seed()
    await recordLocalDeliveryCourier(
      {
        hostId: HOST,
        recordId: ORDER,
        courier: run({ state: 'cancelled', reason: 'no dasher available' }),
        move: 'failed',
        reason: 'DoorDash canceled the delivery: no dasher available',
      },
      20,
    )
    const delivery = (docs.get(ORDER_PATH) as any).localDelivery
    expect(delivery.status).toBe('failed')
    expect(delivery.failedReason).toBe('DoorDash canceled the delivery: no dasher available')
    expect(delivery.courier.state).toBe('cancelled')
  })

  it('reports the seller’s refusal, keeping the run', async () => {
    seed({ status: 'refunded' })
    const outcome = await recordLocalDeliveryCourier(
      { hostId: HOST, recordId: ORDER, courier: run({ state: 'delivered' }), move: 'delivered' },
      20,
    )
    expect(outcome).toEqual({ outcome: 'blocked', from: 'refunded' })
    expect((docs.get(ORDER_PATH) as any).localDelivery.courier.state).toBe('delivered')
  })

  it('clears the run when the store takes the drop back', async () => {
    seed({}, { courier: run() })
    await recordLocalDeliveryCourier({ hostId: HOST, recordId: ORDER, courier: null }, 20)
    const order = docs.get(ORDER_PATH) as any
    expect(order.localDelivery.courier).toBeUndefined()
    expect(order.timeline.at(-1).detail).toBe('DoorDash canceled; the store delivers')
  })

  it('refuses an order that is not a local delivery', async () => {
    seed({ fulfillmentMethod: 'pickup' })
    await expect(recordLocalDeliveryCourier({ hostId: HOST, recordId: ORDER, courier: run() })).resolves.toEqual({
      outcome: 'not_local_delivery',
    })
    await expect(recordLocalDeliveryCourier({ hostId: HOST, recordId: 'nope', courier: run() })).resolves.toEqual({
      outcome: 'no_such_record',
    })
  })
})
