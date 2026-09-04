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
import { checkoutHandler } from './checkout'

/**
 * Promotion redemption slots (AGL-2453): a cap of one must admit one shopper.
 *
 * THE DEFECT. The cap was read with a plain `.get()` at session creation and
 * counted with `FieldValue.increment(1)` at the webhook, minutes later. The
 * increment is atomic so nothing was ever lost — the cap was simply never
 * RE-ASKED. The gap is the whole Checkout Session lifetime, up to 24 hours, so
 * this was never bounded by simultaneity: every shopper who loaded checkout
 * while a `maxRedemptions: 100` promotion sat at 99 passed, and the counter
 * finished at 99+N. Two browser tabs reproduce it.
 *
 * ## THE DOUBLE HAS TO MODEL CONTENTION, OR IT REPORTS GREEN FOR THE BUG
 *
 * A fake that merely ran the callback and applied its writes would pass this
 * file with the defect intact: both callbacks would read `redemptions: 0`, both
 * would pass the cap, and the spec would certify the behaviour it exists to
 * forbid. So the fake versions every document, records the versions a
 * transaction read, and RE-RUNS the whole callback on commit if any of them
 * moved. That is Firestore's optimistic concurrency, and it is the only reason
 * the second checkout observes the first one's hold.
 *
 * PER-DOCUMENT versioning is the faithful model HERE, and that is a claim worth
 * making explicitly because AGL-2450 needed per-COLLECTION versioning: there,
 * the conflicting write was a new reservation row the first transaction never
 * read, and a per-document fake would have been blind to it. A redemption slot
 * is different in kind — every contending checkout reads and writes the SAME
 * promotion document, so a document version is exactly the thing that moves.
 * The reservation shape does not arise, and pretending to model it would be
 * decoration rather than rigour.
 *
 * `afterRead` is the interleaving hook. Real concurrency is not reproducible in
 * a single-threaded test, so the first transaction is parked between its read
 * and its commit while the second runs to completion — the worst-case ordering,
 * and the one the defect needed.
 *
 * The fake also models two Firestore behaviours the fix DEPENDS on:
 *   - `set(…, { merge: true })` merges nested MAPS rather than replacing them,
 *     so writing back a locally-pruned `holds` object does NOT remove a key;
 *   - `FieldValue.delete()` inside such a map is what actually removes one.
 *
 * ## Stripe
 *
 * `global.fetch` is replaced and THROWS on any target that is not
 * `api.stripe.com`, because localhost carries the LIVE secret key. Every
 * refusal under test happens before the first Stripe call, so the interesting
 * assertions are that no session was minted at all.
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
 * is merged key by key, and only a `delete()` sentinel removes a key. Modelling
 * this shallowly is what would let a webhook redelivery double-count.
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
  const ref: any = {
    doc: (id?: string) =>
      makeDocRef(`${path}/${id ?? `auto-${++autoIdCounter}`}`),
    get: async () => ({ docs: childPaths(path).map(makeSnapshot) }),
    limit: () => ref,
    where: () => ref,
  }
  return ref
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

/** One cart checkout. Each shopper carries their own cart and attempt key. */
async function postCart(
  cartId: string,
  key: string,
  body: Record<string, unknown> = {},
) {
  const { res, result } = makeResponse()
  const request = {
    method: 'POST',
    query: {},
    body: { hostId: 'host-1', ...body },
    headers: { host: 'acme.aglyn.app', 'idempotency-key': key },
    cookies: { 'aglyn_cart_host-1': cartId },
    socket: {},
  } as unknown as PluginApiRequest
  await cartCheckoutHandler(request, res)
  return result
}

/** One buy-now checkout. */
async function postBuyNow(key: string, couponCode: string) {
  const { res, result } = makeResponse()
  const request = {
    method: 'POST',
    query: {},
    body: { hostId: 'host-1', productId: 'product-1', couponCode },
    headers: { host: 'acme.aglyn.app', 'idempotency-key': key },
    cookies: {},
    socket: {},
  } as unknown as PluginApiRequest
  await checkoutHandler(request, res)
  return result
}

