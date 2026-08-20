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
 * THE COUNT AND ITS LEDGER ROW ARE ONE WRITE (AGL-2161).
 *
 * Six sale paths decremented stock and then wrote an `inventoryAdjustments`
 * row as a separate, unawaited `.add({…}).catch(() => undefined)`. Either half
 * could land alone, and neither outcome was distinguishable from the common
 * case:
 *
 * - **row lost** — `cancel-order.ts` reads the rows for an order to decide
 *   whether a POS card sale was ever decremented, and reads
 *   `appliedDelta ?? delta` to cap the restock. No row reads as "never
 *   decremented", so the units are never released. Stock stranded, silently.
 * - **count lost** — the reverse hands back units nobody has.
 *
 * The fix makes the pair atomic rather than merely loud, because the helper
 * already owned the transaction the count was written in and both documents
 * hang off the same `hostRef`. Divergence is not reported; it is unreachable.
 *
 * ## WHY THIS FILE CARRIES ITS OWN DOUBLE
 *
 * The doubles in `billing-webhook-*.spec.ts` and `pos-order.spec.ts` stub
 * `runTransaction` to a plain callback invocation — writes apply immediately,
 * there is no read set, and there is no conflict detection at any granularity.
 * They would report green for every assertion below regardless of the code.
 *
 * The versioned double in `stock-decrement-race.spec.ts` is much better but is
 * strictly PER DOCUMENT: its read set is `Map<ref.path, version>`, populated
 * only by `transaction.get(documentRef)`. A ledger row is a NEW DOCUMENT that
 * no transaction ever read, so a per-document double cannot see it conflict
 * with anything — and the one race that matters here is exactly that:
 * `cancel-order.ts` does `transaction.get(query)` over the
 * `inventoryAdjustments` collection, which real Firestore range-locks and
 * which a new matching row must abort.
 *
 * So the double below adds COLLECTION-LEVEL conflict detection, and
 * `describe('the double can express the conflict')` proves it is not lying by
 * running the same race with that tracking switched off and showing the
 * outcome flips. A green from a double that cannot express the failure is
 * worth nothing, so that pair of tests is load-bearing, not decorative.
 */

import * as CommerceModel from '../model'
import { decrementVariantStock } from './reserve-stock'

jest.mock('@aglyn/tenant-data-admin', () => ({
  notifyHostManagers: async () => undefined,
}))

interface Stored {
  data: any
  version: number
}

/** Yields to the macrotask queue so peers interleave. See AGL-2320's double. */
const yieldTurn = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * A Firestore double with BOTH granularities of conflict detection.
 *
 * - documents: `transaction.get(docRef)` records the doc's version, and a
 *   commit aborts if it moved. This is what AGL-2320's double already had.
 * - collections: `transaction.get(query)` records the collection path and the
 *   ids that matched, and a commit aborts if any document has since been
 *   CREATED in that collection. This is the half a new ledger row needs, and
 *   the half the existing doubles do not have.
 *
 * `trackQueryRanges: false` degrades it to the per-document behaviour on
 * purpose, so a test can show what that misses.
 */
class FakeFirestore {
  readonly docs = new Map<string, Stored>()
  retries = 0
  /** Set false to degrade to per-document conflict detection. */
  trackQueryRanges = true
  private autoId = 0
  /** Fails the Nth `set` to this path, to model a half-landed write. */
  failWritesTo: string | null = null

  collection(name: string) {
    return this.collectionAt(name)
  }

  private readonly collectionAt = (path: string): any => {
    const query = (predicates: Array<[string, any]>): any => ({
      path,
      __predicates: predicates,
      where: (field: string, _op: string, value: any) =>
        query([...predicates, [field, value]]),
      get: async () => this.runQuery(path, predicates),
    })
    return {
      path,
      __predicates: [] as Array<[string, any]>,
      doc: (id?: string) =>
        this.docAt(`${path}/${id ?? `auto-${++this.autoId}`}`),
      add: async (value: any) => {
        const ref = this.docAt(`${path}/auto-${++this.autoId}`)
        await ref.set(value)
        return ref
      },
      where: (field: string, _op: string, value: any) =>
        query([[field, value]]),
      get: async () => this.runQuery(path, []),
    }
  }

