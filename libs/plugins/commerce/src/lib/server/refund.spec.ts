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

function makeSnapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
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
        options?.merge ? { ...(docs.get(path) ?? {}), ...value } : value,
      )
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

function makeCollectionRef(path: string): any {
  return {
    doc: (id: string) => makeDocRef(`${path}/${id}`),
    get: async () => ({ docs: childPaths(path).map(makeSnapshot) }),
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
      },
    },
  },
  getOrgForHost: async () => ({ org: { id: 'org-1', slug: 'acme' } }),
}))

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
let nextRefundOutcome: 'ok' | 'rejected' | 'throws' = 'ok'

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

beforeAll(() => {
  ;(global as any).fetch = fetchMock
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
})

beforeEach(() => {
  docs.clear()
  refundCalls.length = 0
  refundsByKey.clear()
  refundCounter = 0
  transactionCount = 0
  transactionQueue = Promise.resolve()
  nextRefundOutcome = 'ok'
  fetchMock.mockClear()
  mockVerifyIdToken.mockClear()

  docs.set('hosts/host-1', { memberRoles: { 'admin-1': 'admin' } })
  docs.set('hosts/host-1/orders/order-1', {
    status: 'paid',
    channel: 'online',
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
