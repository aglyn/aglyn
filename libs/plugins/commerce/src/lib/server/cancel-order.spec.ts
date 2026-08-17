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
import { cancelOrderHandler } from './cancel-order'

/**
 * Cancelling an order releases its stock, exactly once (AGL-1808).
 *
 * WHAT THE DOUBLE HAS TO MODEL, because these cases turn on all of it:
 *
 *  - `update()` REJECTS an absent document with gRPC `NOT_FOUND` (5), so a
 *    product deleted between the sale and the cancellation cannot be conjured
 *    back as a stub holding nothing but a variants array. The sale paths write
 *    stock with `set(…, { merge: true })`, which WOULD conjure one, and that
 *    difference is the reason the fake implements both.
 *  - `create()` REJECTS an existing document (code 6), the primitive an
 *    adjustment row is written with.
 *  - `FieldValue.increment` resolves to a NUMBER rather than being stored as a
 *    sentinel, so a double-count cannot hide inside an opaque object. The
 *    writer under test does not use it at all — stock is a whole-array replace
 *    — which is stricter still: a second release shows up as the wrong COUNT,
 *    and `restocks twice for one order` is what measures that.
 *  - `runTransaction` bodies are SERIALIZED. Real Firestore gets the same
 *    effect by aborting and retrying a transaction whose reads changed under
 *    it; serializing reproduces the property the once-only guard depends on.
 *  - product reads are COUNTED, so "one read per product, not one per line" is
 *    measured rather than asserted.
 *
 *  - a transaction's writes are BUFFERED and applied at COMMIT, all or nothing.
 *    An earlier version of this fake applied each write as it was issued, and
 *    it reported "nothing landed" green for a handler that had already
 *    half-written before its last write failed — a false green measured here,
 *    not imagined.
 *
 * The fidelity gap that remains, stated rather than hidden: a rejected commit
 * leaves this fake's store untouched because it never applied anything, where
 * real Firestore rolls back. The observable outcome is the same, but a handler
 * that wrote OUTSIDE the transaction would look atomic here and would not be.
 * Nothing under test writes outside it.
 *
 * NO STRIPE PATH IS EXERCISED — localhost carries the LIVE secret key. This
 * handler makes no network call at all, and `global.fetch` is a throwing stub
 * asserted UNCALLED after every case.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore, keyed by document path
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()

/** Every `products/{id}` read this file provoked, in order. */
let productReads: string[] = []
/** Product id whose read should throw, like a dead connection mid-transaction. */
let failProductRead = ''
/** Product id deleted the instant it is read, ahead of the write it feeds. */
let deleteProductAfterRead = ''
let generatedIds = 0

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

/**
 * `FieldValue.increment` as a sentinel the fake resolves on write, so a test
 * reads a NUMBER back and a double-count cannot hide in the object.
 */
