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

import { commerceBillingWebhookHandler } from './billing-webhook'

/**
 * What a PAID cart order owes the shopper, independently of whether anyone can
 * be emailed about it (AGL-2149). Three defects on one branch:
 *
 *  1. **License keys were assigned inside the receipt gate.** The whole block
 *     lived under `if (isEmailConfigured() && buyerEmailForReceipt)`, so a
 *     store with no SMTP — the default state of every new storefront — or a
 *     buyer whose email Stripe did not hand back produced a paid digital order
 *     with no key ever claimed for it. Not "the mail bounced": the key was
 *     never assigned, the order never recorded one, and the `created` guard
 *     turns every redelivery away, so there was no later attempt. The goods
 *     were the key; the receipt was only the announcement.
 *
 *  2. **The claim was a query followed by a bare merge-set.** Nothing sat
 *     between reading `assignedAtMs == null` and stamping it, so two orders for
 *     the same product landing together both read the same head of the pool and
 *     both stamped it — one redeemable secret, two buyers, and afterwards the
 *     key document records only the later order.
 *
 *  3. **A product deleted mid-checkout lost a paid line silently.** The line
 *     dropped out of `lineItems` and out of the inventory loop while
 *     `amountCents` kept the full `amount_total`, so the order was short of
 *     what the shopper paid and nothing anywhere said so.
 *
 * THE DOUBLE HAS TO MODEL THREE THINGS FAITHFULLY or these tests fabricate
 * their own result:
 *
 *  - `set(data, { merge: true })` merges and `set(data)` REPLACES. The broken
 *    key claim was a merge-set; a double that treated both as merges would let
 *    it pass.
 *  - `update()` rejects a missing document with gRPC `NOT_FOUND` (code 5) —
 *    `updateExisting` distinguishes exactly that, and a double that let
 *    `update()` create would turn the AGL-1767 refusals on this same branch
 *    into false greens underneath these tests.
 *  - `runTransaction` SERIALISES and applies its writes at commit. This is the
 *    whole experiment for defect 2: a "transaction" that merely called the
 *    callback inline would let two interleaved claims read the same `null` and
 *    would report the fix as broken (a false RED) as readily as it reported the
 *    bug as fixed.
 *
 * The two orders are delivered with a real `Promise.all`, not sequentially, so
 * the pool query of each genuinely runs before either claim commits.
 *
 * No Stripe boundary is exercised. `global.fetch` is replaced and asserted
 * unused, because localhost carries the LIVE secret key.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
let autoIdCounter = 0

/** gRPC `Status.NOT_FOUND` — what Firestore's "no entity to update" carries. */
const GRPC_NOT_FOUND = 5

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolveValue(previous: unknown, next: unknown): unknown {
  if (isPlainObject(next) && '__increment' in next) {
    return Number(previous ?? 0) + Number(next.__increment)
  }
  if (isPlainObject(next) && '__arrayUnion' in next) {
    return [...((previous as unknown[]) ?? []), next.__arrayUnion]
  }
  if (isPlainObject(next) && isPlainObject(previous)) {
    return mergeInto(previous, next)
  }
  return next
}

function mergeInto(
  previous: Record<string, any>,
  patch: Record<string, any>,
): Record<string, any> {
  const merged = { ...previous }
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = resolveValue(previous[key], value)
  }
  return merged
}

function makeSnapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    ref: makeDocRef(path),
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => makeSnapshot(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      docs.set(
        path,
        options?.merge
          ? mergeInto(docs.get(path) ?? {}, value)
          : mergeInto({}, value),
      )
    },
    update: async (value: Record<string, any>) => {
      if (!docs.has(path)) {
        throw Object.assign(
          new Error(`5 NOT_FOUND: No document to update: ${path}`),
          { code: GRPC_NOT_FOUND },
        )
      }
      docs.set(path, mergeInto(docs.get(path) as Record<string, any>, value))
    },
    create: async (value: Record<string, any>) => {
      if (docs.has(path)) {
        throw Object.assign(
          new Error(`6 ALREADY_EXISTS: Document already exists: ${path}`),
          { code: 6 },
        )
      }
      docs.set(path, mergeInto({}, value))
    },
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

