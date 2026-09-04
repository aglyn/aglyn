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
 * THE RACE, MODELLED (AGL-2320).
 *
 * The defect is concurrency, so a test that does not actually race proves
 * nothing. This one runs N decrements of the same variant CONCURRENTLY, holding
 * every one of them at its read until all of them have read — the exact
 * interleaving the read-modify-write lost — and asserts what the shelf did.
 *
 * The double models Firestore's observable transaction semantics rather than
 * rubber-stamping the call:
 *
 *   - `transaction.get` records the version of the document it read.
 *   - a commit whose read set has moved since is ABORTED and the whole callback
 *     RE-RUN against committed state, exactly as a contended Firestore
 *     transaction is. (The real server takes a pessimistic lock on `get`; the
 *     optimistic model here is the harsher one — it forces the callback to be
 *     re-runnable, and reaches the same no-lost-update outcome.)
 *   - reads inside a transaction never see that transaction's own pending
 *     writes, as in the real client.
 *   - `set(…, { merge: true })` merges TOP-LEVEL fields and REPLACES arrays,
 *     which is the whole reason `variants` cannot be incremented in place.
 *   - `add()` appends to a real collection, so the ledger can be counted.
 *
 * Without a faithful double this suite would be theatre: a `runTransaction`
 * that simply invokes its callback passes whether or not the read is inside it.
 * `records a lost decrement when the read is hoisted out of the transaction`
 * below is the negative control that proves it is not.
 */

import * as CommerceModel from '../model'

const notifications: any[] = []
jest.mock('@aglyn/tenant-data-admin', () => ({
  /*
   * The real resolution's shape: an org that declared no pooling resolves
   * every site to a group of ONE. Faked rather than imported because this
   * file mocks the whole module — but faked to the NARROW answer, which is
   * the direction a wrong group may fail in.
   */
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
  notifyHostManagers: (hostId: string, payload: any) => {
    notifications.push({ hostId, ...payload })
  },
}))

import { decrementVariantStock } from './reserve-stock'

/** A committed document: its data and the version that data was written at. */
interface Stored {
  data: any
  version: number
}

/**
 * Yields to the macrotask queue so peers interleave here. `setTimeout`, not
 * `setImmediate`: this project's jest environment is jsdom, which has no
 * `setImmediate`, and a throwing double would have reported every decrement as
 * a failed commit — a false RED that looks exactly like a real one.
 */
const yieldTurn = () => new Promise((resolve) => setTimeout(resolve, 0))

class FakeFirestore {
  readonly docs = new Map<string, Stored>()
  /** Transaction retries, so a test can assert contention actually happened. */
  retries = 0
  private autoId = 0

  collection(name: string) {
    return this.collectionAt(name)
  }

  private readonly collectionAt = (path: string) => ({
    path,
    doc: (id?: string) =>
      this.docAt(`${path}/${id ?? `auto-${++this.autoId}`}`),
    add: async (value: any) => {
      const ref = this.docAt(`${path}/auto-${++this.autoId}`)
      await ref.set(value)
      return ref
    },
  })

  private readonly docAt = (path: string) => ({
    path,
    collection: (name: string) => this.collectionAt(`${path}/${name}`),
    get: async () => this.snapshot(path),
    set: async (value: any, options?: any) => {
      this.commitWrite(path, value, options)
    },
  })

  snapshot(path: string) {
    const stored = this.docs.get(path)
    return {
      exists: stored != null,
      id: path.split('/').pop(),
      data: () => (stored ? JSON.parse(JSON.stringify(stored.data)) : undefined),
      get: (field: string) => stored?.data?.[field],
    }
  }

  private commitWrite(path: string, value: any, options?: any) {
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
    // Generous, because twenty transactions contending on one document is a
    // thundering herd under an optimistic model: one commits per round, so the
    // last loser retries nineteen times. A tight cap would surface as a FAILED
    // COMMIT, whose `applied: 0` is indistinguishable from an honest refusal —
    // the assertions below check `failed` for exactly that reason.
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const readVersions = new Map<string, number>()
      const pending: Array<[string, any, any]> = []
      const transaction = {
        get: async (ref: any) => {
          // The window. Every concurrent decrement gets to read before any of
          // them commits — which is the interleaving that lost a decrement.
          await yieldTurn()
          readVersions.set(ref.path, this.docs.get(ref.path)?.version ?? 0)
          return this.snapshot(ref.path)
        },
        set: (ref: any, value: any, options?: any) => {
          pending.push([ref.path, value, options])
        },
      }
      const result = await fn(transaction)
      await yieldTurn()
      const contended = [...readVersions].some(
        ([path, version]) => (this.docs.get(path)?.version ?? 0) !== version,
      )
      if (contended) {
        this.retries += 1
        continue
      }
      for (const [path, value, options] of pending) {
        this.commitWrite(path, value, options)
      }
      return result
    }
    throw new Error('Transaction failed after 64 attempts')
  }
}

