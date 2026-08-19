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

import { flagOrderRestock } from './restock-flag'

/**
 * Stock left off the shelf by a reversed order (AGL-1797).
 *
 * Every assertion below about what LANDED on the order was, before this
 * change, an assertion about a field nothing had ever written.
 *
 * WHAT THE DOUBLE HAS TO MODEL, because these cases turn on all of it:
 *
 *  - `update()` REPLACES a top-level field, nested maps included. The "a
 *    re-flag does not inherit the answer the merchant already gave" case is
 *    exactly that difference — a double that recursed (as `set({merge:true})`
 *    correctly does, a few lines down) would report it green against a handler
 *    that had the bug.
 *  - `update()` REJECTS an absent document with gRPC `NOT_FOUND` (5), so a flag
 *    aimed at an order that is gone cannot conjure an order stub.
 *  - `runTransaction` bodies are SERIALIZED, reproducing the property the
 *    once-only guard depends on: the read and the write derived from it cannot
 *    interleave with another reversal's.
 *  - product reads are COUNTED, so "one read per product, not one per line" is
 *    measured rather than asserted.
 *
 * No Stripe path is exercised — localhost carries the LIVE secret key. This
 * module makes no network call at all and `global.fetch` is replaced with a
 * throwing stub to prove it.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore, keyed by document path
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()

/** Every `products/{id}` read this file provoked, in order. */
let productReads: string[] = []
/** Set by a test to make the next order read throw, like a dead connection. */
let failNextOrderRead = false

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `set(…, { merge: true })`: recurses into nested maps. */
function mergeInto(
  previous: Record<string, any>,
  patch: Record<string, any>,
): Record<string, any> {
  const merged = { ...previous }
  for (const [key, value] of Object.entries(patch)) {
    merged[key] =
      isPlainObject(value) && isPlainObject(previous[key])
        ? mergeInto(previous[key], value)
        : value
  }
  return merged
}

/**
 * `update()`: each top-level field is written WHOLESALE, so a nested map
 * REPLACES the stored one instead of merging into it. That is the semantics
 * `restockCheck` is written with and the reason a re-flag cannot inherit a
 * stale `resolution`.
 */
function updateInto(
  previous: Record<string, any>,
  patch: Record<string, any>,
): Record<string, any> {
  return { ...previous, ...patch }
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
    id: path.split('/').pop(),
    path,
    get: async () => {
      if (path.includes('/products/')) productReads.push(path)
      if (path.includes('/orders/') && failNextOrderRead) {
        failNextOrderRead = false
        throw new Error('DEADLINE_EXCEEDED')
      }
      return makeSnapshot(path)
    },
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      docs.set(
        path,
        options?.merge ? mergeInto(docs.get(path) ?? {}, value) : { ...value },
      )
    },
    update: async (value: Record<string, any>) => {
      const existing = docs.get(path)
      if (existing === undefined) {
        const error: any = new Error(`NOT_FOUND: no entity to update: ${path}`)
        error.code = 5
        throw error
      }
      docs.set(path, updateInto(existing, value))
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

/**
 * A collection reference, and the ONE query shape production runs against it
 * (AGL-2325): `where('orderId', '==', id)` over `inventoryAdjustments`.
 *
 * Modelled rather than stubbed, and modelled to REAL semantics. Before this
 * the fake offered `doc()` and nothing else, so `readSaleReleaseCaps`'
 * `.where(...)` threw a `TypeError`, the swallowing `catch` on that path
 * turned it into "no caps", and every assertion about capped quantities in
 * this file would have passed against code that never capped anything.
 *
 * The scan is prefix-based over the flat document map and excludes deeper
 * paths, so a subcollection of a document in this collection is not returned
 * as a member of it. Any operator other than `==` throws rather than matching
 * everything, because a filter a fake quietly ignores is a fake that reports
 * a whole-collection scan as a query result.
 */
function makeCollectionRef(path: string): any {
  const prefix = `${path}/`
  const query = (filters: [string, unknown][]): any => ({
    where: (field: string, op: string, value: unknown) => {
      if (op !== '==') {
        throw new Error(`fake firestore: unsupported query operator ${op}`)
      }
      return query([...filters, [field, value]])
    },
    get: async () => {
      const matched = [...docs.keys()]
        .filter(
          (key) =>
            key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
        )
        .filter((key) =>
          filters.every(([field, value]) => docs.get(key)?.[field] === value),
        )
        .map((key) => makeSnapshot(key))
      return { docs: matched, empty: matched.length === 0, size: matched.length }
    },
  })
  return { doc: (id: string) => makeDocRef(`${path}/${id}`), ...query([]) }
}

/** One transaction body at a time — see the file header. */
let transactionQueue: Promise<unknown> = Promise.resolve()

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
  runTransaction: <T>(fn: (transaction: any) => Promise<T>): Promise<T> => {
    const run = transactionQueue.then(() =>
      fn({
        get: (ref: any) => ref.get(),
        update: (ref: any, value: any) => {
          void ref.update(value)
        },
        set: (ref: any, value: any, options?: any) => {
          void ref.set(value, options)
        },
      }),
    )
    // Keep the chain alive even when a body throws, or one rejection would
    // wedge every later transaction in the file.
    transactionQueue = run.catch(() => undefined)
    return run
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
    firestore: {
      FieldValue: {
        serverTimestamp: () => '<server-timestamp>',
        increment: (by: number) => ({ __increment: by }),
      },
    },
  },
}))