const coupon = () => (docs.get('hosts/host-1/coupons/SAVE10') ?? {}) as any
const discount = () => (docs.get('hosts/host-1/discounts/summer') ?? {}) as any
const holdCount = (promotion: any) =>
  Object.keys(promotion.holds ?? {}).length

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
  docs.set('hosts/host-1', { memberRoles: {} })
  docs.set('hosts/host-1/settings/store', { tax: { mode: 'none' } })
  docs.set('profiles/owner-1', {
    stripeAccountId: 'acct_live_merchant',
    stripeChargesEnabled: true,
  })
  // ONE slot each, and nothing redeemed yet. Every figure here is distinct
  // (10% off, one slot, $80 of goods) so an assertion that lands on the right
  // number cannot have reached for the nearest one.
  docs.set('hosts/host-1/coupons/SAVE10', {
    percentOff: 10,
    maxRedemptions: 1,
    redemptions: 0,
    enabled: true,
  })
})

// ---------------------------------------------------------------------------

describe('promotion redemption slots — the typed coupon (AGL-2453)', () => {
  it('holds a slot at checkout instead of reading the counter and walking away', async () => {
    const result = await postCart('cart-a', 'attempt-a', {
      couponCode: 'SAVE10',
    })
    expect(result.status).toBe(200)
    // The COUNTER is untouched: the slot is HELD, not spent, until the webhook
    // settles it. Counting here would burn a redemption on a shopper who may
    // never pay.
    expect(coupon().redemptions).toBe(0)
    expect(holdCount(coupon())).toBe(1)
    // ...and the promotion now reads as exhausted to anyone else.
    expect(CommerceModel.promotionExhausted(coupon(), Date.now())).toBe(true)
    // The hold key reaches the webhook, which is what makes the settlement
    // idempotent. Without it the webhook falls back to a blind increment.
    expect(sessionCalls()[0].params.get('metadata[couponHoldKey]')).toBeTruthy()
  })

  /**
   * THE DEFECT AS THE ISSUE STATES IT, and the test that matters most: the
   * window is not milliseconds, it is the SESSION LIFETIME. These two
   * checkouts do not overlap at all — the first completes entirely before the
   * second begins — and before the fix the second was still admitted, because
   * `redemptions` does not move until the webhook lands up to 24 hours later.
   * Two browser tabs, no timing, one cap of one, two discounts.
   */
  it('refuses a later checkout while the first session is still live', async () => {
    const first = await postCart('cart-a', 'attempt-a', {
      couponCode: 'SAVE10',
    })
    expect(first.status).toBe(200)
    // Nothing has been paid, so `redemptions` is still 0 — which is exactly the
    // figure the old check read and let the next shopper through on.
    expect(coupon().redemptions).toBe(0)

    const second = await postCart('cart-b', 'attempt-b', {
      couponCode: 'SAVE10',
    })
    expect(second.status).toBe(400)
    expect(second.body.error).toBe(CommerceModel.PROMOTION_EXHAUSTED_MESSAGE)
    // One session, and it is the one that took the discount.
    expect(sessionCalls()).toHaveLength(1)
    expect(sessionCalls()[0].params.get('metadata[couponCode]')).toBe('SAVE10')
  })

  /**
   * The same defect in the ordering that produced it: both checkouts read the
   * coupon before either wrote.
   */
  it('refuses the second concurrent checkout instead of over-redeeming', async () => {
    // Seeded rather than left undefined, so a handler that never reaches the
    // transaction (which is what the pre-fix code does) fails on the STATUS
    // rather than on a missing property — a red about the product, not the fake.
    let second: any = { status: 0, body: {} }
    // Park the first checkout between its read of the coupon and its commit,
    // and run the second one to completion inside that window.
    afterRead = async () => {
      second = await postCart('cart-b', 'attempt-b', { couponCode: 'SAVE10' })
    }
    const first = await postCart('cart-a', 'attempt-a', {
      couponCode: 'SAVE10',
    })

    // Exactly one of the two may have the slot. WHICH one is deliberately not
    // asserted: the parked transaction is the one that re-runs, so the loser is
    // whichever commits second, and pinning it would test the fake's scheduling
    // rather than the guard.
    const both = [first, second]
    expect(both.map((result) => result.status).sort()).toEqual([200, 400])
    expect(both.find((result) => result.status === 400).body.error).toBe(
      CommerceModel.PROMOTION_EXHAUSTED_MESSAGE,
    )
    // Exactly ONE session was minted, and only it carries the coupon.
    expect(sessionCalls()).toHaveLength(1)
    expect(sessionCalls()[0].params.get('metadata[couponCode]')).toBe('SAVE10')
    expect(holdCount(coupon())).toBe(1)
    // The contention was real, not an artefact of the fake running them
    // sequentially: the parked transaction saw its read go stale and re-ran.
    expect(abortedRetries).toBeGreaterThan(0)
  })

  /**
   * The guard forced red on purpose, from the other direction: with the hold
   * stripped off the coupon the second checkout is admitted again and the cap
   * of one hands out two discounts. This is the pre-fix behaviour, reproduced
   * deliberately so the assertion above is known to be load-bearing.
   */
  it('would admit the second checkout if the hold were not there (forced red)', async () => {
    await postCart('cart-a', 'attempt-a', { couponCode: 'SAVE10' })
    expect(holdCount(coupon())).toBe(1)

    // Strip the reservation, leaving the counter exactly as the defect left it.
    docs.set('hosts/host-1/coupons/SAVE10', {
      percentOff: 10,
      maxRedemptions: 1,
      redemptions: 0,
      enabled: true,
    })

    const second = await postCart('cart-b', 'attempt-b', {
      couponCode: 'SAVE10',
    })
    expect(second.status).toBe(200)
    // Two sessions, both discounted, against a cap of one: the loss the hold
    // stops.
    expect(
      sessionCalls().filter(
        (call) => call.params.get('metadata[couponCode]') === 'SAVE10',
      ),
    ).toHaveLength(2)
  })

  it('refuses a fresh checkout once the cap is settled, not merely held', async () => {
    docs.set('hosts/host-1/coupons/SAVE10', {
      percentOff: 10,
      maxRedemptions: 1,
      redemptions: 1,
      enabled: true,
    })
    const result = await postCart('cart-a', 'attempt-a', {
      couponCode: 'SAVE10',
    })
    expect(result.status).toBe(400)
    expect(sessionCalls()).toHaveLength(0)
  })

  it('lets a retry of the SAME attempt re-claim its own slot', async () => {
    const first = await postCart('cart-a', 'attempt-a', {
      couponCode: 'SAVE10',
    })
    expect(first.status).toBe(200)
    // A retry under the same idempotency key is one attempt, not two shoppers.
    // Without the `exceptHoldKey` exclusion the second press of the same button
    // would refuse the shopper the slot they are already holding.
    const retry = await postCart('cart-a', 'attempt-a', {
      couponCode: 'SAVE10',
    })
    expect(retry.status).toBe(200)
    expect(holdCount(coupon())).toBe(1)
  })

  it('releases the slot when a refusal below the claim turns the shopper away', async () => {
    // An UNDECIDED tax mode refuses at 409, and it sits below the promotion
    // hold. The slot has to come back with the claim or an abandoned merchant
    // misconfiguration stands a redemption off for a day.
    docs.set('hosts/host-1/settings/store', {})
    const result = await postCart('cart-a', 'attempt-a', {
      couponCode: 'SAVE10',
    })
    expect(result.status).toBe(409)
    expect(holdCount(coupon())).toBe(0)
    expect(CommerceModel.promotionExhausted(coupon(), Date.now())).toBe(false)
  })

  it('keeps the slot once the Stripe session exists', async () => {
    const result = await postCart('cart-a', 'attempt-a', {
      couponCode: 'SAVE10',
    })
    expect(result.status).toBe(200)
    // Past the session the hold belongs to it: the shopper can still pay, and
    // the webhook settles against the reservation. Releasing here would leave a
    // paid order whose redemption is never counted.
    expect(holdCount(coupon())).toBe(1)
  })

  it('holds nothing for an UNCAPPED coupon, and mints no hold key', async () => {
    docs.set('hosts/host-1/coupons/SAVE10', {
      percentOff: 10,
      redemptions: 3,
      enabled: true,
    })
    const result = await postCart('cart-a', 'attempt-a', {
      couponCode: 'SAVE10',
    })
    expect(result.status).toBe(200)
    expect(holdCount(coupon())).toBe(0)
    // No key means the webhook keeps the unconditional increment, which is the
    // right answer when there was no slot to reserve.
    expect(sessionCalls()[0].params.get('metadata[couponHoldKey]')).toBeNull()
  })

  it('sweeps a LAPSED hold rather than letting it bound the cap forever', async () => {
    docs.set('hosts/host-1/coupons/SAVE10', {
      percentOff: 10,
      maxRedemptions: 1,
      redemptions: 0,
      enabled: true,
      holds: { 'attempt-dead': { expiresAtMs: Date.now() - 1000 } },
    })
    const result = await postCart('cart-a', 'attempt-a', {
      couponCode: 'SAVE10',
    })
    expect(result.status).toBe(200)
    // The dead key is GONE from the stored map, not merely ignored on read. It
    // can only go by the delete sentinel: `set(merge:true)` deep-merges, so
    // writing back a locally pruned object would leave it standing and the
    // document would grow one dead key per abandoned checkout forever.
    expect(coupon().holds['attempt-dead']).toBeUndefined()
    expect(holdCount(coupon())).toBe(1)
  })
})