const HOST_ID = 'shop'

function seedProduct(
  store: FakeFirestore,
  inventory: number,
  extra: Partial<CommerceModel.HostProduct> = {},
) {
  store.docs.set('hosts/shop/products/widget', {
    version: 1,
    data: {
      name: 'Widget',
      slug: 'widget',
      type: 'physical',
      status: 'active',
      variants: [{ id: 'v1', priceUsd: 10, inventory }],
      inventory,
      ...extra,
    },
  })
}

function storedInventory(store: FakeFirestore): number {
  return store.docs.get('hosts/shop/products/widget')!.data.variants[0].inventory
}

/** One buyer, from click to committed decrement. */
function buy(store: FakeFirestore, quantity: number) {
  return decrementVariantStock({
    firestore: store,
    hostRef: store.collection('hosts').doc('shop'),
    hostId: HOST_ID,
    productId: 'widget',
    variantId: 'v1',
    quantity,
  })
}

describe('AGL-2320 — concurrent stock decrements', () => {
  beforeEach(() => {
    notifications.length = 0
  })

  it('gives the last unit to exactly one of twenty concurrent buyers', async () => {
    const store = new FakeFirestore()
    seedProduct(store, 1)

    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () => buy(store, 1)),
    )

    // Exactly one buyer took the unit; the other nineteen took nothing.
    const took = outcomes.filter((outcome) => outcome.applied === -1)
    const refused = outcomes.filter((outcome) => outcome.applied === 0)
    expect(took).toHaveLength(1)
    expect(refused).toHaveLength(19)
    // Every one of them COMMITTED. A refusal and a dropped write both read as
    // `applied: 0`, and only the second would make this suite a lie.
    expect(outcomes.every((outcome) => !outcome.failed)).toBe(true)
    // The shelf gave up one unit and never went negative.
    expect(storedInventory(store)).toBe(0)
    expect(storedInventory(store)).toBeGreaterThanOrEqual(0)
    // The interleaving was real: twenty transactions on one document contend.
    expect(store.retries).toBeGreaterThan(0)
  })

  it('never lets the shelf go negative, whatever the concurrent quantities', async () => {
    const store = new FakeFirestore()
    seedProduct(store, 5)

    const outcomes = await Promise.all([
      buy(store, 3),
      buy(store, 3),
      buy(store, 3),
      buy(store, 3),
    ])

    const totalApplied = outcomes.reduce(
      (sum, outcome) => sum + outcome.applied,
      0,
    )
    // Four buyers asked for twelve units; a shelf of five gave up five.
    expect(totalApplied).toBe(-5)
    expect(storedInventory(store)).toBe(0)
  })

  it('still completes a purchase well inside stock', async () => {
    const store = new FakeFirestore()
    seedProduct(store, 10)

    const outcome = await buy(store, 2)

    // The other half of the assertion: a suite that only proves the oversell is
    // refused also passes when EVERY purchase is refused.
    expect(outcome.applied).toBe(-2)
    expect(storedInventory(store)).toBe(8)
    expect(notifications).toHaveLength(0)
  })

  it('compounds two concurrent sales that both fit', async () => {
    const store = new FakeFirestore()
    seedProduct(store, 10)

    const outcomes = await Promise.all([buy(store, 2), buy(store, 3)])

    expect(
      outcomes.map((outcome) => outcome.applied).sort((a, b) => a - b),
    ).toEqual([-3, -2])
    // The lost decrement in one line: read-modify-write left this at 7 or 8.
    expect(storedInventory(store)).toBe(5)
  })

  it('reports the shortfall to the merchant instead of swallowing it', async () => {
    const store = new FakeFirestore()
    seedProduct(store, 1)

    await Promise.all([buy(store, 1), buy(store, 1)])

    // The oversell is no longer silent (finding 2): the sale stands — the money
    // has moved by the time a webhook decrements — but the merchant is told
    // which order they cannot fill.
    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toMatchObject({
      hostId: HOST_ID,
      type: 'content.lowStock',
      title: 'Oversold — Widget',
    })
    expect(notifications[0].body).toContain('1 unit')
  })

  it('says nothing about a backorder product selling past zero', async () => {
    const store = new FakeFirestore()
    seedProduct(store, 1, { oversellPolicy: 'backorder' })

    await Promise.all([buy(store, 1), buy(store, 1)])

    // Selling past zero is what the merchant asked for there (AGL-2149).
    expect(storedInventory(store)).toBe(0)
    expect(notifications).toHaveLength(0)
  })

  it('leaves an untracked variant and a missing product alone', async () => {
    const store = new FakeFirestore()
    store.docs.set('hosts/shop/products/widget', {
      version: 1,
      data: {
        name: 'Widget',
        variants: [{ id: 'v1', priceUsd: 10, inventory: null }],
      },
    })

    const untracked = await buy(store, 1)
    expect(untracked.applied).toBe(0)
    expect(untracked.before).toBeNull()
    expect(untracked.failed).toBe(false)

    store.docs.delete('hosts/shop/products/widget')
    const missing = await buy(store, 1)
    expect(missing.before).toBeNull()
    expect(missing.failed).toBe(false)
  })

  it('reports a failed commit rather than inviting a phantom ledger row', async () => {
    const store = new FakeFirestore()
    seedProduct(store, 5)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    jest
      .spyOn(store, 'runTransaction')
      .mockRejectedValueOnce(new Error('UNAVAILABLE'))

    const outcome = await buy(store, 1)

    // `failed` is what stops the caller writing a `sale` row for a movement
    // that did not happen — the row a later cancellation would hand back.
    expect(outcome.failed).toBe(true)
    expect(outcome.before).toBeNull()
    expect(storedInventory(store)).toBe(5)
    jest.restoreAllMocks()
  })

  it('records a lost decrement when the read is hoisted out of the transaction', async () => {
    // THE NEGATIVE CONTROL. This is the shape every call site had before
    // AGL-2320 — read the product, compute, write inside a transaction — run
    // against the SAME double. If the double could not observe the defect,
    // nothing above would mean anything.
    const store = new FakeFirestore()
    seedProduct(store, 5)

    const hoisted = async (quantity: number) => {
      const ref = store.collection('hosts').doc('shop').collection('products').doc('widget')
      const before = CommerceModel.liftLegacyProduct(
        (await ref.get()).data() as any,
      )
      await yieldTurn()
      const variants = CommerceModel.adjustVariantInventory(
        before,
        'v1',
        -quantity,
      )
      await store.runTransaction(async (transaction: any) => {
        transaction.set(
          { path: 'hosts/shop/products/widget' },
          { variants, inventory: CommerceModel.productInventory({ variants }) },
          { merge: true },
        )
      })
    }

    await Promise.all([hoisted(2), hoisted(3)])

    // Five units of stock, five units sold, and the shelf still shows three or
    // two: the later write overwrote the earlier one.
    expect(storedInventory(store)).toBeGreaterThan(0)
  })
})

