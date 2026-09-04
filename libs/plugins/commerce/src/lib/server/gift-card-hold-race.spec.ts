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
import * as CommerceModel from '../model'
import { cartCheckoutHandler } from './cart-checkout'

/**
 * Gift-card holds (AGL-2449): a card is cash, so two checkouts may not spend it.
 *
 * THE DEFECT. `cart-checkout.ts` read `balanceCents` with a plain `.get()`,
 * minted a Stripe coupon for that much, and the webhook decremented minutes
 * later with a bare `FieldValue.increment(-N)`. The increment is atomic, so no
 * write was ever lost — but nothing ever CHECKED, so two shoppers entering the
 * same code both read $50, both received $50 off, and the card settled at
 * -$50. The merchant shipped $100 of goods against a $50 card and the
 * outstanding-liability total went negative.
 *
 * ## The transaction double models CONTENTION, not just buffering
 *
 * A fake that merely runs the callback and applies the writes would pass this
 * file with the defect still in place — both callbacks would read $50, both
 * would write, and the spec would report a green for the exact behaviour it
 * exists to forbid. So the fake tracks a VERSION per document, records which
 * versions a transaction read, and on commit re-runs the whole callback if any
 * of them moved. That is Firestore's optimistic concurrency, and it is the only
 * reason the second checkout observes the first one's hold.
 *
 * `afterRead` is the interleaving hook. Real concurrency is not reproducible in
 * a single-threaded test, so the first transaction is parked between its read
 * and its commit while the second runs to completion — the worst-case ordering,
 * and the one the defect needed.
 *
 * The double also models two Firestore behaviours this fix DEPENDS on, and a
 * double that skipped either would green-light a live double-decrement:
 *   - `set(…, { merge: true })` merges nested MAPS rather than replacing them,
 *     so writing back a locally-pruned `holds` object does NOT remove a key;
 *   - `FieldValue.delete()` inside such a map is what actually removes one.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore with versioning, deep merge and field sentinels
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
const versions = new Map<string, number>()
let autoIdCounter = 0

const DELETE = Symbol('FieldValue.delete')

function bump(path: string): void {
  versions.set(path, (versions.get(path) ?? 0) + 1)
}

/**
 * Firestore's merge semantics, which are DEEP for plain maps: a nested object
 * is merged key-by-key, and only a `delete()` sentinel removes a key. Modelling
 * this shallowly is what would let the redelivery double-decrement through.
 */
function mergeInto(
  target: Record<string, any>,
  patch: Record<string, any>,
): Record<string, any> {
  const next = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    if (value === DELETE) {
      delete next[key]
    } else if (value && typeof value === 'object' && value.__increment != null) {
      next[key] = Number(next[key] ?? 0) + Number(value.__increment)
    } else if (value && typeof value === 'object' && value.__arrayUnion) {
      next[key] = [...(next[key] ?? []), value.__arrayUnion]
    } else if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      value.constructor === Object
    ) {
      next[key] = mergeInto(
        (next[key] && typeof next[key] === 'object' ? next[key] : {}) as any,
        value,
      )
    } else {
      next[key] = value
    }
  }
  return next
}

function writeDoc(
  path: string,
  value: Record<string, any>,
  merge: boolean,
): void {
  docs.set(path, merge ? mergeInto(docs.get(path) ?? {}, value) : value)
  bump(path)
}

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
    ref: makeDocRef(path),
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
      writeDoc(path, value, Boolean(options?.merge))
    },
    update: async (value: Record<string, any>) => {
      if (!docs.has(path)) {
        const error: any = new Error(`NOT_FOUND: ${path}`)
        error.code = 5
        throw error
      }
      writeDoc(path, value, true)
    },
    create: async (value: Record<string, any>) => {
      if (docs.has(path)) {
        const error: any = new Error(`ALREADY_EXISTS: ${path}`)
        error.code = 6
        throw error
      }
      writeDoc(path, value, false)
    },
    delete: async () => {
      docs.delete(path)
      bump(path)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  return {
    doc: (id?: string) =>
      makeDocRef(`${path}/${id ?? `auto-${++autoIdCounter}`}`),
    get: async () => ({ docs: childPaths(path).map(makeSnapshot) }),
    limit: () => ({ get: async () => ({ docs: childPaths(path).map(makeSnapshot) }) }),
    where: () => makeCollectionRef(path),
  }
}