function resolveFieldValues(
  existing: Record<string, any> | undefined,
  value: Record<string, any>,
): Record<string, any> {
  const resolved: Record<string, any> = {}
  for (const [key, field] of Object.entries(value)) {
    resolved[key] =
      field && typeof field === 'object' && '__increment' in field
        ? Number(existing?.[key] ?? 0) + Number(field.__increment)
        : field
  }
  return resolved
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
    get: async () => {
      if (path.includes('/products/')) {
        productReads.push(path)
        if (failProductRead && path.endsWith(`/${failProductRead}`)) {
          throw new Error('DEADLINE_EXCEEDED')
        }
      }
      // The snapshot captures the data first, so a document deleted right
      // after the read still reads as it did — the window a write derived
      // from that read has to survive.
      const snapshot = makeSnapshot(path)
      if (
        deleteProductAfterRead &&
        path.endsWith(`/${deleteProductAfterRead}`)
      ) {
        docs.delete(path)
      }
      return snapshot
    },
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      const existing = docs.get(path)
      const resolved = resolveFieldValues(existing, value)
      docs.set(
        path,
        options?.merge ? { ...(existing ?? {}), ...resolved } : resolved,
      )
    },
    /** `update()` REJECTS an absent document — it never conjures one. */
    update: async (value: Record<string, any>) => {
      const existing = docs.get(path)
      if (existing === undefined) {
        const error: any = new Error(`NOT_FOUND: no entity to update: ${path}`)
        error.code = 5
        throw error
      }
      docs.set(path, { ...existing, ...resolveFieldValues(existing, value) })
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

function makeCollectionRef(
  path: string,
  filters: Array<[string, unknown]> = [],
): any {
  return {
    doc: (id?: string) =>
      makeDocRef(`${path}/${id ?? `generated-${++generatedIds}`}`),
    /**
     * Equality only, like the one query the handler runs (AGL-1825). Anything
     * fancier throws rather than silently matching everything — a fake `where`
     * that ignored its filter would vouch for every order's ledger and pass
     * the guard tests against a handler that never filtered at all.
     */
    where: (field: string, op: string, value: unknown) => {
      if (op !== '==') throw new Error(`Unsupported operator: ${op}`)
      return makeCollectionRef(path, [...filters, [field, value]])
    },
    get: async () => ({
      docs: childPaths(path)
        .map(makeSnapshot)
        .filter((snapshot) =>
          filters.every(([field, value]) => snapshot.get(field) === value),
        ),
    }),
  }
}

/** One transaction body at a time — see the file header. */
let transactionQueue: Promise<unknown> = Promise.resolve()

/**
 * Writes are BUFFERED and applied at commit, all or nothing, the way Firestore
 * applies a transaction — `transaction.update()` returns synchronously and the
 * `NOT_FOUND` it earns surfaces when the batch lands. A fake that applied each
 * write as it was issued would report "nothing was written" green for a handler
 * that had already half-written before it failed.
 */
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
    // Keep the chain alive even when a body throws, or one rejection would
    // wedge every later transaction in the file.
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
    firestore: {
      FieldValue: {
        serverTimestamp: () => '<server-timestamp>',
        increment: (by: number) => ({ __increment: by }),
      },
    },
  },
}))

// ---------------------------------------------------------------------------
// Fixtures. Counted so nothing coincides: a 3-unit line of a product stocked
// at 12, a 2-unit line of one stocked at 5.
// ---------------------------------------------------------------------------

const HOST = 'host-1'
const ORDER = 'order-1'

function seedHost(
  roles: Record<string, string> = { 'admin-1': 'admin' },
): void {
  docs.set(`hosts/${HOST}`, { memberRoles: roles })
}

