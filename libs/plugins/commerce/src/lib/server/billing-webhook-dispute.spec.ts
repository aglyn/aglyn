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
 * Shopper chargebacks against a merchant's store (AGL-1787).
 *
 * Commerce subscribed no `charge.dispute.*` event at all, so every assertion
 * below about what LANDED was, before this change, an assertion about a
 * document nothing had written to.
 *
 * WHAT THE DOUBLE HAS TO MODEL, because these tests turn on all four:
 *
 *  - `update()` REPLACES a top-level field, nested maps included. The "a second
 *    dispute does not inherit the first one's outcome" case is exactly this
 *    difference, and a double that merged recursively (as `set({merge:true})`
 *    correctly does, a few lines down) would report it green against a handler
 *    that had the bug.
 *  - `update()` REJECTS an absent document with gRPC `NOT_FOUND` (code 5) and
 *    `set(…, {merge:true})` CONJURES one — the AGL-1763 pair. `updateExisting`
 *    is the REAL one here, taken from its leaf path, so the contact write is
 *    genuinely refused for a contact that does not exist.
 *  - `FieldValue.increment` resolves to a NUMBER, so a double-count cannot hide
 *    inside a sentinel — the whole point of the redelivery cases.
 *  - `collectionGroup` really scans across hosts and can be made to fail with
 *    gRPC `FAILED_PRECONDITION` (code 9), which is what a missing index is.
 *
 * `runTransaction` bodies are serialized, reproducing the property the code
 * depends on: a read and the write derived from it cannot interleave.
 *
 * No Stripe path is exercised — localhost carries the LIVE secret key.
 * `global.fetch` is replaced everywhere: asserted UNUSED on every case except
 * the AGL-1794 seller-share reversal tests, which stub it by exact URL and
 * assert the reversal POST by shape. `STRIPE_SECRET_KEY` is DELETED for the
 * suite (the root .env leaks into jest, and it holds the live key) and the
 * reversal tests set a throwaway.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()

/** gRPC status codes this file depends on being distinguishable. */
const GRPC_NOT_FOUND = 5
const GRPC_FAILED_PRECONDITION = 9

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Sentinel resolution, applied wherever the write applies it. */
function resolveValue(previous: unknown, next: unknown): unknown {
  if (isPlainObject(next) && '__increment' in next) {
    return Number(previous ?? 0) + Number(next.__increment)
  }
  if (isPlainObject(next) && '__arrayUnion' in next) {
    return [...((previous as unknown[]) ?? []), next.__arrayUnion]
  }
  return next
}

/** `set(…, { merge: true })`: recurses into nested maps. */
function mergeInto(
  previous: Record<string, any>,
  patch: Record<string, any>,
): Record<string, any> {
  const merged = { ...previous }
  for (const [key, value] of Object.entries(patch)) {
    merged[key] =
      isPlainObject(value) &&
      isPlainObject(previous[key]) &&
      !('__increment' in value) &&
      !('__arrayUnion' in value)
        ? mergeInto(previous[key], value)
        : resolveValue(previous[key], value)
  }
  return merged
}

/**
 * `update()`: each top-level field is written WHOLESALE. A nested map replaces
 * the stored one rather than merging into it, which is the semantics the
 * dispute record is written with and the reason a re-opened dispute cannot
 * inherit a stale `outcome`.
 */
function updateInto(
  previous: Record<string, any>,
  patch: Record<string, any>,
): Record<string, any> {
  const next = { ...previous }
  for (const [key, value] of Object.entries(patch)) {
    next[key] = resolveValue(previous[key], value)
  }
  return next
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
  const segments = path.split('/')
  return {
    id: segments[segments.length - 1],
    path,
    /** `hosts/{hostId}/orders/{id}` → the `orders` collection → the host doc. */
    parent: makeCollectionRef(segments.slice(0, -1).join('/')),
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
      const existing = docs.get(path)
      if (existing === undefined) {
        throw Object.assign(new Error(`5 NOT_FOUND: no entity to update`), {
          code: GRPC_NOT_FOUND,
        })
      }
      docs.set(path, updateInto(existing, value))
    },
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function childPaths(prefix: string): string[] {
  return [...docs.keys()].filter(
    (key) =>
      key.startsWith(`${prefix}/`) &&
      !key.slice(prefix.length + 1).includes('/'),
  )
}

interface FakeFilter {
  field: string
  op: '==' | 'array-contains-any'
  value: any
}

function matchesFilter(data: Record<string, any>, filter: FakeFilter): boolean {
  if (filter.op === '==') return data[filter.field] === filter.value
  // `array-contains-any` matches NOTHING on a document lacking the field
  // (AGL-1037) — the reason every contact carries `visibleTo`.
  const field = data[filter.field]
  if (!Array.isArray(field)) return false
  return (filter.value as any[]).some((token) => field.includes(token))
}

/** Set by a test to make the next collection-group query fail. */
let collectionGroupFailure: { code?: number; message: string } | null = null
/** Set by a test to delete the matched order between the query and the write. */
let deleteOrderDuringQuery = false

function makeQuery(
  paths: () => string[],
  filters: FakeFilter[],
  limit?: number,
  onGet?: (matched: string[]) => void,
): any {
  return {
    where: (field: string, op: any, value: any) =>
      makeQuery(paths, [...filters, { field, op, value }], limit, onGet),
    limit: (count: number) => makeQuery(paths, filters, count, onGet),
    get: async () => {
      const matched = paths().filter((path) =>
        filters.every((filter) => matchesFilter(docs.get(path) ?? {}, filter)),
      )
      onGet?.(matched)
      const snapshots = (limit == null ? matched : matched.slice(0, limit)).map(
        makeSnapshot,
      )
      return {
        empty: snapshots.length === 0,
        docs: snapshots,
        size: snapshots.length,
      }
    },
  }
}

function makeCollectionRef(path: string): any {
  const segments = path.split('/')
  return {
    id: segments[segments.length - 1],
    path,
    /** Root collections have no parent document; subcollections do. */
    parent:
      segments.length > 1 ? makeDocRef(segments.slice(0, -1).join('/')) : null,
    doc: (id: string) => makeDocRef(`${path}/${id}`),
    get: async () => ({ docs: childPaths(path).map(makeSnapshot) }),
    where: (field: string, op: any, value: any) =>
      makeQuery(() => childPaths(path), [{ field, op, value }]),
  }
}

/**
 * A real cross-host scan: every document whose path ends in `/{name}/{id}`,
 * from any parent — which is what makes the "two hosts, one payment intent"
 * and "the dispute belongs to another product" cases mean anything.
 */
function makeCollectionGroupRef(name: string): any {
  return makeQuery(
    () =>
      [...docs.keys()].filter((key) => {
        const segments = key.split('/')
        return segments.length > 1 && segments[segments.length - 2] === name
      }),
    [],
    undefined,
    (matched) => {
      if (collectionGroupFailure) {
        const failure = collectionGroupFailure
        collectionGroupFailure = null
        throw Object.assign(new Error(failure.message), { code: failure.code })
      }
      if (deleteOrderDuringQuery) {
        for (const path of matched) docs.delete(path)
      }
    },
  )
}

/** One transaction body at a time — see the file header. */
let transactionQueue: Promise<unknown> = Promise.resolve()

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
  collectionGroup: (name: string) => makeCollectionGroupRef(name),
  runTransaction: <T>(fn: (transaction: any) => Promise<T>): Promise<T> => {
    const run = transactionQueue.then(() =>
      fn({
        get: (ref: any) => ref.get(),
        set: (ref: any, value: any, options?: any) => {
          void ref.set(value, options)
        },
        update: (ref: any, value: any) => {
          void ref.update(value)
        },
      }),
    )
    transactionQueue = run.catch(() => undefined)
    return run
  },
}