describe('promotion redemption slots — the AUTOMATIC discount (AGL-2453)', () => {
  beforeEach(() => {
    docs.set('hosts/host-1/discounts/summer', {
      name: 'First fifty',
      kind: 'percent',
      valuePct: 15,
      maxRedemptions: 1,
      redemptions: 0,
      enabled: true,
    })
  })

  it('holds a slot for a promotion the shopper never typed', async () => {
    const result = await postCart('cart-a', 'attempt-a')
    expect(result.status).toBe(200)
    expect(discount().redemptions).toBe(0)
    expect(holdCount(discount())).toBe(1)
    expect(
      sessionCalls()[0].params.get('metadata[discountHoldKey]'),
    ).toBeTruthy()
  })

  /**
   * The half-measure this issue warned about: holding only the TYPED coupon
   * would leave the identical silent over-redemption on the path a shopper does
   * not even opt into. A "first fifty customers" promotion would be enforced
   * only against whoever is not currently mid-checkout.
   */
  it('refuses the second concurrent checkout on the automatic path too', async () => {
    let second: any
    afterRead = async () => {
      second = await postCart('cart-b', 'attempt-b')
    }
    const first = await postCart('cart-a', 'attempt-a')

    const both = [first, second]
    expect(both.map((result) => result.status).sort()).toEqual([200, 409])
    expect(both.find((result) => result.status === 409).body.error).toBe(
      CommerceModel.PROMOTION_UNAVAILABLE_MESSAGE,
    )
    expect(sessionCalls()).toHaveLength(1)
    expect(sessionCalls()[0].params.get('metadata[discountId]')).toBe('summer')
    expect(abortedRetries).toBeGreaterThan(0)
  })

  /**
   * Forced red on the automatic path too, because "a fix on one is a fix on
   * neither": with the hold stripped, both carts take the 15% off a promotion
   * configured for one.
   */
  it('would admit the second automatic checkout if the hold were not there (forced red)', async () => {
    await postCart('cart-a', 'attempt-a')
    expect(holdCount(discount())).toBe(1)
    docs.set('hosts/host-1/discounts/summer', {
      name: 'First fifty',
      kind: 'percent',
      valuePct: 15,
      maxRedemptions: 1,
      redemptions: 0,
      enabled: true,
    })
    const second = await postCart('cart-b', 'attempt-b')
    expect(second.status).toBe(200)
    expect(
      sessionCalls().filter(
        (call) => call.params.get('metadata[discountId]') === 'summer',
      ),
    ).toHaveLength(2)
  })

  it('stops offering a held-out promotion, so the retry simply prices without it', async () => {
    // The resolver counts holds too, which is what makes the refusal above
    // recoverable rather than a wall: the reloaded cart resolves no discount
    // and checks out at full price.
    docs.set('hosts/host-1/discounts/summer', {
      name: 'First fifty',
      kind: 'percent',
      valuePct: 15,
      maxRedemptions: 1,
      redemptions: 0,
      enabled: true,
      holds: { 'someone-else': { expiresAtMs: Date.now() + 60_000 } },
    })
    const result = await postCart('cart-a', 'attempt-a')
    expect(result.status).toBe(200)
    expect(sessionCalls()[0].params.get('metadata[discountId]')).toBeNull()
    // No Stripe coupon was minted at all — the basket priced at full price.
    expect(stripeCalls.filter((call) => call.url.includes('/coupons'))).toHaveLength(0)
  })

  it('releases the automatic slot when a later refusal turns the shopper away', async () => {
    docs.set('hosts/host-1/settings/store', {})
    const result = await postCart('cart-a', 'attempt-a')
    expect(result.status).toBe(409)
    expect(holdCount(discount())).toBe(0)
  })
})

