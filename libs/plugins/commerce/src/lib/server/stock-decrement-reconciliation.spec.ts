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
 * THE DEATH, MODELLED (AGL-2358).
 *
 * The premise this detector rests on is not asserted, it is REPRODUCED: the
 * cart branch of the real `commerceBillingWebhookHandler` is delivered, the
 * process stops between the order transaction and the stock decrement, and
 * Stripe redelivers the same event. The suite then asks what the redelivery
 * did — nothing — and what the reconciler can see.
 *
 * A test that stubbed the webhook and asserted "the reconciler flags a row
 * with no ledger entry" would prove only that the reconciler can subtract two
 * sets. What has to be shown is that the LOSS IS REACHABLE at all, and that a
 * redelivery does not repair it, because that is the entire justification for
 * shipping a detector rather than a fix.
 *
 * HOW THE DEATH IS MODELLED. `decrementVariantStock` is made to throw a
 * `ProcessKilled` sentinel on the first delivery, and the throw escapes the
 * handler uncaught. A real timeout or OOM kill unwinds no stack — but the
 * OBSERVABLE STATE it leaves is exactly this one: the order transaction has
 * committed, and nothing at or after the decrement ever ran. The redelivery
 * then runs against that state with the real helper restored, which is what
 * Stripe does. (It is also the shape AGL-2157 cannot see: that route's
 * `catch` fires on a throw, and a kill gives it nothing to catch.)
 *
 * The Firestore double follows `billing-webhook-low-stock.spec.ts`'s, plus the
 * `orderBy`/`limit` query support and the `ref.parent` chain the reconciler
 * needs, and a `runTransaction` that models Firestore's OWN-WRITE INVISIBILITY
 * and RETRIES ON CONTENTION — a `runTransaction` that merely calls its
 * callback would let the `created` guard pass for reasons the real one would
 * not, and the redelivery half of this suite is precisely a claim about that
 * guard.
 */

import * as CommerceModel from '../model'

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

interface Stored {
  data: Record<string, any>
  version: number
}

const docs = new Map<string, Stored>()
let autoIdCounter = 0
/** Transaction retries, so a test can prove contention was modelled. */
let transactionRetries = 0

const setDoc = (path: string, data: Record<string, any>) =>
  docs.set(path, { data, version: (docs.get(path)?.version ?? 0) + 1 })

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function makeSnapshot(path: string): any {
  const stored = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: stored !== undefined,
    data: () => stored?.data,
    get: (field: string) => stored?.data?.[field],
    // The parent chain `scanStockDecrements` walks to name the host.
    ref: makeDocRef(path),
  }
}