interface Filter {
  field: string
  op: string
  value: unknown
}

/**
 * Direct children of `path` matching every accumulated equality filter, capped
 * at `limit`. `null` in a filter matches a stored `null` and NOT a missing
 * field, which is Firestore's rule and the one the license pool turns on: a key
 * document that has been stamped holds a number, and one that has not holds an
 * explicit `null`.
 */
function queryDocs(path: string, filters: Filter[], limit?: number) {
  const matches: any[] = []
  for (const [docPath, data] of docs) {
    if (!docPath.startsWith(`${path}/`)) continue
    if (docPath.slice(path.length + 1).includes('/')) continue
    const ok = filters.every((filter) => {
      const actual = data[filter.field]
      if (filter.op !== '==') throw new Error(`unmodelled op ${filter.op}`)
      if (filter.value === null) return actual === null
      return actual === filter.value
    })
    if (!ok) continue
    matches.push(makeSnapshot(docPath))
    if (limit != null && matches.length >= limit) break
  }
  return { docs: matches, size: matches.length, empty: matches.length === 0 }
}

/**
 * THE RACE WINDOW, HELD OPEN ON PURPOSE.
 *
 * Two webhook deliveries running under `Promise.all` do interleave, but where
 * they interleave is an accident of how many microtask turns each has taken —
 * and the order-creation transaction alone offsets one against the other by a
 * whole transaction. Left to chance the second order's pool query can land
 * after the first order's claims have already committed, which is a window
 * Firestore does NOT guarantee closed and which made the broken claim pass.
 *
 * So the pool query blocks until BOTH readers have arrived at it. That is a
 * window a real Firestore permits — a query answers from a snapshot, and
 * nothing stops two clients holding the same one — held open deterministically
 * instead of hoped for. Armed only by the tests that are about the race; every
 * other test runs with it disarmed.
 */
let poolQueryLatch: {
  needed: number
  arrived: number
  release: () => void
  gate: Promise<void>
} | null = null

function armPoolQueryLatch(needed: number) {
  let release = () => undefined as void
  const gate = new Promise<void>((resolve) => {
    release = () => resolve()
  })
  poolQueryLatch = { needed, arrived: 0, release, gate }
}

async function awaitPoolQueryLatch(path: string, filters: Filter[]) {
  const latch = poolQueryLatch
  if (!latch) return
  if (!path.endsWith('/licenseKeys')) return
  if (!filters.some((filter) => filter.field === 'assignedAtMs')) return
  latch.arrived += 1
  if (latch.arrived >= latch.needed) {
    poolQueryLatch = null
    latch.release()
  }
  await latch.gate
}

function makeCollectionRef(
  path: string,
  filters: Filter[] = [],
  limit?: number,
): any {
  return {
    doc: (id?: string) =>
      makeDocRef(`${path}/${id ?? `auto-${++autoIdCounter}`}`),
    where: (field: string, op: string, value: unknown) =>
      makeCollectionRef(path, [...filters, { field, op, value }], limit),
    limit: (count: number) => makeCollectionRef(path, filters, count),
    orderBy: () => makeCollectionRef(path, filters, limit),
    get: async () => {
      await awaitPoolQueryLatch(path, filters)
      return queryDocs(path, filters, limit)
    },
    add: async (value: Record<string, any>) => {
      const created = makeDocRef(`${path}/auto-${++autoIdCounter}`)
      docs.set(created.path, mergeInto({}, value))
      return created
    },
  }
}