describe('promotion redemption slots — buy-now (AGL-2453)', () => {
  it('holds the coupon slot on the buy-now path', async () => {
    const result = await postBuyNow('attempt-a', 'SAVE10')
    expect(result.status).toBe(200)
    expect(coupon().redemptions).toBe(0)
    expect(holdCount(coupon())).toBe(1)
    expect(sessionCalls()[0].params.get('metadata[couponHoldKey]')).toBeTruthy()
  })

  /**
   * The cross-path case, and the reason the hold lives on the promotion
   * document rather than in either handler: a cart checkout and a buy-now
   * checkout are two different doors onto ONE counter.
   */
  it('refuses a buy-now shopper the slot a cart checkout is holding', async () => {
    const cart = await postCart('cart-a', 'attempt-a', { couponCode: 'SAVE10' })
    expect(cart.status).toBe(200)
    const buyNow = await postBuyNow('attempt-b', 'SAVE10')
    expect(buyNow.status).toBe(400)
    expect(buyNow.body.error).toBe(CommerceModel.PROMOTION_EXHAUSTED_MESSAGE)
    expect(sessionCalls()).toHaveLength(1)
  })

  it('releases the buy-now slot when a refusal below the claim turns the shopper away', async () => {
    // A store that has decided to collect tax but configured no rate refuses
    // at 409, below the claim and below the hold.
    docs.set('hosts/host-1/settings/store', {
      tax: { mode: 'manual', zones: [] },
    })
    const result = await postBuyNow('attempt-a', 'SAVE10')
    expect(result.status).toBeGreaterThanOrEqual(400)
    expect(holdCount(coupon())).toBe(0)
  })
})

describe('the merchant can SEE a held slot (AGL-2453)', () => {
  it('names held slots separately from used ones', async () => {
    await postCart('cart-a', 'attempt-a', { couponCode: 'SAVE10' })
    // Without this the console would show `0/1 used` on a promotion that
    // refuses every shopper, and the merchant would have no way to tell a held
    // slot from a broken one.
    expect(CommerceModel.promotionUsageLabel(coupon(), Date.now())).toBe(
      '0/1 used · 1 held in checkout',
    )
  })
})
