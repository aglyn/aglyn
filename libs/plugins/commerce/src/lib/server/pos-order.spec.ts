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

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
  runTransaction: async (fn: (transaction: any) => Promise<void>) =>
    fn({
      get: (ref: any) => ref.get(),
      set: (ref: any, value: any, options?: any) => {
        void ref.set(value, options)
      },
    }),
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

  /** A reservationId pointing at nothing is likewise no identity, not a stub. */
  it('creates no contact when the reservation does not exist', async () => {
    const result = await chargeRoom({ reservationId: 'ghost' }, 'folio-c')
    expect(result.status).toBe(200)
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