function seedProduct(
  id: string,
  variants: Array<{
    id: string
    inventory?: number | null
    inventoryByLocation?: Record<string, number>
  }>,
): void {
  docs.set(`hosts/${HOST}/products/${id}`, {
    name: `Product ${id}`,
    type: 'physical',
    status: 'active',
    variants: variants.map((variant) => ({ priceUsd: 20, ...variant })),
  })
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

/** The default two-line, two-product, fully tracked shop. */
function seedTrackedShop(orderOverrides: Record<string, any> = {}): void {
  seedHost()
  seedProduct('prod-tee', [{ id: 'var-m', inventory: 12 }])
  seedProduct('prod-mug', [{ id: 'var-one', inventory: 5 }])
  seedOrder(orderOverrides)
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
    body: { hostId: HOST, orderId: ORDER, ...body },
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
  await cancelOrderHandler(makeRequest(body, headers, method), res)
  return result
}

/** What actually landed, not what the handler said. */
function storedOrder(): Record<string, any> {
  return docs.get(`hosts/${HOST}/orders/${ORDER}`) ?? {}
}

function storedProduct(id: string): Record<string, any> {
  return docs.get(`hosts/${HOST}/products/${id}`) ?? {}
}

function inventoryOf(id: string, variantId: string): number | null | undefined {
  return (storedProduct(id).variants ?? []).find(
    (variant: any) => variant.id === variantId,
  )?.inventory
}

function adjustments(): Record<string, any>[] {
  return childPaths(`hosts/${HOST}/inventoryAdjustments`).map(
    (path) => docs.get(path) as Record<string, any>,
  )
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
  productReads = []
  failProductRead = ''
  deleteProductAfterRead = ''
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
// The release
// ---------------------------------------------------------------------------

describe('cancelling a paid order', () => {
  it('puts every tracked line back on the shelf', async () => {
    seedTrackedShop()

    const result = await post()

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true, released: 2, units: 5 })
    expect(inventoryOf('prod-tee', 'var-m')).toBe(15)
    expect(inventoryOf('prod-mug', 'var-one')).toBe(7)
  })

  it('logs one adjustment row per line, with the cancellation reason', async () => {
    seedTrackedShop()

    await post()

    expect(adjustments()).toEqual([
      {
        productId: 'prod-tee',
        variantId: 'var-m',
        delta: 3,
        reason: 'cancellation',
        orderId: ORDER,
        atMs: expect.any(Number),
      },
      {
        productId: 'prod-mug',
        variantId: 'var-one',
        delta: 2,
        reason: 'cancellation',
        orderId: ORDER,
        atMs: expect.any(Number),
      },
    ])
  })

  it('flips the status and says how many units came back', async () => {
    seedTrackedShop()

    await post()

    expect(storedOrder().status).toBe('cancelled')
    expect(storedOrder().timeline).toEqual([
      { atMs: 1, event: 'paid' },
      {
        atMs: expect.any(Number),
        event: 'cancelled',
        detail: '5 units returned to stock',
      },
    ])
  })

  it('keeps the flat total denormalized with the variants it wrote', async () => {
    seedHost()
    seedProduct('prod-tee', [
      { id: 'var-m', inventory: 12 },
      { id: 'var-l', inventory: 4 },
    ])
    seedProduct('prod-mug', [{ id: 'var-one', inventory: 5 }])
    seedOrder()

    await post()

    expect(storedProduct('prod-tee').inventory).toBe(19)
    expect(storedProduct('prod-tee').updatedAtMs).toEqual(expect.any(Number))
  })

  it('sums two lines of ONE product into a single write', async () => {
    seedHost()
    seedProduct('prod-tee', [
      { id: 'var-m', inventory: 12 },
      { id: 'var-l', inventory: 4 },
    ])
    seedOrder({
      lineItems: [
        { productId: 'prod-tee', variantId: 'var-m', quantity: 3, name: 'Tee' },
        { productId: 'prod-tee', variantId: 'var-l', quantity: 2, name: 'Tee' },
      ],
    })

    await post()

    // Both deltas land. Written as two updates computed from one read, the
    // second would have overwritten the first and lost three units.
    expect(inventoryOf('prod-tee', 'var-m')).toBe(15)
    expect(inventoryOf('prod-tee', 'var-l')).toBe(6)
    expect(adjustments()).toHaveLength(2)
  })

  it('sums the SAME variant listed twice', async () => {
    seedHost()
    seedProduct('prod-tee', [{ id: 'var-m', inventory: 12 }])
    seedOrder({
      lineItems: [
        { productId: 'prod-tee', variantId: 'var-m', quantity: 3, name: 'Tee' },
        { productId: 'prod-tee', variantId: 'var-m', quantity: 2, name: 'Tee' },
      ],
    })

    await post()

    expect(inventoryOf('prod-tee', 'var-m')).toBe(17)
  })

  it('reads each product once, not once per line', async () => {
    seedHost()
    seedProduct('prod-tee', [{ id: 'var-m', inventory: 12 }])
    seedOrder({
      lineItems: [
        { productId: 'prod-tee', variantId: 'var-m', quantity: 1, name: 'Tee' },
        { productId: 'prod-tee', variantId: 'var-m', quantity: 1, name: 'Tee' },
        { productId: 'prod-tee', variantId: 'var-m', quantity: 1, name: 'Tee' },
      ],
    })

    await post()

    expect(productReads).toEqual([`hosts/${HOST}/products/prod-tee`])
  })

  it('lifts a legacy order with no stored status', async () => {
    seedHost()
    seedProduct('prod-tee', [{ id: 'var-m', inventory: 12 }])
    docs.set(`hosts/${HOST}/orders/${ORDER}`, {
      lineItems: [
        { productId: 'prod-tee', variantId: 'var-m', quantity: 3, name: 'Tee' },
      ],
    })

    const result = await post()

    expect(result.status).toBe(200)
    expect(inventoryOf('prod-tee', 'var-m')).toBe(15)
  })
})