const managerNotices: any[] = []

jest.mock('@aglyn/tenant-data-admin', () => {
  // The REAL `updateExisting`, from its leaf path: it is what distinguishes
  // gRPC NOT_FOUND from every other failure, and `contact-refund.ts` imports it
  // from that leaf precisely so this barrel mock cannot stand in for it.
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
      org: { id: 'org-1', slug: 'acme', plan: 'business', ownerUid: 'owner-1' },
    }),
    meterHostEmail: async () => undefined,
    notifyHostManagers: async (hostId: string, payload: any) => {
      managerNotices.push({ hostId, ...payload })
    },
    upsertHostContact: async () => undefined,
    renderHostEmailWithTokens: async () => null,
    // Contacts are ORG-scoped (AGL-237), and host reads narrow to what the
    // host may see (AGL-1039) — the same pair `recordContactRefund` resolves
    // through, with the real `visibleTo` filter rather than a permissive stub.
    orgDataCollectionForHost: async (_hostId: string, name: string) =>
      makeCollectionRef(`orgs/org-1/${name}`),
    scopedToHost: (ref: any, hostId: string) =>
      ref.where('visibleTo', 'array-contains-any', ['org', `host:${hostId}`]),
  }
})

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  sendEmail: async () => undefined,
}))

const fetchMock: jest.Mock<Promise<any>, [any, any?]> = jest.fn(
  async (url: any) => {
    throw new Error(`Unexpected fetch to ${String(url)}`)
  },
)

// ---------------------------------------------------------------------------
// The Stripe double (AGL-1794)
// ---------------------------------------------------------------------------

/**
 * The seller-share reversal is the ONE Stripe write this handler makes. Its
 * tests stub `fetch` by EXACT URL — a GET of the charge, a GET of the
 * transfer, a POST of the reversal — so a call to anything unexpected still
 * throws, and the afterEach guard pins that every call a test allowed went to
 * the double and nowhere else. Every test that does not call `stubStripe`
 * keeps the original guarantee: fetch was never called at all.
 */
let stripeStubbed = false
let stripeCalls: Array<{ url: string; init?: any }> = []

function stubStripe(
  routes: Record<string, { status?: number; body?: any }>,
): void {
  stripeStubbed = true
  fetchMock.mockImplementation(async (url: any, init?: any) => {
    stripeCalls.push({ url: String(url), init })
    const route = routes[String(url)]
    if (!route) throw new Error(`Unexpected fetch to ${String(url)}`)
    const status = route.status ?? 200
    return {
      ok: status < 400,
      status,
      json: async () => route.body ?? null,
    }
  })
}

const reversalPosts = () =>
  stripeCalls.filter((call) => call.init?.method === 'POST')

// ---------------------------------------------------------------------------
// The events
// ---------------------------------------------------------------------------

/**
 * Nothing here coincides (AGL-1711): the order is 6200, the dispute 6200, the
 * lifetime value 9100, the order count 4, the seeded partial refund 1700 and
 * the second host's order 3300 — so an assertion that lands on the right
 * number cannot have got there by reading the nearest field.
 */
const ORDER_TOTAL_CENTS = 6200
const DISPUTE_CENTS = 6200
const OPENED_AT_S = 1_760_000_000
const EVIDENCE_DUE_S = 1_760_600_000

function disputeEvent(overrides: Record<string, any> = {}) {
  return {
    id: 'dp_1',
    object: 'dispute',
    amount: DISPUTE_CENTS,
    currency: 'usd',
    charge: 'ch_1',
    payment_intent: 'pi_dispute_1',
    reason: 'product_not_received',
    status: 'needs_response',
    created: OPENED_AT_S,
    evidence_details: { due_by: EVIDENCE_DUE_S },
    ...overrides,
  }
}

async function deliver(type: string, object: any) {
  await commerceBillingWebhookHandler({
    type,
    object,
    event: { id: `evt_${type}` },
    requestHost: 'acme.aglyn.app',
  } as any)
}

