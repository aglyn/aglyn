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

import {
  holdPromotionSlot,
  releasePromotionHold,
  settlePromotionSlot,
} from './promotion-hold'
import { commerceBillingWebhookHandler } from './billing-webhook'

/**
 * Settling a promotion slot (AGL-2453) — the webhook half of the reserve.
 *
 * The checkout side is `promotion-hold-race.spec.ts`; this file is about what
 * happens once the money moves, and about the two Firestore behaviours the
 * settlement DEPENDS on:
 *
 *  1. `set(…, { merge: true })` DEEP-merges nested maps. Writing back a locally
 *     pruned `holds` object leaves every stale key exactly where it was — so a
 *     settlement that "removed" a hold that way would leave it standing, and a
 *     webhook redelivery would count the redemption a SECOND time. Only
 *     `FieldValue.delete()` removes it.
 *  2. A merge must not disturb a sibling. Two shoppers can hold slots on one
 *     promotion at once, and settling one of them must leave the other's
 *     reservation untouched.
 *
 * Both are modelled in the fake below. A shallow one would report green for a
 * double-count, which is a WORSE bug than the over-redemption being fixed.
 *
 * ## Why the redelivery cases test the helper directly
 *
 * `billing-webhook.ts` guards its whole order fan-out behind an early return on
 * its own redelivery flag, so a second `checkout.session.completed` never reaches
 * the redemption block at all today. That guard is recorded at
 * `reconcile-stock.ts:52-58` as the reason a per-effect idempotency sweep is
 * still owed on these counters — it is one flag covering many effects. So the
 * idempotency asserted here is the EFFECT's own, proved where it lives, rather
 * than through a handler whose outer guard would make any such test pass
 * vacuously. The handler tests below cover the wiring: which document, which
 * hold key, and the fallback for a session that reserved nothing.
 *
 * `global.fetch` is replaced and throws: localhost carries the LIVE Stripe key
 * and nothing in this file has any business reaching it.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore with deep merge and field sentinels
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
let autoIdCounter = 0

const DELETE = Symbol('FieldValue.delete')

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

/** Paths whose transactional read should fail, for the transport-failure case. */
const readFailures = new Set<string>()

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
        const error: any = new Error(`5 NOT_FOUND: ${path}`)
        error.code = 5
        throw error
      }
      writeDoc(path, value, true)
    },
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  const ref: any = {
    doc: (id?: string) =>
      makeDocRef(`${path}/${id ?? `auto-${++autoIdCounter}`}`),
    get: async () => ({ docs: [], size: 0 }),
    add: async (value: Record<string, any>) => {
      const created = makeDocRef(`${path}/auto-${++autoIdCounter}`)
      docs.set(created.path, value)
      return created
    },
    where: () => ref,
    limit: () => ref,
  }
  return ref
}

/**
 * Writes are BUFFERED and applied at commit, all or nothing — a fake that
 * applied each write as it was issued would report a half-written promotion as
 * atomic. No version tracking: contention is modelled in
 * `promotion-hold-race.spec.ts`, and claiming to model it twice would be
 * decoration.
 */
async function runTransaction(
  body: (transaction: any) => Promise<any>,
): Promise<any> {
  const writes: Array<[string, Record<string, any>, boolean]> = []
  const transaction = {
    get: async (ref: any) => {
      if (readFailures.has(ref.path)) {
        throw Object.assign(new Error(`14 UNAVAILABLE: ${ref.path}`), {
          code: 14,
        })
      }
      return makeSnapshot(ref.path)
    },
    set: (ref: any, value: Record<string, any>, options?: any) => {
      writes.push([ref.path, value, Boolean(options?.merge)])
    },
    update: (ref: any, value: Record<string, any>) => {
      writes.push([ref.path, value, true])
    },
  }
  const result = await body(transaction)
  for (const [path, value, merge] of writes) writeDoc(path, value, merge)
  return result
}

const fakeFirestore: any = {
  collection: (name: string) => makeCollectionRef(name),
  runTransaction,
}

const contactUpserts: any[] = []

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
          delete: () => DELETE,
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
    notifyHostManagers: async () => undefined,
    upsertHostContact: async (options: any) => {
      contactUpserts.push(options)
    },
    renderHostEmailWithTokens: async () => null,
  }
})

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  sendEmail: async () => undefined,
}))

const fetchMock = jest.fn(async (url: any) => {
  throw new Error(`Unexpected fetch to ${String(url)}`)
})

// ---------------------------------------------------------------------------

const COUPON_PATH = 'hosts/host-1/coupons/SAVE10'
const DISCOUNT_PATH = 'hosts/host-1/discounts/summer'
const ORDER_PATH = 'hosts/host-1/orders/cs_cart_1'