// ---------------------------------------------------------------------------
// What must NOT be released
// ---------------------------------------------------------------------------

describe('what stays off the shelf', () => {
  it('releases nothing for a pending order — the sale never decremented', async () => {
    seedTrackedShop({ status: 'pending' })

    const result = await post()

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true, released: 0, units: 0 })
    expect(storedOrder().status).toBe('cancelled')
    expect(inventoryOf('prod-tee', 'var-m')).toBe(12)
    expect(inventoryOf('prod-mug', 'var-one')).toBe(5)
    expect(adjustments()).toHaveLength(0)
    expect(productReads).toEqual([])
  })

  it('does not restock twice for one order', async () => {
    seedTrackedShop()

    const first = await post()
    const second = await post()

    expect(first.body).toEqual({ ok: true, released: 2, units: 5 })
    expect(second.status).toBe(200)
    expect(second.body).toEqual({
      ok: true,
      alreadyCancelled: true,
      released: 0,
      units: 0,
    })
    expect(inventoryOf('prod-tee', 'var-m')).toBe(15)
    expect(adjustments()).toHaveLength(2)
  })

  it('releases once when two admins cancel at the same moment', async () => {
    seedTrackedShop()

    const [first, second] = await Promise.all([post(), post()])

    expect([first.status, second.status]).toEqual([200, 200])
    expect(inventoryOf('prod-tee', 'var-m')).toBe(15)
    expect(inventoryOf('prod-mug', 'var-one')).toBe(7)
    expect(adjustments()).toHaveLength(2)
    expect(
      storedOrder().timeline.filter((e: any) => e.event === 'cancelled'),
    ).toHaveLength(1)
  })

  it('refuses a fulfilled order and moves nothing', async () => {
    seedTrackedShop({ status: 'fulfilled' })

    const result = await post()

    expect(result.status).toBe(409)
    expect(result.body).toEqual({
      error: 'Orders in "fulfilled" cannot cancel',
    })
    expect(storedOrder().status).toBe('fulfilled')
    expect(inventoryOf('prod-tee', 'var-m')).toBe(12)
    expect(adjustments()).toHaveLength(0)
  })

  it.each(['partially_fulfilled', 'delivered', 'refunded'])(
    'refuses a %s order',
    async (status) => {
      seedTrackedShop({ status })

      const result = await post()

      expect(result.status).toBe(409)
      expect(storedOrder().status).toBe(status)
      expect(inventoryOf('prod-tee', 'var-m')).toBe(12)
    },
  )

  it('writes no adjustment row for a store that tracks no stock', async () => {
    seedHost()
    seedProduct('prod-tee', [{ id: 'var-m', inventory: null }])
    seedProduct('prod-mug', [{ id: 'var-one' }])
    seedOrder()

    const result = await post()

    expect(result.body).toEqual({ ok: true, released: 0, units: 0 })
    expect(storedOrder().status).toBe('cancelled')
    expect(storedOrder().timeline.at(-1)).toEqual({
      atMs: expect.any(Number),
      event: 'cancelled',
    })
    expect(adjustments()).toHaveLength(0)
    expect(storedProduct('prod-tee').updatedAtMs).toBeUndefined()
  })

  it('drops a line whose product was deleted, and restocks the rest', async () => {
    seedTrackedShop()
    docs.delete(`hosts/${HOST}/products/prod-mug`)

    const result = await post()

    expect(result.body).toEqual({ ok: true, released: 1, units: 3 })
    expect(inventoryOf('prod-tee', 'var-m')).toBe(15)
    // No phantom: `update()` would have rejected, and nothing tried to create.
    expect(docs.has(`hosts/${HOST}/products/prod-mug`)).toBe(false)
    expect(adjustments()).toHaveLength(1)
  })

  it('drops a line whose variant is gone from the product', async () => {
    seedHost()
    seedProduct('prod-tee', [{ id: 'var-xl', inventory: 12 }])
    seedProduct('prod-mug', [{ id: 'var-one', inventory: 5 }])
    seedOrder()

    const result = await post()

    expect(result.body).toEqual({ ok: true, released: 1, units: 2 })
    expect(inventoryOf('prod-tee', 'var-xl')).toBe(12)
    expect(inventoryOf('prod-mug', 'var-one')).toBe(7)
  })
})