const order = () => docs.get('hosts/host-1/orders/order-1') ?? {}
const contact = () => docs.get('orgs/org-1/contacts/contact-1') ?? {}
const disputeEvents = () =>
  ((order().timeline ?? []) as any[]).filter(
    (entry) => entry.event === 'dispute',
  )

/**
 * `recordContactRefund` swallows its own failures so it can never fail a
 * reversal that already landed — which means a contact assertion could
 * otherwise pass because nothing ran at all. Paired with every one of them.
 */
function expectNothingSwallowed() {
  expect(consoleError).not.toHaveBeenCalledWith(
    'recordContactRefund failed',
    expect.anything(),
  )
}

let consoleError: jest.SpyInstance

/** May be the LIVE key (the root .env leaks into jest): restore, never log. */
const ORIGINAL_STRIPE_KEY = process.env.STRIPE_SECRET_KEY

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

afterAll(() => {
  if (ORIGINAL_STRIPE_KEY === undefined) delete process.env.STRIPE_SECRET_KEY
  else process.env.STRIPE_SECRET_KEY = ORIGINAL_STRIPE_KEY
})

beforeEach(() => {
  docs.clear()
  managerNotices.length = 0
  collectionGroupFailure = null
  deleteOrderDuringQuery = false
  transactionQueue = Promise.resolve()
  // The suite's default: NO key, so every pre-AGL-1794 case runs exactly as
  // it always did — the reversal step refuses before any fetch. The reversal
  // describe sets its own throwaway.
  delete process.env.STRIPE_SECRET_KEY
  stripeStubbed = false
  stripeCalls = []
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: any) => {
    throw new Error(`Unexpected fetch to ${String(url)}`)
  })
  consoleError = jest
    .spyOn(console, 'error')
    .mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)

  docs.set('hosts/host-1', { displayName: 'Acme Boxes', orgId: 'org-1' })
  docs.set('hosts/host-1/orders/order-1', {
    status: 'paid',
    channel: 'online',
    customerEmail: 'Buyer@Example.com',
    customerName: 'Dana Buyer',
    paymentIntentId: 'pi_dispute_1',
    lineItems: [
      {
        productId: 'product-1',
        name: 'Chair',
        quantity: 1,
        unitAmountCents: ORDER_TOTAL_CENTS,
      },
    ],
    totals: {
      itemsCents: ORDER_TOTAL_CENTS,
      shippingCents: 0,
      taxCents: 0,
      discountCents: 0,
      feeCents: 0,
      totalCents: ORDER_TOTAL_CENTS,
    },
  })
  // The buyer, already a contact from an earlier sale. The order's
  // `Buyer@Example.com` is NOT the contact's `buyer@example.com`, which pins
  // the normalized join rather than an accidental exact match.
  docs.set('orgs/org-1/contacts/contact-1', {
    hostId: 'host-1',
    visibleTo: ['org'],
    email: 'buyer@example.com',
    name: 'Dana Buyer',
    sources: { order: true },
    interactions: [
      { type: 'order', atMs: 1, refId: 'order-1', summary: 'Ordered ($62.00)' },
    ],
    ltvCents: 9100,
    ordersCount: 4,
  })
  // The product the sale decremented (AGL-1797). Stocked at 8, which is not
  // any other figure in this file, and the order line names no variant so the
  // first-variant fallback is the path under test.
  docs.set('hosts/host-1/products/product-1', {
    name: 'Chair',
    type: 'physical',
    status: 'active',
    variants: [{ id: 'var-default', priceUsd: 62, inventory: 8 }],
  })
})

afterEach(() => {
  if (stripeStubbed) {
    // Everything the test allowed went to the DOUBLE, and only to Stripe's
    // own API — nothing real is reachable from here.
    for (const call of stripeCalls) {
      expect(call.url.startsWith('https://api.stripe.com/v1/')).toBe(true)
    }
  } else {
    expect(fetchMock).not.toHaveBeenCalled()
  }
  jest.restoreAllMocks()
})

// ---------------------------------------------------------------------------

describe('charge.dispute.created — flag, reverse nothing (AGL-1787)', () => {
  /**
   * The event that has to reverse NOTHING. A dispute can be won, and the
   * contact writer is monotonic by construction (AGL-1754) — there is no
   * decrement to undo a premature reversal with.
   */
  it('leaves the money exactly where it is', async () => {
    await deliver('charge.dispute.created', disputeEvent())
    expect(order().status).toBe('paid')
    expect(order().refundedCents ?? 0).toBe(0)
    expect(contact().refundedCents).toBeUndefined()
    expect(contact().ltvCents).toBe(9100)
  })

  /** The flag itself: what the merchant's order now carries. */
  it('records the open dispute on the order', async () => {
    await deliver('charge.dispute.created', disputeEvent())
    expect(order().dispute).toMatchObject({
      id: 'dp_1',
      status: 'needs_response',
      reason: 'product_not_received',
      amountCents: DISPUTE_CENTS,
      openedAtMs: OPENED_AT_S * 1000,
      evidenceDueByMs: EVIDENCE_DUE_S * 1000,
    })
    expect(order().dispute.outcome).toBeUndefined()
    expect(order().dispute.closedAtMs).toBeUndefined()
  })

  /**
   * The half the merchant needs on day one. Stripe's evidence window is days;
   * before this, nothing told them a dispute existed at all.
   */
  it('warns the merchant, with the evidence deadline', async () => {
    await deliver('charge.dispute.created', disputeEvent())
    expect(managerNotices).toHaveLength(1)
    expect(managerNotices[0].hostId).toBe('host-1')
    expect(managerNotices[0].title).toContain('$62.00')
    expect(managerNotices[0].body).toContain('product not received')
    expect(managerNotices[0].body).toContain('2025-10-16')
  })

  /** The console order dialog renders `timeline`; this is what it shows. */
  it('stamps the order timeline', async () => {
    await deliver('charge.dispute.created', disputeEvent())
    expect(disputeEvents()).toHaveLength(1)
    expect(disputeEvents()[0].detail).toContain('Chargeback opened')
  })

  /** Stripe delivers at least once. */
  it('does not re-notify or re-stamp on a redelivery', async () => {
    await deliver('charge.dispute.created', disputeEvent())
    await deliver('charge.dispute.created', disputeEvent())
    expect(disputeEvents()).toHaveLength(1)
    expect(managerNotices).toHaveLength(1)
  })
})

