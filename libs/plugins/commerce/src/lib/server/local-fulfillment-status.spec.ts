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
import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { localFulfillmentHandler, moveLocalFulfillment } from './local-fulfillment-status'

/**
 * Pickup and local delivery steps (AGL-3624), moved in one transaction that
 * re-reads the order and re-asks the step. The Firestore double is
 * `fulfill-order.spec.ts`'s: buffered writes applied at commit, serialized
 * transaction bodies, and `update()` refusing an absent document. The buyer
 * notifier and the event outbox are mocked at their module boundary, so what
 * is asserted is WHICH message each step owes and that it is asked for only
 * after the write lands.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore, keyed by document path
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()

let generatedIds = 0

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function makeSnapshot(path: string): any {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
    ref: makeDocRef(path),
  }
}

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => makeSnapshot(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      const existing = docs.get(path)
      docs.set(path, options?.merge ? { ...(existing ?? {}), ...value } : value)
    },
    /** `update()` REJECTS an absent document — it never conjures one. */
    update: async (value: Record<string, any>) => {
      const existing = docs.get(path)
      if (existing === undefined) {
        const error: any = new Error(`NOT_FOUND: no entity to update: ${path}`)
        error.code = 5
        throw error
      }
      docs.set(path, { ...existing, ...value })
    },
    /** `create()` REJECTS an existing document. */
    create: async (value: Record<string, any>) => {
      if (docs.has(path)) {
        const error: any = new Error(`ALREADY_EXISTS: ${path}`)
        error.code = 6
        throw error
      }
      docs.set(path, value)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  return {
    doc: (id?: string) =>
      makeDocRef(`${path}/${id ?? `generated-${++generatedIds}`}`),
    get: async () => ({ docs: childPaths(path).map(makeSnapshot) }),
  }
}

/** One transaction body at a time; writes buffered and applied at commit. */
let transactionQueue: Promise<unknown> = Promise.resolve()

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
  runTransaction: <T>(fn: (transaction: any) => Promise<T>): Promise<T> => {
    const run = transactionQueue.then(async () => {
      const queued: Array<[string, any, any, any?]> = []
      const result = await fn({
        get: (ref: any) => ref.get(),
        update: (ref: any, value: any) => queued.push(['update', ref, value]),
        create: (ref: any, value: any) => queued.push(['create', ref, value]),
        set: (ref: any, value: any, options?: any) =>
          queued.push(['set', ref, value, options]),
      })
      // Validate the whole batch before any of it lands.
      for (const [op, ref] of queued) {
        if (op === 'update' && !docs.has(ref.path)) {
          const error: any = new Error(
            `NOT_FOUND: no entity to update: ${ref.path}`,
          )
          error.code = 5
          throw error
        }
        if (op === 'create' && docs.has(ref.path)) {
          const error: any = new Error(`ALREADY_EXISTS: ${ref.path}`)
          error.code = 6
          throw error
        }
      }
      for (const [op, ref, value, options] of queued) {
        if (op === 'update') await ref.update(value)
        else if (op === 'create') await ref.create(value)
        else await ref.set(value, options)
      }
      return result
    })
    transactionQueue = run.catch(() => undefined)
    return run
  },
}

const mockVerifyIdToken = jest.fn(async () => ({ uid: 'admin-1' }))
const mockNotify = jest.fn(async () => ({ outcome: 'handled', channels: [] }))
const mockStage = jest.fn()
let mockEntitled = true
let mockQuoter: any = null

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: any[]) => mockVerifyIdToken(...(args as [])),
      }),
      firestore: () => fakeFirestore,
    }),
  },
  getOrgForHost: async () => ({ org: { id: 'org-1', plan: mockEntitled ? 'business' : 'free' } }),
  consumeRateLimit: async () => ({ allowed: true }),
}))
jest.mock('@aglyn/aglyn/server', () => {
  const actual = jest.requireActual('@aglyn/aglyn/server')
  return { ...actual, checkEntitlement: () => mockEntitled }
})
jest.mock('./order-notifications', () => ({
  notifyOrderBuyer: (...args: unknown[]) => mockNotify(...(args as [])),
}))
jest.mock('./order-events', () => ({
  stageOrderEvent: (...args: unknown[]) => mockStage(...args),
  fulfillmentEventView: () => ({ id: 'view' }),
}))
jest.mock('@aglyn/aglyn/plugin-manager/plugin-shipping-rates', () => ({
  pluginShippingRateQuoter: () => mockQuoter,
}))

