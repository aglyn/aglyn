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

import type {
  PluginApiRequest,
  PluginApiResponse,
} from '@aglyn/aglyn/server'
import { refundHandler } from './refund'

/**
 * Refund idempotency and the over-refund cap (AGL-1696).
 *
 * This path sends money OUT, so the boundary is mocked absolutely: `fetch` is
 * replaced for the whole file and every POST to /v1/refunds is counted.
 * Nothing here may reach api.stripe.com — localhost carries the LIVE secret
 * key, so a real call would refund real money from a real merchant account.
 * Same rule as `pos-order.spec.ts`.
 *
 * Firestore is an in-memory map keyed by document path, so the tests read the
 * `refundedCents` that actually LANDED rather than trusting the handler's
 * response, and count the Stripe refunds that were actually issued.
 *
 * `runTransaction` is serialized through a queue. Real Firestore gets the same
 * effect by aborting and retrying a transaction whose reads changed under it;
 * serializing reproduces the property the code depends on — that a read and
 * the write derived from it cannot interleave with another transaction — which
 * is exactly the property the pre-fix code did not have.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

/**
 * `FieldValue.increment` as a sentinel the fake resolves on write (AGL-1754).
 * The contact's `refundedCents` is an increment, so a fake that stored the
 * sentinel object would let a double-count through unnoticed — the tests have
 * to read a NUMBER back.
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

function makeSnapshot(path: string) {
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
      const resolved = resolveFieldValues(existing, value)
      // `set(…, { merge: true })` CONJURES an absent document — the property
      // the contact write must not rely on, and the counter write does.
      docs.set(
        path,
        options?.merge ? { ...(existing ?? {}), ...resolved } : resolved,
      )
    },
    /**
     * `update()` REJECTS an absent document with gRPC `NOT_FOUND` (code 5) —
     * the whole reason `updateExisting` exists (AGL-1763). A fake that let an
     * update conjure a document would report the phantom-contact case green.
     */
    update: async (value: Record<string, any>) => {
      const existing = docs.get(path)
      if (existing === undefined) {
        const error: any = new Error(`NOT_FOUND: no entity to update: ${path}`)
        error.code = 5
        throw error
      }
      docs.set(path, { ...existing, ...resolveFieldValues(existing, value) })
    },
    /**
     * The atomic claim. Firestore rejects a `create()` on an existing
     * document, and that rejection IS the dedupe primitive — the fake has to
     * reproduce it faithfully or the test proves nothing.
     */
    create: async (value: Record<string, any>) => {
      if (docs.has(path)) {
        const error: any = new Error(
          `ALREADY_EXISTS: entity already exists: ${path}`,
        )
        error.code = 6
        throw error
      }
      docs.set(path, value)
    },
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

/**
 * Set by a test to delete the contact between the query that finds it and the
 * write that follows — the window `updateExisting` exists for (AGL-1754).
 */
let deleteContactDuringQuery = false

interface FakeFilter {
  field: string
  op: '==' | 'array-contains-any'
  value: any
}

function matchesFilter(data: Record<string, any>, filter: FakeFilter): boolean {
  const field = data[filter.field]
  if (filter.op === '==') return field === filter.value
  // `array-contains-any` matches NOTHING on a document that lacks the field
  // (AGL-1037) — the reason every contact carries `visibleTo`.
  if (!Array.isArray(field)) return false
  return (filter.value as any[]).some((token) => field.includes(token))
}

function makeQuery(path: string, filters: FakeFilter[], limit?: number): any {
  return {
    where: (field: string, op: any, value: any) =>
      makeQuery(path, [...filters, { field, op, value }], limit),
    limit: (count: number) => makeQuery(path, filters, count),
    get: async () => {
      const matched = childPaths(path).filter((child) =>
        filters.every((filter) => matchesFilter(docs.get(child) ?? {}, filter)),
      )
      const snapshots = (limit == null ? matched : matched.slice(0, limit)).map(
        makeSnapshot,
      )
      if (deleteContactDuringQuery) {
        for (const child of matched) docs.delete(child)
      }
      return { empty: snapshots.length === 0, docs: snapshots }
    },
  }
}

function makeCollectionRef(path: string): any {
  return {
    doc: (id: string) => makeDocRef(`${path}/${id}`),
    get: async () => ({ docs: childPaths(path).map(makeSnapshot) }),
    where: (field: string, op: any, value: any) =>
      makeQuery(path, [{ field, op, value }]),
    add: async (value: Record<string, any>) => {
      const id = `generated-${docs.size + 1}`
      docs.set(`${path}/${id}`, value)
      return makeDocRef(`${path}/${id}`)
    },
  }
}

/** One transaction body at a time — see the file header. */
let transactionQueue: Promise<unknown> = Promise.resolve()
let transactionCount = 0

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
  runTransaction: <T,>(fn: (transaction: any) => Promise<T>): Promise<T> => {
    const run = transactionQueue.then(() => {
      transactionCount += 1
      return fn({
        get: (ref: any) => ref.get(),
        set: (ref: any, value: any, options?: any) => {
          void ref.set(value, options)
        },
        // The restock flag (AGL-1797) writes its record with `update()`, which
        // replaces a nested map wholesale where a merge would recurse into it.
        update: (ref: any, value: any) => {
          void ref.update(value)
        },
      })
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
  getOrgForHost: async () => ({ org: { id: 'org-1', slug: 'acme' } }),
  // Contacts are ORG-scoped (AGL-237), so the contact write resolves through
  // the org, not `hosts/{hostId}/contacts`.
  orgDataCollectionForHost: async (_hostId: string, name: string) =>
    makeCollectionRef(`orgs/org-1/${name}`),
  // Faithful to the real narrowing (AGL-1039): the same `visibleTo` filter,
  // so a contact this host may not see is genuinely invisible to the query
  // rather than invisible only in the assertion.
  scopedToHost: (ref: any, hostId: string) =>
    ref.where('visibleTo', 'array-contains-any', ['org', `host:${hostId}`]),
}))

