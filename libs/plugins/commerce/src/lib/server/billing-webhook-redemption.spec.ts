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
 * Redemptions against a coupon, gift card or discount that no longer exists
 * (AGL-1767) — the cart branch and the buy-now branch.
 *
 * All five sites were `set(..., { merge: true })` against a document the branch
 * never asked about, so a merchant who deleted the code between the shopper
 * starting checkout and the webhook landing got a phantom back. These tests
 * assert on WHAT LANDED in the in-memory Firestore, keyed by document path, so
 * "no document was created" is a real absence rather than a return value the
 * handler does not produce — it returns nothing.
 *
 * THE DOUBLE MODELS THE TWO CALLS' DIFFERENT SEMANTICS, which is the whole
 * experiment: `update()` rejects a missing document with a gRPC `NOT_FOUND`
 * (`code: 5`), while `set({ merge: true })` creates it; both apply
 * `increment`/`arrayUnion` sentinels, and the merge recurses. A double that
 * treated the two as interchangeable would pass against the broken code as
 * happily as against the fix, and one that rejected with a bare `Error` would
 * make `updateExisting` rethrow and turn every case into a false red.
 *
 * No Stripe boundary is exercised: the handler is handed the event object and
 * the paths under test make no outbound call. `global.fetch` is still replaced
 * and asserted unused, because localhost carries the LIVE secret key.
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

/**
 * Resolves one field value against what is already stored, so the sentinels
 * behave as Firestore's do rather than landing as literal marker objects.
 * Applied at ANY depth, because that is where `set({ merge: true })` honours
 * them and it is the difference the gift-card site turns on.
 */
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
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

/**
 * Paths whose `update()` should fail for a reason that is NOT absence, so the
 * "an outage is not a deletion" case can be driven through the real handler.
 */
const updateFailures = new Map<string, { code?: number; message: string }>()

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
      const injected = updateFailures.get(path)
      if (injected) throw Object.assign(new Error(injected.message), injected)
      if (!docs.has(path)) {
        throw Object.assign(
          new Error(`5 NOT_FOUND: No document to update: ${path}`),
          { code: GRPC_NOT_FOUND },
        )
      }
      docs.set(path, mergeInto(docs.get(path) as Record<string, any>, value))
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

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
  runTransaction: async (fn: (transaction: any) => Promise<any>) =>
    fn({
      get: (ref: any) => ref.get(),
      set: (ref: any, value: any, options?: any) => {
        void ref.set(value, options)
      },
    }),
}

const contactUpserts: any[] = []

jest.mock('@aglyn/tenant-data-admin', () => {
  // The REAL `updateExisting` — it is what distinguishes gRPC NOT_FOUND from
  // every other failure, so a stub of it would leave the claim untested. Taken
  // from the module's own path rather than the barrel, which pulls
  // `render-cache` and with it Next's server internals into a jsdom worker.
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
// The sessions
// ---------------------------------------------------------------------------

/**
 * Nothing here coincides: the gift-card value (2500), the charge (4137), the
 * line total (4500), the fee (146) and the seeded redemption counts (4, 2) are
 * all distinct, so an assertion that lands on the right number cannot have got
 * there by reaching for the nearest one.
 */
const CART_SESSION = {
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
    couponCode: 'SAVE10',
    giftCardCode: 'GC-DELETED',
    giftCardCents: '2500',
    discountId: 'disc-7',
  },
}

const BUY_NOW_SESSION = {
  id: 'cs_buynow_1',
  payment_status: 'paid',
  payment_intent: 'pi_buynow_1',
  amount_total: 1350,
  customer_details: { email: 'buyer@example.com', name: 'Ada Cartwright' },
  total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 0 },
  metadata: {
    type: 'commerce-order',
    hostId: 'host-1',
    productId: 'product-1',
    variantId: 'large',
    feeCents: '44',
    couponCode: 'SAVE10',
  },
}

async function deliver(object: any) {
  await commerceBillingWebhookHandler({
    type: 'checkout.session.completed',
    object,
    requestHost: 'acme.aglyn.app',
  } as any)
}

const cartOrder = () => docs.get('hosts/host-1/orders/cs_cart_1') as any
const buyNowOrder = () => docs.get('hosts/host-1/orders/cs_buynow_1') as any