/**
 * SERIALISED, with writes buffered to the commit — the two properties defect 2
 * turns on. Transactions queue behind one another, so a second claim on a key
 * reads the first claim's committed result rather than the state it started
 * from, and a callback that throws commits nothing.
 */
let transactionQueue: Promise<unknown> = Promise.resolve()
let transactionsRun = 0

function runTransaction<T>(fn: (transaction: any) => Promise<T>): Promise<T> {
  const result = transactionQueue.then(async () => {
    transactionsRun += 1
    const writes: (() => Promise<void>)[] = []
    const transaction = {
      get: (target: any) => target.get(),
      set: (ref: any, value: any, options?: any) => {
        writes.push(() => ref.set(value, options))
      },
      update: (ref: any, value: any) => {
        writes.push(() => ref.update(value))
      },
      create: (ref: any, value: any) => {
        writes.push(() => ref.create(value))
      },
      delete: (ref: any) => {
        writes.push(() => ref.delete())
      },
    }
    const outcome = await fn(transaction)
    for (const write of writes) await write()
    return outcome
  })
  transactionQueue = result.catch(() => undefined)
  return result as Promise<T>
}

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
  runTransaction,
}

const managerNotices: any[] = []

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
    notifyHostManagers: async (hostId: string, notice: any) => {
      managerNotices.push({ hostId, ...notice })
    },
    upsertHostContact: async () => undefined,
    renderHostEmailWithTokens: async () => null,
  }
})

// THE POINT of most of this file: no SMTP at all, which is the default state of
// a new storefront and the state in which the keys were never assigned.
jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  sendEmail: async () => undefined,
}))