// ---------------------------------------------------------------------------
// Fixtures. Priced and counted so nothing coincides (AGL-1711): a 3-unit line
// of a product stocked at 12, a 2-unit line of one stocked at 5.
// ---------------------------------------------------------------------------

const HOST = 'host-1'
const ORDER = 'order-9'

function seedProduct(
  id: string,
  variants: Array<{ id: string; inventory?: number | null }>,
): void {
  docs.set(`hosts/${HOST}/products/${id}`, {
    name: `Product ${id}`,
    type: 'physical',
    status: 'active',
    variants: variants.map((variant) => ({
      priceUsd: 20,
      ...variant,
    })),
  })
}

function seedOrder(overrides: Record<string, any> = {}): void {
  docs.set(`hosts/${HOST}/orders/${ORDER}`, {
    status: 'refunded',
    totals: { totalCents: 6200 },
    lineItems: [
      {
        productId: 'prod-tee',
        variantId: 'var-large',
        name: 'Cotton tee',
        variantLabel: 'Large',
        quantity: 3,
        unitAmountCents: 2000,
      },
    ],
    timeline: [{ atMs: 1, event: 'paid' }],
    ...overrides,
  })
}

function order(): Record<string, any> {
  return docs.get(`hosts/${HOST}/orders/${ORDER}`) ?? {}
}

function restockEvents(): any[] {
  return (order().timeline ?? []).filter(
    (event: any) => event.event === 'restock-check',
  )
}

const fetchMock = jest.fn(async () => {
  throw new Error('No network call belongs in this module')
})

beforeEach(() => {
  docs.clear()
  productReads = []
  failNextOrderRead = false
  transactionQueue = Promise.resolve()
  fetchMock.mockClear()
  global.fetch = fetchMock as any
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  seedProduct('prod-tee', [{ id: 'var-large', inventory: 12 }])
})

