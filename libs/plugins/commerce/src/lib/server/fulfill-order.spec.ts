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
import { fulfillOrderHandler } from './fulfill-order'

/**
 * Fulfil and mark-delivered re-ask the transition under the write (AGL-1819).
 *
 * The double is `cancel-order.spec.ts`'s in-memory Firestore, kept faithful
 * where these cases turn on it: `update()` REJECTS an absent document, a
 * transaction's writes are BUFFERED and applied at commit (all or nothing),
 * and transaction bodies are serialized. What this file leans on hardest is
 * simpler than the cancel spec's stock machinery: that the handler writes the
 * ORDER document only — the no-stock cases assert the product documents
 * byte-identical and the adjustments collection empty, not merely "the
 * numbers look right".
 *
 * NO STRIPE PATH IS EXERCISED — localhost carries the LIVE secret key. This
 * handler makes no network call at all, and `global.fetch` is a throwing stub
 * asserted UNCALLED after every case.
 *
 * The module is new, so a red-before-the-fix run cannot exist; non-vacuity is
 * proved by mutation instead (each reverted): dropping the transition guard,
 * dropping the already-in-target guard, replacing the fulfillments append
 * with a whole-array write, computing the timeline from an empty order
 * instead of the transaction's read, admitting `cancelled` as a target, and
 * narrowing the role gate to admin-only each fail the cases named for them.
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

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: any[]) => mockVerifyIdToken(...(args as [])),
      }),
      firestore: () => fakeFirestore,
    }),
  },
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HOST = 'host-1'
const ORDER = 'order-1'

function seedHost(
  roles: Record<string, string> = { 'admin-1': 'admin' },
): void {
  docs.set(`hosts/${HOST}`, { memberRoles: roles })
}

function seedOrder(overrides: Record<string, any> = {}): void {
  docs.set(`hosts/${HOST}/orders/${ORDER}`, {
    status: 'paid',
    channel: 'online',
    totals: { totalCents: 6200 },
    lineItems: [
      {
        productId: 'prod-tee',
        variantId: 'var-m',
        name: 'Tee',
        variantLabel: 'M',
        quantity: 3,
        unitAmountCents: 1400,
      },
      {
        productId: 'prod-mug',
        variantId: 'var-one',
        name: 'Mug',
        quantity: 2,
        unitAmountCents: 1000,
      },
    ],
    timeline: [{ atMs: 1, event: 'paid' }],
    createdAtMs: 1,
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// Request / response plumbing
// ---------------------------------------------------------------------------

function makeResponse() {
  const result = { status: 0, body: undefined as any }
  const res: PluginApiResponse = {
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

function makeRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
  method = 'POST',
): PluginApiRequest {
  return {
    method,
    query: {},
    body: { hostId: HOST, orderId: ORDER, to: 'fulfilled', ...body },
    headers: { authorization: 'Bearer token', ...headers },
    cookies: {},
    socket: {},
  } as unknown as PluginApiRequest
}

async function post(
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
  method = 'POST',
) {
  const { res, result } = makeResponse()
  await fulfillOrderHandler(makeRequest(body, headers, method), res)
  return result
}

/** What actually landed, not what the handler said. */
function storedOrder(): Record<string, any> {
  return docs.get(`hosts/${HOST}/orders/${ORDER}`) ?? {}
}

const fetchMock = jest.fn(async (url: any) => {
  throw new Error(`Unexpected fetch to ${String(url)}`)
})

let consoleError: jest.SpyInstance

beforeAll(() => {
  ;(global as any).fetch = fetchMock
  consoleError = jest
    .spyOn(console, 'error')
    .mockImplementation(() => undefined)
})

afterAll(() => {
  consoleError.mockRestore()
})

beforeEach(() => {
  docs.clear()
  generatedIds = 0
  transactionQueue = Promise.resolve()
  fetchMock.mockClear()
  consoleError.mockClear()
  mockVerifyIdToken.mockClear()
  mockVerifyIdToken.mockImplementation(async () => ({ uid: 'admin-1' }))
})

afterEach(() => {
  // No network, ever. Localhost carries the LIVE Stripe key.
  expect(fetchMock).not.toHaveBeenCalled()
})

// ---------------------------------------------------------------------------
// Fulfil
// ---------------------------------------------------------------------------