const HOST = 'host-1'
const ORDER = 'order-1'
const ORDER_PATH = `hosts/${HOST}/orders/${ORDER}`

function seedHost(roles: Record<string, string> = { 'admin-1': 'admin' }): void {
  docs.set(`hosts/${HOST}`, { memberRoles: roles })
}

const LINES = [
  { productId: 'p1', name: 'Bread', quantity: 2, unitAmountCents: 500, productType: 'physical' },
  { productId: 'p2', name: 'Recipe', quantity: 1, unitAmountCents: 300, productType: 'digital' },
]

function seedPickup(overrides: Record<string, any> = {}): void {
  docs.set(ORDER_PATH, {
    status: 'paid',
    channel: 'online',
    fulfillmentMethod: 'pickup',
    pickup: { locationId: 'main', locationName: 'Main Street', status: 'preparing' },
    fulfillmentKey: 'pickup_preparing',
    fulfillmentLocationId: 'main',
    fulfillmentDueMs: 1,
    lineItems: LINES,
    timeline: [{ atMs: 1, event: 'paid' }],
    createdAtMs: 1,
    ...overrides,
  })
}

function seedDelivery(overrides: Record<string, any> = {}): void {
  docs.set(ORDER_PATH, {
    status: 'paid',
    channel: 'online',
    fulfillmentMethod: 'local_delivery',
    localDelivery: {
      zoneId: 'near',
      zoneName: 'Downtown',
      feeCents: 500,
      windowStartMs: 5000,
      windowEndMs: 9000,
      status: 'scheduled',
    },
    lineItems: LINES,
    timeline: [{ atMs: 1, event: 'paid' }],
    createdAtMs: 1,
    ...overrides,
  })
}

function makeResponse() {
  const result = { status: 0, body: undefined as any }
  const res = {
    status(code: number) {
      result.status = code
      return res
    },
    json(body: unknown) {
      result.body = body
    },
    send(body: unknown) {
      result.body = body
    },
    setHeader() {
      // unused
    },
    redirect() {
      // unused
    },
    end() {
      // unused
    },
  } as unknown as PluginApiResponse
  return { res, result }
}

function request(body: Record<string, unknown>, method = 'POST', token = 'token'): PluginApiRequest {
  return {
    method,
    query: method === 'GET' ? { hostId: HOST, ...body } : {},
    body: method === 'POST' ? { hostId: HOST, orderId: ORDER, ...body } : undefined,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    cookies: {},
  } as unknown as PluginApiRequest
}

async function call(body: Record<string, unknown>, method = 'POST', token = 'token') {
  const { res, result } = makeResponse()
  await localFulfillmentHandler(request(body, method, token), res)
  return result
}

beforeEach(() => {
  docs.clear()
  mockNotify.mockClear()
  mockStage.mockClear()
  mockVerifyIdToken.mockClear()
  mockEntitled = true
  mockQuoter = null
  seedHost()
})