  private readonly docAt = (path: string) => ({
    path,
    collection: (name: string) => this.collectionAt(`${path}/${name}`),
    get: async () => this.snapshot(path),
    set: async (value: any, options?: any) => {
      this.commitWrite(path, value, options)
    },
  })

  /** Direct children of `path` (one segment deeper), in insertion order. */
  childIds(path: string): string[] {
    const ids: string[] = []
    for (const key of this.docs.keys()) {
      if (!key.startsWith(`${path}/`)) continue
      const rest = key.slice(path.length + 1)
      if (!rest.includes('/')) ids.push(rest)
    }
    return ids
  }

  private runQuery(path: string, predicates: Array<[string, any]>) {
    const docs = this.childIds(path)
      .map((id) => this.snapshot(`${path}/${id}`))
      .filter((snapshot) =>
        predicates.every(([field, value]) => snapshot.get(field) === value),
      )
    return { docs, size: docs.length, empty: docs.length === 0 }
  }

  snapshot(path: string) {
    const stored = this.docs.get(path)
    return {
      exists: stored != null,
      id: path.split('/').pop(),
      path,
      data: () =>
        stored ? JSON.parse(JSON.stringify(stored.data)) : undefined,
      get: (field: string) => stored?.data?.[field],
    }
  }

  private commitWrite(path: string, value: any, options?: any) {
    if (this.failWritesTo && path.startsWith(this.failWritesTo)) {
      throw new Error(`13 INTERNAL: write rejected for ${path}`)
    }
    const previous = this.docs.get(path)
    const merged = options?.merge
      ? { ...(previous?.data ?? {}), ...value }
      : value
    this.docs.set(path, {
      data: JSON.parse(JSON.stringify(merged)),
      version: (previous?.version ?? 0) + 1,
    })
  }

  async runTransaction<T>(fn: (transaction: any) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const readVersions = new Map<string, number>()
      const readRanges = new Map<string, Set<string>>()
      const pending: Array<[string, any, any]> = []
      const transaction = {
        get: async (ref: any) => {
          await yieldTurn()
          if (ref.__predicates !== undefined) {
            // A QUERY. Real Firestore takes a range lock here; the double
            // remembers which ids existed so a later creation is visible as a
            // conflict.
            if (this.trackQueryRanges) {
              readRanges.set(ref.path, new Set(this.childIds(ref.path)))
            }
            return this.runQuery(ref.path, ref.__predicates)
          }
          readVersions.set(ref.path, this.docs.get(ref.path)?.version ?? 0)
          return this.snapshot(ref.path)
        },
        set: (ref: any, value: any, options?: any) => {
          pending.push([ref.path, value, options])
        },
      }
      const result = await fn(transaction)
      await yieldTurn()
      const documentMoved = [...readVersions].some(
        ([path, version]) => (this.docs.get(path)?.version ?? 0) !== version,
      )
      const rangeGrew = [...readRanges].some(([path, seen]) =>
        this.childIds(path).some((id) => !seen.has(id)),
      )
      if (documentMoved || rangeGrew) {
        this.retries += 1
        continue
      }
      // All-or-nothing, like a real commit: one rejected write discards the
      // batch. Without this the double could not express the failure the fix
      // is about.
      const snapshotOfDocs = new Map(this.docs)
      try {
        for (const [path, value, options] of pending) {
          this.commitWrite(path, value, options)
        }
      } catch (error) {
        this.docs.clear()
        for (const [key, value] of snapshotOfDocs) this.docs.set(key, value)
        throw error
      }
      return result
    }
    throw new Error('Transaction failed after 32 attempts')
  }
}

const HOST = 'hosts/shop'
const PRODUCT = `${HOST}/products/widget`
const LEDGER = `${HOST}/inventoryAdjustments`