describe('fulfilling a paid order', () => {
  it('flips the status and records the fulfillment with its tracking', async () => {
    seedHost()
    seedOrder()

    const result = await post({ carrier: 'UPS', trackingNumber: '1Z999' })

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true })
    expect(storedOrder().status).toBe('fulfilled')
    expect(storedOrder().fulfillments).toEqual([
      {
        id: expect.any(String),
        lineItemIds: [0, 1],
        carrier: 'UPS',
        trackingNumber: '1Z999',
        atMs: expect.any(Number),
      },
    ])
    expect(storedOrder().timeline).toEqual([
      { atMs: 1, event: 'paid' },
      { atMs: expect.any(Number), event: 'fulfilled', detail: 'UPS 1Z999' },
    ])
  })

  it('says "Fulfilled" and stores no tracking keys when none was given', async () => {
    seedHost()
    seedOrder()

    await post()

    const [fulfillment] = storedOrder().fulfillments
    expect(fulfillment).toEqual({
      id: expect.any(String),
      lineItemIds: [0, 1],
      atMs: expect.any(Number),
    })
    expect(storedOrder().timeline[1]).toEqual({
      atMs: expect.any(Number),
      event: 'fulfilled',
      detail: 'Fulfilled',
    })
  })

  it('fulfils a partially_fulfilled order, appending to its fulfillments', async () => {
    seedHost()
    seedOrder({
      status: 'partially_fulfilled',
      fulfillments: [{ id: 'f-1', lineItemIds: [0], atMs: 5 }],
    })

    const result = await post({ trackingNumber: 'TN-2' })

    expect(result.status).toBe(200)
    expect(storedOrder().status).toBe('fulfilled')
    // Appended, not replaced — a whole-array write would erase the first
    // shipment's tracking.
    expect(storedOrder().fulfillments).toEqual([
      { id: 'f-1', lineItemIds: [0], atMs: 5 },
      {
        id: expect.any(String),
        lineItemIds: [0, 1],
        trackingNumber: 'TN-2',
        atMs: expect.any(Number),
      },
    ])
  })

  it("appends to the SERVER's timeline, so a note from another tab survives", async () => {
    seedHost()
    seedOrder({
      timeline: [
        { atMs: 1, event: 'paid' },
        { atMs: 2, event: 'note', detail: 'gift wrap please' },
      ],
    })

    await post()

    expect(storedOrder().timeline).toEqual([
      { atMs: 1, event: 'paid' },
      { atMs: 2, event: 'note', detail: 'gift wrap please' },
      { atMs: expect.any(Number), event: 'fulfilled', detail: 'Fulfilled' },
    ])
  })

  it('bounds carrier and tracking number like the supplier route does', async () => {
    seedHost()
    seedOrder()

    await post({ carrier: 'C'.repeat(80), trackingNumber: 'T'.repeat(80) })

    const [fulfillment] = storedOrder().fulfillments
    expect(fulfillment.carrier).toHaveLength(40)
    expect(fulfillment.trackingNumber).toHaveLength(60)
  })
})

// ---------------------------------------------------------------------------
// Delivered
// ---------------------------------------------------------------------------

describe('marking delivered', () => {
  it('flips a fulfilled order to delivered with a plain timeline event', async () => {
    seedHost()
    seedOrder({
      status: 'fulfilled',
      timeline: [
        { atMs: 1, event: 'paid' },
        { atMs: 2, event: 'fulfilled', detail: 'UPS 1Z999' },
      ],
    })

    const result = await post({ to: 'delivered' })

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true })
    expect(storedOrder().status).toBe('delivered')
    expect(storedOrder().timeline[2]).toEqual({
      atMs: expect.any(Number),
      event: 'delivered',
    })
  })

  it('refuses to mark a paid order delivered — it never shipped', async () => {
    seedHost()
    seedOrder()

    const result = await post({ to: 'delivered' })

    expect(result.status).toBe(409)
    expect(result.body).toEqual({
      error: 'Orders in "paid" cannot be marked delivered',
    })
    expect(storedOrder().status).toBe('paid')
  })
})

// ---------------------------------------------------------------------------
// The guard, and what the route refuses to be
// ---------------------------------------------------------------------------