/** Parked between read and commit, to force the interleaving. */
let afterRead: (() => Promise<void>) | null = null
let abortedRetries = 0

async function runTransaction(
  body: (transaction: any) => Promise<any>,
): Promise<any> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const readVersions = new Map<string, number>()
    const writes: {
      path: string
      value: Record<string, any>
      merge: boolean
    }[] = []
    const transaction = {
      get: async (ref: any) => {
        readVersions.set(ref.path, versions.get(ref.path) ?? 0)
        return makeSnapshot(ref.path)
      },
      set: (ref: any, value: Record<string, any>, options?: any) => {
        writes.push({ path: ref.path, value, merge: Boolean(options?.merge) })
      },
      update: (ref: any, value: Record<string, any>) => {
        writes.push({ path: ref.path, value, merge: true })
      },
      create: (ref: any, value: Record<string, any>) => {
        writes.push({ path: ref.path, value, merge: false })
      },
    }
    const result = await body(transaction)
    // The interleaving hook fires once, on the first attempt only, so a retry
    // is not parked behind itself.
    if (afterRead && attempt === 0) {
      const hook = afterRead
      afterRead = null
      await hook()
    }
    const stale = [...readVersions.entries()].some(
      ([path, version]) => (versions.get(path) ?? 0) !== version,
    )
    if (stale) {
      abortedRetries++
      continue
    }
    for (const write of writes) writeDoc(write.path, write.value, write.merge)
    return result
  }
  const error: any = new Error('ABORTED: too much contention')
  error.code = 10
  throw error
}

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
  runTransaction,
}

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
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
    firestore: {
      FieldValue: {
        delete: () => DELETE,
        increment: (value: number) => ({ __increment: value }),
        arrayUnion: (value: any) => ({ __arrayUnion: value }),
      },
    },
  },
  getOrgForHost: async () => mockOrg,
}))

// ---------------------------------------------------------------------------
// Stripe boundary — counted, never reached
// ---------------------------------------------------------------------------

interface StripeCall {
  url: string
  params: URLSearchParams
}

const stripeCalls: StripeCall[] = []
let stripeObjectCounter = 0

function sessionCalls() {
  return stripeCalls.filter((call) => call.url.includes('checkout/sessions'))
}

const fetchMock = jest.fn(async (url: any, init: any): Promise<any> => {
  const target = String(url)
  if (!target.includes('api.stripe.com')) {
    throw new Error(`Unexpected fetch to ${target}`)
  }
  stripeCalls.push({
    url: target,
    params: new URLSearchParams(String(init?.body ?? '')),
  })
  const payload = target.includes('/coupons')
    ? { id: `coupon_${++stripeObjectCounter}` }
    : {
        id: `cs_${++stripeObjectCounter}`,
        url: `https://checkout.stripe.com/pay/s-${stripeObjectCounter}`,
      }
  return { ok: true, json: async () => payload }
})

// ---------------------------------------------------------------------------
// Request plumbing
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
      /* unused */
    },
    redirect() {
      /* unused */
    },
    end() {
      /* unused */
    },
  } as PluginApiResponse
  return { res, result }
}

/** Each shopper carries their own cart and their own idempotency key. */
async function post(cartId: string, key: string, giftCardCode = 'GC50') {
  const { res, result } = makeResponse()
  const request = {
    method: 'POST',
    query: {},
    body: { hostId: 'host-1', giftCardCode },
    headers: { host: 'acme.aglyn.app', 'idempotency-key': key },
    cookies: { 'aglyn_cart_host-1': cartId },
    socket: {},
  } as unknown as PluginApiRequest
  await cartCheckoutHandler(request, res)
  return result
}

function card() {
  return docs.get('hosts/host-1/giftCards/GC50') ?? {}
}

function holdCount() {
  return Object.keys(card().holds ?? {}).length
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
})