afterEach(() => {
  // This module talks to nothing but Firestore. Asserted every case, not once.
  expect(fetchMock).not.toHaveBeenCalled()
  jest.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// What the shelf actually lost (AGL-2325)
// ---------------------------------------------------------------------------

/**
 * The prompt's number is bounded by the sale's `appliedDelta` (AGL-2325).
 *
 * `line.quantity` is the units the sale SOLD. On a backorder product the
 * inventory floor absorbs part or all of the decrement — stock 0,
 * `canPurchase` admits the sale because the policy says to, three units sell,
 * `Math.max(0, 0 + -3)` leaves the count at 0 — so the units the count gave up
 * and the units the line sold are different numbers, and only the first one is
 * missing from the shelf.
 */
describe('flagOrderRestock — the prompt counts units the count gave up', () => {
  function seedSaleRow(
    id: string,
    row: Record<string, any>,
  ): void {
    docs.set(`hosts/${HOST}/inventoryAdjustments/${id}`, {
      productId: 'prod-tee',
      variantId: 'var-large',
      reason: 'sale',
      orderId: ORDER,
      atMs: 1,
      ...row,
    })
  }

  it('asks about the units the floor let go, not the units sold', async () => {
    // Sold 3, the count could only give up 1. Asking for 3 invites the
    // merchant to put two units on the shelf that were never taken off it.
    seedOrder()
    seedSaleRow('sale-1', { delta: -3, appliedDelta: -1 })
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'refund',
      closedTheOrder: true,
    })
    expect(order().restockCheck).toMatchObject({
      units: 1,
      lines: [{ productId: 'prod-tee', variantId: 'var-large', quantity: 1 }],
    })
    expect(restockEvents()[0].detail).toContain('1 unit may need restocking')
  })

  it('raises no question at all when the floor absorbed the whole decrement', async () => {
    // The pure backorder sale: stock was already 0, so nothing left the shelf
    // and there is nothing to put back. A "3 units may need restocking"
    // prompt here is not merely over-stated, it is about no units whatsoever.
    seedOrder()
    seedSaleRow('sale-1', { delta: -3, appliedDelta: 0 })
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'refund',
      closedTheOrder: true,
    })
    expect(order().restockCheck).toBeUndefined()
    expect(restockEvents()).toEqual([])
  })

  it('keeps the units sold when the ledger says nothing about the line', async () => {
    // The under-prompt this fix could have caused, and the reason only pairs
    // the ledger DESCRIBES are capped. A pre-AGL-1807 draft link decremented
    // stock with no row at all; zeroing it from a ledger with holes would
    // strand that stock silently. An absent ledger degrades to the old upper
    // bound, which is a question the merchant can still answer.
    seedOrder()
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'refund',
      closedTheOrder: true,
    })
    expect(order().restockCheck).toMatchObject({
      units: 3,
      lines: [{ quantity: 3 }],
    })
  })

  it('ignores rows belonging to another order, and non-sale rows', async () => {
    // The cap is only as good as the query behind it. A refund row on THIS
    // order and a sale row on another one both read as "0 units moved" if
    // either filter is dropped, which would silence the prompt entirely.
    seedOrder()
    seedSaleRow('other-order', { delta: -3, appliedDelta: 0, orderId: 'order-other' })
    seedSaleRow('refund-row', { delta: 3, reason: 'refund' })
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'refund',
      closedTheOrder: true,
    })
    expect(order().restockCheck).toMatchObject({ units: 3 })
  })

  it('falls back to `delta` on a row written before the floor was recorded', async () => {
    // `appliedDelta` is only written when something was clamped, so a row
    // without one moved exactly what it says.
    seedOrder()
    seedSaleRow('sale-1', { delta: -2 })
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'refund',
      closedTheOrder: true,
    })
    expect(order().restockCheck).toMatchObject({ units: 2 })
  })

  it('shares one budget between two lines of the same variant', async () => {
    // Two lines of one product+variant are two claims on ONE cap. Each
    // claiming it whole would report four units against a shelf that lost two.
    seedOrder({
      lineItems: [
        { productId: 'prod-tee', variantId: 'var-large', quantity: 2 },
        { productId: 'prod-tee', variantId: 'var-large', quantity: 2 },
      ],
    })
    seedSaleRow('sale-1', { delta: -4, appliedDelta: -2 })
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'refund',
      closedTheOrder: true,
    })
    expect(order().restockCheck.units).toBe(2)
    expect(order().restockCheck.lines).toEqual([
      expect.objectContaining({ quantity: 2 }),
    ])
  })
})