const couponRef = () => makeDocRef(COUPON_PATH)
const coupon = () => (docs.get(COUPON_PATH) ?? {}) as any
const discount = () => (docs.get(DISCOUNT_PATH) ?? {}) as any
const order = () => (docs.get(ORDER_PATH) ?? {}) as any

/**
 * A completed cart session. The figures are all distinct — 7 prior redemptions,
 * a cap of 9, a 4137¢ charge — so an assertion that lands on the right number
 * cannot have got there by reaching for the nearest one.
 */
function cartSession(metadata: Record<string, string> = {}) {
  return {
    id: 'cs_cart_1',
    payment_status: 'paid',
    payment_intent: 'pi_cart_1',
    amount_total: 4137,
    customer_details: { email: 'buyer@example.com', name: 'Ada Cartwright' },
    total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 0 },
    metadata: {
      type: 'commerce-cart',
      hostId: 'host-1',
      cartId: 'cart-1',
      feeCents: '146',
      ...metadata,
    },
  }
}

async function deliver(type: string, object: any) {
  await commerceBillingWebhookHandler({
    type,
    object,
    requestHost: 'acme.aglyn.app',
  } as any)
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

beforeEach(() => {
  docs.clear()
  readFailures.clear()
  contactUpserts.length = 0
  autoIdCounter = 0
  fetchMock.mockClear()
  docs.set(COUPON_PATH, {
    percentOff: 10,
    maxRedemptions: 9,
    redemptions: 7,
    enabled: true,
    holds: { 'attempt-a': { expiresAtMs: Date.now() + 60_000 } },
  })
  docs.set('hosts/host-1/carts/cart-1', { lines: [] })
})

// ---------------------------------------------------------------------------

describe('settling a held slot (AGL-2453)', () => {
  it('counts the redemption and removes the hold in one write', async () => {
    const settled = await settlePromotionSlot({
      firestore: fakeFirestore,
      ref: couponRef(),
      holdKey: 'attempt-a',
      label: 'coupon SAVE10',
    })
    expect(settled).toBe('settled')
    expect(coupon().redemptions).toBe(8)
    // The hold is GONE from the stored map, not merely absent from a copy we
    // wrote back. This is the assertion the delete sentinel exists for.
    expect(coupon().holds).toEqual({})
  })

  /**
   * THE REDELIVERY. Stripe delivers at least once, so this must be a no-op the
   * second time. The redemption is owed by the PRESENCE of the hold, so once
   * the hold is gone there is nothing to settle.
   */
  it('counts nothing on a second delivery', async () => {
    await settlePromotionSlot({
      firestore: fakeFirestore,
      ref: couponRef(),
      holdKey: 'attempt-a',
      label: 'coupon SAVE10',
    })
    const again = await settlePromotionSlot({
      firestore: fakeFirestore,
      ref: couponRef(),
      holdKey: 'attempt-a',
      label: 'coupon SAVE10',
    })
    expect(again).toBe('already-settled')
    expect(coupon().redemptions).toBe(8)
  })

  /**
   * THE FORCED RED, and the reason the sentinel is not a detail. This is what
   * a settlement that wrote back a locally-pruned copy of the map would do:
   * `set(merge: true)` deep-merges, so the pruned key survives, the second
   * delivery finds it, and the counter advances TWICE for one payment.
   */
  it('would double-count if the hold were removed by writing back a pruned map (forced red)', async () => {
    // Exactly the wrong write, issued by hand against the same fake.
    const pruned = { ...(coupon().holds ?? {}) }
    delete pruned['attempt-a']
    await couponRef().set(
      { redemptions: { __increment: 1 }, holds: pruned },
      { merge: true },
    )
    expect(coupon().redemptions).toBe(8)
    // The hold is STILL THERE — the deep merge kept it.
    expect(coupon().holds['attempt-a']).toBeDefined()
    // ...so a redelivery settles it a second time.
    const again = await settlePromotionSlot({
      firestore: fakeFirestore,
      ref: couponRef(),
      holdKey: 'attempt-a',
      label: 'coupon SAVE10',
    })
    expect(again).toBe('settled')
    expect(coupon().redemptions).toBe(9)
  })

  it("leaves another shopper's live hold alone", async () => {
    docs.set(COUPON_PATH, {
      ...coupon(),
      holds: {
        'attempt-a': { expiresAtMs: Date.now() + 60_000 },
        'attempt-b': { expiresAtMs: Date.now() + 90_000 },
      },
    })
    await settlePromotionSlot({
      firestore: fakeFirestore,
      ref: couponRef(),
      holdKey: 'attempt-a',
      label: 'coupon SAVE10',
    })
    expect(coupon().redemptions).toBe(8)
    expect(Object.keys(coupon().holds)).toEqual(['attempt-b'])
  })

  /**
   * Expiry governs what a NEW checkout may claim, never whether a COMPLETED
   * payment is counted. A shopper who paid a session whose hold had lapsed
   * still got the discount, and the merchant's cap must record it.
   */
  it('settles a hold that lapsed while the session sat unpaid', async () => {
    docs.set(COUPON_PATH, {
      ...coupon(),
      holds: { 'attempt-a': { expiresAtMs: Date.now() - 1000 } },
    })
    const settled = await settlePromotionSlot({
      firestore: fakeFirestore,
      ref: couponRef(),
      holdKey: 'attempt-a',
      label: 'coupon SAVE10',
    })
    expect(settled).toBe('settled')
    expect(coupon().redemptions).toBe(8)
  })

  it('reports a deleted promotion as missing rather than counting into nothing', async () => {
    docs.delete(COUPON_PATH)
    const settled = await settlePromotionSlot({
      firestore: fakeFirestore,
      ref: couponRef(),
      holdKey: 'attempt-a',
      label: 'coupon SAVE10',
    })
    expect(settled).toBe('missing')
    expect(docs.has(COUPON_PATH)).toBe(false)
  })

  /**
   * A transport failure is NOT a deletion, and the two must not collapse: the
   * hold stands and lapses on its own, and the merchant is not told their
   * coupon was deleted.
   */
  it('reports a read failure as an error, leaving the hold standing', async () => {
    readFailures.add(COUPON_PATH)
    const settled = await settlePromotionSlot({
      firestore: fakeFirestore,
      ref: couponRef(),
      holdKey: 'attempt-a',
      label: 'coupon SAVE10',
    })
    expect(settled).toBe('error')
    expect(coupon().redemptions).toBe(7)
    expect(coupon().holds['attempt-a']).toBeDefined()
  })
})

describe('holding and releasing a slot (AGL-2453)', () => {
  it('refuses when the settled count alone has reached the cap', async () => {
    docs.set(COUPON_PATH, {
      percentOff: 10,
      maxRedemptions: 9,
      redemptions: 9,
      enabled: true,
    })
    const outcome = await holdPromotionSlot({
      firestore: fakeFirestore,
      ref: couponRef(),
      holdKey: 'attempt-b',
      label: 'coupon SAVE10',
    })
    expect(outcome).toEqual({ ok: false, reason: 'exhausted' })
    expect(coupon().holds).toBeUndefined()
  })

  it('refuses when holds alone have reached the cap, with nothing settled', async () => {
    docs.set(COUPON_PATH, {
      percentOff: 10,
      maxRedemptions: 2,
      redemptions: 0,
      enabled: true,
      holds: {
        'attempt-a': { expiresAtMs: Date.now() + 60_000 },
        'attempt-b': { expiresAtMs: Date.now() + 60_000 },
      },
    })
    const outcome = await holdPromotionSlot({
      firestore: fakeFirestore,
      ref: couponRef(),
      holdKey: 'attempt-c',
      label: 'coupon SAVE10',
    })
    expect(outcome).toEqual({ ok: false, reason: 'exhausted' })
  })

  it('writes nothing at all for an uncapped promotion', async () => {
    docs.set(COUPON_PATH, { percentOff: 10, redemptions: 7, enabled: true })
    const outcome: any = await holdPromotionSlot({
      firestore: fakeFirestore,
      ref: couponRef(),
      holdKey: 'attempt-b',
      label: 'coupon SAVE10',
    })
    expect(outcome.ok).toBe(true)
    expect(outcome.holdKey).toBe('')
    expect(coupon().holds).toBeUndefined()
  })

  it('releases by sentinel, leaving siblings intact', async () => {
    docs.set(COUPON_PATH, {
      ...coupon(),
      holds: {
        'attempt-a': { expiresAtMs: Date.now() + 60_000 },
        'attempt-b': { expiresAtMs: Date.now() + 60_000 },
      },
    })
    await releasePromotionHold(couponRef(), 'attempt-a')
    expect(Object.keys(coupon().holds)).toEqual(['attempt-b'])
    expect(coupon().redemptions).toBe(7)
  })
})

describe('the webhook settles the right document (AGL-2453)', () => {
  it('settles the coupon slot the session reserved', async () => {
    await deliver(
      'checkout.session.completed',
      cartSession({ couponCode: 'SAVE10', couponHoldKey: 'attempt-a' }),
    )
    expect(coupon().redemptions).toBe(8)
    expect(coupon().holds).toEqual({})
  })

  it('settles the automatic discount slot the session reserved', async () => {
    docs.set(DISCOUNT_PATH, {
      kind: 'percent',
      valuePct: 15,
      maxRedemptions: 3,
      redemptions: 1,
      holds: { 'attempt-a': { expiresAtMs: Date.now() + 60_000 } },
    })
    await deliver(
      'checkout.session.completed',
      cartSession({ discountId: 'summer', discountHoldKey: 'attempt-a' }),
    )
    expect(discount().redemptions).toBe(2)
    expect(discount().holds).toEqual({})
  })

  /**
   * A session minted BEFORE this deploy, and an UNCAPPED promotion, both carry
   * no hold key. Both reserved nothing, and both must still be counted — the
   * shopper got the discount and the merchant's own record of their promotion
   * has to show it. Dropping these would under-count real redemptions, which is
   * the original defect pointing the other way.
   */
  it('keeps the unconditional increment for a session that reserved nothing', async () => {
    docs.set(COUPON_PATH, {
      percentOff: 10,
      maxRedemptions: 9,
      redemptions: 7,
      enabled: true,
    })
    await deliver('checkout.session.completed', cartSession({
      couponCode: 'SAVE10',
    }))
    expect(coupon().redemptions).toBe(8)
  })

  it('records a redemption against a deleted coupon on the order timeline', async () => {
    docs.delete(COUPON_PATH)
    await deliver(
      'checkout.session.completed',
      cartSession({ couponCode: 'SAVE10', couponHoldKey: 'attempt-a' }),
    )
    // The merchant deleted the code between checkout and payment. The
    // redemption cannot be recorded anywhere else, so it lands where they read.
    const events = (order().timeline ?? []) as any[]
    expect(
      events.some((event) => event.event === 'redemption-unrecorded'),
    ).toBe(true)
  })

  it('does NOT create the coupon document it was asked to settle', async () => {
    docs.delete(COUPON_PATH)
    await deliver(
      'checkout.session.completed',
      cartSession({ couponCode: 'SAVE10', couponHoldKey: 'attempt-a' }),
    )
    // A phantom coupon written by a merge-set is AGL-1767's defect; the
    // transaction must not resurrect one either.
    expect(docs.has(COUPON_PATH)).toBe(false)
  })
})

describe('an expired session gives its reservations back (AGL-2453)', () => {
  function expiredSession(metadata: Record<string, string>) {
    return { id: 'cs_cart_1', metadata: { hostId: 'host-1', ...metadata } }
  }

  it('releases a coupon slot', async () => {
    await deliver(
      'checkout.session.expired',
      expiredSession({ couponCode: 'SAVE10', couponHoldKey: 'attempt-a' }),
    )
    expect(coupon().holds).toEqual({})
    // Released, never counted: the shopper never paid.
    expect(coupon().redemptions).toBe(7)
  })

  it('releases a discount slot', async () => {
    docs.set(DISCOUNT_PATH, {
      kind: 'percent',
      valuePct: 15,
      maxRedemptions: 3,
      redemptions: 1,
      holds: { 'attempt-a': { expiresAtMs: Date.now() + 60_000 } },
    })
    await deliver(
      'checkout.session.expired',
      expiredSession({ discountId: 'summer', discountHoldKey: 'attempt-a' }),
    )
    expect(discount().holds).toEqual({})
    expect(discount().redemptions).toBe(1)
  })

  it('releases a gift-card hold, which AGL-2449 left to the TTL alone', async () => {
    docs.set('hosts/host-1/giftCards/GC50', {
      balanceCents: 5000,
      holds: { 'attempt-a': { cents: 5000, expiresAtMs: Date.now() + 60_000 } },
    })
    await deliver(
      'checkout.session.expired',
      expiredSession({ giftCardCode: 'GC50', giftCardHoldKey: 'attempt-a' }),
    )
    const card = docs.get('hosts/host-1/giftCards/GC50') as any
    expect(card.holds).toEqual({})
    expect(card.balanceCents).toBe(5000)
  })

  it('leaves a sibling shopper alone, and does nothing without a hold key', async () => {
    docs.set(COUPON_PATH, {
      ...coupon(),
      holds: {
        'attempt-a': { expiresAtMs: Date.now() + 60_000 },
        'attempt-b': { expiresAtMs: Date.now() + 60_000 },
      },
    })
    await deliver(
      'checkout.session.expired',
      expiredSession({ couponCode: 'SAVE10', couponHoldKey: 'attempt-a' }),
    )
    expect(Object.keys(coupon().holds)).toEqual(['attempt-b'])

    // A pre-deploy session carries no hold key and must not be read as a
    // licence to clear the map.
    await deliver(
      'checkout.session.expired',
      expiredSession({ couponCode: 'SAVE10' }),
    )
    expect(Object.keys(coupon().holds)).toEqual(['attempt-b'])
  })

  it('ignores an expired session with no host, rather than throwing', async () => {
    await deliver('checkout.session.expired', { id: 'cs_x', metadata: {} })
    expect(Object.keys(coupon().holds)).toEqual(['attempt-a'])
  })
})