beforeEach(() => {
  docs.clear()
  versions.clear()
  stripeCalls.length = 0
  autoIdCounter = 0
  stripeObjectCounter = 0
  abortedRetries = 0
  afterRead = null
  fetchMock.mockClear()

  for (const cartId of ['cart-a', 'cart-b']) {
    docs.set(`hosts/host-1/carts/${cartId}`, {
      lines: [{ productId: 'product-1', quantity: 1 }],
    })
  }
  docs.set('hosts/host-1/products/product-1', {
    name: 'Walnut desk',
    type: 'physical',
    status: 'active',
    variants: [{ id: 'default', priceUsd: 80, inventory: null }],
  })
  docs.set('hosts/host-1/settings/store', { tax: { mode: 'none' } })
  // $50 on the card, $80 of goods — so one checkout can absorb the whole card.
  docs.set('hosts/host-1/giftCards/GC50', { balanceCents: 5000 })
  docs.set('profiles/owner-1', {
    stripeAccountId: 'acct_live_merchant',
    stripeChargesEnabled: true,
  })
})

// ---------------------------------------------------------------------------

describe('gift card holds (AGL-2449)', () => {
  it('holds the balance at checkout rather than reading it and walking away', async () => {
    const result = await post('cart-a', 'attempt-a')
    expect(result.status).toBe(200)
    expect(sessionCalls()[0].params.get('metadata[giftCardCents]')).toBe('5000')
    // The balance is untouched — the card is HELD, not spent, until the
    // webhook settles it. Spending here would take the money from a shopper
    // who may never pay.
    expect(card().balanceCents).toBe(5000)
    expect(holdCount()).toBe(1)
    expect(CommerceModel.giftCardAvailableCents(card() as any, Date.now())).toBe(
      0,
    )
  })

  /**
   * THE DEFECT, in the ordering that produced it: both checkouts read the card
   * before either wrote. Before the fix both received `metadata[giftCardCents]`
   * of 5000 and the card settled at -5000.
   */
  it('refuses the second concurrent checkout instead of spending the card twice', async () => {
    let second: Awaited<ReturnType<typeof post>> | null = null
    // Park the first checkout between its read of the card and its commit,
    // and run the second one to completion inside that window.
    afterRead = async () => {
      second = await post('cart-b', 'attempt-b')
    }
    const first = await post('cart-a', 'attempt-a')

    // Exactly one of the two may hold the card. WHICH one is deliberately not
    // asserted: the parked transaction is the one that re-runs, so the loser is
    // whichever commits second, and pinning it would test the fake's scheduling
    // rather than the guard. What matters is that exactly one is refused — at
    // the door, BEFORE Stripe is contacted for it, which is the whole reason
    // this door can refuse where the stock decrement (AGL-2320) cannot.
    const both = [first, second as any]
    const statuses = both.map((result) => result.status).sort()
    expect(statuses).toEqual([200, 400])
    expect(both.find((result) => result.status === 400).body).toEqual({
      error: 'Gift card is empty or invalid',
    })
    expect(both.find((result) => result.status === 200).body.url).toContain(
      'checkout.stripe.com',
    )
    // The contention was real, not an artefact of the fake running them
    // sequentially: the parked transaction saw its read go stale and re-ran.
    expect(abortedRetries).toBeGreaterThan(0)

    // One hold, for 5000, and no more than the card is worth.
    expect(holdCount()).toBe(1)
    const holds = Object.values(card().holds ?? {}) as any[]
    expect(holds[0].cents).toBe(5000)
    expect(card().balanceCents).toBe(5000)

    // And only ONE session ever carried the discount.
    const discounted = sessionCalls().filter((call) =>
      call.params.get('metadata[giftCardCents]'),
    )
    expect(discounted).toHaveLength(1)
  })

  /**
   * The guard forced red on purpose, from the other direction: with the hold
   * removed from the card the second checkout is admitted again and the card is
   * promised twice. This is the pre-fix behaviour, reproduced deliberately so
   * the assertion above is known to be load-bearing rather than vacuous.
   */
  it('would admit the second checkout if the hold were not there (forced red)', async () => {
    await post('cart-a', 'attempt-a')
    expect(holdCount()).toBe(1)

    // Strip the reservation, leaving the balance exactly as the defect left it.
    docs.set('hosts/host-1/giftCards/GC50', { balanceCents: 5000 })

    const second = await post('cart-b', 'attempt-b')
    expect(second.status).toBe(200)
    // Two sessions, each promising the whole $50 card: the loss the hold stops.
    const discounted = sessionCalls().filter(
      (call) => call.params.get('metadata[giftCardCents]') === '5000',
    )
    expect(discounted).toHaveLength(2)
  })

  it('lets the same attempt re-claim its own hold on a retry', async () => {
    const first = await post('cart-a', 'attempt-a')
    expect(first.status).toBe(200)
    const before = { ...(card().holds ?? {}) }

    // The shopper presses the same button again under the same key. The claim
    // replays, so the handler returns the first answer — and critically the
    // card is not left doubly held.
    const retry = await post('cart-a', 'attempt-a')
    expect(retry.status).toBe(200)
    expect(card().holds).toEqual(before)
    expect(holdCount()).toBe(1)
  })

  it('releases the hold when a refusal below the claim sends the shopper back', async () => {
    // An undecided tax setting refuses AFTER the hold is placed. The shopper is
    // going to retry, so the money has to come back with the claim — otherwise
    // they are locked out of their own card until the TTL lapses.
    docs.set('hosts/host-1/settings/store', {})
    const result = await post('cart-a', 'attempt-a')
    expect(result.status).toBe(409)
    expect(holdCount()).toBe(0)
    expect(card().balanceCents).toBe(5000)
  })

  it('admits a checkout again once a stale hold has lapsed', async () => {
    docs.set('hosts/host-1/giftCards/GC50', {
      balanceCents: 5000,
      holds: {
        'abandoned-attempt': {
          cents: 5000,
          expiresAtMs: Date.now() - 1_000,
        },
      },
    })
    const result = await post('cart-a', 'attempt-a')
    expect(result.status).toBe(200)
    expect(sessionCalls()[0].params.get('metadata[giftCardCents]')).toBe('5000')
    // The lapsed key is swept by sentinel rather than left to accumulate one
    // dead entry per abandoned checkout.
    expect(Object.keys(card().holds ?? {})).not.toContain('abandoned-attempt')
    expect(holdCount()).toBe(1)
  })
})