// ---------------------------------------------------------------------------
// Location-tracked stock (AGL-286)
// ---------------------------------------------------------------------------

describe('multi-location stock', () => {
  it('returns POS units to the bucket the sale took them from', async () => {
    seedHost()
    seedProduct('prod-tee', [
      {
        id: 'var-m',
        inventory: 12,
        inventoryByLocation: { 'loc-shop': 4, 'loc-warehouse': 8 },
      },
    ])
    seedOrder({
      channel: 'pos',
      locationId: 'loc-shop',
      lineItems: [
        { productId: 'prod-tee', variantId: 'var-m', quantity: 3, name: 'Tee' },
      ],
    })

    await post()

    const variant = storedProduct('prod-tee').variants[0]
    expect(variant.inventoryByLocation).toEqual({
      'loc-shop': 7,
      'loc-warehouse': 8,
    })
    // The flat count stays the sum of the buckets, so the next location-aware
    // write cannot recompute the restock away.
    expect(variant.inventory).toBe(15)
    expect(adjustments()[0].locationId).toBe('loc-shop')
  })

  it('records no locationId for an online order', async () => {
    seedTrackedShop()

    await post()

    expect(adjustments()[0]).not.toHaveProperty('locationId')
  })
})

// ---------------------------------------------------------------------------
// The POS card order whose sale may never have decremented (AGL-1825)
// ---------------------------------------------------------------------------

/**
 * A POS card (QR) order is paid by the webhook's `commerce-draft` branch, and
 * until AGL-1825 that branch decremented NOTHING for it — the sale completed
 * and the shelf count never moved. Releasing such an order's stock on cancel
 * restocks units that were never taken, silently inflating inventory.
 *
 * The sale's own ledger is the discriminator: every decrement path pairs the
 * movement with a `reason: 'sale'` `inventoryAdjustments` row (AGL-1807 closed
 * the last hole), and the AGL-1825 webhook decrement writes them from day one.
 * So a paid card order with no sale row is one whose sale took nothing, and
 * nothing is what the cancel puts back. Scoped to card orders (the
 * `pos-card-pending` timeline event) because one historical path decremented
 * WITHOUT rows — pre-AGL-1807 draft links — and gating those on the ledger
 * would wrongly strand their stock.
 */