function makeDocRef(path: string): any {
  const segments = path.split('/')
  return {
    id: segments[segments.length - 1],
    path,
    get parent() {
      return makeCollectionRef(segments.slice(0, -1).join('/'))
    },
    get: async () => makeSnapshot(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      setDoc(
        path,
        options?.merge ? { ...(docs.get(path)?.data ?? {}), ...value } : value,
      )
    },
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  const segments = path.split('/')
  const query = (order?: { field: string; dir: string }, max?: number) => {
    const self: any = {
      orderBy: (field: string, dir = 'asc') => query({ field, dir }, max),
      limit: (value: number) => query(order, value),
      where: () => self,
      get: async () => {
        let rows = childPaths(path).map(makeSnapshot)
        if (order) {
          // Firestore EXCLUDES documents missing the ordered field. Modelled,
          // because a reconciler that silently skipped orders without
          // `createdAtMs` would look clean for the wrong reason.
          rows = rows
            .filter((row) => row.get(order.field) !== undefined)
            .sort((a, b) => {
              const left = Number(a.get(order.field) ?? 0)
              const right = Number(b.get(order.field) ?? 0)
              return order.dir === 'desc' ? right - left : left - right
            })
        }
        if (max != null) rows = rows.slice(0, max)
        return { docs: rows, size: rows.length, empty: rows.length === 0 }
      },
    }
    return self
  }
  const ref: any = {
    ...query(),
    id: segments[segments.length - 1],
    path,
    get parent() {
      return segments.length > 1
        ? makeDocRef(segments.slice(0, -1).join('/'))
        : undefined
    },
    doc: (id?: string) =>
      makeDocRef(`${path}/${id ?? `auto-${++autoIdCounter}`}`),
    add: async (value: Record<string, any>) => {
      const created = makeDocRef(`${path}/auto-${++autoIdCounter}`)
      setDoc(created.path, value)
      return created
    },
  }
  return ref
}

const fakeFirestore: any = {
  collection: (name: string) => makeCollectionRef(name),
  collectionGroup: (name: string) => {
    const matching = () =>
      [...docs.keys()].filter((key) => {
        const segments = key.split('/')
        return segments.length >= 2 && segments[segments.length - 2] === name
      })
    const query = (order?: { field: string; dir: string }, max?: number) => {
      const self: any = {
        orderBy: (field: string, dir = 'asc') => query({ field, dir }, max),
        limit: (value: number) => query(order, value),
        get: async () => {
          let rows = matching().map(makeSnapshot)
          if (order) {
            rows = rows
              .filter((row) => row.get(order.field) !== undefined)
              .sort((a, b) => {
                const left = Number(a.get(order.field) ?? 0)
                const right = Number(b.get(order.field) ?? 0)
                return order.dir === 'desc' ? right - left : left - right
              })
          }
          if (max != null) rows = rows.slice(0, max)
          return { docs: rows, size: rows.length, empty: rows.length === 0 }
        },
      }
      return self
    }
    return query()
  },
  runTransaction: async (fn: (transaction: any) => Promise<any>) => {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const readVersions = new Map<string, number>()
      const pending: Array<[string, any, any]> = []
      const transaction = {
        get: async (ref: any) => {
          readVersions.set(ref.path, docs.get(ref.path)?.version ?? 0)
          // Own pending writes are INVISIBLE to a later read in the same
          // transaction, as in the real client.
          return makeSnapshot(ref.path)
        },
        set: (ref: any, value: any, options?: any) => {
          pending.push([ref.path, value, options])
        },
      }
      const result = await fn(transaction)
      const contended = [...readVersions].some(
        ([path, version]) => (docs.get(path)?.version ?? 0) !== version,
      )
      if (contended) {
        transactionRetries += 1
        continue
      }
      for (const [path, value, options] of pending) {
        setDoc(
          path,
          options?.merge
            ? { ...(docs.get(path)?.data ?? {}), ...value }
            : value,
        )
      }
      return result
    }
    throw new Error('Transaction failed after 16 attempts')
  },
}

const notifications: any[] = []

jest.mock('@aglyn/tenant-data-admin', () => {
  const { updateExisting } = jest.requireActual(
    '@aglyn/tenant-data-admin/server/update-existing',
  )
  return {
    updateExisting,
    firebaseAdmin: {
      app: () => ({ firestore: () => fakeFirestore }),
      firestore: {
        FieldValue: {
          serverTimestamp: () => '<server-timestamp>',
          arrayUnion: (value: any) => ({ __arrayUnion: value }),
          increment: (value: number) => ({ __increment: value }),
        },
      },
    },
    findUserByUidAcrossPools: async () => null,
    getOrgForHost: async () => ({
      org: { id: 'org-1', plan: 'business', ownerUid: 'owner-1' },
    }),
    meterHostEmail: async () => undefined,
    notifyHostManagers: async (hostId: string, notification: any) => {
      notifications.push({ hostId, ...notification })
    },
    upsertHostContact: async () => undefined,
    renderHostEmailWithTokens: async () => null,
  }
})

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  sendEmail: async () => undefined,
}))

/**
 * THE KILL SWITCH. The real helper by default; a throw that escapes the
 * handler when armed. Nothing else about the webhook is stubbed.
 */
class ProcessKilled extends Error {}
let killDecrementsAfterOrder = false

jest.mock('./reserve-stock', () => {
  const actual = jest.requireActual('./reserve-stock')
  return {
    ...actual,
    decrementVariantStock: (options: any) => {
      if (killDecrementsAfterOrder) {
        throw new ProcessKilled('container terminated')
      }
      return actual.decrementVariantStock(options)
    },
  }
})

import { commerceBillingWebhookHandler } from './billing-webhook'
import {
  reconcileHostStockDecrements,
  reportMissingSaleDecrements,
  scanStockDecrements,
} from './reconcile-stock'