const fetchMock = jest.fn(async (url: any) => {
  throw new Error(`Unexpected fetch to ${String(url)}`)
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Nothing coincides: the charge is 7700, the fee 231, the unit price $38.50 and
 * the pool holds 7 keys, so an assertion that lands on the right number cannot
 * have got there by reaching for the nearest one.
 */
function cartSession(id: string, cartId: string, overrides: any = {}) {
  return {
    id,
    payment_status: 'paid',
    payment_intent: `pi_${id}`,
    amount_total: 7700,
    customer_details: { email: 'buyer@example.com', name: 'Ada Cartwright' },
    total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 0 },
    metadata: {
      type: 'commerce-cart',
      hostId: 'host-1',
      cartId,
      feeCents: '231',
    },
    ...overrides,
  }
}

async function deliver(object: any) {
  await commerceBillingWebhookHandler({
    type: 'checkout.session.completed',
    object,
    requestHost: 'acme.aglyn.app',
  } as any)
}

const order = (id: string) => docs.get(`hosts/host-1/orders/${id}`) as any

/** Every key document, with what it was stamped with. */
function keyRows() {
  return [...docs.entries()]
    .filter(([path]) => path.startsWith('hosts/host-1/licenseKeys/'))
    .map(([path, data]) => ({ id: path.split('/').pop() as string, ...data }))
}

function seedPool(count: number) {
  for (let index = 1; index <= count; index += 1) {
    docs.set(`hosts/host-1/licenseKeys/key-${index}`, {
      productId: 'ebook',
      key: `AGLYN-${String(index).padStart(4, '0')}`,
      assignedAtMs: null,
    })
  }
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

beforeEach(() => {
  docs.clear()
  managerNotices.length = 0
  autoIdCounter = 0
  transactionsRun = 0
  transactionQueue = Promise.resolve()
  poolQueryLatch = null
  fetchMock.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)

  docs.set('hosts/host-1', { displayName: 'Acme Books' })
  docs.set('hosts/host-1/products/ebook', {
    name: 'The Compleat Widget',
    type: 'digital',
    variants: [{ id: 'pdf', priceUsd: 38.5, sku: 'EB-1' }],
  })
  docs.set('hosts/host-1/carts/cart-1', {
    lines: [{ productId: 'ebook', variantId: 'pdf', quantity: 2 }],
  })
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ---------------------------------------------------------------------------

describe('a paid digital order and its license keys (AGL-2149)', () => {
  /**
   * THE DEFECT. No SMTP configured, so `isEmailConfigured()` is false and the
   * whole receipt block — assignment included — was skipped. The shopper paid
   * $77 for two keys and the order recorded none, permanently: the `created`
   * guard means no redelivery ever tries again.
   */
  it('assigns the keys when the store has no SMTP at all', async () => {
    seedPool(7)

    await deliver(cartSession('cs_1', 'cart-1'))

    expect(order('cs_1').status).toBe('paid')
    expect(order('cs_1').licenseKeys).toEqual({
      ebook: ['AGLYN-0001', 'AGLYN-0002'],
    })
    const assigned = keyRows().filter((row) => row.assignedAtMs != null)
    expect(assigned.map((row) => row.key)).toEqual([
      'AGLYN-0001',
      'AGLYN-0002',
    ])
    expect(assigned.every((row) => row.orderId === 'cs_1')).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /**
   * The other half of the same gate: SMTP is fine, but Stripe handed back no
   * buyer email, so `buyerEmailForReceipt` was falsy and the block was skipped
   * for a second reason. The keys still belong to the order — the `orderId` is
   * the join that matters, and the order carries the buyer identity.
   */
  it('assigns the keys when Stripe hands back no buyer email', async () => {
    seedPool(7)

    await deliver(
      cartSession('cs_1', 'cart-1', { customer_details: { name: 'Ada' } }),
    )

    expect(order('cs_1').licenseKeys).toEqual({
      ebook: ['AGLYN-0001', 'AGLYN-0002'],
    })
    expect(
      keyRows().filter((row) => row.assignedAtMs != null)[0].email,
    ).toBeNull()
  })

  /**
   * The negative control for the hoist: it moved the assignment out of the
   * gate, it did not start assigning keys to lines that are not digital. A
   * physical order must claim nothing, or the pool drains on every sale.
   */
  it('assigns nothing for a physical order', async () => {
    seedPool(7)
    docs.set('hosts/host-1/products/ebook', {
      name: 'The Compleat Widget',
      type: 'physical',
      variants: [{ id: 'pdf', priceUsd: 38.5, sku: 'EB-1', inventory: 9 }],
    })

    await deliver(cartSession('cs_1', 'cart-1'))

    expect(order('cs_1').licenseKeys).toBeUndefined()
    expect(keyRows().every((row) => row.assignedAtMs === null)).toBe(true)
  })

  /** And an empty pool is still a paid order, not a thrown webhook. */
  it('records the order even when the pool is empty', async () => {
    await deliver(cartSession('cs_1', 'cart-1'))

    expect(order('cs_1').status).toBe('paid')
    expect(order('cs_1').licenseKeys).toBeUndefined()
  })
})

describe('two orders claiming the same pool (AGL-2149)', () => {
  beforeEach(() => {
    docs.set('hosts/host-1/carts/cart-2', {
      lines: [{ productId: 'ebook', variantId: 'pdf', quantity: 2 }],
    })
  })

  /**
   * THE DEFECT, and the one that hands out a redeemable secret twice. The old
   * claim was `.where('assignedAtMs','==',null).limit(quantity)` followed by a
   * bare `set(…, { merge: true })` per document with nothing in between, so two
   * orders landing together both read `key-1`/`key-2` and both stamped them.
   * The second write simply overwrote the first order's `orderId`, so afterwards
   * nothing in the data even shows that two buyers hold the same key.
   *
   * Delivered with a real `Promise.all`, so each order's pool query genuinely
   * runs before either claim commits — the interleaving the bug needs.
   */
  it('never hands the same key to two concurrent orders', async () => {
    seedPool(7)
    armPoolQueryLatch(2)

    await Promise.all([
      deliver(cartSession('cs_1', 'cart-1')),
      deliver(cartSession('cs_2', 'cart-2')),
    ])

    const first = order('cs_1').licenseKeys.ebook as string[]
    const second = order('cs_2').licenseKeys.ebook as string[]
    expect(first).toHaveLength(2)
    expect(second).toHaveLength(2)
    // Four keys, four buyers' worth of secret, no overlap.
    expect(new Set([...first, ...second]).size).toBe(4)
    // And the pool agrees: exactly four stamped, each to one order.
    const assigned = keyRows().filter((row) => row.assignedAtMs != null)
    expect(assigned).toHaveLength(4)
    expect(
      assigned.filter((row) => row.orderId === 'cs_1').map((row) => row.key),
    ).toEqual(first)
    expect(
      assigned.filter((row) => row.orderId === 'cs_2').map((row) => row.key),
    ).toEqual(second)
  })

  /**
   * The claim really is a transaction rather than a read the handler happens to
   * repeat: without this, an implementation that re-read the key with a plain
   * `get()` and then wrote would pass the test above under a double that
   * serialises everything anyway.
   */
  it('claims each key inside its own transaction', async () => {
    seedPool(7)

    await deliver(cartSession('cs_1', 'cart-1'))

    // One for the order/counter write, one per key claimed.
    expect(transactionsRun).toBe(3)
  })

  /**
   * When the pool cannot cover both orders the shortfall lands on ONE of them
   * rather than being papered over with a duplicate. Three keys, two orders
   * wanting two each: someone gets one, and no key is issued twice.
   */
  it('runs the pool dry rather than issuing a key twice', async () => {
    seedPool(3)
    armPoolQueryLatch(2)

    await Promise.all([
      deliver(cartSession('cs_1', 'cart-1')),
      deliver(cartSession('cs_2', 'cart-2')),
    ])

    const issued = [
      ...((order('cs_1').licenseKeys?.ebook ?? []) as string[]),
      ...((order('cs_2').licenseKeys?.ebook ?? []) as string[]),
    ]
    expect(issued).toHaveLength(3)
    expect(new Set(issued).size).toBe(3)
    expect(keyRows().filter((row) => row.assignedAtMs != null)).toHaveLength(3)
  })
})

/**
 * WHAT THE SALE'S LEDGER ROW SAYS THE COUNT ACTUALLY DID (AGL-2149).
 *
 * `adjustVariantInventory` floors at zero, so a backorder product at 0 that
 * sells 2 does not move — and the row said `-2` anyway, which every reversal
 * read as two units to put back. `appliedDelta` is what the floor let through,
 * and it is written only when the two differ so the merchant's stock history
 * still reads "2 went out the door".
 */
describe('a sale the inventory floor clamped (AGL-2149)', () => {
  function seedPhysical(inventory: number) {
    docs.set('hosts/host-1/products/ebook', {
      name: 'The Compleat Widget',
      type: 'physical',
      oversellPolicy: 'backorder',
      variants: [{ id: 'pdf', priceUsd: 38.5, sku: 'EB-1', inventory }],
    })
  }

  function saleRow() {
    return [...docs.entries()]
      .filter(([path]) => path.startsWith('hosts/host-1/inventoryAdjustments/'))
      .map(([, data]) => data)
      .find((row) => row.reason === 'sale') as Record<string, any>
  }

  it('records what the floor let through when it swallowed the decrement', async () => {
    seedPhysical(0)

    await deliver(cartSession('cs_1', 'cart-1'))

    // The count did not move, and the row says so — while `delta` still
    // reports the two units the shopper bought.
    expect(docs.get('hosts/host-1/products/ebook')?.variants[0].inventory).toBe(
      0,
    )
    expect(saleRow()).toMatchObject({ delta: -2, appliedDelta: 0 })
  })

  it('records the partial the floor let through', async () => {
    seedPhysical(1)

    await deliver(cartSession('cs_1', 'cart-1'))

    expect(docs.get('hosts/host-1/products/ebook')?.variants[0].inventory).toBe(
      0,
    )
    expect(saleRow()).toMatchObject({ delta: -2, appliedDelta: -1 })
  })

  /** The negative control: an ordinary sale carries no `appliedDelta` at all. */
  it('writes no appliedDelta when nothing was clamped', async () => {
    seedPhysical(9)

    await deliver(cartSession('cs_1', 'cart-1'))

    expect(docs.get('hosts/host-1/products/ebook')?.variants[0].inventory).toBe(
      7,
    )
    expect(saleRow()).toMatchObject({ delta: -2 })
    expect(saleRow()).not.toHaveProperty('appliedDelta')
  })
})

describe('a paid line whose product was deleted mid-checkout (AGL-2149)', () => {
  beforeEach(() => {
    docs.set('hosts/host-1/carts/cart-1', {
      lines: [
        { productId: 'ebook', variantId: 'pdf', quantity: 2 },
        { productId: 'vanished', variantId: 'hardback', quantity: 1 },
      ],
    })
  })

  /**
   * THE DEFECT. `if (!product) return null` and the `.filter(Boolean)` behind
   * it dropped the line, and the inventory loop's `if (!product) continue`
   * dropped its decrement, while `amountCents` kept the full `amount_total`.
   * The order was quietly short of what the shopper was charged and nothing
   * recorded which line the difference was.
   *
   * The upstream fix — snapshotting each line into `checkouts/{sessionId}` at
   * session creation — is a schema addition to the recovery document and is NOT
   * what this pins. This pins that the loss is DETECTABLE.
   */
  it('records the line it could not resolve on the order', async () => {
    await deliver(cartSession('cs_1', 'cart-1'))

    expect(order('cs_1').unresolvedLines).toEqual([
      { productId: 'vanished', variantId: 'hardback', quantity: 1 },
    ])
    // The discrepancy is now arithmetic anyone can check: the recorded items
    // are $77.00 of a $77.00 charge only because the missing line is named.
    expect(order('cs_1').lineItems).toHaveLength(1)
    expect(order('cs_1').amountCents).toBe(7700)
  })

  /** And the merchant is told, on the timeline the console dialog renders. */
  it('stamps the loss on the order timeline', async () => {
    await deliver(cartSession('cs_1', 'cart-1'))

    const stamped = (order('cs_1').timeline as any[]).find(
      (event) => event.event === 'line-unresolved',
    )
    expect(stamped).toBeDefined()
    expect(stamped.detail).toContain('deleted during checkout')
    expect((order('cs_1').timeline as any[])[0].event).toBe('paid')
  })

  /** …and pushed to them, once, behind the same redelivery guard. */
  it('notifies the managers exactly once', async () => {
    await deliver(cartSession('cs_1', 'cart-1'))
    await deliver(cartSession('cs_1', 'cart-1'))

    const missing = managerNotices.filter(
      (notice) => notice.title === 'A paid order is missing items',
    )
    expect(missing).toHaveLength(1)
    expect(missing[0].hostId).toBe('host-1')
  })

  /**
   * The negative control. An order whose products all resolved must carry
   * neither the field nor the event, or the badge fires on every sale and the
   * merchant learns to ignore it.
   */
  it('says nothing on an order that lost no line', async () => {
    docs.set('hosts/host-1/carts/cart-1', {
      lines: [{ productId: 'ebook', variantId: 'pdf', quantity: 2 }],
    })

    await deliver(cartSession('cs_1', 'cart-1'))

    expect(order('cs_1').unresolvedLines).toBeUndefined()
    expect(
      (order('cs_1').timeline as any[]).some(
        (event) => event.event === 'line-unresolved',
      ),
    ).toBe(false)
    expect(
      managerNotices.filter(
        (notice) => notice.title === 'A paid order is missing items',
      ),
    ).toHaveLength(0)
  })
})