// `updateExisting` is deliberately NOT mocked. It is imported from its leaf
// entry point precisely so this barrel mock cannot stand in for it — a
// permissive stub would report "the contact was updated" for a document that
// never existed, which is the one case the tests below turn on.

// ---------------------------------------------------------------------------
// Stripe boundary — counted, never reached
// ---------------------------------------------------------------------------

interface StripeRefundCall {
  amount: string | null
  paymentIntent: string | null
  idempotencyKey: string | null
}

const refundCalls: StripeRefundCall[] = []
/** Keyed by the Idempotency-Key Stripe was handed, mirroring Stripe's replay. */
const refundsByKey = new Map<string, any>()
let refundCounter = 0
/** Set by a test to make the next refund call fail or throw. */
let nextRefundOutcome: 'ok' | 'rejected' | 'disputed' | 'throws' = 'ok'

const fetchMock = jest.fn(async (url: any, init: any): Promise<any> => {
  const target = String(url)
  if (!target.includes('api.stripe.com')) {
    throw new Error(`Unexpected fetch to ${target}`)
  }
  if (!target.endsWith('/v1/refunds')) {
    throw new Error(`Unexpected Stripe endpoint ${target}`)
  }
  const params = new URLSearchParams(String(init?.body ?? ''))
  const idempotencyKey =
    (init?.headers?.['Idempotency-Key'] as string | undefined) ?? null
  refundCalls.push({
    amount: params.get('amount'),
    paymentIntent: params.get('payment_intent'),
    idempotencyKey,
  })
  const outcome = nextRefundOutcome
  nextRefundOutcome = 'ok'
  // A real network round trip parks the handler here. Awaiting a macrotask
  // reproduces that, which is what lets two concurrent refunds interleave.
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (outcome === 'throws') throw new Error('socket hang up')
  if (outcome === 'rejected') {
    return {
      ok: false,
      json: async () => ({ error: { message: 'charge already refunded' } }),
    }
  }
  // Stripe's refusal on a disputed charge (AGL-1809): HTTP 400, error code
  // `charge_disputed`, message verbatim from the error-code table.
  if (outcome === 'disputed') {
    return {
      ok: false,
      json: async () => ({
        error: {
          code: 'charge_disputed',
          message:
            "The charge you're attempting to refund has been charged back.",
        },
      }),
    }
  }
  // Stripe replays a prior refund for a repeated key rather than issuing a
  // second one. Reproduced so a test can tell "we never called twice" from
  // "we called twice and Stripe absorbed it" — the assertions count CALLS.
  if (idempotencyKey && refundsByKey.has(idempotencyKey)) {
    return { ok: true, json: async () => refundsByKey.get(idempotencyKey) }
  }
  const refund = { id: `re_${++refundCounter}`, status: 'succeeded' }
  if (idempotencyKey) refundsByKey.set(idempotencyKey, refund)
  return { ok: true, json: async () => refund }
})

// ---------------------------------------------------------------------------
// Request / response plumbing
// ---------------------------------------------------------------------------

function makeResponse() {
  const result = { status: 0, body: undefined as any }
  const res: PluginApiResponse = {
    status(code) {
      result.status = code
      return res
    },
    json(body) {
      result.body = body
    },
    send(body) {
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
  } as PluginApiResponse
  return { res, result }
}

function makeRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): PluginApiRequest {
  return {
    method: 'POST',
    query: {},
    body: { hostId: 'host-1', orderId: 'order-1', ...body },
    headers: { authorization: 'Bearer token', ...headers },
    cookies: {},
    socket: {},
  } as unknown as PluginApiRequest
}

async function post(
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const { res, result } = makeResponse()
  await refundHandler(makeRequest(body, headers), res)
  return result
}

/** What actually landed on the order, not what the handler said. */
function storedOrder() {
  return docs.get('hosts/host-1/orders/order-1') ?? {}
}

/** What actually landed on the buyer's org-scoped contact (AGL-1754). */
function storedContact() {
  return docs.get('orgs/org-1/contacts/contact-1') ?? {}
}

/** The counter a refund that reached no contact increments (AGL-1754). */
function unmatchedCounter() {
  return docs.get('hosts/host-1/counters/contactRefundsUnmatched') ?? {}
}

/**
 * `recordContactRefund` swallows its own failures so it can never fail a
 * refund that already moved money — which means a test could otherwise pass
 * because nothing ran at all. Every assertion about the contact is paired with
 * this.
 */
function expectNothingSwallowed() {
  expect(consoleError).not.toHaveBeenCalledWith(
    'recordContactRefund failed',
    expect.anything(),
  )
}

let consoleError: jest.SpyInstance
let consoleWarn: jest.SpyInstance