describe('gift card hold arithmetic (AGL-2449)', () => {
  const now = 1_000_000

  it('subtracts live holds from the balance and ignores lapsed ones', () => {
    const card = {
      balanceCents: 5000,
      holds: {
        live: { cents: 2000, expiresAtMs: now + 1 },
        lapsed: { cents: 3000, expiresAtMs: now - 1 },
      },
    }
    expect(CommerceModel.giftCardAvailableCents(card, now)).toBe(3000)
  })

  it('treats a malformed hold as expired, so money is never stranded', () => {
    const card = {
      balanceCents: 5000,
      holds: { broken: { cents: 5000 } as any },
    }
    expect(CommerceModel.giftCardAvailableCents(card, now)).toBe(5000)
  })

  it('never reports a negative balance available', () => {
    const card = {
      // A card voided while a hold stood: the console zeroes the balance.
      balanceCents: 0,
      holds: { live: { cents: 5000, expiresAtMs: now + 1 } },
    }
    expect(CommerceModel.giftCardAvailableCents(card, now)).toBe(0)
  })

  it('settles a lapsed hold anyway — expiry governs new claims, not payments', () => {
    const card = {
      balanceCents: 5000,
      holds: { paid: { cents: 2000, expiresAtMs: now - 1 } },
    }
    // The shopper paid a session whose hold had lapsed. Dropping it would take
    // the discount off them and give nothing back to the merchant.
    expect(CommerceModel.giftCardSettlementCents(card, 'paid', now)).toBe(2000)
  })

  it('settles nothing for a session with no hold, which is the redelivery case', () => {
    const card = { balanceCents: 5000, holds: {} }
    expect(CommerceModel.giftCardSettlementCents(card, 'gone', now)).toBe(0)
  })

  it('caps settlement at the live balance when the card was voided mid-flight', () => {
    const card = {
      balanceCents: 500,
      holds: { paid: { cents: 5000, expiresAtMs: now + 1 } },
    }
    expect(CommerceModel.giftCardSettlementCents(card, 'paid', now)).toBe(500)
  })
})
