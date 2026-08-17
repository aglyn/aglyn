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
import { posOrderHandler } from './pos-order'

/**
 * POS order idempotency (AGL-1691).
 *
 * The boundary that matters here is Stripe, and it is mocked absolutely:
 * `global.fetch` is replaced for the whole file and every call is counted.
 * Nothing in this spec may reach api.stripe.com — localhost carries the LIVE
 * secret key, so a real call would mint a real Checkout session on a real
 * merchant account. Same rule as `pos-card-qr-local.spec.tsx`.
 *
 * Firestore is an in-memory map keyed by document path, which lets the tests
 * COUNT the `orders` documents that actually got written rather than trusting
 * the handler's response.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
let autoIdCounter = 0

/** Direct children of `path` — a collection `get()` must not return grandchildren. */
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
     * The atomic claim. Firestore's `create()` rejects when the document
     * already exists — that rejection IS the dedupe primitive, so the fake
     * has to reproduce it faithfully or the test proves nothing.
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
    /**
     * The mirror image, and the AGL-1760 primitive: `update()` REJECTS on a
     * missing document where `set(..., { merge: true })` would CREATE it. That
     * rejection is the guard, so the fake has to reproduce it or the test
     * proves nothing — a fake that merged into a missing path would pass
     * against the stub-creating code as happily as against the fix.
     */
    update: async (value: Record<string, any>) => {
      if (!docs.has(path)) {
        const error: any = new Error(
          `NOT_FOUND: no entity to update: ${path}`,
        )
        error.code = 5
        throw error
      }
      docs.set(path, { ...(docs.get(path) ?? {}), ...value })
    },
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  return {
    doc: (id?: string) =>
      makeDocRef(`${path}/${id ?? `auto-${++autoIdCounter}`}`),
    get: async () => ({ docs: childPaths(path).map(makeSnapshot) }),
    add: async (value: Record<string, any>) => {
      const ref = makeDocRef(`${path}/auto-${++autoIdCounter}`)
      docs.set(ref.path, value)
      return ref
    },
  }
}

/**
 * Fires once each `runTransaction` completes, so a test can mutate the store
 * from INSIDE a handler run. The folio path's only transaction is the order
 * write (`claimAttempt` uses `create`/`get`/`set`, never a transaction), so
 * this hook lands in exactly the window AGL-1760's race needs: after the sale
 * is committed and before the folio line is appended.
 */
let afterTransaction: (() => void) | null = null

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
  runTransaction: async (fn: (transaction: any) => Promise<void>) => {
    const outcome = await fn({
      get: (ref: any) => ref.get(),
      set: (ref: any, value: any, options?: any) => {
        void ref.set(value, options)
      },
    })
    afterTransaction?.()
    return outcome
  },
}

/** Every `upsertHostContact` call the handler made, options verbatim (AGL-1748). */
const contactUpserts: any[] = []

const mockVerifyIdToken = jest.fn(async () => ({ uid: 'cashier-1' }))
const mockOrg: any = {
  org: {
    id: 'org-1',
    plan: 'business',
    subscriptionStatus: 'active',
    ownerUid: 'owner-1',
    slug: 'acme',
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: any[]) => mockVerifyIdToken(...(args as [])) }),
      firestore: () => fakeFirestore,
    }),
    firestore: {
      FieldValue: {
        serverTimestamp: () => '<server-timestamp>',
        arrayUnion: (value: any) => ({ __arrayUnion: value }),
      },
    },
  },
  getOrgForHost: async () => mockOrg,
  upsertHostContact: async (options: any) => {
    contactUpserts.push(options)
  },
}))

// ---------------------------------------------------------------------------
// Stripe boundary — counted, never reached
// ---------------------------------------------------------------------------

interface StripeCall {
  url: string
  idempotencyKey: string | null
}

const stripeCalls: StripeCall[] = []
/** Keyed by the Idempotency-Key Stripe was handed, mirroring Stripe's own replay. */
const stripeSessionsByKey = new Map<string, string>()
let stripeSessionCounter = 0

// `Promise<any>`: the failure test overrides this with an error-shaped
// response, and a narrowly inferred success type would reject it.
const fetchMock = jest.fn(async (url: any, init: any): Promise<any> => {
  const target = String(url)
  if (!target.includes('api.stripe.com')) {
    throw new Error(`Unexpected fetch to ${target}`)
  }
  const idempotencyKey =
    (init?.headers?.['Idempotency-Key'] as string | undefined) ?? null
  stripeCalls.push({ url: target, idempotencyKey })
  // Stripe replays a prior response for a repeated key rather than creating a
  // second session. Reproduced so a test can tell "we never called twice" from
  // "we called twice but Stripe absorbed it" — only the first is a real fix,
  // but both leave one session, and the assertion below checks the CALLS.
  if (idempotencyKey && stripeSessionsByKey.has(idempotencyKey)) {
    return {
      ok: true,
      json: async () => ({ url: stripeSessionsByKey.get(idempotencyKey) }),
    }
  }
  const sessionUrl = `https://checkout.stripe.com/pay/session-${++stripeSessionCounter}`
  if (idempotencyKey) stripeSessionsByKey.set(idempotencyKey, sessionUrl)
  return { ok: true, json: async () => ({ url: sessionUrl }) }
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
    body: {
      hostId: 'host-1',
      registerId: 'register-1',
      lines: [{ productId: 'product-1', quantity: 1 }],
      ...body,
    },
    headers: { authorization: 'Bearer token', ...headers },
    cookies: {},
    socket: {},
  }
}