describe('charge.dispute.closed — the only event that moves money', () => {
  /** THE DEFECT: the money the shopper's bank took back, reversed at last. */
  it('reverses the money on the order when the dispute is lost', async () => {
    await deliver('charge.dispute.created', disputeEvent())
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expect(order().refundedCents).toBe(DISPUTE_CENTS)
  })

  /**
   * `refunded`, not a new status — and this is the assertion that pins the
   * decision. `gate.ts`, `download.ts`, `reviews.ts`, `membership-account.ts`
   * and the glance card all match the LITERAL `'refunded'`, so a `disputed`
   * status would have left the shopper their downloads and their
   * verified-purchase review after taking the money back.
   */
  it('moves the order to refunded, the status five gates already read', async () => {
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expect(order().status).toBe('refunded')
  })

  /** And the distinction is kept, beside the status rather than inside it. */
  it('keeps the chargeback distinguishable from a refund', async () => {
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expect(order().dispute).toMatchObject({
      id: 'dp_1',
      outcome: 'lost',
      reason: 'product_not_received',
      reversedCents: DISPUTE_CENTS,
    })
    expect(typeof order().dispute.closedAtMs).toBe('number')
    expect(disputeEvents().at(-1).detail).toContain('charged back')
  })

  /** The buyer's side of the ledger (AGL-1754), by the second door. */
  it('records the reversal against the buyer contact', async () => {
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expect(contact().refundedCents).toBe(DISPUTE_CENTS)
    expect(contact().refundedOrdersCount).toBe(1)
    expect(typeof contact().lastRefundAtMs).toBe('number')
    expectNothingSwallowed()
  })

  /** Gross stays gross — AGL-1754's decision, not re-litigated here. */
  it('does not decrement the contact lifetime value or order count', async () => {
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expect(contact().ltvCents).toBe(9100)
    expect(contact().ordersCount).toBe(4)
  })

  /** The wording is the whole reason `kind` exists on the writer. */
  it('says "charged back" on the contact timeline, not "refunded"', async () => {
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    const latest = contact().interactions[0]
    expect(latest.refId).toBe('order-1')
    expect(latest.summary).toContain('charged back')
    expect(latest.summary).not.toContain('refunded')
  })

  /** A reversal captures nobody — AGL-1754's `sources` rule, inherited. */
  it('does not add a capture source to the contact', async () => {
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expect(contact().sources).toEqual({ order: true })
  })

  /** The merchant is told the outcome, either way. */
  it('tells the merchant the dispute was lost', async () => {
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expect(managerNotices).toHaveLength(1)
    expect(managerNotices[0].title).toContain('$62.00')
  })
})

describe('a dispute that is WON', () => {
  /**
   * The case the whole `created`/`closed` split exists for. Nothing was
   * reversed, so nothing has to be un-reversed — a stronger guarantee than
   * undoing correctly, and the only one available given a monotonic contact.
   */
  it('leaves the order and the contact untouched', async () => {
    await deliver('charge.dispute.created', disputeEvent())
    await deliver('charge.dispute.closed', disputeEvent({ status: 'won' }))
    expect(order().status).toBe('paid')
    expect(order().refundedCents ?? 0).toBe(0)
    expect(contact().refundedCents).toBeUndefined()
    expect(contact().refundedOrdersCount).toBeUndefined()
  })

  /** But the outcome is recorded, so the flag does not sit open forever. */
  it('records the win and clears the open state', async () => {
    await deliver('charge.dispute.created', disputeEvent())
    await deliver('charge.dispute.closed', disputeEvent({ status: 'won' }))
    expect(order().dispute).toMatchObject({ outcome: 'won', reversedCents: 0 })
    expect(disputeEvents().at(-1).detail).toContain('no money reversed')
  })

  /**
   * `warning_closed` is an early-fraud warning that never became a dispute.
   * Same answer, and asserted separately so "anything that is not `lost`"
   * cannot regress into "anything that is `won`".
   */
  it('reverses nothing on warning_closed either', async () => {
    await deliver(
      'charge.dispute.closed',
      disputeEvent({ status: 'warning_closed' }),
    )
    expect(order().refundedCents ?? 0).toBe(0)
    expect(order().dispute.outcome).toBe('warning_closed')
  })
})