/**
 * The helper is only worth anything if the sale paths actually CALL it, and
 * every spec above would stay green if one of them quietly went back to a bare
 * read-modify-write. So this reads the source.
 *
 * `cancel-order.ts` is the deliberate exception: its restore has been fully
 * transactional since AGL-1808 — reads through `transaction.get`, writes through
 * `transaction.update` — which is why it was never part of this defect and why
 * it does not route through a helper built for the decrement direction.
 */
describe('AGL-2320 — every stock writer is transactional', () => {
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const serverDir = __dirname
  const ALLOWED_TO_ADJUST_DIRECTLY = new Set([
    // The helper itself: its call IS inside the transaction.
    'reserve-stock.ts',
    // Transactional since AGL-1808.
    'cancel-order.ts',
  ])

  const sources = fs
    .readdirSync(serverDir)
    .filter((name) => name.endsWith('.ts') && !name.includes('.spec.'))

  it('has server sources to check at all', () => {
    // A guard whose enumeration silently returns nothing passes forever.
    expect(sources.length).toBeGreaterThan(20)
    expect(sources).toContain('billing-webhook.ts')
    expect(sources).toContain('pos-order.ts')
  })

  it.each(sources)('%s does not hand-roll a stock write', (name) => {
    if (ALLOWED_TO_ADJUST_DIRECTLY.has(name)) return
    // `latin1`, not `utf8`: `cancel-order.ts` carries a literal NUL as a
    // composite-map-key separator and byte-faithful reading is what keeps this
    // sweep honest about what a file contains.
    const source = fs.readFileSync(path.join(serverDir, name), 'latin1')
    expect(source).not.toContain('adjustVariantInventory')
    expect(source).not.toContain('appliedVariantInventoryDelta')
  })

  it('routes every sale decrement through the helper', () => {
    const webhook = fs.readFileSync(
      path.join(serverDir, 'billing-webhook.ts'),
      'latin1',
    )
    const pos = fs.readFileSync(path.join(serverDir, 'pos-order.ts'), 'latin1')
    const calls = (source: string) =>
      (source.match(/decrementVariantStock\(\{/g) ?? []).length
    // Buy-now, cart lines, subscription cycle, draft link, POS card lines.
    expect(calls(webhook)).toBe(5)
    // The register's cash and folio sales.
    expect(calls(pos)).toBe(1)
  })
})