beforeAll(() => {
  ;(global as any).fetch = fetchMock
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
  consoleError = jest
    .spyOn(console, 'error')
    .mockImplementation(() => undefined)
  consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterAll(() => {
  consoleError.mockRestore()
  consoleWarn.mockRestore()
})

beforeEach(() => {
  docs.clear()
  refundCalls.length = 0
  refundsByKey.clear()
  refundCounter = 0
  transactionCount = 0
  transactionQueue = Promise.resolve()
  nextRefundOutcome = 'ok'
  deleteContactDuringQuery = false
  fetchMock.mockClear()
  mockVerifyIdToken.mockClear()
  consoleError.mockClear()
  consoleWarn.mockClear()

  docs.set('hosts/host-1', { memberRoles: { 'admin-1': 'admin' } })
  // The buyer, already a contact from an earlier sale. Every figure is
  // distinct from every other in this file (AGL-1711): the order is 5000, the
  // partial 1500, the lifetime value 7400 and the order count 3, so no
  // assertion can pass by reading the wrong field.
  docs.set('orgs/org-1/contacts/contact-1', {
    hostId: 'host-1',
    visibleTo: ['org'],
    email: 'buyer@example.com',
    name: 'Dana Buyer',
    sources: { booking: true },
    interactions: [
      {
        type: 'booking',
        atMs: 1,
        refId: 'reservation-9',
        summary: 'Reserved a stay ($210.00)',
      },
    ],
    ltvCents: 7400,
    ordersCount: 3,
  })
  docs.set('hosts/host-1/orders/order-1', {
    status: 'paid',
    channel: 'online',
    customerEmail: 'Buyer@Example.com',
    customerName: 'Dana Buyer',
    paymentIntentId: 'pi_live_1',
    lineItems: [
      { productId: 'product-1', name: 'Chair', quantity: 1, unitAmountCents: 5000 },
    ],
    totals: {
      itemsCents: 5000,
      shippingCents: 0,
      taxCents: 0,
      discountCents: 0,
      feeCents: 0,
      totalCents: 5000,
    },
  })
  // The product the sale decremented (AGL-1797). Stocked at 9, which is not
  // any other figure in this file, and the order line names no variant so the
  // handler's first-variant fallback is the path under test.
  docs.set('hosts/host-1/products/product-1', {
    name: 'Chair',
    type: 'physical',
    status: 'active',
    variants: [{ id: 'var-default', priceUsd: 50, inventory: 9 }],
  })
})

// ---------------------------------------------------------------------------

describe('refund idempotency and cap (AGL-1696)', () => {
  it('refunds an order once and records it', async () => {
    const result = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ refundedCents: 5000, fullyRefunded: true })
    expect(refundCalls).toHaveLength(1)
    expect(refundCalls[0].amount).toBe('5000')
    expect(refundCalls[0].paymentIntent).toBe('pi_live_1')
    expect(storedOrder().refundedCents).toBe(5000)
    expect(storedOrder().status).toBe('refunded')
  })

  /**
   * THE DEFECT, half one. The same attempt posted twice — a lost response, a
   * double-click, an admin hitting refresh. Before the fix the second call
   * re-read an unchanged `refundedCents` (written only AFTER the Stripe call,
   * outside any transaction) and sent a second full refund.
   */
  it('does not refund twice when one attempt is retried', async () => {
    const first = await post({}, { 'idempotency-key': 'attempt-a' })
    const second = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(first.status).toBe(200)
    // One refund left the merchant account, not two.
    expect(refundCalls).toHaveLength(1)
    expect(storedOrder().refundedCents).toBe(5000)
    // The retry gets the recorded answer rather than a fresh refund.
    expect(second.status).toBe(200)
    expect(second.body).toMatchObject({ refundedCents: 5000, fullyRefunded: true })
  })

  /**
   * The same retry against a PARTIAL refund, which is where the defect is
   * naked. A retried full refund happened to be caught by the status guard
   * once the order reached `refunded`; a partial leaves the order in `paid`,
   * so nothing at all stood between the retry and a second transfer. Measured
   * before the fix: two $10 refunds and `refundedCents` at 2000.
   */
  it('does not refund twice when a partial attempt is retried', async () => {
    const first = await post(
      { amountCents: 1000 },
      { 'idempotency-key': 'attempt-a' },
    )
    const second = await post(
      { amountCents: 1000 },
      { 'idempotency-key': 'attempt-a' },
    )

    expect(first.status).toBe(200)
    expect(refundCalls).toHaveLength(1)
    expect(storedOrder().refundedCents).toBe(1000)
    expect(second.status).toBe(200)
    expect(second.body).toMatchObject({ refundedCents: 1000, fullyRefunded: false })
  })

  /**
   * THE DEFECT, half two — and a DIFFERENT control. Two admins (or two tabs)
   * refunding the same order at once mint two distinct attempt keys, so the
   * idempotency key cannot help. Only a cap read and written inside the same
   * transaction stops the second one.
   */
  it('does not refund twice when two distinct attempts race', async () => {
    const first = post({}, { 'idempotency-key': 'attempt-a' })
    const second = post({}, { 'idempotency-key': 'attempt-b' })
    const [a, b] = await Promise.all([first, second])

    // Exactly one refund reached Stripe; the loser saw nothing left.
    expect(refundCalls).toHaveLength(1)
    expect(storedOrder().refundedCents).toBe(5000)
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([200, 400])
  })

  /**
   * The backstop for the window where our own claim landed but the process
   * died before recording the response: Stripe must recognise the retry.
   */
  it('hands Stripe an idempotency key derived from the attempt', async () => {
    await post({}, { 'idempotency-key': 'attempt-a' })
    expect(refundCalls).toHaveLength(1)
    expect(refundCalls[0].idempotencyKey).toBeTruthy()

    // Drop our claim and the reservation, as a crash between them would.
    for (const path of childPaths('apiIdempotency')) docs.delete(path)
    docs.set('hosts/host-1/orders/order-1', {
      ...storedOrder(),
      refundedCents: 0,
      status: 'paid',
    })

    await post({}, { 'idempotency-key': 'attempt-a' })
    expect(refundCalls).toHaveLength(2)
    // Same key, so Stripe replays its own refund instead of issuing a second.
    expect(refundCalls[1].idempotencyKey).toBe(refundCalls[0].idempotencyKey)
    expect(refundsByKey.size).toBe(1)
  })

  /**
   * The mirror of "the same coffee twice is a real second sale" in
   * `pos-order.spec.ts`. A key derived from the order id — or from the order
   * id plus the amount — would silently swallow a legitimate second partial
   * refund. Two $10 refunds on a $50 order are two real refunds.
   */
  it('lets a genuinely different partial refund through', async () => {
    const first = await post(
      { amountCents: 1000 },
      { 'idempotency-key': 'attempt-a' },
    )
    const second = await post(
      { amountCents: 1000 },
      { 'idempotency-key': 'attempt-b' },
    )

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(refundCalls).toHaveLength(2)
    expect(refundCalls[0].amount).toBe('1000')
    expect(refundCalls[1].amount).toBe('1000')
    expect(storedOrder().refundedCents).toBe(2000)
    // Partials do not close the order.
    expect(storedOrder().status).toBe('paid')
  })

  /** The cap's own job: several partials must not exceed what was captured. */
  it('caps the running total at the captured amount', async () => {
    await post({ amountCents: 4000 }, { 'idempotency-key': 'attempt-a' })
    const second = await post(
      { amountCents: 4000 },
      { 'idempotency-key': 'attempt-b' },
    )

    expect(second.status).toBe(200)
    // Clamped to what was left, not the requested 4000.
    expect(refundCalls[1].amount).toBe('1000')
    expect(storedOrder().refundedCents).toBe(5000)
    expect(storedOrder().status).toBe('refunded')

    // Now fully refunded, so the status guard turns a third attempt away
    // before the cap is even consulted. Either way, no third Stripe call.
    const third = await post(
      { amountCents: 500 },
      { 'idempotency-key': 'attempt-c' },
    )
    expect(third.status).toBe(409)
    expect(refundCalls).toHaveLength(2)
  })

  /**
   * A refund Stripe explicitly rejected did not happen, so the reservation
   * must come back and the key must not be burned — otherwise one bad moment
   * locks the order out of ever being refunded.
   */
  it('rolls back and releases when Stripe rejects the refund', async () => {
    nextRefundOutcome = 'rejected'
    const failed = await post({}, { 'idempotency-key': 'attempt-a' })
    expect(failed.status).toBe(502)
    expect(storedOrder().refundedCents ?? 0).toBe(0)
    expect(storedOrder().status).toBe('paid')

    const retry = await post({}, { 'idempotency-key': 'attempt-a' })
    expect(retry.status).toBe(200)
    expect(storedOrder().refundedCents).toBe(5000)
  })

  /**
   * The deliberate divergence from `pos-order.ts`, which releases its claim in
   * the catch-all. When the refund call THROWS we do not know whether Stripe
   * moved the money, and the two failure directions are not symmetric: a
   * stranded key costs a support ticket, a released one costs a second refund.
   * So refunds fail CLOSED — the retry is refused rather than re-sent.
   */
  it('fails closed when the refund call throws', async () => {
    nextRefundOutcome = 'throws'
    const thrown = await post({}, { 'idempotency-key': 'attempt-a' })
    expect(thrown.status).toBe(500)

    const retry = await post({}, { 'idempotency-key': 'attempt-a' })
    expect(retry.status).toBe(409)
    // Still exactly one refund attempt against Stripe.
    expect(refundCalls).toHaveLength(1)
  })

  /**
   * Backwards compatibility: an older cached console bundle sends no key. It
   * must still refund — and the transactional cap, which is a separate
   * control, must still hold without one.
   */
  it('still refunds without a key, and the cap still holds', async () => {
    const first = await post({ amountCents: 4000 })
    const second = await post({ amountCents: 4000 })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(storedOrder().refundedCents).toBe(5000)
    expect(childPaths('apiIdempotency')).toHaveLength(0)
  })

  /** The cap must be read inside a transaction, not before one. */
  it('reads and writes the cap inside a transaction', async () => {
    await post({}, { 'idempotency-key': 'attempt-a' })
    expect(transactionCount).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------

/**
 * The customer's side of a refund (AGL-1754).
 *
 * `refund.ts` moved the money, transitioned the order and appended a timeline
 * event, and never touched the buyer. `ltvCents` only ever rose, so a customer
 * who bought $500 and returned all of it read identically to one who kept it.
 *
 * The chosen shape is AGL-1747's, not a decrement: `ltvCents` stays GROSS
 * under its existing name and `refundedCents` is recorded beside it, so the
 * stored numbers cannot go negative and a reader computes the net. These tests
 * therefore assert BOTH — that the reversal landed and that the gross figure
 * was left alone — since a decrement would pass "the contact knows about the
 * refund" just as well.
 */
describe('refund and lifetime value (AGL-1754)', () => {
  /**
   * THE DEFECT. Before the fix the contact was untouched by a refund: no
   * `refundedCents`, no timeline entry, `ltvCents` still the full sale.
   */
  it('records a full refund against the buyer without lowering ltvCents', async () => {
    const result = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(result.status).toBe(200)
    expect(storedContact().refundedCents).toBe(5000)
    // Gross, deliberately unchanged — the whole point of the shape.
    expect(storedContact().ltvCents).toBe(7400)
    expect(storedContact().ordersCount).toBe(3)
    expect(storedContact().refundedOrdersCount).toBe(1)
    expect(storedContact().lastRefundAtMs).toEqual(expect.any(Number))
    expectNothingSwallowed()
  })

  /**
   * The join key is the NORMALIZED email (AGL-1753 item 3): orders store
   * whatever was typed, contacts are keyed lowercased. The fixture order
   * carries `Buyer@Example.com` and the contact `buyer@example.com`, so a
   * writer that skipped `normalizeContactEmail` would find nobody and quietly
   * count this as an unmatched refund instead.
   */
  it('matches the contact through the normalized email', async () => {
    await post({}, { 'idempotency-key': 'attempt-a' })

    expect(storedContact().refundedCents).toBe(5000)
    expect(unmatchedCounter().total).toBeUndefined()
  })

  /** A partial refunds what was refunded, never the order total. */
  it('records only the refunded part of a partial', async () => {
    const result = await post(
      { amountCents: 1500 },
      { 'idempotency-key': 'attempt-a' },
    )

    expect(result.status).toBe(200)
    expect(storedContact().refundedCents).toBe(1500)
    expect(storedContact().ltvCents).toBe(7400)
    // The order is still open, so it is not a reversed ORDER yet.
    expect(storedContact().refundedOrdersCount).toBeUndefined()
    expect(storedOrder().status).toBe('paid')
    expectNothingSwallowed()
  })

  /** Several partials accumulate, and close the order exactly once. */
  it('sums partials and counts the closed order once', async () => {
    await post({ amountCents: 1500 }, { 'idempotency-key': 'attempt-a' })
    await post({ amountCents: 3500 }, { 'idempotency-key': 'attempt-b' })

    expect(storedContact().refundedCents).toBe(5000)
    expect(storedContact().refundedOrdersCount).toBe(1)
    expect(storedOrder().status).toBe('refunded')
    expectNothingSwallowed()
  })

  /**
   * The subtlety `closedTheOrder` exists for. Two partials that between them
   * close an order both reserve before either settles, so BOTH re-read a
   * completed `refundedCents` and both compute `fullyRefunded`. Writing
   * `status: 'refunded'` twice is harmless; counting a reversed order twice is
   * not. Keyed on the status transition rather than the total, this counts one.
   */
  it('counts one reversed order when two partials close it at once', async () => {
    const first = post(
      { amountCents: 4000 },
      { 'idempotency-key': 'attempt-a' },
    )
    const second = post(
      { amountCents: 1000 },
      { 'idempotency-key': 'attempt-b' },
    )
    await Promise.all([first, second])

    expect(storedOrder().refundedCents).toBe(5000)
    expect(storedContact().refundedCents).toBe(5000)
    expect(storedContact().refundedOrdersCount).toBe(1)
    expectNothingSwallowed()
  })

  /**
   * A retried attempt replays the recorded response without re-refunding, so
   * it must not decrement the customer a second time either. `refundedCents`
   * is a `FieldValue.increment`, which is exactly the shape a replay inflates.
   */
  it('does not double-count a retried attempt', async () => {
    await post({}, { 'idempotency-key': 'attempt-a' })
    await post({}, { 'idempotency-key': 'attempt-a' })

    expect(refundCalls).toHaveLength(1)
    expect(storedContact().refundedCents).toBe(5000)
    expect(storedContact().refundedOrdersCount).toBe(1)
  })

  /**
   * A refund belongs in the contact's HISTORY, not only its total — the
   * profile timeline is what a merchant looks at to understand a number they
   * distrust.
   */
  it('appends the refund to the contact timeline, newest first', async () => {
    await post({ amountCents: 1500 }, { 'idempotency-key': 'attempt-a' })

    const interactions = storedContact().interactions
    expect(interactions).toHaveLength(2)
    expect(interactions[0]).toMatchObject({
      type: 'order',
      refId: 'order-1',
      summary: '$15.00 refunded',
    })
    // The earlier interaction survives underneath it.
    expect(interactions[1].refId).toBe('reservation-9')
  })

  /** A full refund says so, matching the order timeline's own wording. */
  it('marks a timeline entry that closed the order as full', async () => {
    await post({}, { 'idempotency-key': 'attempt-a' })

    expect(storedContact().interactions[0].summary).toBe(
      '$50.00 refunded (full)',
    )
  })

  /**
   * `sources` records which capture silo produced the contact, and a refund
   * captures nobody. This contact came from a booking; a refund must not
   * rewrite it into an order-sourced contact and change which saved segments
   * match it.
   */
  it('does not add a capture source for a refund', async () => {
    await post({}, { 'idempotency-key': 'attempt-a' })

    expect(storedContact().sources).toEqual({ booking: true })
  })

  /**
   * THE REFUSAL. A buyer whose order predates AGL-1748 — a payment link, a POS
   * card sale — has no contact at all. Creating one here would be band-gated
   * (billing a merchant for a customer record they never had), and would mint a
   * contact holding a refund and no purchase. The refund is durable on the
   * order either way, which is what AGL-1753's rebuild reads.
   */
  it('refuses to create a contact for a buyer that has none, and counts it', async () => {
    docs.delete('orgs/org-1/contacts/contact-1')

    const result = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(result.status).toBe(200)
    // The money is still recorded where it belongs.
    expect(storedOrder().refundedCents).toBe(5000)
    // Nothing was conjured anywhere in the contacts collection.
    expect(childPaths('orgs/org-1/contacts')).toHaveLength(0)
    expect(unmatchedCounter().total).toBe(1)
    expect(unmatchedCounter().lastReason).toBe('no-contact')
    expect(unmatchedCounter().lastOrderId).toBe('order-1')
  })

  /**
   * The window `updateExisting` exists for: the contact is deleted between the
   * query that found it and the write that follows. `set(…, { merge: true })`
   * would resurrect it as a document holding nothing but a refund — a contact
   * with a negative lifetime value who never bought anything, and one that
   * satisfies every query filtering on the fields it happens to carry.
   */
  it('does not resurrect a contact deleted under the write', async () => {
    deleteContactDuringQuery = true

    const result = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(result.status).toBe(200)
    expect(childPaths('orgs/org-1/contacts')).toHaveLength(0)
    expect(unmatchedCounter().total).toBe(1)
    expect(unmatchedCounter().lastReason).toBe('contact-deleted')
  })

  /** An order that never identified its buyer: refunded, recorded, no contact. */
  it('records a refund on an order with no customer email', async () => {
    docs.set('hosts/host-1/orders/order-1', {
      ...storedOrder(),
      customerEmail: null,
    })

    const result = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(result.status).toBe(200)
    expect(storedOrder().refundedCents).toBe(5000)
    expect(storedContact().refundedCents).toBeUndefined()
    expect(unmatchedCounter().lastReason).toBe('no-email')
  })

  /**
   * Placement: the contact write sits past the settle transaction, so a refund
   * Stripe REJECTED — where no money moved and the reservation was handed back
   * — must leave the customer's figures alone.
   */
  it('leaves the contact alone when Stripe rejects the refund', async () => {
    nextRefundOutcome = 'rejected'

    const result = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(result.status).toBe(502)
    expect(storedContact().refundedCents).toBeUndefined()
    expect(storedContact().ltvCents).toBe(7400)
    expect(unmatchedCounter().total).toBeUndefined()
  })

  /** Nothing left to refund is not a refund. */
  it('leaves the contact alone when there is nothing left to refund', async () => {
    await post({}, { 'idempotency-key': 'attempt-a' })
    const second = await post(
      { amountCents: 500 },
      { 'idempotency-key': 'attempt-b' },
    )

    expect(second.status).toBe(409)
    // Exactly the one refund, not a second helping of nothing.
    expect(storedContact().refundedCents).toBe(5000)
    expect(storedContact().refundedOrdersCount).toBe(1)
  })

  /**
   * The read is host-scoped (AGL-1039). A contact another site in the org owns
   * exclusively must not be found by this host's refund — the admin SDK does
   * not evaluate rules, so the query has to filter for itself.
   */
  it('does not reach a contact scoped to another site', async () => {
    docs.set('orgs/org-1/contacts/contact-1', {
      ...storedContact(),
      visibleTo: ['host:host-2'],
    })

    await post({}, { 'idempotency-key': 'attempt-a' })

    expect(storedContact().refundedCents).toBeUndefined()
    expect(unmatchedCounter().lastReason).toBe('no-contact')
  })
})

/**
 * The shelf's side of the ledger (AGL-1797). `refund.ts` moved the money,
 * transitioned the order and appended the timeline, and touched no inventory —
 * so an order refunded in full left the merchant's stock count permanently one
 * lower than their shelf.
 *
 * These are WIRING cases: the writer's own behaviour is pinned in
 * `restock-flag.spec.ts`, and what is measured here is that the door actually
 * calls it, on the paths that moved money and on none of the paths that did
 * not. The flag swallows its own failures, so every assertion is paired with
 * `expectNothingFlagFailed` — otherwise a case could pass because the writer
 * threw on its first line and was never heard from again.
 */
describe('refund and the shelf (AGL-1797)', () => {
  function expectNothingFlagFailed() {
    expect(consoleError).not.toHaveBeenCalledWith(
      'flagOrderRestock failed',
      expect.anything(),
    )
  }

  it('flags the stock a full refund left off the shelf', async () => {
    const result = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(result.status).toBe(200)
    expectNothingFlagFailed()
    expect(storedOrder().restockCheck).toMatchObject({
      kind: 'refund',
      units: 1,
      fullyReversed: true,
      lines: [
        { productId: 'product-1', variantId: 'var-default', quantity: 1 },
      ],
    })
    // FLAGGED, NOT RELEASED — the whole decision. The goods may never have come
    // back, so the count is exactly where the refund found it and the merchant
    // is the one who answers.
    expect(
      docs.get('hosts/host-1/products/product-1').variants[0].inventory,
    ).toBe(9)
    // And no adjustment row: that ledger records stock that MOVED, and none did.
    expect(
      [...docs.keys()].filter((path) =>
        path.startsWith('hosts/host-1/inventoryAdjustments'),
      ),
    ).toHaveLength(0)
  })

  it('marks a partial refund as an upper bound, since it names no line', async () => {
    // A refund is requested as an AMOUNT and records no line selection, so
    // "$15 of a $50 order" cannot say which of the goods came back.
    const result = await post(
      { amountCents: 1500 },
      { 'idempotency-key': 'attempt-a' },
    )

    expect(result.status).toBe(200)
    expectNothingFlagFailed()
    expect(storedOrder().restockCheck).toMatchObject({
      units: 1,
      fullyReversed: false,
    })
  })

  it('flags nothing when Stripe rejected the refund', async () => {
    nextRefundOutcome = 'rejected'

    const result = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(result.status).toBe(502)
    expect(storedOrder().restockCheck).toBeUndefined()
  })

  it('flags nothing when there is nothing left to refund', async () => {
    await post({}, { 'idempotency-key': 'attempt-a' })
    const flaggedAtMs = storedOrder().restockCheck.flaggedAtMs
    const second = await post(
      { amountCents: 500 },
      { 'idempotency-key': 'attempt-b' },
    )

    expect(second.status).toBe(409)
    // The first flag stands, untouched — not re-flagged by a refund of nothing.
    expect(storedOrder().restockCheck.flaggedAtMs).toBe(flaggedAtMs)
  })

  it('says nothing at all when the merchant tracks no stock', async () => {
    docs.set('hosts/host-1/products/product-1', {
      name: 'Chair',
      type: 'physical',
      status: 'active',
      variants: [{ id: 'var-default', priceUsd: 50, inventory: null }],
    })

    const result = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(result.status).toBe(200)
    expectNothingFlagFailed()
    // No prompt a merchant could not act on: nothing was ever decremented.
    expect(storedOrder().restockCheck).toBeUndefined()
    expect(
      (storedOrder().timeline ?? []).some(
        (event: any) => event.event === 'restock-check',
      ),
    ).toBe(false)
  })

  it('does not disturb the refund the flag rides behind', async () => {
    const result = await post({}, { 'idempotency-key': 'attempt-a' })

    // The money, the status and the contact are all exactly as AGL-1696 and
    // AGL-1754 left them: this writer is additive or it is wrong.
    expect(result.body).toMatchObject({
      refundedCents: 5000,
      fullyRefunded: true,
    })
    expect(refundCalls).toHaveLength(1)
    expect(storedOrder().status).toBe('refunded')
    expect(storedContact().refundedCents).toBe(5000)
    expect(storedContact().ltvCents).toBe(7400)
  })
})

// ---------------------------------------------------------------------------

/**
 * A refund alongside an open dispute (AGL-1809).
 *
 * Refunding a charge in Stripe does NOT withdraw the shopper's dispute. Once a
 * chargeback is formally open the bank has already pulled the disputed funds,
 * so a refund that also went through would pay the shopper twice — and Stripe
 * itself refuses the call with `charge_disputed`. Before the fix `refund.ts`
 * mentioned disputes nowhere: `canTransitionOrder('paid', 'refunded')` is
 * true, and an order with an open dispute is exactly a `paid` order, so the
 * console's "Chargeback open" badge (AGL-1796) sat beside a live Refund
 * button with nothing between them.
 *
 * The dispute records here mirror the two shapes `billing-webhook.ts` writes
 * (pinned in `billing-webhook-dispute.spec.ts`): `created` writes
 * `{id, status, reason?, amountCents, openedAtMs, evidenceDueByMs?}`, and
 * `closed` overwrites `status` and adds `outcome`/`closedAtMs`/
 * `reversedCents`. Note every settled record still carries `evidenceDueByMs`
 * — Stripe sends the deadline on the `closed` event too — which is why the
 * fixtures keep it and why open-ness is `orderHasOpenDispute`, never a
 * deadline test.
 */
/**
 * THE MONEY'S WAY OUT OF A CANCELLATION (AGL-2149).
 *
 * `cancel-order.ts` accepts a **paid** order and moves NO money: it flips the
 * status, puts the stock back and returns. This handler gates on
 * `canTransitionOrder(order.status, 'refunded')`, and `cancelled` used to list
 * no successor at all — so an admin who reached for Cancel instead of Refund,
 * two buttons that sit beside each other in the order dialog, had permanently
 * locked the shopper's money out of every refund route the product has. The
 * shopper's only recourse was a chargeback, which costs the merchant the goods,
 * the money AND the dispute fee.
 *
 * These drive the WHOLE handler rather than `canTransitionOrder` alone (which
 * `commerce-orders.spec.ts` pins directly), because the transition edge is only
 * the first of several gates the money has to pass: the claim, the dispute
 * check, the cap read inside the transaction, the Stripe call and the contact
 * write all sit behind it, and an edge that opened without the rest following
 * would be a fix that reports success and moves nothing.
 */
describe('refunding a cancelled order (AGL-2149)', () => {
  function cancelOrderInPlace() {
    docs.set('hosts/host-1/orders/order-1', {
      ...storedOrder(),
      status: 'cancelled',
      timeline: [
        { atMs: 1, event: 'paid' },
        { atMs: 2, event: 'cancelled', detail: '1 unit returned to stock' },
      ],
    })
  }

  it('refunds a paid order an admin cancelled', async () => {
    cancelOrderInPlace()

    const result = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({
      refundedCents: 5000,
      fullyRefunded: true,
    })
    // The money really left, through the same Stripe call every other refund
    // uses — not a status flip that only looks like one.
    expect(refundCalls).toHaveLength(1)
    expect(refundCalls[0].amount).toBe('5000')
    expect(refundCalls[0].paymentIntent).toBe('pi_live_1')
    expect(storedOrder().refundedCents).toBe(5000)
    expect(storedOrder().status).toBe('refunded')
  })

  /** A partial works too, and leaves the order where the merchant put it. */
  it('takes a partial refund off a cancelled order without closing it', async () => {
    cancelOrderInPlace()

    const result = await post(
      { amountCents: 1500 },
      { 'idempotency-key': 'attempt-a' },
    )

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({
      refundedCents: 1500,
      fullyRefunded: false,
    })
    expect(storedOrder().status).toBe('cancelled')
    expect(storedOrder().refundedCents).toBe(1500)
  })

  /**
   * And the cancellation's OWN restock is not re-asked. `cancel-order.ts` has
   * already put these units back and written the `cancellation` ledger rows, so
   * a fresh "1 unit may need restocking" prompt would invite the merchant to
   * restock the same unit a second time — the double-count `flagOrderRestock`
   * exists to avoid. Unreachable before this change, because the refund itself
   * was refused.
   */
  it('does not ask the merchant to restock what the cancellation already returned', async () => {
    cancelOrderInPlace()

    const result = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(result.status).toBe(200)
    expect(storedOrder().restockCheck).toBeUndefined()
    expect(
      consoleError.mock.calls.filter(
        (call) => call[0] === 'flagOrderRestock failed',
      ),
    ).toHaveLength(0)
    // The count is untouched, and no second ledger row was written.
    expect(
      docs.get('hosts/host-1/products/product-1').variants[0].inventory,
    ).toBe(9)
    expect(
      [...docs.keys()].filter((path) =>
        path.startsWith('hosts/host-1/inventoryAdjustments'),
      ),
    ).toHaveLength(0)
  })

  /**
   * The negative control for the edge: `refunded` is still terminal, so the
   * widened table did not simply stop refusing. Without this, a fix that
   * emptied `ORDER_TRANSITIONS` entirely would pass the three tests above.
   */
  it('still refuses an order that is already refunded', async () => {
    docs.set('hosts/host-1/orders/order-1', {
      ...storedOrder(),
      status: 'refunded',
      refundedCents: 5000,
    })

    const result = await post({}, { 'idempotency-key': 'attempt-b' })

    expect(result.status).toBe(409)
    expect(result.body).toEqual({
      error: 'Orders in "refunded" cannot refund',
    })
    expect(refundCalls).toHaveLength(0)
  })
})

describe('refund and an open dispute (AGL-1809)', () => {
  const openDispute = {
    id: 'dp_1TESTblock',
    status: 'needs_response',
    reason: 'product_not_received',
    amountCents: 5000,
    openedAtMs: Date.UTC(2026, 7, 10),
    evidenceDueByMs: Date.UTC(2026, 7, 24),
  }

  function orderWithDispute(dispute: Record<string, unknown>) {
    docs.set('hosts/host-1/orders/order-1', {
      ...storedOrder(),
      dispute,
    })
  }

  /**
   * THE DEFECT. A formally open dispute must refuse BEFORE anything is
   * written: no Stripe call, no reservation, no claim, no contact write. A
   * refusal that had already reserved or claimed would violate AGL-1754's
   * contract by stranding state for money that never moved.
   */
  it('refuses to refund while a chargeback is formally open', async () => {
    orderWithDispute(openDispute)

    const result = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(result.status).toBe(409)
    expect(String(result.body?.error)).toContain('chargeback is open')
    // Nothing moved and nothing was written anywhere.
    expect(refundCalls).toHaveLength(0)
    expect(storedOrder().refundedCents ?? 0).toBe(0)
    expect(storedOrder().status).toBe('paid')
    expect(childPaths('apiIdempotency')).toHaveLength(0)
    expect(storedContact().refundedCents).toBeUndefined()
    expect(storedOrder().restockCheck).toBeUndefined()
  })

  it('refuses while the dispute is under review too', async () => {
    orderWithDispute({ ...openDispute, status: 'under_review' })

    const result = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(result.status).toBe(409)
    expect(refundCalls).toHaveLength(0)
  })

  /**
   * The refusal must not strand the attempt: once the dispute settles in the
   * merchant's favour, the SAME key refunds normally — proof the 409 burned
   * no claim.
   */
  it('lets the same attempt through once the dispute is won', async () => {
    orderWithDispute(openDispute)
    const refused = await post({}, { 'idempotency-key': 'attempt-a' })
    expect(refused.status).toBe(409)

    orderWithDispute({
      ...openDispute,
      status: 'won',
      outcome: 'won',
      closedAtMs: Date.UTC(2026, 7, 20),
      reversedCents: 0,
    })
    const retry = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(retry.status).toBe(200)
    expect(refundCalls).toHaveLength(1)
    expect(storedOrder().refundedCents).toBe(5000)
    expect(storedOrder().status).toBe('refunded')
  })

  /**
   * An INQUIRY is the deliberate exception. No funds have moved in that
   * phase, Stripe permits the refund, and its docs name a full refund as the
   * way to resolve an inquiry before it escalates to an unwinnable
   * chargeback — a guard that blocked these would forbid the recommended
   * exit while the window is days long.
   */
  it('permits a refund during an open inquiry', async () => {
    orderWithDispute({ ...openDispute, status: 'warning_needs_response' })

    const result = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(result.status).toBe(200)
    expect(refundCalls).toHaveLength(1)
    expect(storedOrder().refundedCents).toBe(5000)
    expect(storedOrder().status).toBe('refunded')
    expect(storedContact().refundedCents).toBe(5000)
  })

  it('permits a refund while inquiry evidence is under review', async () => {
    orderWithDispute({ ...openDispute, status: 'warning_under_review' })

    const result = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(result.status).toBe(200)
    expect(refundCalls).toHaveLength(1)
  })

  /** A closed inquiry is over; the charge is an ordinary refundable charge. */
  it('permits a refund after an inquiry closes without escalating', async () => {
    orderWithDispute({
      ...openDispute,
      status: 'warning_closed',
      outcome: 'warning_closed',
      closedAtMs: Date.UTC(2026, 7, 20),
      reversedCents: 0,
    })

    const result = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(result.status).toBe(200)
    expect(refundCalls).toHaveLength(1)
  })

  /** On the question of paying twice, an unknown open status fails closed. */
  it('fails closed on an open dispute in an unrecognised status', async () => {
    orderWithDispute({ ...openDispute, status: 'prearbitration' })

    const result = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(result.status).toBe(409)
    expect(refundCalls).toHaveLength(0)
  })

  /**
   * Ordering: the replay short-circuit still answers FIRST. A partial that
   * settled before the dispute opened must replay its recorded 200 when
   * retried — answering "a chargeback is open" about money that moved before
   * the dispute existed would send the admin to reconcile a refund that is
   * fine. Same reasoning the file header gives for the status guard.
   */
  it('replays a refund that settled before the dispute opened', async () => {
    const first = await post(
      { amountCents: 1500 },
      { 'idempotency-key': 'attempt-a' },
    )
    expect(first.status).toBe(200)
    orderWithDispute(openDispute)

    const retry = await post(
      { amountCents: 1500 },
      { 'idempotency-key': 'attempt-a' },
    )

    expect(retry.status).toBe(200)
    expect(retry.body).toMatchObject({ refundedCents: 1500 })
    expect(refundCalls).toHaveLength(1)
    // A genuinely NEW attempt is refused — only the settled one replays.
    const fresh = await post(
      { amountCents: 1000 },
      { 'idempotency-key': 'attempt-b' },
    )
    expect(fresh.status).toBe(409)
    expect(refundCalls).toHaveLength(1)
  })

  /**
   * The backstop for the guard's blind spot: Stripe knows about a dispute our
   * order document does not (webhook lag, or an order disputed before
   * `charge.dispute.*` was subscribed at all). Stripe answers HTTP 400 with
   * `charge_disputed`, and the admin must be told a dispute refused the
   * refund — not handed a 502 reading "has been charged back" with no
   * connection to the button they pressed. Money-wise it is the ordinary
   * rejected path: Stripe said no, so the reservation comes back and the key
   * is not burned.
   */
  it('reports Stripe refusing a disputed charge as the dispute, accurately', async () => {
    nextRefundOutcome = 'disputed'

    const result = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(result.status).toBe(409)
    expect(String(result.body?.error)).toContain('disputed')
    // Stripe was asked once and said no; the rollback and release ran.
    expect(refundCalls).toHaveLength(1)
    expect(storedOrder().refundedCents ?? 0).toBe(0)
    expect(storedOrder().status).toBe('paid')
    expect(storedContact().refundedCents).toBeUndefined()

    // The key was not burned: the dispute settles at Stripe's end, and the
    // same attempt refunds.
    const retry = await post({}, { 'idempotency-key': 'attempt-a' })
    expect(retry.status).toBe(200)
    expect(storedOrder().refundedCents).toBe(5000)
  })
})