describe('redelivery and races', () => {
  /**
   * The double-count that matters: the order's `refundedCents` is a plain
   * write, but the contact's is a `FieldValue.increment`, so a replay inflates
   * the buyer's reversal total and their refunded-order count forever. The
   * double resolves increments to NUMBERS so this cannot hide in a sentinel.
   */
  it('does not count a redelivered close twice', async () => {
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expect(order().refundedCents).toBe(DISPUTE_CENTS)
    expect(contact().refundedCents).toBe(DISPUTE_CENTS)
    expect(contact().refundedOrdersCount).toBe(1)
    expect(contact().interactions).toHaveLength(2)
  })

  /**
   * Stripe does not order deliveries. A `created` that arrives after its own
   * `closed` must not re-open a settled dispute.
   */
  it('does not re-open a dispute when created arrives after closed', async () => {
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    await deliver('charge.dispute.created', disputeEvent())
    expect(order().dispute.outcome).toBe('lost')
    expect(order().status).toBe('refunded')
  })

  /** And a `closed` with no `created` before it still settles. */
  it('settles a close that never saw its created', async () => {
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expect(order().refundedCents).toBe(DISPUTE_CENTS)
    expect(order().dispute.openedAtMs).toBe(OPENED_AT_S * 1000)
  })

  /**
   * `update()` replaces a nested map wholesale; `set({merge:true})` recurses
   * into it. A second dispute written through a merge would inherit the first
   * one's `outcome`, `closedAtMs` and `reversedCents` — an OPEN dispute reading
   * as already settled, and a merchant told a live chargeback was resolved.
   */
  it('does not let a second dispute inherit the first one outcome', async () => {
    await deliver('charge.dispute.closed', disputeEvent({ status: 'won' }))
    await deliver(
      'charge.dispute.created',
      disputeEvent({ id: 'dp_2', status: 'needs_response' }),
    )
    expect(order().dispute.id).toBe('dp_2')
    expect(order().dispute.outcome).toBeUndefined()
    expect(order().dispute.closedAtMs).toBeUndefined()
    expect(order().dispute.reversedCents).toBeUndefined()
  })

  /**
   * The cap is `refund.ts`'s: this reversal against what is LEFT, never the
   * order total. The buyer cannot be handed the same money twice.
   */
  it('reverses only what a partial refund left behind', async () => {
    docs.set('hosts/host-1/orders/order-1', {
      ...order(),
      refundedCents: 1700,
    })
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expect(order().refundedCents).toBe(ORDER_TOTAL_CENTS)
    expect(contact().refundedCents).toBe(ORDER_TOTAL_CENTS - 1700)
    expect(order().dispute.reversedCents).toBe(ORDER_TOTAL_CENTS - 1700)
  })

  /**
   * AGL-1754's finding, inherited: `fullyRefunded` is NOT a once-only signal.
   * An order a merchant already refunded in full is already `refunded`, which
   * has no legal transition out of it — so `canTransitionOrder` is false, the
   * flip is not observable a second time, and `refundedOrdersCount` is not
   * incremented again for an order it already counted.
   */
  it('does not count a closed order twice when the merchant refunded it first', async () => {
    docs.set('hosts/host-1/orders/order-1', {
      ...order(),
      status: 'refunded',
      refundedCents: ORDER_TOTAL_CENTS,
    })
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expect(order().refundedCents).toBe(ORDER_TOTAL_CENTS)
    expect(contact().refundedOrdersCount).toBeUndefined()
    expect(order().dispute.outcome).toBe('lost')
  })

  /**
   * A chargeback must not rewrite a terminal state the merchant chose. The
   * loss is still recorded — the money really did leave.
   */
  it('records a loss on a cancelled order without flipping its status', async () => {
    docs.set('hosts/host-1/orders/order-1', { ...order(), status: 'cancelled' })
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expect(order().status).toBe('cancelled')
    expect(order().refundedCents).toBe(DISPUTE_CENTS)
    expect(contact().refundedOrdersCount).toBeUndefined()
    expect(contact().refundedCents).toBe(DISPUTE_CENTS)
  })
})

describe('finding the order the dispute is against', () => {
  /**
   * A dispute carries no metadata, so the LOOKUP is how this branch
   * self-selects. The same platform account carries marketplace purchases
   * (AGL-1554), booking payments and Aglyn's own subscription billing, and a
   * dispute on any of those reaches this handler too — silence is correct, and
   * an alert here would fire on every one of them.
   */
  it('writes nothing for a dispute against another product', async () => {
    const before = new Map(docs)
    await deliver(
      'charge.dispute.closed',
      disputeEvent({ status: 'lost', payment_intent: 'pi_marketplace_9' }),
    )
    expect([...docs.entries()]).toEqual([...before.entries()])
    expect(managerNotices).toHaveLength(0)
  })

  /** An old charge with no payment intent cannot be joined to anything. */
  it('writes nothing when the dispute carries no payment intent', async () => {
    await deliver(
      'charge.dispute.closed',
      disputeEvent({ status: 'lost', payment_intent: null }),
    )
    expect(order().refundedCents ?? 0).toBe(0)
  })

  /**
   * The scan really does cross hosts, so the assertion above is not passing
   * because the query found nothing on principle.
   */
  it('finds an order on another host', async () => {
    docs.set('hosts/host-2', { displayName: 'Other Store', orgId: 'org-1' })
    docs.set('hosts/host-2/orders/order-9', {
      status: 'paid',
      customerEmail: 'buyer@example.com',
      paymentIntentId: 'pi_other_1',
      lineItems: [
        { productId: 'p', name: 'Desk', quantity: 1, unitAmountCents: 3300 },
      ],
      totals: {
        itemsCents: 3300,
        shippingCents: 0,
        taxCents: 0,
        discountCents: 0,
        feeCents: 0,
        totalCents: 3300,
      },
    })
    await deliver(
      'charge.dispute.closed',
      disputeEvent({
        status: 'lost',
        amount: 3300,
        payment_intent: 'pi_other_1',
      }),
    )
    expect(docs.get('hosts/host-2/orders/order-9')?.refundedCents).toBe(3300)
    expect(order().refundedCents ?? 0).toBe(0)
    expect(managerNotices[0].hostId).toBe('host-2')
  })

  /**
   * A payment intent belongs to one order. Two matches is corrupt data:
   * reversing an arbitrary one is a coin flip and reversing both double-counts.
   */
  it('reverses nothing when two orders claim the same payment intent', async () => {
    docs.set('hosts/host-1/orders/order-dupe', {
      ...order(),
      paymentIntentId: 'pi_dispute_1',
    })
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expect(order().refundedCents ?? 0).toBe(0)
    expect(docs.get('hosts/host-1/orders/order-dupe')?.refundedCents ?? 0).toBe(
      0,
    )
  })

  /**
   * An order deleted between the query and the transaction. The write is an
   * `update()` on a document the transaction re-read, so it refuses rather
   * than conjuring an order stub out of a dispute.
   */
  it('does not resurrect an order deleted under the query', async () => {
    deleteOrderDuringQuery = true
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expect(docs.has('hosts/host-1/orders/order-1')).toBe(false)
    expect(managerNotices).toHaveLength(0)
  })
})