// ---------------------------------------------------------------------------
// What it flags
// ---------------------------------------------------------------------------

describe('flagOrderRestock — the stock a reversal left off the shelf', () => {
  it('records the tracked line, its units and the door the money left by', async () => {
    seedOrder()
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'refund',
      closedTheOrder: true,
    })
    expect(order().restockCheck).toMatchObject({
      kind: 'refund',
      units: 3,
      fullyReversed: true,
      lines: [
        {
          productId: 'prod-tee',
          variantId: 'var-large',
          quantity: 3,
          name: 'Cotton tee',
          variantLabel: 'Large',
        },
      ],
    })
    expect(order().restockCheck.flaggedAtMs).toBeGreaterThan(0)
    // The question is OPEN until a merchant answers it.
    expect(order().restockCheck.resolution).toBeUndefined()
  })

  it('appends the timeline event the console order dialog already renders', async () => {
    seedOrder()
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'refund',
      closedTheOrder: true,
    })
    expect(restockEvents()).toHaveLength(1)
    expect(restockEvents()[0].detail).toBe('3 units may need restocking')
    // Appended, not replacing: the paid event is still there.
    expect(order().timeline[0].event).toBe('paid')
  })

  it('sums units across every tracked line', async () => {
    seedProduct('prod-mug', [{ id: 'var-only', inventory: 5 }])
    seedOrder({
      lineItems: [
        {
          productId: 'prod-tee',
          variantId: 'var-large',
          quantity: 3,
          unitAmountCents: 2000,
        },
        {
          productId: 'prod-mug',
          variantId: 'var-only',
          quantity: 2,
          unitAmountCents: 100,
        },
      ],
    })
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'refund',
      closedTheOrder: true,
    })
    expect(order().restockCheck.units).toBe(5)
    expect(order().restockCheck.lines).toHaveLength(2)
  })

  it('says "unit" for one and "units" for more', async () => {
    seedOrder({
      lineItems: [
        {
          productId: 'prod-tee',
          variantId: 'var-large',
          quantity: 1,
          unitAmountCents: 2000,
        },
      ],
    })
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'refund',
      closedTheOrder: true,
    })
    expect(restockEvents()[0].detail).toBe('1 unit may need restocking')
  })

  it('falls back to the first variant when the line named none', async () => {
    seedOrder({
      lineItems: [
        { productId: 'prod-tee', quantity: 2, unitAmountCents: 2000 },
      ],
    })
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'refund',
      closedTheOrder: true,
    })
    expect(order().restockCheck.lines[0].variantId).toBe('var-large')
  })
})

// ---------------------------------------------------------------------------
// What it refuses to flag. These are the cases that decide whether the flag is
// a signal or noise, and every one of them writes NOTHING — no record and no
// timeline entry, so a merchant is never asked a question they cannot answer.
// ---------------------------------------------------------------------------