async function post(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  const { res, result } = makeResponse()
  await posOrderHandler(makeRequest(body, headers), res)
  return result
}

/** Every `orders` document that actually landed in the fake database. */
function orderDocs() {
  return childPaths('hosts/host-1/orders').map((path) => docs.get(path))
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
})

beforeEach(() => {
  docs.clear()
  contactUpserts.length = 0
  stripeCalls.length = 0
  stripeSessionsByKey.clear()
  autoIdCounter = 0
  stripeSessionCounter = 0
  afterTransaction = null
  fetchMock.mockClear()
  mockVerifyIdToken.mockClear()

  docs.set('hosts/host-1', { memberRoles: { 'cashier-1': 'manager' } })
  docs.set('hosts/host-1/registers/register-1', {
    name: 'Front counter',
    createdAt: { toMillis: () => 1000 },
  })
  docs.set('hosts/host-1/products/product-1', {
    name: 'Flat white',
    type: 'physical',
    status: 'active',
    variants: [{ id: 'default', priceUsd: 4, inventory: null }],
  })
  docs.set('hosts/host-1/settings/store', { tax: {} })
  docs.set('profiles/owner-1', {
    stripeAccountId: 'acct_live_merchant',
    stripeChargesEnabled: true,
  })
  docs.set('hostIndex/host-1', { subdomain: 'acme-cafe' })
})

// ---------------------------------------------------------------------------