function store(inventory = 5): FakeFirestore {
  const firestore = new FakeFirestore()
  firestore.docs.set(PRODUCT, {
    version: 1,
    data: {
      name: 'Widget',
      slug: 'widget',
      type: 'physical',
      status: 'active',
      variants: [{ id: 'v1', priceUsd: 10, inventory }],
      inventory,
    },
  })
  return firestore
}

const sell = (
  firestore: FakeFirestore,
  quantity: number,
  overrides: Record<string, unknown> = {},
) =>
  decrementVariantStock({
    firestore,
    hostRef: firestore.collection('hosts').doc('shop'),
    hostId: 'shop',
    productId: 'widget',
    variantId: 'v1',
    quantity,
    ledger: { reason: 'sale', orderId: 'order-1' },
    ...overrides,
  })

const rows = (firestore: FakeFirestore) =>
  firestore.childIds(LEDGER).map((id) => firestore.docs.get(`${LEDGER}/${id}`)!.data)

const inventoryOf = (firestore: FakeFirestore) =>
  firestore.docs.get(PRODUCT)!.data.variants[0].inventory

describe('the pair commits together (AGL-2161)', () => {
  it('writes the count and the row, with the fields the readers need', async () => {
    const firestore = store(5)
    const moved = await sell(firestore, 2)

    expect(moved.failed).toBe(false)
    expect(inventoryOf(firestore)).toBe(3)
    expect(rows(firestore)).toEqual([
      {
        productId: 'widget',
        variantId: 'v1',
        delta: -2,
        reason: 'sale',
        orderId: 'order-1',
        atMs: expect.any(Number),
      },
    ])
  })

  it('records appliedDelta when the shelf could not cover the sale', async () => {
    // `cancel-order.ts` caps a restock with `appliedDelta ?? delta`. Restoring
    // `delta` on a sale the floor swallowed invents inventory (AGL-2149).
    const firestore = store(1)
    await sell(firestore, 3)
    expect(rows(firestore)[0].delta).toBe(-3)
    expect(rows(firestore)[0].appliedDelta).toBe(-1)
    expect(inventoryOf(firestore)).toBe(0)
  })

  it('omits appliedDelta when nothing was clamped', async () => {
    // The conditional spread, asserted rather than assumed: a row that always
    // carried `appliedDelta` would change what every existing reader compares.
    const firestore = store(5)
    await sell(firestore, 2)
    expect('appliedDelta' in rows(firestore)[0]).toBe(false)
  })

  it('carries the locationId when the register named one', async () => {
    const firestore = store(5)
    await sell(firestore, 1, { locationId: 'back-room' })
    expect(rows(firestore)[0].locationId).toBe('back-room')
  })

  it('A LEDGER FAILURE ROLLS THE COUNT BACK — neither half lands', async () => {
    // THE BUG, from the count's side. Before this, the row's failure was
    // swallowed and the count stayed moved, so `cancel-order.ts` read "never
    // decremented" and stranded the stock permanently.
    const firestore = store(5)
    firestore.failWritesTo = LEDGER
    const moved = await sell(firestore, 2)

    expect(moved.failed).toBe(true)
    expect(inventoryOf(firestore)).toBe(5)
    expect(rows(firestore)).toEqual([])
  })

  it('A COUNT FAILURE WRITES NO ROW — the reverse direction', async () => {
    // A row whose count never moved is what makes a later cancellation hand
    // back units nobody has.
    const firestore = store(5)
    firestore.failWritesTo = PRODUCT
    const moved = await sell(firestore, 2)

    expect(moved.failed).toBe(true)
    expect(inventoryOf(firestore)).toBe(5)
    expect(rows(firestore)).toEqual([])
  })

  it('writes NO row when there was no movement to record', async () => {
    // A missing product must not mint a ledger row for a sale that never came
    // off any shelf.
    const firestore = store(5)
    const moved = await decrementVariantStock({
      firestore,
      hostRef: firestore.collection('hosts').doc('shop'),
      hostId: 'shop',
      productId: 'ghost',
      variantId: 'v1',
      quantity: 1,
      ledger: { reason: 'sale', orderId: 'order-1' },
    })
    expect(moved.before).toBeNull()
    expect(rows(firestore)).toEqual([])
  })

  it('two lines of one product write TWO rows, not one folded row', async () => {
    // A deterministic row id keyed on the order would collide here and
    // under-cap the restock. Auto-ids are the deliberate choice.
    const firestore = store(9)
    await sell(firestore, 2)
    await sell(firestore, 3)
    expect(rows(firestore)).toHaveLength(2)
    expect(inventoryOf(firestore)).toBe(4)
  })
})