describe('flagOrderRestock — what it stays silent about', () => {
  it('says nothing when the store tracks no stock at all', async () => {
    // `inventory == null` is untracked (AGL-96), so the sale decremented
    // nothing and there is nothing to put back.
    seedProduct('prod-tee', [{ id: 'var-large', inventory: null }])
    seedOrder()
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'refund',
      closedTheOrder: true,
    })
    expect(order().restockCheck).toBeUndefined()
    expect(restockEvents()).toHaveLength(0)
  })

  it('drops the untracked line and keeps the tracked one', async () => {
    seedProduct('prod-poster', [{ id: 'var-only', inventory: null }])
    seedOrder({
      lineItems: [
        {
          productId: 'prod-poster',
          variantId: 'var-only',
          quantity: 4,
          unitAmountCents: 500,
        },
        {
          productId: 'prod-tee',
          variantId: 'var-large',
          quantity: 3,
          unitAmountCents: 2000,
        },
      ],
    })
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'refund',
      closedTheOrder: true,
    })
    expect(order().restockCheck.units).toBe(3)
    expect(order().restockCheck.lines).toHaveLength(1)
    expect(order().restockCheck.lines[0].productId).toBe('prod-tee')
  })

  it('DOES flag a digital line whose variant is stocked', async () => {
    // Tracking is the test, not the product type: a merchant counting license
    // keys had one taken off the pile and wants it back.
    docs.set(`hosts/${HOST}/products/prod-license`, {
      name: 'Licence',
      type: 'digital',
      status: 'active',
      variants: [{ id: 'var-key', priceUsd: 40, inventory: 7 }],
    })
    seedOrder({
      lineItems: [
        {
          productId: 'prod-license',
          variantId: 'var-key',
          productType: 'digital',
          quantity: 1,
          unitAmountCents: 4000,
        },
      ],
    })
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'refund',
      closedTheOrder: true,
    })
    expect(order().restockCheck.units).toBe(1)
  })

  it('drops a line whose product was deleted since the sale', async () => {
    docs.delete(`hosts/${HOST}/products/prod-tee`)
    seedOrder()
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'refund',
      closedTheOrder: true,
    })
    expect(order().restockCheck).toBeUndefined()
  })

  it('drops a line whose variant was removed from the product', async () => {
    seedProduct('prod-tee', [{ id: 'var-small', inventory: 12 }])
    seedOrder()
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'refund',
      closedTheOrder: true,
    })
    expect(order().restockCheck).toBeUndefined()
  })

  it('ignores lines with no product and lines of zero quantity', async () => {
    seedOrder({
      lineItems: [
        { productId: '', variantId: 'var-large', quantity: 3 },
        { productId: 'prod-tee', variantId: 'var-large', quantity: 0 },
      ],
    })
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'refund',
      closedTheOrder: true,
    })
    expect(order().restockCheck).toBeUndefined()
  })

  it('writes nothing, and does not conjure an order, when the order is gone', async () => {
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'refund',
      closedTheOrder: true,
    })
    expect(docs.has(`hosts/${HOST}/orders/${ORDER}`)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The partial, and the chargeback
// ---------------------------------------------------------------------------

describe('flagOrderRestock — an upper bound is labelled as one', () => {
  it('marks a partial reversal, because no reversal records which lines it covered', async () => {
    seedOrder()
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'refund',
      closedTheOrder: false,
    })
    expect(order().restockCheck.fullyReversed).toBe(false)
    // Still 3 — the units the line SOLD, which is the most that can come back.
    expect(order().restockCheck.units).toBe(3)
    expect(restockEvents()[0].detail).toBe(
      '3 units may need restocking (partial reversal, at most)',
    )
  })

  it('words a chargeback as the do-not-restock case it usually is', async () => {
    seedOrder()
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'chargeback',
      closedTheOrder: true,
    })
    expect(order().restockCheck.kind).toBe('chargeback')
    expect(restockEvents()[0].detail).toBe(
      '3 units may need restocking — the shopper kept the goods unless they came back',
    )
  })

  it('flags the same units for a chargeback as for a refund', async () => {
    // The flag never moves stock, so the two doors may share a record shape:
    // the asymmetry lives in the wording and in the merchant's answer.
    seedOrder()
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'chargeback',
      closedTheOrder: true,
    })
    expect(order().restockCheck.units).toBe(3)
    expect(order().restockCheck.lines[0].variantId).toBe('var-large')
  })
})

// ---------------------------------------------------------------------------
// Asked once, and asked again only once it has been answered
// ---------------------------------------------------------------------------