describe('the failure that no redelivery can fix', () => {
  /**
   * A missing collection-group index is PERMANENT: every redelivery fails
   * identically, and `runBillingWebhookHandlers` propagates the first throw
   * into a 500, so a throw here is an infinite Stripe retry loop rather than a
   * retry. Caught, logged by name, and the event is let go.
   */
  it('does not throw when the collection-group index is missing', async () => {
    collectionGroupFailure = {
      code: GRPC_FAILED_PRECONDITION,
      message: '9 FAILED_PRECONDITION: The query requires an index.',
    }
    await expect(
      deliver('charge.dispute.closed', disputeEvent({ status: 'lost' })),
    ).resolves.toBeUndefined()
    expect(order().refundedCents ?? 0).toBe(0)
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('orders.paymentIntentId'),
      expect.anything(),
    )
  })

  /**
   * And the catch is narrow. A transient failure must still propagate, because
   * there a redelivery IS the fix — without this the case above would pass
   * just as well against a bare `.catch(() => null)`.
   */
  it('still throws on a transient failure, so Stripe redelivers', async () => {
    collectionGroupFailure = {
      code: 14,
      message: '14 UNAVAILABLE: The service is currently unavailable.',
    }
    await expect(
      deliver('charge.dispute.closed', disputeEvent({ status: 'lost' })),
    ).rejects.toThrow('UNAVAILABLE')
  })
})

describe('the contact the reversal cannot reach', () => {
  /**
   * AGL-1754's refuse-and-record, reached through the chargeback door. The
   * reversal is durable on the ORDER, which is what the AGL-1753 rebuild
   * reads, so refusing discards nothing — and creating a contact here would
   * mint one holding a reversal and no purchase.
   */
  it('refuses to create a contact and counts the miss', async () => {
    docs.delete('orgs/org-1/contacts/contact-1')
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expect(order().refundedCents).toBe(DISPUTE_CENTS)
    expect(
      [...docs.keys()].some((key) => key.startsWith('orgs/org-1/contacts/')),
    ).toBe(false)
    expect(
      docs.get('hosts/host-1/counters/contactRefundsUnmatched'),
    ).toMatchObject({
      total: 1,
      lastReason: 'no-contact',
      lastOrderId: 'order-1',
    })
    expectNothingSwallowed()
  })
})

/**
 * The shelf's side of the ledger (AGL-1797), through the chargeback door.
 *
 * Neither door touched inventory: the checkout webhook decremented variant
 * stock on the sale and nothing put it back, so a lost dispute left the
 * merchant's count permanently one lower than their shelf. These are WIRING
 * cases — the writer's own behaviour is pinned in `restock-flag.spec.ts` — and
 * what they measure is that this door calls it on the ONE event that moves
 * money and on none of the others, so the two doors cannot diverge the way the
 * contact ledger did before AGL-1754.
 */
describe('the stock a chargeback left off the shelf (AGL-1797)', () => {
  const restockEvents = () =>
    ((order().timeline ?? []) as any[]).filter(
      (entry) => entry.event === 'restock-check',
    )

  function expectNothingFlagFailed() {
    expect(consoleError).not.toHaveBeenCalledWith(
      'flagOrderRestock failed',
      expect.anything(),
    )
  }

  it('flags the stock a LOST dispute left off the shelf', async () => {
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expectNothingFlagFailed()
    expect(order().restockCheck).toMatchObject({
      kind: 'chargeback',
      units: 1,
      fullyReversed: true,
      lines: [
        { productId: 'product-1', variantId: 'var-default', quantity: 1 },
      ],
    })
    // FLAGGED, NOT RELEASED, and a chargeback is the clearest case for that:
    // the shopper kept the item and took the money, so incrementing would
    // invent stock the merchant does not have.
    expect(
      docs.get('hosts/host-1/products/product-1').variants[0].inventory,
    ).toBe(8)
    expect(restockEvents()).toHaveLength(1)
    expect(restockEvents()[0].detail).toContain(
      'the shopper kept the goods unless they came back',
    )
  })

  it('leaves the shelf alone on `created`, which reverses nothing', async () => {
    await deliver('charge.dispute.created', disputeEvent())
    expect(order().restockCheck).toBeUndefined()
    expect(restockEvents()).toHaveLength(0)
  })

  it('leaves the shelf alone when the dispute is WON', async () => {
    await deliver('charge.dispute.created', disputeEvent())
    await deliver('charge.dispute.closed', disputeEvent({ status: 'won' }))
    // Nothing was reversed, so nothing is missing from the shelf — the same
    // reason a win has no contact write and no status flip.
    expect(order().restockCheck).toBeUndefined()
    expect(
      docs.get('hosts/host-1/products/product-1').variants[0].inventory,
    ).toBe(8)
  })

  it('leaves the shelf alone on `warning_closed`', async () => {
    // Asserted separately from `won` so "anything not lost" cannot regress
    // into "anything that is won".
    await deliver(
      'charge.dispute.closed',
      disputeEvent({ status: 'warning_closed' }),
    )
    expect(order().restockCheck).toBeUndefined()
  })

  it('flags nothing when a lost dispute found nothing left to reverse', async () => {
    // Already refunded in full by hand, so the dispute reverses $0 — and a
    // reversal of nothing left nothing off the shelf.
    docs.set('hosts/host-1/orders/order-1', {
      ...order(),
      status: 'refunded',
      refundedCents: ORDER_TOTAL_CENTS,
    })
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expect(order().restockCheck).toBeUndefined()
  })

  it('says nothing at all when the merchant tracks no stock', async () => {
    docs.set('hosts/host-1/products/product-1', {
      name: 'Chair',
      type: 'physical',
      status: 'active',
      variants: [{ id: 'var-default', priceUsd: 62, inventory: null }],
    })
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expectNothingFlagFailed()
    // The reversal still landed; only the prompt is withheld.
    expect(order().refundedCents).toBe(DISPUTE_CENTS)
    expect(order().restockCheck).toBeUndefined()
    expect(restockEvents()).toHaveLength(0)
  })

  it('flags once across a redelivered `closed`', async () => {
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    const flaggedAtMs = order().restockCheck.flaggedAtMs
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expect(restockEvents()).toHaveLength(1)
    expect(order().restockCheck.flaggedAtMs).toBe(flaggedAtMs)
  })

  it('does not disturb the reversal the flag rides behind', async () => {
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expect(order().refundedCents).toBe(DISPUTE_CENTS)
    expect(order().status).toBe('refunded')
    expect(contact().refundedCents).toBe(DISPUTE_CENTS)
    expect(contact().ltvCents).toBe(9100)
    expectNothingSwallowed()
  })
})