describe('pickup steps', () => {
  it('marks ready, stamps the queue key, and tells the buyer once the write lands', async () => {
    seedPickup()
    const result = await call({ action: 'ready' })
    expect(result).toEqual({ status: 200, body: { ok: true, status: 'paid' } })
    const order = docs.get(ORDER_PATH) as any
    expect(order.pickup.status).toBe('ready')
    expect(order.pickup.readyAtMs).toEqual(expect.any(Number))
    expect(order.fulfillmentKey).toBe('pickup_ready')
    expect(order.fulfillmentLocationId).toBe('main')
    expect(order.timeline.at(-1)).toMatchObject({ event: 'ready-for-pickup', detail: 'Ready for pickup at Main Street' })
    expect(mockNotify).toHaveBeenCalledWith({ hostId: HOST, orderId: ORDER }, 'ready_for_pickup')
    expect(mockStage).not.toHaveBeenCalled()
  })

  it('answers a repeat as already, writing nothing and telling nobody twice', async () => {
    seedPickup({ pickup: { locationId: 'main', locationName: 'Main Street', status: 'ready', readyAtMs: 5 } })
    const before = JSON.stringify(docs.get(ORDER_PATH))
    const result = await call({ action: 'ready' })
    expect(result.body).toEqual({ ok: true, already: true })
    expect(JSON.stringify(docs.get(ORDER_PATH))).toBe(before)
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('takes a ready back to preparing without a message', async () => {
    seedPickup({ pickup: { locationId: 'main', locationName: 'Main Street', status: 'ready', readyAtMs: 5 } })
    await call({ action: 'preparing' })
    const order = docs.get(ORDER_PATH) as any
    expect(order.pickup.status).toBe('preparing')
    expect(order.pickup.readyAtMs).toBeUndefined()
    expect(order.fulfillmentKey).toBe('pickup_preparing')
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('a pickup hands over the whole order: one handover fulfillment, delivered, both events', async () => {
    seedPickup({ pickup: { locationId: 'main', locationName: 'Main Street', status: 'ready' } })
    const result = await call({ action: 'picked_up', pickedUpBy: '  Sam  ' })
    expect(result.body).toEqual({ ok: true, status: 'delivered' })
    const order = docs.get(ORDER_PATH) as any
    expect(order.status).toBe('delivered')
    expect(order.pickup).toMatchObject({ status: 'picked_up', pickedUpBy: 'Sam' })
    expect(order.fulfillments).toHaveLength(1)
    expect(order.fulfillments[0]).toMatchObject({
      handover: 'pickup',
      notify: false,
      status: 'active',
      lines: [
        { lineItemId: 0, quantity: 2 },
        { lineItemId: 1, quantity: 1 },
      ],
    })
    expect(order.fulfillmentKey).toBe('pickup_picked_up')
    expect(order.timeline.map((entry: any) => entry.event)).toEqual(['paid', 'picked-up', 'fulfilled', 'delivered'])
    expect(mockStage.mock.calls.map((args) => (args[1] as any).id)).toEqual(['order.fulfilled', 'order.delivered'])
    expect(mockNotify).toHaveBeenCalledWith({ hostId: HOST, orderId: ORDER }, 'picked_up')
  })

  it('records the handover of an order already marked delivered without moving its status', async () => {
    seedPickup({ status: 'delivered' })
    const outcome = await moveLocalFulfillment({ hostId: HOST, orderId: ORDER, action: 'picked_up' })
    expect(outcome).toEqual({ outcome: 'updated', status: 'delivered', notify: 'picked_up' })
    expect(mockStage.mock.calls.map((args) => (args[1] as any).id)).toEqual(['order.fulfilled'])
  })

  it('refuses to hand over a cancelled or refunded order', async () => {
    seedPickup({ status: 'refunded' })
    const result = await call({ action: 'picked_up' })
    expect(result.status).toBe(409)
    expect(result.body.error).toBe('This order can’t move on from "refunded"')
    expect((docs.get(ORDER_PATH) as any).pickup.status).toBe('preparing')
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('refuses a picked-up order going back', async () => {
    seedPickup({ pickup: { locationId: 'main', locationName: 'Main Street', status: 'picked_up' } })
    const result = await call({ action: 'ready' })
    expect(result.status).toBe(409)
    expect(result.body.error).toBe('This order can’t move on from "Picked up"')
  })

  it('refuses a pickup step on a shipped or delivery order', async () => {
    seedDelivery()
    expect((await call({ action: 'ready' })).body.error).toBe('This order is not a pickup order')
    docs.set(ORDER_PATH, { status: 'paid', lineItems: LINES })
    expect((await call({ action: 'out_for_delivery' })).body.error).toBe('This order is not a local delivery order')
  })
})

describe('local delivery steps', () => {
  it('sends it out, and tells the buyer with the window', async () => {
    seedDelivery()
    const result = await call({ action: 'out_for_delivery' })
    expect(result.body).toEqual({ ok: true, status: 'paid' })
    const order = docs.get(ORDER_PATH) as any
    expect(order.localDelivery.status).toBe('out_for_delivery')
    expect(order.fulfillmentKey).toBe('delivery_out_for_delivery')
    expect(order.fulfillmentDueMs).toBe(5000)
    expect(mockNotify).toHaveBeenCalledWith({ hostId: HOST, orderId: ORDER }, 'out_for_delivery')
  })

  it('records a failed drop with its reason, and lets it go out again', async () => {
    seedDelivery({ localDelivery: { zoneId: 'near', zoneName: 'Downtown', feeCents: 500, windowStartMs: 5000, windowEndMs: 9000, status: 'out_for_delivery' } })
    await call({ action: 'delivery_failed', reason: 'Nobody home' })
    let order = docs.get(ORDER_PATH) as any
    expect(order.localDelivery).toMatchObject({ status: 'failed', failedReason: 'Nobody home' })
    expect(order.fulfillmentKey).toBe('delivery_failed')
    expect(mockNotify).not.toHaveBeenCalled()
    await call({ action: 'out_for_delivery' })
    order = docs.get(ORDER_PATH) as any
    expect(order.localDelivery.status).toBe('out_for_delivery')
  })

  it('delivers: a handover fulfillment, delivered, and the delivered message', async () => {
    seedDelivery({
      status: 'partially_fulfilled',
      fulfillments: [{ id: 'f1', lineItemIds: [1], lines: [{ lineItemId: 1, quantity: 1 }], atMs: 2 }],
      localDelivery: { zoneId: 'near', zoneName: 'Downtown', feeCents: 500, windowStartMs: 5000, windowEndMs: 9000, status: 'out_for_delivery' },
    })
    const result = await call({ action: 'delivered' })
    expect(result.body).toEqual({ ok: true, status: 'delivered' })
    const order = docs.get(ORDER_PATH) as any
    // Only what was still open is handed over.
    expect(order.fulfillments[1]).toMatchObject({ handover: 'local_delivery', lines: [{ lineItemId: 0, quantity: 2 }] })
    expect(order.localDelivery.deliveredAtMs).toEqual(expect.any(Number))
    expect(mockNotify).toHaveBeenCalledWith({ hostId: HOST, orderId: ORDER }, 'delivered')
  })
})

describe('the route', () => {
  it('needs a session, an admin or editor, and the commerce plan', async () => {
    seedPickup()
    expect((await call({ action: 'ready' }, 'POST', '')).status).toBe(401)
    seedHost({ 'admin-1': 'viewer' })
    expect((await call({ action: 'ready' })).status).toBe(403)
    seedHost({ 'admin-1': 'editor' })
    mockEntitled = false
    expect((await call({ action: 'ready' })).status).toBe(403)
    mockEntitled = true
    expect((await call({ action: 'ready' })).status).toBe(200)
  })

  it('refuses an unknown action and a missing order before reading anything', async () => {
    expect((await call({ action: 'ship' })).status).toBe(400)
    expect((await call({ action: 'ready', orderId: '' })).status).toBe(400)
    expect((await call({ action: 'ready', orderId: 'gone' })).status).toBe(404)
    expect(mockVerifyIdToken).toHaveBeenCalledTimes(1)
  })

  it('says whether distance zones can work here', async () => {
    expect((await call({}, 'GET')).body).toEqual({ radius: false })
    mockQuoter = { available: async () => true, validateAddress: async () => ({ verdict: 'valid', messages: [] }) }
    expect((await call({}, 'GET')).body).toEqual({ radius: true })
  })

  it('places a location on the map only when the address check returns a position', async () => {
    docs.set(`hosts/${HOST}/locations/main`, {
      name: 'Main',
      postalAddress: { line1: '1 Main St', city: 'Springfield', postalCode: '62701', country: 'US' },
    })
    mockQuoter = {
      available: async () => true,
      validateAddress: async () => ({ verdict: 'valid', messages: [], coordinates: { lat: 39.8, lng: -89.6 } }),
    }
    expect((await call({ action: 'locate', locationId: 'main' })).body).toEqual({
      ok: true,
      origin: { lat: 39.8, lng: -89.6 },
    })
    mockQuoter = { available: async () => true, validateAddress: async () => ({ verdict: 'valid', messages: [] }) }
    expect((await call({ action: 'locate', locationId: 'main' })).status).toBe(409)
    docs.set(`hosts/${HOST}/locations/bare`, { name: 'Bare' })
    expect((await call({ action: 'locate', locationId: 'bare' })).body.error).toBe(
      'Add a full street address to that location first.',
    )
  })
})