/** The notes this change adds, in the order they were stamped. */
function orphanNotes(order: any): any[] {
  return ((order?.timeline ?? []) as any[]).filter(
    (event) => event.event === 'redemption-unrecorded',
  )
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

beforeEach(() => {
  docs.clear()
  updateFailures.clear()
  contactUpserts.length = 0
  autoIdCounter = 0
  fetchMock.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)

  docs.set('hosts/host-1', { displayName: 'Acme Boxes' })
  docs.set('hosts/host-1/products/product-1', {
    name: 'Monthly box',
    type: 'physical',
    variants: [{ id: 'large', priceUsd: 15, sku: 'BOX-L', inventory: 10 }],
  })
  docs.set('hosts/host-1/carts/cart-1', {
    lines: [{ productId: 'product-1', variantId: 'large', quantity: 3 }],
  })
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ---------------------------------------------------------------------------

describe('a redemption against a document that no longer exists (AGL-1767)', () => {
  /**
   * THE DEFECT, and the one that corrupts an aggregate. `increment(-2500)` on a
   * missing document CREATES it holding `balanceCents: -2500`, so every
   * outstanding-gift-card-liability figure summed over the collection is
   * understated by $25 and re-issuing the code later starts the new card in the
   * hole. Not zero — negative.
   */
  it('does not resurrect a deleted gift card at a negative balance', async () => {
    await deliver(CART_SESSION)
    expect(docs.has('hosts/host-1/giftCards/GC-DELETED')).toBe(false)
  })

  /**
   * And the redemption is not merely dropped, which would be AGL-1732 inverted:
   * the shopper's $25 really was applied by Stripe. The console order dialog
   * renders `timeline`, so the merchant reading the order they were just paid
   * for sees the balance that came off no card.
   */
  it('stamps the orphaned gift-card redemption on the order', async () => {
    await deliver(CART_SESSION)
    const notes = orphanNotes(cartOrder())
    const giftNote = notes.find((event) =>
      String(event.detail).includes('GC-DELETED'),
    )
    expect(giftNote).toBeDefined()
    expect(giftNote.detail).toContain('$25.00')
    expect(typeof giftNote.atMs).toBe('number')
  })

  /** The ghost a re-created coupon inherits against its `maxRedemptions` cap. */
  it('does not mint a coupon out of a redemption count', async () => {
    await deliver(CART_SESSION)
    expect(docs.has('hosts/host-1/coupons/SAVE10')).toBe(false)
    expect(
      orphanNotes(cartOrder()).some((event) =>
        String(event.detail).includes('SAVE10'),
      ),
    ).toBe(true)
  })

  /**
   * The discount ghost is the one that is not inert: `{ redemptions: 1 }`
   * passes every gate in `applies()`, because each skips when its constraint
   * field is ABSENT, so it reaches the automatic-promotion loop as a candidate
   * and lists in the console as a nameless always-on promotion.
   */
  it('does not mint a discount that would qualify as an automatic promotion', async () => {
    await deliver(CART_SESSION)
    expect(docs.has('hosts/host-1/discounts/disc-7')).toBe(false)
    expect(
      orphanNotes(cartOrder()).some((event) =>
        String(event.detail).includes('disc-7'),
      ),
    ).toBe(true)
  })

  /** All three orphans are recorded, not just the first one to be reached. */
  it('records every orphaned redemption on the one order', async () => {
    await deliver(CART_SESSION)
    expect(orphanNotes(cartOrder())).toHaveLength(3)
  })

  /**
   * `arrayUnion` appends, so the `paid` event the transaction wrote survives —
   * the notes are added to the order's history, not swapped for it.
   */
  it('keeps the paid event the order was created with', async () => {
    await deliver(CART_SESSION)
    const timeline = cartOrder().timeline as any[]
    expect(timeline[0].event).toBe('paid')
    expect(timeline).toHaveLength(4)
  })

  /**
   * Site 5, the plain refusal. Nothing occurred that a missing `checkouts` doc
   * would strand — the order, the receipt and the fulfilment are written
   * elsewhere — so there is nothing to record, only a stub not to create.
   */
  it('does not mint a completed checkout for a session it never recorded', async () => {
    await deliver(CART_SESSION)
    expect(docs.has('hosts/host-1/checkouts/cs_cart_1')).toBe(false)
  })

  /** The same coupon defect on the buy-now branch, a separate call site. */
  it('does not mint a coupon from the buy-now branch either', async () => {
    await deliver(BUY_NOW_SESSION)
    expect(docs.has('hosts/host-1/coupons/SAVE10')).toBe(false)
    expect(
      orphanNotes(buyNowOrder()).some((event) =>
        String(event.detail).includes('SAVE10'),
      ),
    ).toBe(true)
  })

  /**
   * THE LIE THE SHORTHAND WOULD TELL. `ref.update(data).catch(() => false)`
   * reports "absent" for a permission denial, an App Check rejection or a
   * transport failure — and the note this writes claims absence BY NAME, on an
   * order the merchant is reading. `updateExisting` rethrows anything that is
   * not gRPC NOT_FOUND, and the handler logs it and stamps nothing.
   */
  it('does not call an outage a deletion', async () => {
    docs.set('hosts/host-1/giftCards/GC-DELETED', { balanceCents: 9000 })
    updateFailures.set('hosts/host-1/giftCards/GC-DELETED', {
      code: 7,
      message: '7 PERMISSION_DENIED: Missing or insufficient permissions',
    })
    await deliver(CART_SESSION)
    expect(
      orphanNotes(cartOrder()).some((event) =>
        String(event.detail).includes('GC-DELETED'),
      ),
    ).toBe(false)
    // The balance is untouched and the rest of the fan-out still ran.
    expect(
      (docs.get('hosts/host-1/giftCards/GC-DELETED') as any).balanceCents,
    ).toBe(9000)
    expect(orphanNotes(cartOrder())).toHaveLength(2)
  })

  /** A throw here would 500 the route; Stripe would redeliver into the
   * AGL-498 existence guard and skip the whole fan-out permanently. */
  it('never rethrows out of the handler', async () => {
    updateFailures.set('hosts/host-1/coupons/SAVE10', {
      code: 14,
      message: '14 UNAVAILABLE',
    })
    await expect(deliver(CART_SESSION)).resolves.toBeUndefined()
  })
})

describe('the redemptions that still land (AGL-1767 pins)', () => {
  beforeEach(() => {
    docs.set('hosts/host-1/coupons/SAVE10', {
      percentOff: 10,
      redemptions: 4,
    })
    docs.set('hosts/host-1/giftCards/GC-DELETED', {
      initialCents: 10000,
      balanceCents: 9000,
    })
    docs.set('hosts/host-1/discounts/disc-7', {
      kind: 'percent',
      value: 5,
      redemptions: 2,
    })
    docs.set('hosts/host-1/checkouts/cs_cart_1', {
      status: 'open',
      marketingOptIn: true,
    })
  })

  /** The feature the refusal must not be bought by breaking. */
  it('still decrements a gift card that exists', async () => {
    await deliver(CART_SESSION)
    const card = docs.get('hosts/host-1/giftCards/GC-DELETED') as any
    expect(card.balanceCents).toBe(6500)
    expect(card.initialCents).toBe(10000)
    expect(typeof card.lastUsedAtMs).toBe('number')
  })

  it('still counts a coupon redemption on the cart branch', async () => {
    await deliver(CART_SESSION)
    const coupon = docs.get('hosts/host-1/coupons/SAVE10') as any
    expect(coupon.redemptions).toBe(5)
    expect(coupon.percentOff).toBe(10)
  })

  it('still counts a coupon redemption on the buy-now branch', async () => {
    await deliver(BUY_NOW_SESSION)
    expect((docs.get('hosts/host-1/coupons/SAVE10') as any).redemptions).toBe(5)
  })

  it('still counts a discount redemption', async () => {
    await deliver(CART_SESSION)
    const discount = docs.get('hosts/host-1/discounts/disc-7') as any
    expect(discount.redemptions).toBe(3)
    expect(discount.kind).toBe('percent')
  })

  /**
   * The checkout doc still closes, and the `marketingOptIn` the read above it
   * exists for still reaches the contact — the read was never the thing being
   * removed, only the thing that was not answering the existence question.
   */
  it('still completes a checkout that exists, and keeps its opt-in', async () => {
    await deliver(CART_SESSION)
    const checkout = docs.get('hosts/host-1/checkouts/cs_cart_1') as any
    expect(checkout.status).toBe('completed')
    expect(typeof checkout.completedAtMs).toBe('number')
    expect(checkout.marketingOptIn).toBe(true)
    expect(contactUpserts[0].marketingConsent).toBe(true)
  })

  /** Nothing to report when every code is where the shopper left it. */
  it('stamps no note when all three redemptions land', async () => {
    await deliver(CART_SESSION)
    expect(orphanNotes(cartOrder())).toHaveLength(0)
    expect(cartOrder().timeline).toHaveLength(1)
  })

  /** The order itself is untouched by any of this. */
  it('still writes the paid order', async () => {
    await deliver(CART_SESSION)
    const order = cartOrder()
    expect(order.status).toBe('paid')
    expect(order.number).toBe(1)
    expect(order.lineItems).toHaveLength(1)
    expect(order.lineItems[0].quantity).toBe(3)
    expect(order.checkoutSessionId).toBe('cs_cart_1')
  })

  /** localhost carries the LIVE Stripe key: no path here may reach out. */
  it('makes no outbound request', async () => {
    await deliver(CART_SESSION)
    await deliver(BUY_NOW_SESSION)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