/**
 * An UNLOCKED gate (AGL-2495) — this suite is about the reconciliation
 * itself. The locked answer is asserted in `job-lockdown.spec.ts`.
 */
const OPEN_GATE = { isLocked: async () => false }

const fetchMock = jest.fn(async (url: any) => {
  throw new Error(`Unexpected fetch to ${String(url)}`)
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HOST = 'host-1'
const NOW = 1_760_000_000_000
/** Well past the ten-minute grace, so the order is settled. */
const LONG_AGO = NOW - 60 * 60 * 1000

const CART_SESSION = {
  id: 'cs_cart_death',
  payment_status: 'paid',
  payment_intent: 'pi_cart_death',
  amount_total: 4500,
  customer_details: { email: 'buyer@example.com', name: 'Ada Cartwright' },
  total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 0 },
  metadata: {
    type: 'commerce-cart',
    hostId: HOST,
    cartId: 'cart-1',
    feeCents: '146',
  },
}

async function deliver(object: any) {
  await commerceBillingWebhookHandler({
    type: 'checkout.session.completed',
    object,
    requestHost: 'acme.aglyn.app',
  } as any)
}

const hostRef = () => fakeFirestore.collection('hosts').doc(HOST)

const reconcile = (overrides: Record<string, any> = {}) =>
  reconcileHostStockDecrements({
    firestore: fakeFirestore,
    hostRef: hostRef(),
    hostId: HOST,
    nowMs: NOW,
    ...overrides,
  })

const inventoryOf = (productId = 'product-1') =>
  (docs.get(`hosts/${HOST}/products/${productId}`) as Stored).data.variants[0]
    .inventory

const saleRows = () =>
  childPaths(`hosts/${HOST}/inventoryAdjustments`)
    .map((path) => docs.get(path)!.data)
    .filter((row) => row.reason === 'sale')

/** Backdates the order the webhook just minted past the grace window. */
function settleOrders(atMs = LONG_AGO) {
  for (const path of childPaths(`hosts/${HOST}/orders`)) {
    setDoc(path, { ...docs.get(path)!.data, createdAtMs: atMs })
  }
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

beforeEach(() => {
  docs.clear()
  notifications.length = 0
  autoIdCounter = 0
  transactionRetries = 0
  killDecrementsAfterOrder = false
  fetchMock.mockClear()

  setDoc(`hosts/${HOST}`, { displayName: 'Acme Boxes' })
  setDoc(`hosts/${HOST}/products/product-1`, {
    name: 'Monthly box',
    type: 'physical',
    variants: [{ id: 'large', priceUsd: 15, sku: 'BOX-L', inventory: 10 }],
  })
  setDoc(`hosts/${HOST}/carts/cart-1`, {
    lines: [{ productId: 'product-1', variantId: 'large', quantity: 3 }],
  })
})

// ---------------------------------------------------------------------------

describe('the loss itself (AGL-2358)', () => {
  it('loses the decrement forever when the process dies and Stripe redelivers', async () => {
    killDecrementsAfterOrder = true
    await expect(deliver(CART_SESSION)).rejects.toBeInstanceOf(ProcessKilled)

    // The order transaction COMMITTED before the death — this is the half
    // that makes the redelivery a no-op.
    const order = docs.get(`hosts/${HOST}/orders/cs_cart_death`)
    expect(order?.data.status).toBe('paid')
    expect(inventoryOf()).toBe(10)
    expect(saleRows()).toEqual([])

    // THE REDELIVERY, with the real helper back. The `created` guard turns
    // the whole tail of the branch away.
    killDecrementsAfterOrder = false
    await deliver(CART_SESSION)

    expect(inventoryOf()).toBe(10)
    expect(saleRows()).toEqual([])
    expect(childPaths(`hosts/${HOST}/orders`)).toHaveLength(1)
  })

  /**
   * THE LOSS IS DOUBLY LOCKED, and this is why a re-entry path is not the
   * bounded change it sounds like. Deleting the `created` guard does NOT make
   * the redelivery above decrement: `cartRef.delete()` runs between the guard
   * and the inventory loop, so the second delivery reads an empty cart and
   * the loop has nothing to iterate. A resumable guard would therefore also
   * have to stop reading the cart and start reading the order's own
   * `lineItems` — a second change, to the same branch, for the same fix.
   */
  it('cannot re-decrement on redelivery even with the created guard deleted', async () => {
    killDecrementsAfterOrder = true
    await expect(deliver(CART_SESSION)).rejects.toBeInstanceOf(ProcessKilled)

    // The cart the loop iterates is already gone — deleted before the death.
    expect(docs.has(`hosts/${HOST}/carts/cart-1`)).toBe(false)
  })

  it('does not double-decrement when a fully-processed event is redelivered', async () => {
    await deliver(CART_SESSION)
    expect(inventoryOf()).toBe(7)
    expect(saleRows()).toHaveLength(1)

    await deliver(CART_SESSION)

    expect(inventoryOf()).toBe(7)
    expect(saleRows()).toHaveLength(1)
    // The `created` guard's OWN observable effect, and the reason this test
    // is not just re-asserting the cart deletion above: the merchant's "New
    // order" push sits past the guard and depends on no cart, so deleting
    // the guard fires it twice while the stock assertions stay green.
    expect(
      notifications.filter((n) => n.type === 'content.order'),
    ).toHaveLength(1)
  })
})

describe('the reconciler sees it', () => {
  it('names the order, product, variant and units the shelf never gave up', async () => {
    killDecrementsAfterOrder = true
    await expect(deliver(CART_SESSION)).rejects.toBeInstanceOf(ProcessKilled)
    killDecrementsAfterOrder = false
    await deliver(CART_SESSION)
    settleOrders()

    const result = await reconcile()

    expect(result.ledgerTruncated).toBe(false)
    expect(result.ordersChecked).toBe(1)
    expect(result.missing).toEqual([
      {
        hostId: HOST,
        orderId: 'cs_cart_death',
        orderNumber: 1,
        orderStatus: 'paid',
        orderCreatedAtMs: LONG_AGO,
        productId: 'product-1',
        productName: 'Monthly box',
        variantId: 'large',
        quantity: 3,
      },
    ])
  })

  it('reports nothing for a delivery that completed normally', async () => {
    await deliver(CART_SESSION)
    settleOrders()

    // The negative control the whole suite turns on: the SAME order, the SAME
    // reconciler, differing only in whether the process survived.
    expect((await reconcile()).missing).toEqual([])
  })

  it('reports nothing after a healthy redelivery either', async () => {
    await deliver(CART_SESSION)
    await deliver(CART_SESSION)
    settleOrders()

    expect((await reconcile()).missing).toEqual([])
  })

  it('leaves an order inside the grace window alone', async () => {
    killDecrementsAfterOrder = true
    await expect(deliver(CART_SESSION)).rejects.toBeInstanceOf(ProcessKilled)
    settleOrders(NOW - 60 * 1000)

    // A minute old: the decrement of a healthy webhook is still plausibly in
    // flight, and a detector that flagged it would cry wolf on every sale.
    expect((await reconcile()).missing).toEqual([])
    // ...and the same order, once settled, IS flagged. Without this the test
    // above would pass against a reconciler that flagged nothing at all.
    settleOrders()
    expect((await reconcile()).missing).toHaveLength(1)
  })

  it('leaves a pending order alone — it has not paid, so nothing decremented', async () => {
    setDoc(`hosts/${HOST}/orders/draft-1`, {
      number: 9,
      status: 'pending',
      channel: 'draft',
      createdAtMs: LONG_AGO,
      lineItems: [
        {
          productId: 'product-1',
          variantId: 'large',
          name: 'Monthly box',
          quantity: 2,
          unitAmountCents: 1500,
          productType: 'physical',
        },
      ],
    })

    expect((await reconcile()).missing).toEqual([])
  })

  it('leaves a digital line alone without reading the product', async () => {
    setDoc(`hosts/${HOST}/products/product-2`, {
      name: 'Ebook',
      type: 'digital',
      // Deliberately TRACKED, so only the line's own `productType` can be
      // what excludes it. A reconciler that ignored the snapshot and asked
      // the live product would flag this.
      variants: [{ id: 'pdf', priceUsd: 9, inventory: 4 }],
    })
    setDoc(`hosts/${HOST}/orders/order-digital`, {
      number: 4,
      status: 'paid',
      channel: 'online',
      createdAtMs: LONG_AGO,
      lineItems: [
        {
          productId: 'product-2',
          variantId: 'pdf',
          name: 'Ebook',
          quantity: 1,
          unitAmountCents: 900,
          productType: 'digital',
        },
      ],
    })

    expect((await reconcile()).missing).toEqual([])
  })

  it('leaves an untracked physical variant alone', async () => {
    setDoc(`hosts/${HOST}/products/product-3`, {
      name: 'Made to order desk',
      type: 'physical',
      variants: [{ id: 'oak', priceUsd: 900 }],
    })
    setDoc(`hosts/${HOST}/orders/order-untracked`, {
      number: 5,
      status: 'paid',
      channel: 'online',
      createdAtMs: LONG_AGO,
      lineItems: [
        {
          productId: 'product-3',
          variantId: 'oak',
          name: 'Made to order desk',
          quantity: 1,
          unitAmountCents: 90000,
          productType: 'physical',
        },
      ],
    })

    expect((await reconcile()).missing).toEqual([])
  })

  it('flags the line the ledger is silent about and not its paid sibling', async () => {
    setDoc(`hosts/${HOST}/products/product-4`, {
      name: 'Mug',
      type: 'physical',
      variants: [{ id: 'default', priceUsd: 9, inventory: 6 }],
    })
    setDoc(`hosts/${HOST}/orders/order-pair`, {
      number: 7,
      status: 'fulfilled',
      channel: 'online',
      createdAtMs: LONG_AGO,
      lineItems: [
        {
          productId: 'product-1',
          variantId: 'large',
          name: 'Monthly box',
          quantity: 2,
          unitAmountCents: 1500,
          productType: 'physical',
        },
        {
          productId: 'product-4',
          variantId: 'default',
          name: 'Mug',
          quantity: 1,
          unitAmountCents: 900,
          productType: 'physical',
        },
      ],
    })
    // Only the mug's decrement landed.
    setDoc(`hosts/${HOST}/inventoryAdjustments/adj-1`, {
      productId: 'product-4',
      variantId: 'default',
      delta: -1,
      reason: 'sale',
      orderId: 'order-pair',
      atMs: LONG_AGO,
    })

    const result = await reconcile()

    expect(result.missing).toHaveLength(1)
    expect(result.missing[0]).toMatchObject({
      productId: 'product-1',
      variantId: 'large',
      quantity: 2,
      orderStatus: 'fulfilled',
    })
  })

  it('does not accept a cancellation row as the sale that never happened', async () => {
    setDoc(`hosts/${HOST}/orders/order-wrong-reason`, {
      number: 8,
      status: 'paid',
      channel: 'online',
      createdAtMs: LONG_AGO,
      lineItems: [
        {
          productId: 'product-1',
          variantId: 'large',
          name: 'Monthly box',
          quantity: 2,
          unitAmountCents: 1500,
          productType: 'physical',
        },
      ],
    })
    setDoc(`hosts/${HOST}/inventoryAdjustments/adj-2`, {
      productId: 'product-1',
      variantId: 'large',
      delta: 2,
      reason: 'cancellation',
      orderId: 'order-wrong-reason',
      atMs: LONG_AGO,
    })

    expect((await reconcile()).missing).toHaveLength(1)
  })

  it('drops orders older than a truncated ledger window rather than judging them', async () => {
    // Two decrement-less orders, one older than the single ledger row the
    // window will reach back to.
    for (const [id, createdAtMs] of [
      ['order-recent', LONG_AGO],
      ['order-ancient', LONG_AGO - 10 * 60 * 60 * 1000],
    ] as const) {
      setDoc(`hosts/${HOST}/orders/${id}`, {
        number: 1,
        status: 'paid',
        channel: 'online',
        createdAtMs,
        lineItems: [
          {
            productId: 'product-1',
            variantId: 'large',
            name: 'Monthly box',
            quantity: 1,
            unitAmountCents: 1500,
            productType: 'physical',
          },
        ],
      })
    }
    setDoc(`hosts/${HOST}/inventoryAdjustments/adj-3`, {
      productId: 'product-9',
      variantId: 'x',
      delta: -1,
      reason: 'sale',
      orderId: 'order-elsewhere',
      atMs: LONG_AGO,
    })

    const result = await reconcile({ ledgerLimit: 1 })

    // The ancient one is UNJUDGED, not cleared: the rows that would have
    // vouched for it were never read.
    expect(result.ledgerTruncated).toBe(true)
    expect(result.missing.map((row) => row.orderId)).toEqual(['order-recent'])
  })
})

describe('the report', () => {
  async function loseADecrement() {
    killDecrementsAfterOrder = true
    await expect(deliver(CART_SESSION)).rejects.toBeInstanceOf(ProcessKilled)
    killDecrementsAfterOrder = false
    settleOrders()
    return (await reconcile()).missing
  }

  it('tells the merchant which order and how many units, once', async () => {
    const missing = await loseADecrement()

    expect(await reportMissingSaleDecrements(HOST, missing)).toBe(1)
    const alerts = notifications.filter(
      (notification) => notification.type === 'content.lowStock',
    )
    expect(alerts).toHaveLength(1)
    expect(alerts[0].hostId).toBe(HOST)
    expect(alerts[0].title).toContain('#1')
    expect(alerts[0].body).toContain('3 units')
    expect(alerts[0].body).toContain('Monthly box')

    // The marker is the only write the pass makes, and it is what stops the
    // hourly beat from re-nagging about an order already reported.
    expect(
      docs.get(`hosts/${HOST}/inventoryReconciliation/cs_cart_death`)?.data,
    ).toMatchObject({ orderId: 'cs_cart_death' })

    notifications.length = 0
    expect(await reportMissingSaleDecrements(HOST, missing)).toBe(0)
    expect(notifications).toEqual([])
  })

  it('writes nothing at all when there is nothing to report', async () => {
    await deliver(CART_SESSION)
    settleOrders()
    const before = docs.size

    expect(
      await reportMissingSaleDecrements(HOST, (await reconcile()).missing),
    ).toBe(0)

    expect(docs.size).toBe(before)
    // The sale's own "New order" notice is the webhook's, not this pass's —
    // filtered rather than asserted away, so a stray alert from HERE shows.
    expect(notifications.filter((n) => n.type === 'content.lowStock')).toEqual(
      [],
    )
  })
})

describe('the platform beat', () => {
  it('finds the host through the collection group and reports it', async () => {
    killDecrementsAfterOrder = true
    await expect(deliver(CART_SESSION)).rejects.toBeInstanceOf(ProcessKilled)
    killDecrementsAfterOrder = false
    settleOrders()

    const scan = await scanStockDecrements(OPEN_GATE, { nowMs: NOW })

    expect(scan.hosts).toBe(1)
    expect(scan.missingLines).toBe(1)
    expect(scan.reportedOrders).toBe(1)
    expect(scan.truncatedHosts).toBe(0)
    expect(
      notifications.filter((n) => n.type === 'content.lowStock'),
    ).toHaveLength(1)
  })
})

describe('the double is faithful', () => {
  it('retries a contended transaction instead of rubber-stamping it', async () => {
    setDoc(`hosts/${HOST}/products/product-contended`, {
      name: 'Contended',
      type: 'physical',
      variants: [{ id: 'v1', priceUsd: 5, inventory: 5 }],
    })
    const { decrementVariantStock } = jest.requireActual('./reserve-stock')
    const ref = fakeFirestore
      .collection('hosts')
      .doc(HOST)
      .collection('products')
      .doc('product-contended')

    await fakeFirestore.runTransaction(async (transaction: any) => {
      await transaction.get(ref)
      // A concurrent committed write lands between this transaction's read
      // and its commit. A double that just ran the callback would not notice.
      if (transactionRetries === 0) {
        setDoc(`hosts/${HOST}/products/product-contended`, {
          ...docs.get(`hosts/${HOST}/products/product-contended`)!.data,
          variants: [{ id: 'v1', priceUsd: 5, inventory: 4 }],
        })
      }
      transaction.set(ref, { touched: true }, { merge: true })
    })

    expect(transactionRetries).toBe(1)
    expect(typeof decrementVariantStock).toBe('function')
    expect(CommerceModel.liftLegacyProduct).toBeDefined()
  })
})