describe('a POS card order (AGL-1825)', () => {
  /** A paid QR sale: card-pending first, then the webhook's paid flip. */
  const CARD_TIMELINE = [
    { atMs: 1, event: 'pos-card-pending' },
    { atMs: 2, event: 'paid' },
  ]

  function seedSaleLedger(orderId: string = ORDER): void {
    docs.set(`hosts/${HOST}/inventoryAdjustments/sale-row-1`, {
      productId: 'prod-tee',
      variantId: 'var-m',
      delta: -3,
      reason: 'sale',
      orderId,
      atMs: 3,
    })
  }

  it('releases nothing when the sale never decremented', async () => {
    seedTrackedShop({ channel: 'pos', timeline: CARD_TIMELINE })

    const result = await post()

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true, released: 0, units: 0 })
    expect(storedOrder().status).toBe('cancelled')
    // The shelf counts stand exactly where the sale left them: untouched.
    expect(inventoryOf('prod-tee', 'var-m')).toBe(12)
    expect(inventoryOf('prod-mug', 'var-one')).toBe(5)
    expect(adjustments()).toEqual([])
    // And the timeline does not claim units came back.
    expect(storedOrder().timeline).toEqual([
      ...CARD_TIMELINE,
      { atMs: expect.any(Number), event: 'cancelled' },
    ])
  })

  it('releases a card sale whose decrement is in the ledger', async () => {
    seedTrackedShop({ channel: 'pos', timeline: CARD_TIMELINE })
    seedSaleLedger()

    const result = await post()

    expect(result.body).toEqual({ ok: true, released: 2, units: 5 })
    expect(inventoryOf('prod-tee', 'var-m')).toBe(15)
    expect(inventoryOf('prod-mug', 'var-one')).toBe(7)
  })

  /** A refund or cancellation row proves other movements, not the sale's. */
  it('does not let a non-sale row vouch for the decrement', async () => {
    seedTrackedShop({ channel: 'pos', timeline: CARD_TIMELINE })
    docs.set(`hosts/${HOST}/inventoryAdjustments/refund-row-1`, {
      productId: 'prod-tee',
      variantId: 'var-m',
      delta: 3,
      reason: 'refund',
      orderId: ORDER,
      atMs: 3,
    })

    const result = await post()

    expect(result.body).toEqual({ ok: true, released: 0, units: 0 })
    expect(inventoryOf('prod-tee', 'var-m')).toBe(12)
  })

  /** Another order's sale is not this order's. */
  it('does not let another order’s sale row vouch', async () => {
    seedTrackedShop({ channel: 'pos', timeline: CARD_TIMELINE })
    seedSaleLedger('order-somebody-else')

    const result = await post()

    expect(result.body).toEqual({ ok: true, released: 0, units: 0 })
    expect(inventoryOf('prod-tee', 'var-m')).toBe(12)
  })

  /**
   * The guard is for CARD orders only. A cash register sale decremented
   * synchronously in `pos-order.ts` — its ledger rows date from AGL-1807's
   * siblings and can be missing for older sales, so the ledger must not be
   * asked to vouch for a decrement that provably ran.
   */
  it('releases a cash register sale without consulting the ledger', async () => {
    seedTrackedShop({
      channel: 'pos',
      timeline: [{ atMs: 1, event: 'paid' }],
    })

    const result = await post()

    expect(result.body).toEqual({ ok: true, released: 2, units: 5 })
    expect(inventoryOf('prod-tee', 'var-m')).toBe(15)
    expect(inventoryOf('prod-mug', 'var-one')).toBe(7)
  })
})

// ---------------------------------------------------------------------------
// The open restock question (AGL-1797)
// ---------------------------------------------------------------------------

describe('an open restockCheck', () => {
  const openCheck = {
    kind: 'refund',
    lines: [{ productId: 'prod-tee', variantId: 'var-m', quantity: 3 }],
    units: 3,
    fullyReversed: false,
    flaggedAtMs: 10,
  }

  it('is answered by the release, so nobody restocks the units twice', async () => {
    seedTrackedShop({ restockCheck: openCheck })

    await post()

    expect(storedOrder().restockCheck).toEqual({
      ...openCheck,
      resolution: 'restocked',
      resolvedAtMs: expect.any(Number),
      resolvedBy: 'admin-1',
    })
  })

  it('is left alone when the merchant already answered it', async () => {
    const answered = {
      ...openCheck,
      resolution: 'dismissed',
      resolvedAtMs: 20,
      resolvedBy: 'admin-2',
    }
    seedTrackedShop({ restockCheck: answered })

    await post()

    expect(storedOrder().restockCheck).toEqual(answered)
  })

  it('is left open when the cancellation released nothing', async () => {
    seedHost()
    seedProduct('prod-tee', [{ id: 'var-m', inventory: null }])
    seedProduct('prod-mug', [{ id: 'var-one', inventory: null }])
    seedOrder({ restockCheck: openCheck })

    await post()

    expect(storedOrder().restockCheck).toEqual(openCheck)
  })
})

// ---------------------------------------------------------------------------
// Failure leaves the order open
// ---------------------------------------------------------------------------