describe('the re-asked transition', () => {
  it('refuses the stale dialog: fulfil lands on a refunded order as a 409', async () => {
    // The dialog rendered its Fulfill button from a `paid` order; the order
    // was refunded in another tab before the click. The old client write
    // landed `fulfilled` straight onto it.
    seedHost()
    seedOrder({ status: 'refunded' })

    const result = await post({ trackingNumber: '1Z999' })

    expect(result.status).toBe(409)
    expect(result.body).toEqual({
      error: 'Orders in "refunded" cannot be fulfilled',
    })
    expect(storedOrder().status).toBe('refunded')
    expect(storedOrder().fulfillments).toBeUndefined()
    expect(storedOrder().timeline).toEqual([{ atMs: 1, event: 'paid' }])
  })

  it('refuses to fulfil a cancelled order', async () => {
    seedHost()
    seedOrder({ status: 'cancelled' })

    const result = await post()

    expect(result.status).toBe(409)
    expect(result.body).toEqual({
      error: 'Orders in "cancelled" cannot be fulfilled',
    })
    expect(storedOrder().status).toBe('cancelled')
  })

  it('answers an already-fulfilled order as success WITHOUT a second fulfillment', async () => {
    seedHost()
    seedOrder({
      status: 'fulfilled',
      fulfillments: [{ id: 'f-1', lineItemIds: [0, 1], atMs: 5 }],
      timeline: [
        { atMs: 1, event: 'paid' },
        { atMs: 5, event: 'fulfilled', detail: 'UPS 1Z999' },
      ],
    })

    const result = await post({ trackingNumber: '1Z999' })

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true, already: true })
    // The retry wrote NOTHING — one fulfillment, two timeline entries.
    expect(storedOrder().fulfillments).toHaveLength(1)
    expect(storedOrder().timeline).toHaveLength(2)
  })

  it('answers an already-delivered order as success without writing', async () => {
    seedHost()
    seedOrder({
      status: 'delivered',
      timeline: [
        { atMs: 1, event: 'paid' },
        { atMs: 2, event: 'fulfilled' },
        { atMs: 3, event: 'delivered' },
      ],
    })

    const result = await post({ to: 'delivered' })

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true, already: true })
    expect(storedOrder().timeline).toHaveLength(3)
  })

  it('moves no stock and leaves an open restock question open', async () => {
    // A partial refund flagged a restock question, then the merchant ships
    // the rest. The question is still theirs to answer — fulfilment neither
    // moves stock nor speaks for them.
    seedHost()
    docs.set(`hosts/${HOST}/products/prod-tee`, {
      name: 'Tee',
      variants: [{ id: 'var-m', inventory: 12 }],
    })
    const check = {
      kind: 'refund',
      units: 1,
      lines: [{ productId: 'prod-tee', variantId: 'var-m', quantity: 1 }],
      fullyReversed: false,
      flaggedAtMs: 7,
    }
    seedOrder({ restockCheck: check })
    const productBefore = JSON.stringify(
      docs.get(`hosts/${HOST}/products/prod-tee`),
    )

    const result = await post()

    expect(result.status).toBe(200)
    expect(docs.get(`hosts/${HOST}/products/prod-tee`)).toEqual(
      JSON.parse(productBefore),
    )
    expect(childPaths(`hosts/${HOST}/inventoryAdjustments`)).toEqual([])
    expect(storedOrder().restockCheck).toEqual(check)
  })

  it('is NOT a door around the cancel and refund routes', async () => {
    // `cancelled` releases stock under cancel-order's transaction and
    // `refunded` moves money under refund's — a `paid` order could legally
    // reach either, so admitting them here would bypass those specifics.
    seedHost()
    seedOrder()

    for (const to of ['cancelled', 'refunded', 'paid', '', undefined]) {
      const result = await post({ to })
      expect(result.status).toBe(400)
      expect(result.body).toEqual({
        error: 'to must be fulfilled or delivered',
      })
    }
    expect(storedOrder().status).toBe('paid')
  })
})

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

describe('access', () => {
  it('rejects a GET', async () => {
    seedHost()
    seedOrder()
    const result = await post({}, {}, 'GET')
    expect(result.status).toBe(405)
    expect(storedOrder().status).toBe('paid')
  })

  it('rejects a request with no bearer token', async () => {
    seedHost()
    seedOrder()
    const result = await post({}, { authorization: '' })
    expect(result.status).toBe(401)
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
    expect(storedOrder().status).toBe('paid')
  })

  it('rejects a missing orderId before touching Firestore', async () => {
    const result = await post({ orderId: '' })
    expect(result.status).toBe(400)
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
  })

  it('rejects a Firestore-reserved id instead of throwing', async () => {
    const result = await post({ orderId: '__order__' })
    expect(result.status).toBe(400)
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
  })

  it('404s an unknown site', async () => {
    seedOrder()
    const result = await post()
    expect(result.status).toBe(404)
    expect(result.body).toEqual({ error: 'Unknown site' })
  })

  it('404s an unknown order', async () => {
    seedHost()
    const result = await post()
    expect(result.status).toBe(404)
    expect(result.body).toEqual({ error: 'Unknown order' })
  })

  it('refuses a viewer', async () => {
    seedHost({ 'admin-1': 'viewer' })
    seedOrder()
    const result = await post()
    expect(result.status).toBe(403)
    expect(storedOrder().status).toBe('paid')
  })

  it('refuses a signed-in stranger', async () => {
    seedHost({ 'someone-else': 'admin' })
    seedOrder()
    const result = await post()
    expect(result.status).toBe(403)
    expect(storedOrder().status).toBe('paid')
  })

  it('admits an editor, who could always fulfil client-side', async () => {
    seedHost({ 'admin-1': 'editor' })
    seedOrder()
    const result = await post()
    expect(result.status).toBe(200)
    expect(storedOrder().status).toBe('fulfilled')
  })

  it('500s on a rejected token without writing', async () => {
    seedHost()
    seedOrder()
    mockVerifyIdToken.mockRejectedValueOnce(new Error('expired'))
    const result = await post()
    expect(result.status).toBe(500)
    expect(result.body).toEqual({ error: 'Fulfill failed' })
    expect(storedOrder().status).toBe('paid')
  })
})