/**
 * The platform's side of the money (AGL-1794).
 *
 * On a destination charge a lost dispute debits AGLYN's balance while the
 * merchant keeps the transfer. The decision: the merchant eats their share —
 * a transfer reversal for the portion that was actually transferred, never
 * the application fee's — and the platform eats Stripe's dispute fee as the
 * cost of owning the payment relationship.
 *
 * The transfer is 5580 of the 6200 charge (a 620 application fee), so no
 * correct assertion can coincide with the dispute amount, the order total or
 * any other figure in this file (AGL-1711).
 */
describe('the seller share of a lost dispute (AGL-1794)', () => {
  const TRANSFER_CENTS = 5580
  const CHARGE_URL = 'https://api.stripe.com/v1/charges/ch_1'
  const TRANSFER_URL = 'https://api.stripe.com/v1/transfers/tr_1'
  const REVERSAL_URL = 'https://api.stripe.com/v1/transfers/tr_1/reversals'

  /** The happy path's three stops, each overridable per test. */
  function happyStripe(
    overrides: {
      transfer?: Record<string, any>
      reversal?: { status?: number; body?: any }
    } = {},
  ): void {
    stubStripe({
      [CHARGE_URL]: {
        body: { id: 'ch_1', amount: ORDER_TOTAL_CENTS, transfer: 'tr_1' },
      },
      [TRANSFER_URL]: {
        body: {
          id: 'tr_1',
          amount: TRANSFER_CENTS,
          amount_reversed: 0,
          reversals: { data: [] },
          ...overrides.transfer,
        },
      },
      [REVERSAL_URL]: overrides.reversal ?? {
        body: {
          id: 'trr_1',
          object: 'transfer_reversal',
          amount: TRANSFER_CENTS,
        },
      },
    })
  }

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_double_1794'
  })

  /** THE DECISION, as a wire shape: the merchant's share leaves their account. */
  it('pulls the seller share back from the connected account on a loss', async () => {
    happyStripe()
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expect(reversalPosts()).toHaveLength(1)
    const post = reversalPosts()[0]
    expect(post.url).toBe(REVERSAL_URL)
    const body = new URLSearchParams(String(post.init.body))
    // The TRANSFERRED portion, not the disputed 6200: the application fee's
    // 620 was never the merchant's, so it is not pulled back from them.
    expect(body.get('amount')).toBe(String(TRANSFER_CENTS))
    // The metadata is the crash-window backstop's join key.
    expect(body.get('metadata[disputeId]')).toBe('dp_1')
    expect(body.get('metadata[orderId]')).toBe('order-1')
    expect(post.init.headers['Idempotency-Key']).toBe('dispute-reversal-dp_1')
    // Every call carried the throwaway key — and only the throwaway key.
    for (const call of stripeCalls) {
      expect(call.init.headers['Authorization']).toBe('Bearer sk_double_1794')
    }
    expect(order().dispute.transferReversalId).toBe('trr_1')
    expect(order().dispute.reversedTransferCents).toBe(TRANSFER_CENTS)
  })

  /** The wording the merchant reads — honest about which door and whose share. */
  it('stamps the timeline in words the merchant can read', async () => {
    happyStripe()
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expect(disputeEvents().at(-1).detail).toBe(
      '$55.80 seller share reversed for lost dispute',
    )
  })

  /**
   * The proportion follows the order's OWN reversal, which `refund.ts`'s cap
   * already bounded: a $17.00 refund left 4500 to charge back, and the
   * merchant's share of that is 4500 × 5580 ÷ 6200 = 4050.
   */
  it('reverses proportionally when a partial refund left less behind', async () => {
    docs.set('hosts/host-1/orders/order-1', {
      ...order(),
      refundedCents: 1700,
    })
    happyStripe({ reversal: { body: { id: 'trr_1', amount: 4050 } } })
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    const body = new URLSearchParams(String(reversalPosts()[0].init.body))
    expect(body.get('amount')).toBe('4050')
    expect(order().dispute.reversedTransferCents).toBe(4050)
  })

  /** NEVER MORE: the transfer's remainder caps the share. */
  it('never reverses more than the transfer has left', async () => {
    happyStripe({
      transfer: { amount_reversed: 5000 },
      reversal: { body: { id: 'trr_1', amount: 580 } },
    })
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    const body = new URLSearchParams(String(reversalPosts()[0].init.body))
    expect(body.get('amount')).toBe('580')
    expect(order().dispute.reversedTransferCents).toBe(580)
  })

  /**
   * THE GUARD, proven from the redelivery side: `reversedTransferCents` on
   * the order's dispute record settles the step, so the second delivery makes
   * no Stripe call at all.
   */
  it('does not double-reverse on a redelivered closed', async () => {
    happyStripe()
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expect(reversalPosts()).toHaveLength(1)
    expect(order().dispute.reversedTransferCents).toBe(TRANSFER_CENTS)
  })

  /**
   * THE GUARD's backstop, proven from the crash side: the POST landed on a
   * previous delivery and the process died before the record wrote, so the
   * marker is unset — and the reversal is FOUND on the transfer, adopted,
   * never created twice.
   */
  it('adopts a reversal that landed before the record could be written', async () => {
    happyStripe({
      transfer: {
        amount_reversed: TRANSFER_CENTS,
        reversals: {
          data: [
            {
              id: 'trr_9',
              amount: TRANSFER_CENTS,
              metadata: { disputeId: 'dp_1' },
            },
          ],
        },
      },
    })
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expect(reversalPosts()).toHaveLength(0)
    expect(order().dispute.transferReversalId).toBe('trr_9')
    expect(order().dispute.reversedTransferCents).toBe(TRANSFER_CENTS)
    expect(disputeEvents().at(-1).detail).toContain('seller share reversed')
  })

  /** …and the join is the dispute id, not "any reversal that exists". */
  it('does not adopt another dispute reversal', async () => {
    happyStripe({
      transfer: {
        amount_reversed: 100,
        reversals: {
          data: [{ id: 'trr_8', amount: 100, metadata: { disputeId: 'dp_0' } }],
        },
      },
      reversal: { body: { id: 'trr_1', amount: 5480 } },
    })
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    const body = new URLSearchParams(String(reversalPosts()[0].init.body))
    // Capped by the 5480 the transfer has left, not the full 5580 share.
    expect(body.get('amount')).toBe('5480')
    expect(order().dispute.transferReversalId).toBe('trr_1')
  })

  /**
   * A transfer with nothing left is a failure no redelivery can fix: logged,
   * recorded as 0 so the step never retries, and NOT thrown (AGL-1743).
   */
  it('records nothing left when the transfer is already fully reversed', async () => {
    happyStripe({ transfer: { amount_reversed: TRANSFER_CENTS } })
    await expect(
      deliver('charge.dispute.closed', disputeEvent({ status: 'lost' })),
    ).resolves.toBeUndefined()
    expect(reversalPosts()).toHaveLength(0)
    expect(order().dispute.reversedTransferCents).toBe(0)
    expect(order().dispute.transferReversalId).toBeUndefined()
    expect(disputeEvents().at(-1).detail).toContain('nothing left to pull back')
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('nothing left to reverse'),
      expect.anything(),
    )
  })

  /** Same rule for a charge Stripe holds no transfer on. */
  it('records no transfer to reverse when the charge has none', async () => {
    stubStripe({
      [CHARGE_URL]: { body: { id: 'ch_1', amount: ORDER_TOTAL_CENTS } },
    })
    await expect(
      deliver('charge.dispute.closed', disputeEvent({ status: 'lost' })),
    ).resolves.toBeUndefined()
    expect(reversalPosts()).toHaveLength(0)
    expect(order().dispute.reversedTransferCents).toBe(0)
    expect(disputeEvents().at(-1).detail).toContain('no transfer on the charge')
  })

  /** And for Stripe refusing the reversal itself. */
  it('records a refused reversal rather than retrying it forever', async () => {
    happyStripe({
      reversal: { status: 400, body: { error: { message: 'no' } } },
    })
    await expect(
      deliver('charge.dispute.closed', disputeEvent({ status: 'lost' })),
    ).resolves.toBeUndefined()
    expect(order().dispute.reversedTransferCents).toBe(0)
    expect(order().dispute.transferReversalId).toBeUndefined()
    expect(disputeEvents().at(-1).detail).toContain('Stripe refused')
  })

  /**
   * A TRANSIENT failure throws on purpose — the marker stays unset, so the
   * 500 Stripe answers with a redelivery, and the redelivery IS the retry.
   */
  it('throws on a transient Stripe failure, so Stripe redelivers', async () => {
    stubStripe({
      [CHARGE_URL]: { status: 500, body: { error: { message: 'flaky' } } },
    })
    await expect(
      deliver('charge.dispute.closed', disputeEvent({ status: 'lost' })),
    ).rejects.toThrow('Stripe charge read failed')
    expect(order().dispute.reversedTransferCents).toBeUndefined()
  })

  /**
   * …and the redelivery completes the reversal WITHOUT doubling anything the
   * first delivery already did — the reason the reversal step runs outside
   * the settle's `recorded` guard and re-reads the order itself.
   */
  it('completes on the redelivery after a transient failure, once', async () => {
    stubStripe({
      [CHARGE_URL]: { status: 500, body: { error: { message: 'flaky' } } },
    })
    await expect(
      deliver('charge.dispute.closed', disputeEvent({ status: 'lost' })),
    ).rejects.toThrow()
    happyStripe()
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expect(reversalPosts()).toHaveLength(1)
    expect(order().dispute.reversedTransferCents).toBe(TRANSFER_CENTS)
    // The settle was idle on the redelivery: one notice, one contact write.
    expect(managerNotices).toHaveLength(1)
    expect(contact().refundedCents).toBe(DISPUTE_CENTS)
    expect(contact().refundedOrdersCount).toBe(1)
  })

  /**
   * An order the merchant already refunded in full reversed nothing here, and
   * `refund.ts` sent `reverse_transfer=true` when it did — the seller's share
   * already went back by the refund door, so this one makes NO Stripe call.
   */
  it('makes no Stripe call when the order had nothing left to reverse', async () => {
    docs.set('hosts/host-1/orders/order-1', {
      ...order(),
      status: 'refunded',
      refundedCents: ORDER_TOTAL_CENTS,
    })
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(order().dispute.reversedTransferCents).toBeUndefined()
  })

  /** A WON dispute reverses nothing anywhere — no call, no marker. */
  it('makes no Stripe call on a won dispute', async () => {
    await deliver('charge.dispute.closed', disputeEvent({ status: 'won' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(order().dispute.reversedTransferCents).toBeUndefined()
  })

  /** Config missing is logged and left retryable, never thrown. */
  it('makes no reversal without a secret key', async () => {
    delete process.env.STRIPE_SECRET_KEY
    await deliver('charge.dispute.closed', disputeEvent({ status: 'lost' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(order().dispute.reversedTransferCents).toBeUndefined()
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('STRIPE_SECRET_KEY'),
    )
  })
})