describe('when the stock write cannot be made', () => {
  it('fails the cancel rather than cancelling without the release', async () => {
    seedTrackedShop()
    failProductRead = 'prod-mug'

    const result = await post()

    expect(result.status).toBe(500)
    expect(result.body).toEqual({ error: 'Cancel failed' })
    // Nothing landed: the order is still cancellable, and a retry restocks.
    expect(storedOrder().status).toBe('paid')
    expect(inventoryOf('prod-tee', 'var-m')).toBe(12)
    expect(adjustments()).toHaveLength(0)
    expect(consoleError).toHaveBeenCalledWith(
      'cancelOrder failed',
      expect.anything(),
    )
  })

  it('refuses to conjure a product deleted between the read and the write', async () => {
    seedTrackedShop()
    deleteProductAfterRead = 'prod-mug'

    const result = await post()

    expect(result.status).toBe(500)
    // `set(…, { merge: true })`, which the sale paths use, would have created
    // a product doc holding a variants array and nothing else — no name, no
    // status, no price — and the storefront lists what it finds.
    expect(docs.has(`hosts/${HOST}/products/prod-mug`)).toBe(false)
    // And the batch is all-or-nothing: the tee's release did not half-land.
    expect(inventoryOf('prod-tee', 'var-m')).toBe(12)
    expect(storedOrder().status).toBe('paid')
    expect(adjustments()).toHaveLength(0)
  })

  it('retries clean once the read recovers', async () => {
    seedTrackedShop()
    failProductRead = 'prod-mug'
    await post()
    failProductRead = ''

    const result = await post()

    expect(result.status).toBe(200)
    expect(inventoryOf('prod-tee', 'var-m')).toBe(15)
    expect(inventoryOf('prod-mug', 'var-one')).toBe(7)
    expect(adjustments()).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Who may cancel
// ---------------------------------------------------------------------------

describe('access', () => {
  it('rejects a GET', async () => {
    seedTrackedShop()

    const result = await post({}, {}, 'GET')

    expect(result.status).toBe(405)
    expect(storedOrder().status).toBe('paid')
  })

  it('rejects a request with no bearer token', async () => {
    seedTrackedShop()

    const result = await post({}, { authorization: '' })

    expect(result.status).toBe(401)
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
    expect(storedOrder().status).toBe('paid')
  })

  it('rejects a missing orderId before touching Firestore', async () => {
    seedTrackedShop()

    const result = await post({ orderId: '' })

    expect(result.status).toBe(400)
    expect(storedOrder().status).toBe('paid')
  })

  it('rejects a Firestore-reserved id instead of throwing', async () => {
    seedTrackedShop()

    const result = await post({ orderId: '__name__' })

    expect(result.status).toBe(400)
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('404s an unknown site', async () => {
    seedTrackedShop()
    docs.delete(`hosts/${HOST}`)

    const result = await post()

    expect(result.status).toBe(404)
    expect(result.body).toEqual({ error: 'Unknown site' })
    expect(storedOrder().status).toBe('paid')
  })

  it('404s an unknown order', async () => {
    seedTrackedShop()
    docs.delete(`hosts/${HOST}/orders/${ORDER}`)

    const result = await post()

    expect(result.status).toBe(404)
    expect(result.body).toEqual({ error: 'Unknown order' })
    // No phantom order: nothing conjured a doc for the id that was asked for.
    expect(docs.has(`hosts/${HOST}/orders/${ORDER}`)).toBe(false)
  })

  it('refuses a viewer', async () => {
    seedTrackedShop()
    docs.set(`hosts/${HOST}`, { memberRoles: { 'admin-1': 'viewer' } })

    const result = await post()

    expect(result.status).toBe(403)
    expect(storedOrder().status).toBe('paid')
    expect(inventoryOf('prod-tee', 'var-m')).toBe(12)
  })

  it('refuses a signed-in stranger', async () => {
    seedTrackedShop()
    mockVerifyIdToken.mockImplementation(async () => ({ uid: 'nobody' }))

    const result = await post()

    expect(result.status).toBe(403)
    expect(storedOrder().status).toBe('paid')
  })

  it('admits an editor, who could always cancel client-side', async () => {
    seedTrackedShop()
    docs.set(`hosts/${HOST}`, { memberRoles: { 'admin-1': 'editor' } })

    const result = await post()

    expect(result.status).toBe(200)
    expect(storedOrder().status).toBe('cancelled')
    expect(inventoryOf('prod-tee', 'var-m')).toBe(15)
  })

  it('500s on a rejected token without writing', async () => {
    seedTrackedShop()
    mockVerifyIdToken.mockImplementation(async () => {
      throw new Error('token expired')
    })

    const result = await post()

    expect(result.status).toBe(500)
    expect(storedOrder().status).toBe('paid')
  })
})