describe('the double can express the conflict it is asked about', () => {
  /**
   * A reader shaped exactly like `cancel-order.ts:206-224`: inside a
   * transaction, query the order's adjustment rows and decide from them
   * whether the sale was ever decremented.
   */
  const readSaleRows = (firestore: FakeFirestore) =>
    firestore.runTransaction(async (transaction: any) => {
      const snapshot = await transaction.get(
        firestore
          .collection(LEDGER)
          .where('orderId', '==', 'order-1'),
      )
      await yieldTurn()
      await yieldTurn()
      return snapshot.docs.filter(
        (row: any) => row.get('reason') === 'sale',
      ).length
    })

  it('COLLECTION-LEVEL: a row created mid-read aborts and the reader sees it', async () => {
    const firestore = store(5)
    const [seen] = await Promise.all([readSaleRows(firestore), sell(firestore, 1)])

    expect(firestore.retries).toBeGreaterThan(0)
    expect(seen).toBe(1)
  })

  it('PER-DOCUMENT ONLY: the same race reports a false green', async () => {
    // THE NEGATIVE CONTROL, and the reason this file does not reuse the
    // existing doubles. With range tracking off — which is precisely what a
    // `Map<ref.path, version>` read set gives you — the reader commits having
    // seen no sale row, and a canceller built on that answer would refuse to
    // release stock that had just been decremented.
    const firestore = store(5)
    firestore.trackQueryRanges = false
    const [seen] = await Promise.all([readSaleRows(firestore), sell(firestore, 1)])

    expect(firestore.retries).toBe(0)
    expect(seen).toBe(0)
    // The row IS there; the reader simply could not be made to notice.
    expect(rows(firestore)).toHaveLength(1)
  })

  it('detects a plain document conflict too, so it has not lost the old half', async () => {
    const firestore = store(5)
    await Promise.all([sell(firestore, 1), sell(firestore, 1)])
    expect(firestore.retries).toBeGreaterThan(0)
    expect(inventoryOf(firestore)).toBe(3)
    expect(rows(firestore)).toHaveLength(2)
  })
})

describe('every sale path routes its row through the decrement (AGL-2161)', () => {
  const read = (name: string) => {
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    return fs.readFileSync(path.join(__dirname, name), 'latin1')
  }

  it.each(['billing-webhook.ts', 'pos-order.ts'])(
    '%s hand-rolls no inventoryAdjustments write',
    (name) => {
      // The six duplicated literals are gone. One that came back would be a
      // pair that can diverge again, and it would look exactly like the code
      // that was here before.
      expect(read(name)).not.toContain(".collection('inventoryAdjustments')")
    },
  )

  it('every decrement in a sale path passes a ledger join', () => {
    // `ledger` is optional on the helper — `reserve-stock`'s own specs
    // decrement without one — so the type system cannot enforce this. A sale
    // path that forgot it would move stock and record nothing, which is the
    // "row lost" half of the bug with no error to notice.
    const sites: string[] = []
    for (const name of ['billing-webhook.ts', 'pos-order.ts']) {
      const source = read(name)
      let index = source.indexOf('decrementVariantStock({')
      while (index !== -1) {
        sites.push(source.slice(index, source.indexOf('})', index)))
        index = source.indexOf('decrementVariantStock({', index + 1)
      }
    }
    // Buy-now, cart lines, subscription cycle, draft link, POS card lines,
    // and the register's own sale. A zero-length sweep must not read as
    // compliance.
    expect(sites).toHaveLength(6)
    for (const site of sites) {
      expect(site).toContain('ledger: { reason:')
    }
  })
})