describe('POS sale idempotency (AGL-1691)', () => {
  it('takes a card sale and returns a Checkout URL', async () => {
    const result = await post(
      { payment: 'link' },
      { 'idempotency-key': 'attempt-a' },
    )
    expect(result.status).toBe(200)
    expect(result.body.url).toContain('checkout.stripe.com')
    expect(orderDocs()).toHaveLength(1)
    expect(stripeCalls).toHaveLength(1)
  })

  /**
   * THE DEFECT. Same basket, same attempt key, posted twice — a lost response,
   * a double-submit, a cashier hitting back. Before the fix this returns two
   * `orders` documents and two Checkout sessions on a live merchant account.
   */
  it('replays a retried card sale instead of charging twice', async () => {
    const first = await post(
      { payment: 'link' },
      { 'idempotency-key': 'attempt-a' },
    )
    const second = await post(
      { payment: 'link' },
      { 'idempotency-key': 'attempt-a' },
    )

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    // One order document, not two.
    expect(orderDocs()).toHaveLength(1)
    // One Checkout session — the half that costs real money.
    expect(stripeCalls).toHaveLength(1)
    // The retry gets the SAME session back, so the QR the cashier is already
    // showing stays the one that gets paid.
    expect(second.body.url).toBe(first.body.url)
    expect(second.body.orderId).toBe(first.body.orderId)
  })

  it('replays a retried cash sale instead of ringing it twice', async () => {
    const first = await post(
      { payment: 'cash', cashReceivedCents: 1000 },
      { 'idempotency-key': 'attempt-b' },
    )
    const second = await post(
      { payment: 'cash', cashReceivedCents: 1000 },
      { 'idempotency-key': 'attempt-b' },
    )

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(orderDocs()).toHaveLength(1)
    expect(second.body.orderId).toBe(first.body.orderId)
    expect(second.body.changeCents).toBe(first.body.changeCents)
  })

  /**
   * The other half of correctness, and the easier one to get wrong: a cashier
   * ringing the same coffee twice in a minute is a REAL second sale. Keying on
   * the basket contents would silently swallow it, which is a worse bug than
   * the one being fixed. Distinct attempt keys must produce distinct orders.
   */
  it('rings a genuinely identical second sale as its own order', async () => {
    const first = await post(
      { payment: 'cash', cashReceivedCents: 1000 },
      { 'idempotency-key': 'attempt-b' },
    )
    const second = await post(
      { payment: 'cash', cashReceivedCents: 1000 },
      { 'idempotency-key': 'attempt-c' },
    )

    expect(orderDocs()).toHaveLength(2)
    expect(second.body.orderId).not.toBe(first.body.orderId)
  })

  /**
   * Stripe's own idempotency is the backstop for the window where our claim
   * landed but the process died before recording the response. Assert the
   * header is actually sent, and that it is stable for one attempt key.
   */
  it('hands Stripe an idempotency key derived from the attempt', async () => {
    await post({ payment: 'link' }, { 'idempotency-key': 'attempt-a' })
    expect(stripeCalls).toHaveLength(1)
    expect(stripeCalls[0].idempotencyKey).toBeTruthy()

    docs.delete(
      childPaths('apiIdempotency')[0] ?? 'apiIdempotency/none',
    )
    await post({ payment: 'link' }, { 'idempotency-key': 'attempt-a' })
    // Claim removed, so the handler runs the Stripe call again — and because
    // the key is derived from the attempt, Stripe replays rather than opening
    // a second session.
    expect(stripeCalls).toHaveLength(2)
    expect(stripeCalls[1].idempotencyKey).toBe(stripeCalls[0].idempotencyKey)
    expect(stripeSessionsByKey.size).toBe(1)
  })

  /**
   * A key must not be burned by a deterministic rejection: "cash received is
   * short" is a 400 the cashier fixes by taking more cash and pressing the
   * same button. If the claim were taken before validation, that retry would
   * replay the rejection forever.
   */
  it('does not burn the key on a validation rejection', async () => {
    const short = await post(
      { payment: 'cash', cashReceivedCents: 1 },
      { 'idempotency-key': 'attempt-d' },
    )
    expect(short.status).toBe(400)
    expect(orderDocs()).toHaveLength(0)

    const retry = await post(
      { payment: 'cash', cashReceivedCents: 1000 },
      { 'idempotency-key': 'attempt-d' },
    )
    expect(retry.status).toBe(200)
    expect(orderDocs()).toHaveLength(1)
  })

  /**
   * A failed Stripe call must release the claim too, or one flaky network
   * moment locks that basket out of ever being sold.
   */
  it('releases the claim when the Checkout session fails', async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      json: async () => ({ error: { message: 'nope' } }),
    }))
    const failed = await post(
      { payment: 'link' },
      { 'idempotency-key': 'attempt-e' },
    )
    expect(failed.status).toBe(502)
    expect(orderDocs()).toHaveLength(0)

    const retry = await post(
      { payment: 'link' },
      { 'idempotency-key': 'attempt-e' },
    )
    expect(retry.status).toBe(200)
    expect(orderDocs()).toHaveLength(1)
  })

  /**
   * Backwards compatibility: a client that sends no key still transacts. The
   * POS page always sends one after this change, but the endpoint is a plugin
   * API route and an older cached bundle must not start failing sales.
   */
  it('still sells without a key, and dedupes nothing', async () => {
    await post({ payment: 'cash', cashReceivedCents: 1000 })
    await post({ payment: 'cash', cashReceivedCents: 1000 })
    expect(orderDocs()).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------

/**
 * The card sale's location (AGL-1825).
 *
 * The webhook that completes a QR sale decrements from the order document —
 * by then the register's chosen location exists nowhere else. 932559b60 stored
 * `locationId` on the cash/folio order for the cancel release; the `link`
 * pending write was the one that still dropped it, so a card sale could only
 * ever decrement the flat total that the next location-aware write recomputes
 * from the buckets.
 */
describe('POS card sale location (AGL-1825)', () => {
  it('stores the sale location on the pending card order', async () => {
    await post(
      { payment: 'link', locationId: 'loc-front' },
      { 'idempotency-key': 'attempt-loc' },
    )
    expect(orderDocs()).toHaveLength(1)
    expect((orderDocs()[0] as any).locationId).toBe('loc-front')
    expect((orderDocs()[0] as any).status).toBe('pending')
  })

  /** No chosen location writes NO field — not an empty string for the webhook
   *  (and later the cancel release) to mistake for a bucket. */
  it('writes no location field when the register sent none', async () => {
    await post({ payment: 'link' }, { 'idempotency-key': 'attempt-noloc' })
    expect(orderDocs()).toHaveLength(1)
    expect('locationId' in (orderDocs()[0] as any)).toBe(false)
  })
})

// ---------------------------------------------------------------------------

/**
 * In-store sales in the customer's lifetime value (AGL-1748).
 *
 * The handler already recorded the sale as a contact INTERACTION, with the
 * amount formatted into the summary string — and passed nothing to
 * `purchaseCents`, the field that exists to hold it. So `ltvCents` counted
 * online sales only, and a merchant whose business is a shop counter would see
 * every one of their best customers ranked at zero.
 *
 * The basket below is deliberately priced so no two figures coincide: per
 * AGL-1711, a test that asserts one total passes against a decomposition whose
 * every component is wrong, so each stored field is asserted on its own.
 *
 *   unit              400   $4.00 flat white
 *   x quantity          3
 *   = itemsCents     1200
 *   - discount        120   10% off the basket
 *   + tax              89   8.25% origin tax on 1080
 *   = totalCents     1169   what the cashier actually took
 */
describe('POS sale lifetime value (AGL-1748)', () => {
  beforeEach(() => {
    docs.set('hosts/host-1/settings/store', {
      tax: {
        mode: 'manual',
        pricesIncludeTax: false,
        origin: { country: 'US', state: 'TX' },
        rates: [{ country: 'US', state: 'TX', pct: 8.25 }],
      },
    })
  })

  async function sellBasket() {
    return post(
      {
        payment: 'cash',
        cashReceivedCents: 2000,
        discountPct: 10,
        customerEmail: 'Regular@Example.com',
        lines: [{ productId: 'product-1', quantity: 3 }],
      },
      { 'idempotency-key': 'ltv-a' },
    )
  }

  /** The order is the reference: LTV must equal what was actually charged. */
  it('stores the basket at 1169 cents', async () => {
    const result = await sellBasket()
    expect(result.status).toBe(200)
    const stored = orderDocs()[0] as any
    expect(stored.totals.itemsCents).toBe(1200)
    expect(stored.totals.discountCents).toBe(120)
    expect(stored.totals.taxCents).toBe(89)
    expect(stored.totals.totalCents).toBe(1169)
    expect(stored.channel).toBe('pos')
  })

  /**
   * THE DEFECT. Before the fix `purchaseCents` was `undefined` here, which
   * `upsertHostContact` treats as "no purchase at all": no `ltvCents`, no
   * `ordersCount`, no `lastPurchaseAtMs`. The interaction summary carried the
   * figure the whole time, in prose.
   */
  it('passes the charged amount as purchaseCents', async () => {
    await sellBasket()
    expect(contactUpserts).toHaveLength(1)
    expect(contactUpserts[0].purchaseCents).toBe(1169)
  })

  /**
   * Not the items subtotal, not the unit price, not the cash tendered — three
   * plausible wrong answers that a total-shaped assertion alone would let
   * through. Pinned individually so a future edit that reaches for the nearest
   * number fails here.
   */
  it('is the charged total, not the subtotal or the tender', async () => {
    await sellBasket()
    const { purchaseCents } = contactUpserts[0]
    expect(purchaseCents).toBe(1169)
    expect(purchaseCents).not.toBe(1200) // itemsCents
    expect(purchaseCents).not.toBe(400) // unit price
    expect(purchaseCents).not.toBe(2000) // cash received
  })

  /** The rest of the capture is unchanged — asserted so the fix cannot regress it. */
  it('still records the sale as an order-sourced interaction', async () => {
    await sellBasket()
    const upsert = contactUpserts[0]
    expect(upsert.hostId).toBe('host-1')
    expect(upsert.email).toBe('regular@example.com')
    expect(upsert.source).toBe('order')
    expect(upsert.interaction.summary).toBe('In-store purchase ($11.69)')
    // The interaction points at the order document that was actually written,
    // which is what lets a rebuild-from-orders backfill match the two up.
    expect(childPaths('hosts/host-1/orders')).toContain(
      `hosts/host-1/orders/${upsert.interaction.refId}`,
    )
  })

  /**
   * `purchaseCents` becomes a `FieldValue.increment`, so a replayed settlement
   * would inflate lifetime value on every retry. The `claimAttempt` taken
   * before the order write is what stops it — the contact call sits past the
   * point of no return, so the replay never reaches it.
   */
  it('does not double-count a replayed settlement', async () => {
    await sellBasket()
    await sellBasket()
    expect(orderDocs()).toHaveLength(1)
    expect(contactUpserts).toHaveLength(1)
  })

  /**
   * A card sale takes no contact here BY DESIGN — it is still pending at this
   * point and completes through the webhook's `commerce-draft` branch, which is
   * the other half of AGL-1748. Pinned so nobody "fixes" this path by capturing
   * a customer who has not paid yet.
   */
  it('takes no contact for a card sale that is still pending', async () => {
    await post(
      { payment: 'link', customerEmail: 'regular@example.com' },
      { 'idempotency-key': 'ltv-b' },
    )
    expect((orderDocs()[0] as any).status).toBe('pending')
    expect(contactUpserts).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------

/**
 * Folio sales attributed to the stay's guest (AGL-1757).
 *
 * A `folio` tender is the one POS path where the customer is already
 * IDENTIFIED by the system: the cashier picked a reservation, and
 * `hosts/{h}/reservations/{id}` carries `guestEmail`/`guestName` from the
 * guest's own booking. The handler wrote the folio line onto that document and
 * then fell back to "did the cashier also type an email?" for the contact — so
 * a drink charged to room 4 produced a paid order with a real amount and, in
 * the normal case where the email box was left empty, no contact at all.
 *
 * Fixtures are priced so nothing coincides (AGL-1711). Crucially the
 * reservation's own money is nothing like the sale's, because reaching for it
 * is the specific wrong answer here — the deposit and every folio line are
 * DISJOINT sums, each charged exactly once (AGL-1755, `a7a2d90df`).
 *
 *   unit             1700   $17.00 negroni
 *   x quantity          3
 *   = itemsCents     5100
 *   + tax             421   8.25% origin tax
 *   = totalCents     5521   the room charge
 *
 *   reservation paidCents   21000   the deposit, already counted at `booking`
 *   reservation totalCents  84000   the stay — money not yet handed over
 */
describe('POS folio attribution (AGL-1757)', () => {
  beforeEach(() => {
    docs.set('hosts/host-1/settings/store', {
      tax: {
        mode: 'manual',
        pricesIncludeTax: false,
        origin: { country: 'US', state: 'TX' },
        rates: [{ country: 'US', state: 'TX', pct: 8.25 }],
      },
    })
    docs.set('hosts/host-1/products/product-2', {
      name: 'Negroni',
      type: 'physical',
      status: 'active',
      variants: [{ id: 'default', priceUsd: 17, inventory: null }],
    })
    docs.set('hosts/host-1/reservations/stay-1', {
      resourceId: 'room-4',
      status: 'checked_in',
      guestName: 'Ada Lovelace',
      guestEmail: 'ada@example.com',
      nights: 7,
      totalCents: 84000,
      depositCents: 21000,
      paidCents: 21000,
    })
  })

  async function chargeRoom(
    body: Record<string, unknown> = {},
    key = 'folio-a',
  ) {
    return post(
      {
        payment: 'folio',
        reservationId: 'stay-1',
        lines: [{ productId: 'product-2', quantity: 3 }],
        ...body,
      },
      { 'idempotency-key': key },
    )
  }

  /** The order is the reference: attribution must match what was charged. */
  it('rings the room charge at 5521 cents', async () => {
    const result = await chargeRoom()
    expect(result.status).toBe(200)
    const stored = orderDocs()[0] as any
    expect(stored.totals.itemsCents).toBe(5100)
    expect(stored.totals.taxCents).toBe(421)
    expect(stored.totals.totalCents).toBe(5521)
    expect(stored.status).toBe('paid')
    expect(stored.reservationId).toBe('stay-1')
  })

  /**
   * THE DEFECT. The cashier typed nothing, so before the fix `customerEmail`
   * was empty and `upsertHostContact` was never reached — a real, paid sale
   * attributed to nobody, even though the reservation names the guest.
   */
  it('falls back to the reservation guest when the cashier typed nothing', async () => {
    await chargeRoom()
    expect(contactUpserts).toHaveLength(1)
    expect(contactUpserts[0].email).toBe('ada@example.com')
  })

  /** Each stored field on its own (AGL-1711), not one shape-matched blob. */
  it('records the guest name, the host and an order-sourced interaction', async () => {
    await chargeRoom()
    const upsert = contactUpserts[0]
    expect(upsert.hostId).toBe('host-1')
    expect(upsert.name).toBe('Ada Lovelace')
    expect(upsert.source).toBe('order')
    expect(upsert.interaction.summary).toBe('Room charge ($55.21)')
    // The interaction points at the order that actually landed, which is what
    // lets an AGL-1753 backfill match the two up.
    expect(childPaths('hosts/host-1/orders')).toContain(
      `hosts/host-1/orders/${upsert.interaction.refId}`,
    )
  })

  /**
   * The amount is the SALE, never the stay. Reaching for the reservation's
   * `paidCents` would re-count a deposit already counted at `source: 'booking'`,
   * and its `totalCents` would claim money the guest has not handed over and
   * will pay again at the register.
   */
  it('counts the sale, not the deposit or the stay total', async () => {
    await chargeRoom()
    const { purchaseCents } = contactUpserts[0]
    expect(purchaseCents).toBe(5521)
    expect(purchaseCents).not.toBe(21000) // the deposit
    expect(purchaseCents).not.toBe(84000) // the stay total
    expect(purchaseCents).not.toBe(5100) // itemsCents
  })

  /**
   * Disjoint sums: the folio line is appended and `paidCents` is untouched.
   * This is a pre-existing invariant (`a7a2d90df`) rather than new behaviour —
   * asserted here so that reading the reservation for its guest cannot turn
   * into writing money back to it.
   */
  it('appends the folio line without touching paidCents', async () => {
    await chargeRoom()
    const reservation = docs.get('hosts/host-1/reservations/stay-1') as any
    expect(reservation.paidCents).toBe(21000)
    expect(reservation.totalCents).toBe(84000)
    expect(reservation.folio.__arrayUnion.amountCents).toBe(5521)
    // The folio line points at the order that actually landed.
    expect(childPaths('hosts/host-1/orders')).toContain(
      `hosts/host-1/orders/${reservation.folio.__arrayUnion.orderId}`,
    )
  })

  /**
   * A cashier correcting the guest's address should win over stale reservation
   * data — and the guest's NAME must not ride along to a different person.
   */
  it('prefers a typed email over the reservation, and withholds the name', async () => {
    await chargeRoom({ customerEmail: 'Corrected@Example.com' })
    expect(contactUpserts).toHaveLength(1)
    expect(contactUpserts[0].email).toBe('corrected@example.com')
    expect(contactUpserts[0].name).toBeUndefined()
  })

  /** Typed the same address the reservation holds: the name still applies. */
  it('keeps the guest name when the typed email is the guest', async () => {
    await chargeRoom({ customerEmail: 'ADA@example.com' })
    expect(contactUpserts[0].email).toBe('ada@example.com')
    expect(contactUpserts[0].name).toBe('Ada Lovelace')
  })

  /**
   * Nothing is invented. The console walk-in writes `guestEmail: null`, so
   * there is no identity to fall back to — and no contact is the CORRECT
   * outcome, not a remaining gap. Pinned so nobody later mints a placeholder.
   */
  it('creates no contact for a walk-in stay with no email', async () => {
    docs.set('hosts/host-1/reservations/stay-2', {
      resourceId: 'room-9',
      status: 'checked_in',
      guestName: 'Walk-in',
      guestEmail: null,
      paidCents: 0,
    })
    const result = await chargeRoom({ reservationId: 'stay-2' }, 'folio-b')
    expect(result.status).toBe(200)
    expect(orderDocs()).toHaveLength(1)
    expect(contactUpserts).toHaveLength(0)
  })

  /**
   * A reservationId pointing at nothing is likewise no identity, not a stub.
   *
   * AGL-1760 CHANGED the outcome this pins. When AGL-1757 wrote it, the sale
   * still went through at 200 and simply attributed nobody — which was the
   * best available answer while the stub was still being created underneath.
   * The sale is now refused outright, above the claim, so no contact is the
   * same conclusion reached a better way. Asserted through the refusal rather
   * than deleted, so the "invent nobody" intent keeps its test.
   */
  it('creates no contact when the reservation does not exist', async () => {
    const result = await chargeRoom({ reservationId: 'ghost' }, 'folio-c')
    expect(result.status).toBe(404)
    expect(contactUpserts).toHaveLength(0)
  })

  /**
   * `purchaseCents` is a `FieldValue.increment`, so a replayed settlement would
   * inflate the guest's lifetime value. The fallback sits INSIDE the
   * `claimAttempt` taken before the order write (AGL-1691), not beside it.
   */
  it('does not double-count a replayed room charge', async () => {
    await chargeRoom()
    await chargeRoom()
    expect(orderDocs()).toHaveLength(1)
    expect(contactUpserts).toHaveLength(1)
  })

  /** No folio sale may reach Stripe — localhost carries the LIVE key. */
  it('never calls Stripe for a folio sale', async () => {
    await chargeRoom()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(stripeCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------

/**
 * Phantom stays from a folio sale (AGL-1760).
 *
 * THE DEFECT. The folio line was appended with an unguarded
 * `set({ folio: arrayUnion(...) }, { merge: true })`, and a merge-set against a
 * missing path CREATES the document. So a typo or a stale `reservationId` — the
 * handler takes it verbatim from the request body — minted a
 * `hosts/{h}/reservations/{id}` doc holding one folio line and nothing else: no
 * guest, no dates, no room, no `status`. Invisible to the console list and the
 * POS picker, which filter on `status`, and `NaN`-valued to the availability
 * maths that reads `checkInDayMs` — but a real document with a real charge on
 * it that nothing would ever settle or display. Same shape `a7a2d90df` fixed
 * for bookings.
 *
 * The filing left the answer open because "the sale is already paid" by the
 * append. Traced here rather than assumed, and the premise does not hold: a
 * `folio` tender takes NO money at the counter. There is no Stripe call (the
 * AGL-1757 suite above pins that) and no cash — the order is written `paid`
 * because the charge is booked against the stay and collected at check-out, as
 * its own sale. And `reservationId` arrives in the settle request body, at the
 * top of the handler, long before anything is written. So the preventable
 * option was reachable after all: refuse the tender before the claim, exactly
 * where "cash received is short" already refuses.
 *
 * Fixtures follow AGL-1757's, priced so nothing coincides (AGL-1711), plus a
 * TRACKED variant — inventory must not move for a sale that never happened, and
 * an untracked one would make that assertion pass vacuously.
 */
describe('POS folio stub reservations (AGL-1760)', () => {
  beforeEach(() => {
    docs.set('hosts/host-1/settings/store', {
      tax: {
        mode: 'manual',
        pricesIncludeTax: false,
        origin: { country: 'US', state: 'TX' },
        rates: [{ country: 'US', state: 'TX', pct: 8.25 }],
      },
    })
    docs.set('hosts/host-1/products/product-2', {
      name: 'Negroni',
      type: 'physical',
      status: 'active',
      variants: [{ id: 'default', priceUsd: 17, inventory: 40 }],
    })
    docs.set('hosts/host-1/reservations/stay-1', {
      resourceId: 'room-4',
      status: 'checked_in',
      guestName: 'Ada Lovelace',
      guestEmail: 'ada@example.com',
      nights: 7,
      totalCents: 84000,
      depositCents: 21000,
      paidCents: 21000,
    })
  })

  async function chargeRoom(
    body: Record<string, unknown> = {},
    key = 'stub-a',
  ) {
    return post(
      {
        payment: 'folio',
        reservationId: 'stay-1',
        lines: [{ productId: 'product-2', quantity: 3 }],
        ...body,
      },
      { 'idempotency-key': key },
    )
  }

  /** Every reservation document that actually landed. */
  function reservationPaths() {
    return childPaths('hosts/host-1/reservations')
  }

  /** The control: a real stay still transacts, and is the only stay there is. */
  it('charges a real stay and leaves the collection alone', async () => {
    const result = await chargeRoom()
    expect(result.status).toBe(200)
    expect(reservationPaths()).toEqual(['hosts/host-1/reservations/stay-1'])
    const reservation = docs.get('hosts/host-1/reservations/stay-1') as any
    expect(reservation.folio.__arrayUnion.amountCents).toBe(5521)
    // The append must still not touch the stay's money — the deposit and each
    // folio line are disjoint sums, each charged once (AGL-1755).
    expect(reservation.paidCents).toBe(21000)
    expect(reservation.totalCents).toBe(84000)
  })

  /**
   * THE FIX, at the point it prevents rather than mitigates: the tender is
   * refused before the claim, so nothing downstream ever runs.
   */
  it('refuses a folio sale against a reservation that does not exist', async () => {
    const result = await chargeRoom({ reservationId: 'ghost-stay' })
    expect(result.status).toBe(404)
    expect(result.body.error).toBe('Unknown reservation')
  })

  /** The phantom itself, asserted as the document it would have been. */
  it('creates no reservation document for an unknown id', async () => {
    await chargeRoom({ reservationId: 'ghost-stay' })
    expect(docs.has('hosts/host-1/reservations/ghost-stay')).toBe(false)
    expect(reservationPaths()).toEqual(['hosts/host-1/reservations/stay-1'])
  })

  /** Nothing downstream of the refusal ran — each side effect on its own. */
  it('writes no order, no contact and no inventory movement', async () => {
    await chargeRoom({ reservationId: 'ghost-stay' })
    expect(orderDocs()).toHaveLength(0)
    expect(contactUpserts).toHaveLength(0)
    expect(childPaths('hosts/host-1/inventoryAdjustments')).toHaveLength(0)
    const product = docs.get('hosts/host-1/products/product-2') as any
    expect(product.variants[0].inventory).toBe(40)
  })

  /** Nor the order counter — a refused sale must not consume a number. */
  it('does not consume an order number', async () => {
    await chargeRoom({ reservationId: 'ghost-stay' })
    expect(docs.has('hosts/host-1/counters/orders')).toBe(false)
    const good = await chargeRoom({}, 'stub-b')
    expect(good.status).toBe(200)
    expect((orderDocs()[0] as any).number).toBe(1)
  })

  /**
   * The refusal is deterministic and retryable, so it must sit ABOVE the claim
   * like "cash received is short" (AGL-1691). If it were taken below, the
   * cashier's correction would replay the 404 forever.
   */
  it('does not burn the attempt key on an unknown reservation', async () => {
    const refused = await chargeRoom({ reservationId: 'ghost-stay' }, 'stub-c')
    expect(refused.status).toBe(404)

    const retry = await chargeRoom({}, 'stub-c')
    expect(retry.status).toBe(200)
    expect(orderDocs()).toHaveLength(1)
    expect((orderDocs()[0] as any).reservationId).toBe('stay-1')
  })

  /** An empty id is still the 400 it was — a different message, kept distinct. */
  it('still asks for a reservation when none was picked', async () => {
    const result = await chargeRoom({ reservationId: '' })
    expect(result.status).toBe(400)
    expect(result.body.error).toBe('Pick a reservation')
    expect(orderDocs()).toHaveLength(0)
  })

  /** A refused folio sale may not reach Stripe either — localhost is LIVE. */
  it('never calls Stripe when refusing a folio sale', async () => {
    await chargeRoom({ reservationId: 'ghost-stay' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(stripeCalls).toHaveLength(0)
  })

  /**
   * The window the validation cannot close: a manager deletes the stay between
   * the check and the append. The sale is committed by then, so this is the
   * one case that must be HANDLED rather than prevented — and the three things
   * that must hold are asserted separately.
   */
  describe('when the stay vanishes mid-sale', () => {
    let consoleError: jest.SpyInstance

    beforeEach(() => {
      consoleError = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)
      afterTransaction = () => {
        docs.delete('hosts/host-1/reservations/stay-1')
        afterTransaction = null
      }
    })

    afterEach(() => {
      consoleError.mockRestore()
    })

    /** Still no stub: `update()` rejects where a merge-set would re-create it. */
    it('does not re-create the deleted reservation', async () => {
      await chargeRoom()
      expect(docs.has('hosts/host-1/reservations/stay-1')).toBe(false)
      expect(reservationPaths()).toHaveLength(0)
    })

    /** A paid sale is never lost, whatever happened to the stay. */
    it('keeps the paid order intact', async () => {
      const result = await chargeRoom()
      expect(result.status).toBe(200)
      expect(orderDocs()).toHaveLength(1)
      const stored = orderDocs()[0] as any
      expect(stored.status).toBe('paid')
      expect(stored.totals.totalCents).toBe(5521)
      expect(stored.reservationId).toBe('stay-1')
    })

    /**
     * And the orphan is visible to someone rather than silent. The console
     * order dialog renders `timeline`, so the merchant reading the order sees
     * that this charge landed on no folio and is still to be collected.
     */
    it('stamps the order so the orphaned charge is visible', async () => {
      await chargeRoom()
      const timeline = (orderDocs()[0] as any).timeline
      // The `paid` event is not replaced by the second one.
      expect(timeline).toHaveLength(2)
      expect(timeline[0].event).toBe('paid')
      expect(timeline[0].detail).toBe('Charged to reservation stay-1')
      expect(timeline[1].event).toBe('folio-unattached')
      expect(timeline[1].detail).toContain('stay-1')
      expect(timeline[1].detail).toContain('$55.21')
      expect(consoleError).toHaveBeenCalled()
    })

    /** The guest was resolved before the deletion, so attribution survives. */
    it('still attributes the charge to the guest it read', async () => {
      await chargeRoom()
      expect(contactUpserts).toHaveLength(1)
      expect(contactUpserts[0].email).toBe('ada@example.com')
      expect(contactUpserts[0].purchaseCents).toBe(5521)
    })
  })
})

// ---------------------------------------------------------------------------

/**
 * Two lines of one product in the cash/folio decrement loop (AGL-1828).
 *
 * THE DEFECT. The loop read every line's product from `productsById` — a map
 * built once from the pricing reads and never updated — so two lines of the
 * same product (two variants, or one variant rung twice; `body.lines` is
 * client-supplied and nothing merges duplicates) both computed
 * `adjustVariantInventory` from the ORIGINAL variants array, and the second
 * merge-set silently erased the first line's decrement. The ledger got BOTH
 * `sale` rows, so the history claimed more movement than the count showed —
 * the exact ledger/count disagreement AGL-1807 existed to prevent.
 *
 * The webhook's POS card loop (AGL-1825) already carries each adjustment
 * forward; these cases pin the same compounding here. Quantities, stocks and
 * prices are all distinct (AGL-1711) so the final counts cannot coincide:
 *
 *   wool    9 (6 front + 3 back)   sold 2 from loc-front   =  7 (4 + 3)
 *   cotton  4 (flat)               sold 1                  =  3
 *   flat total 13                                          = 10
 */
describe('POS cash sale with two lines of one product (AGL-1828)', () => {
  beforeEach(() => {
    docs.set('hosts/host-1/products/product-4', {
      name: 'Beanie',
      type: 'physical',
      status: 'active',
      variants: [
        {
          id: 'wool',
          priceUsd: 22,
          inventory: 9,
          inventoryByLocation: { 'loc-front': 6, 'loc-back': 3 },
        },
        { id: 'cotton', priceUsd: 18, inventory: 4 },
      ],
    })
    docs.set('hosts/host-1/products/product-5', {
      name: 'Scarf',
      type: 'physical',
      status: 'active',
      variants: [{ id: 'default', priceUsd: 10, inventory: 9 }],
    })
  })

  function beanieVariant(id: string) {
    const product = docs.get('hosts/host-1/products/product-4') as any
    return product.variants.find((variant: any) => variant.id === id)
  }

  function ledgerRows() {
    return childPaths('hosts/host-1/inventoryAdjustments').map(
      (path) => docs.get(path) as any,
    )
  }

  /**
   * THE DEFECT, variant shape: before the fix the cotton line recomputed from
   * the product as first read, so its write landed wool back at 9 (6 front)
   * and the sale's two wool units returned to the shelf on paper.
   */
  it('compounds two variant lines of one product into one final count', async () => {
    const result = await post(
      {
        payment: 'cash',
        cashReceivedCents: 10000,
        locationId: 'loc-front',
        lines: [
          { productId: 'product-4', variantId: 'wool', quantity: 2 },
          { productId: 'product-4', variantId: 'cotton', quantity: 1 },
        ],
      },
      { 'idempotency-key': 'clobber-a' },
    )
    expect(result.status).toBe(200)
    expect(beanieVariant('wool').inventoryByLocation).toEqual({
      'loc-front': 4,
      'loc-back': 3,
    })
    expect(beanieVariant('wool').inventory).toBe(7)
    expect(beanieVariant('cotton').inventory).toBe(3)
    // The denormalized flat total sums BOTH decrements, not just the last.
    expect(
      (docs.get('hosts/host-1/products/product-4') as any).inventory,
    ).toBe(10)
  })

  /**
   * THE DEFECT, same-variant shape: one variant rung twice must take both
   * quantities off. Before the fix the second line started from 9 again, so
   * 9 - 2 - 3 landed at 6 instead of 4.
   */
  it('compounds the same variant rung on two lines', async () => {
    const result = await post(
      {
        payment: 'cash',
        cashReceivedCents: 5000,
        lines: [
          { productId: 'product-5', quantity: 2 },
          { productId: 'product-5', quantity: 3 },
        ],
      },
      { 'idempotency-key': 'clobber-b' },
    )
    expect(result.status).toBe(200)
    expect(
      (docs.get('hosts/host-1/products/product-5') as any).variants[0]
        .inventory,
    ).toBe(4)
  })

  /**
   * The ledger was never the broken half: both lines logged their row while
   * the count kept only the last. Pinned so the fix is measured as the count
   * AGREEING with the history, not as the history shrinking to match.
   */
  it('logs one sale row per line, agreeing with the folded count', async () => {
    await post(
      {
        payment: 'cash',
        cashReceivedCents: 10000,
        locationId: 'loc-front',
        lines: [
          { productId: 'product-4', variantId: 'wool', quantity: 2 },
          { productId: 'product-4', variantId: 'cotton', quantity: 1 },
        ],
      },
      { 'idempotency-key': 'clobber-c' },
    )
    const rows = ledgerRows().filter((row) => row.productId === 'product-4')
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => [row.variantId, row.delta])).toEqual([
      ['wool', -2],
      ['cotton', -1],
    ])
    // 13 - (2 + 1) from the rows equals the stored flat count.
    expect(
      (docs.get('hosts/host-1/products/product-4') as any).inventory,
    ).toBe(10)
  })

  /** Distinct products never contended — pinned so the carry-forward cannot
   *  bleed one product's variants into another's. */
  it('still decrements two different products independently', async () => {
    await post(
      {
        payment: 'cash',
        cashReceivedCents: 10000,
        lines: [
          { productId: 'product-4', variantId: 'cotton', quantity: 1 },
          { productId: 'product-5', quantity: 2 },
        ],
      },
      { 'idempotency-key': 'clobber-d' },
    )
    expect(beanieVariant('cotton').inventory).toBe(3)
    expect(beanieVariant('wool').inventory).toBe(9)
    expect(
      (docs.get('hosts/host-1/products/product-5') as any).variants[0]
        .inventory,
    ).toBe(7)
  })
})