describe('flagOrderRestock — one open question at a time', () => {
  it('does not re-flag or re-append while the question is still open', async () => {
    seedOrder()
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'refund',
      closedTheOrder: false,
    })
    const first = order().restockCheck.flaggedAtMs
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'refund',
      closedTheOrder: true,
    })
    expect(restockEvents()).toHaveLength(1)
    expect(order().restockCheck.flaggedAtMs).toBe(first)
    // The FIRST answer stands: a second partial adds nothing a merchant
    // looking at an unanswered prompt does not already have.
    expect(order().restockCheck.fullyReversed).toBe(false)
  })

  it('two reversals settling at once flag exactly once', async () => {
    seedOrder()
    await Promise.all([
      flagOrderRestock({
        hostId: HOST,
        orderId: ORDER,
        kind: 'refund',
        closedTheOrder: false,
      }),
      flagOrderRestock({
        hostId: HOST,
        orderId: ORDER,
        kind: 'refund',
        closedTheOrder: true,
      }),
    ])
    expect(restockEvents()).toHaveLength(1)
  })

  it('asks again once the merchant has answered, WITHOUT inheriting the answer', async () => {
    // The `update()`-versus-merge case. A merge would leave `resolution:
    // 'restocked'` on a brand-new question, so the prompt would render as
    // already handled and the stock would stay off the shelf a second time.
    seedOrder({
      restockCheck: {
        kind: 'refund',
        lines: [{ productId: 'prod-tee', variantId: 'var-large', quantity: 1 }],
        units: 1,
        fullyReversed: false,
        flaggedAtMs: 100,
        resolution: 'restocked',
        resolvedAtMs: 200,
        resolvedBy: 'admin-1',
      },
    })
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'chargeback',
      closedTheOrder: true,
    })
    expect(order().restockCheck.units).toBe(3)
    expect(order().restockCheck.kind).toBe('chargeback')
    expect(order().restockCheck.resolution).toBeUndefined()
    expect(order().restockCheck.resolvedAtMs).toBeUndefined()
    expect(order().restockCheck.resolvedBy).toBeUndefined()
  })

  it('a dismissed question is re-asked too', async () => {
    seedOrder({
      restockCheck: {
        kind: 'refund',
        lines: [],
        units: 0,
        fullyReversed: true,
        flaggedAtMs: 100,
        resolution: 'dismissed',
        resolvedAtMs: 200,
      },
    })
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'refund',
      closedTheOrder: true,
    })
    expect(order().restockCheck.units).toBe(3)
    expect(order().restockCheck.resolution).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Reads, and the failures that must not reach the caller
// ---------------------------------------------------------------------------

describe('flagOrderRestock — reads and refusals', () => {
  it('reads each product once, not once per line', async () => {
    seedOrder({
      lineItems: [
        { productId: 'prod-tee', variantId: 'var-large', quantity: 3 },
        { productId: 'prod-tee', variantId: 'var-large', quantity: 2 },
      ],
    })
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'refund',
      closedTheOrder: true,
    })
    expect(productReads).toEqual([`hosts/${HOST}/products/prod-tee`])
    // Both lines are still flagged; the dedupe is on the READ, not the line.
    expect(order().restockCheck.units).toBe(5)
  })

  it('skips a Firestore-reserved product id without losing the rest of the order', async () => {
    // `.doc('__proto__')` throws SYNCHRONOUSLY at the service's reserved-id
    // rule, which no `.catch()` on the returned promise would see. One corrupt
    // line must not cost the whole flag.
    seedOrder({
      lineItems: [
        { productId: '__reserved__', variantId: 'var-large', quantity: 9 },
        { productId: 'prod-tee', variantId: 'var-large', quantity: 3 },
      ],
    })
    await flagOrderRestock({
      hostId: HOST,
      orderId: ORDER,
      kind: 'refund',
      closedTheOrder: true,
    })
    expect(order().restockCheck.units).toBe(3)
    expect(productReads).toEqual([`hosts/${HOST}/products/prod-tee`])
  })

  it('swallows a Firestore failure rather than failing the refund above it', async () => {
    seedOrder()
    failNextOrderRead = true
    await expect(
      flagOrderRestock({
        hostId: HOST,
        orderId: ORDER,
        kind: 'refund',
        closedTheOrder: true,
      }),
    ).resolves.toBeUndefined()
    expect(order().restockCheck).toBeUndefined()
    expect(console.error).toHaveBeenCalledWith(
      'flagOrderRestock failed',
      expect.any(Error),
    )
  })
})
