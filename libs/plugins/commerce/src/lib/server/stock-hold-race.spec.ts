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

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import * as CommerceModel from '../model'
import { cartCheckoutHandler } from './cart-checkout'
import { checkoutHandler } from './checkout'
import { holdStock } from './stock-hold'
import { commerceBillingWebhookHandler } from './billing-webhook'

/**
 * THE LAST UNIT GOES TO ONE SHOPPER (AGL-2356).
 *
 * THE DEFECT. `canPurchase` was read with a plain `.get()` at session creation
 * and the stock was decremented in the webhook minutes later. AGL-2320 made
 * that decrement atomic, so nothing was ever LOST — the shelf was simply never
 * RE-ASKED. Nothing was written at checkout, so there was no document to
 * contend on: N concurrent shoppers all read `inventory: 1`, all passed, all
 * paid, and the merchant could ship one of them. The gap is the whole Checkout
 * Session lifetime, so this was never bounded by simultaneity — two browser
 * tabs minutes apart reproduce it.
 *
 * ## THE DOUBLE HAS TO MODEL CONTENTION, OR IT REPORTS GREEN FOR THE BUG
 *
 * A fake that merely ran each callback and applied its writes would pass this
 * whole file with the defect intact: both transactions would read
 * `inventory: 1`, both would pass, and the spec would certify the behaviour it
 * exists to forbid. So the fake versions every document, records the versions a
 * transaction read, and RE-RUNS the whole callback on commit if any of them
 * moved. That is Firestore's optimistic concurrency, and it is the only reason
 * the second checkout ever observes the first one's hold.
 *
 * PER-DOCUMENT versioning is the faithful model here, and that is worth saying
 * because AGL-2450 needed per-COLLECTION versioning: there the conflicting
 * write was a new reservation row the first transaction never read. A stock
 * hold is different in kind — every contending checkout reads and writes the
 * SAME product document — so a document version is exactly the thing that
 * moves.
 *
 * `parkOnRead` is the interleaving hook, and it is keyed on the PATH that was
 * read rather than "the first transaction". A checkout runs several
 * transactions (the idempotency claim, the stock hold, the promotion slot), and
 * parking whichever happened to go first would be an interleaving that drifts
 * the moment a handler grows another one. Keying on `products/` parks the
 * transaction under test, in the window under test.
 *
 * The fake also models two Firestore behaviours the fix DEPENDS on:
 *   - `set(…, { merge: true })` merges nested MAPS rather than replacing them,
 *     so a locally pruned `stockHolds` object does NOT remove a key;
 *   - `FieldValue.delete()` inside such a map is what actually removes one.
 *
 * ## Stripe
 *
 * `global.fetch` is replaced and THROWS on any target that is not
 * `api.stripe.com`, because localhost carries the LIVE secret key. No test here
 * reaches a real Stripe call — every response is a local double, and the
 * refusals under test happen before the first call is made at all.
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

/** Firestore's merge semantics, which are DEEP for plain maps. */
function mergeInto(
  target: Record<string, any>,
  patch: Record<string, any>,
): Record<string, any> {
  const next = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    if (value === DELETE) {
      delete next[key]
    } else if (
      value &&
      typeof value === 'object' &&
      value.__increment != null
    ) {
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
    orderBy: () => ref,
  }
  return ref
}

/**
 * Parked between read and commit, to force the interleaving. Keyed on a path
 * fragment so it fires for the transaction under test and not for whichever
 * one a handler happens to run first.
 */
let parkOnRead: { match: string; run: () => Promise<void> } | null = null
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
      /**
       * Set only by `delete()`, which is how a hold RELEASE is distinguished
       * from a hold write of `{}`. Optional because the other three recorders
       * never set it, and a required field would force every one of them to
       * push a falsy flag that means nothing to them.
       */
      remove?: boolean
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
      delete: (ref: any) => {
        writes.push({ path: ref.path, value: {}, merge: false, remove: true })
      },
    }
    const result = await body(transaction)
    // The hook fires ONCE, and only for a transaction that actually read the
    // document class under test — a retry is never parked behind itself.
    if (
      parkOnRead &&
      attempt === 0 &&
      [...readVersions.keys()].some((path) =>
        path.includes((parkOnRead as any).match),
      )
    ) {
      const hook = parkOnRead.run
      parkOnRead = null
      await hook()
    }
    const stale = [...readVersions.entries()].some(
      ([path, version]) => (versions.get(path) ?? 0) !== version,
    )
    if (stale) {
      abortedRetries++
      continue
    }
    for (const write of writes) {
      if ((write as any).remove) {
        docs.delete(write.path)
        bump(write.path)
      } else {
        writeDoc(write.path, write.value, write.merge)
      }
    }
    return result
  }
  const error: any = new Error('ABORTED: too much contention')
  error.code = 10
  throw error
}

const fakeFirestore: any = {
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
          delete: () => DELETE,
          increment: (value: number) => ({ __increment: value }),
          arrayUnion: (value: any) => ({ __arrayUnion: value }),
        },
      },
    },
    getOrgForHost: async () => mockOrg,
    findUserByUidAcrossPools: async () => null,
    meterHostEmail: async () => undefined,
    notifyHostManagers: async (hostId: string, notice: any) => {
      managerNotices.push({ hostId, ...notice })
    },
    upsertHostContact: async () => undefined,
    renderHostEmailWithTokens: async () => null,
  }
})

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  sendEmail: async () => undefined,
}))

// ---------------------------------------------------------------------------
// Stripe boundary — doubles only, never a live call
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

async function postBuyNow(key: string, body: Record<string, unknown> = {}) {
  const { res, result } = makeResponse()
  const request = {
    method: 'POST',
    query: {},
    body: { hostId: 'host-1', productId: 'product-1', ...body },
    headers: { host: 'acme.aglyn.app', 'idempotency-key': key },
    cookies: {},
    socket: {},
  } as unknown as PluginApiRequest
  await checkoutHandler(request, res)
  return result
}

async function deliver(type: string, object: any) {
  await commerceBillingWebhookHandler({
    type,
    object,
    requestHost: 'acme.aglyn.app',
  } as any)
}

const product = () => (docs.get('hosts/host-1/products/product-1') ?? {}) as any
const holdsOf = (row: any) => (row.stockHolds ?? {}) as Record<string, any>
const holdCount = (row: any) => Object.keys(holdsOf(row)).length
const inventoryOf = (row: any) => row.variants?.[0]?.inventory
const indexDocs = () =>
  [...docs.keys()].filter((path) => path.includes('/stockHolds/'))

beforeAll(() => {
  ;(global as any).fetch = fetchMock
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
})

beforeEach(() => {
  docs.clear()
  versions.clear()
  stripeCalls.length = 0
  managerNotices.length = 0
  autoIdCounter = 0
  stripeObjectCounter = 0
  abortedRetries = 0
  parkOnRead = null
  fetchMock.mockClear()

  for (const cartId of ['cart-a', 'cart-b']) {
    docs.set(`hosts/host-1/carts/${cartId}`, {
      lines: [{ productId: 'product-1', variantId: 'oak', quantity: 1 }],
    })
  }
  // ONE unit on the shelf, `deny` policy, and every figure distinct ($83, one
  // unit, one variant id that is not `default`) so an assertion that lands on
  // the right number cannot have reached for the nearest one.
  docs.set('hosts/host-1/products/product-1', {
    name: 'Walnut desk',
    type: 'physical',
    status: 'active',
    oversellPolicy: 'deny',
    inventory: 1,
    variants: [{ id: 'oak', priceUsd: 83, inventory: 1 }],
  })
  docs.set('hosts/host-1', { memberRoles: {} })
  docs.set('hosts/host-1/settings/store', { tax: { mode: 'none' } })
  docs.set('profiles/owner-1', {
    stripeAccountId: 'acct_live_merchant',
    stripeChargesEnabled: true,
  })
})

// ---------------------------------------------------------------------------

describe('the last unit — cart checkout (AGL-2356)', () => {
  it('holds the unit at checkout without moving the shelf count', async () => {
    const result = await postCart('cart-a', 'attempt-a')
    expect(result.status).toBe(200)
    // The SHELF is untouched: the unit is HELD, not sold, until the webhook
    // decrements. Moving `inventory` here would make the low-stock alert, the
    // restock queue and the console all wrong for the length of a checkout.
    expect(inventoryOf(product())).toBe(1)
    expect(holdCount(product())).toBe(1)
    expect(CommerceModel.heldVariantUnits(product(), 'oak', Date.now())).toBe(1)
    // Availability is what actually moved.
    expect(
      CommerceModel.availableVariantUnits(product(), 'oak', Date.now()),
    ).toBe(0)
    // The session carries the key the webhook releases against.
    const key = sessionCalls()[0].params.get('metadata[stockHoldKey]')
    expect(key).toBeTruthy()
    expect(holdsOf(product())[key as string]).toBeTruthy()
  })

  it('refuses the second CONCURRENT checkout instead of overselling', async () => {
    // Seeded rather than left undefined, so a handler that never reaches the
    // transaction fails on the STATUS rather than on a missing property.
    let second: any = { status: 0, body: {} }
    // Park the first checkout between its read of the PRODUCT and its commit,
    // and run the second one to completion inside that window. This is the
    // worst-case ordering and the one the defect needed.
    parkOnRead = {
      match: '/products/',
      run: async () => {
        second = await postCart('cart-b', 'attempt-b')
      },
    }
    const first = await postCart('cart-a', 'attempt-a')

    // Exactly one of the two may have the unit. WHICH one is deliberately not
    // asserted: the parked transaction is the one that re-runs, so the loser is
    // whichever commits second, and pinning it would test the fake's scheduling
    // rather than the guard.
    const both = [first, second]
    expect(both.map((result) => result.status).sort()).toEqual([200, 409])
    expect(both.find((result) => result.status === 409).body.error).toContain(
      CommerceModel.STOCK_HELD_MESSAGE,
    )
    // Exactly ONE session was minted. The other shopper never reached Stripe,
    // so no money can move against a unit that is not there.
    expect(sessionCalls()).toHaveLength(1)
    expect(holdCount(product())).toBe(1)
    expect(inventoryOf(product())).toBe(1)
    // The contention was REAL, not an artefact of the fake running them
    // sequentially: the parked transaction saw its read go stale and re-ran.
    expect(abortedRetries).toBeGreaterThan(0)
  })

  /**
   * The guard forced red from the other direction: with the hold stripped off
   * the product, the second checkout is admitted again and one unit is sold
   * twice. This is the pre-fix behaviour, reproduced deliberately so the
   * assertion above is known to be load-bearing rather than incidentally true.
   */
  it('would sell the same unit twice if the hold were not there (forced red)', async () => {
    const first = await postCart('cart-a', 'attempt-a')
    expect(first.status).toBe(200)
    expect(holdCount(product())).toBe(1)

    // Strip the reservation, leaving the shelf exactly as the defect left it:
    // one unit, already promised to somebody, and nothing recording that.
    docs.set('hosts/host-1/products/product-1', {
      name: 'Walnut desk',
      type: 'physical',
      status: 'active',
      oversellPolicy: 'deny',
      inventory: 1,
      variants: [{ id: 'oak', priceUsd: 83, inventory: 1 }],
    })

    const second = await postCart('cart-b', 'attempt-b')
    expect(second.status).toBe(200)
    // Two paid-capable sessions against one unit: the oversell the hold stops.
    expect(sessionCalls()).toHaveLength(2)
  })

  it('refuses a fresh checkout once the shelf is empty, not merely held', async () => {
    docs.set('hosts/host-1/products/product-1', {
      name: 'Walnut desk',
      type: 'physical',
      status: 'active',
      oversellPolicy: 'deny',
      inventory: 0,
      variants: [{ id: 'oak', priceUsd: 83, inventory: 0 }],
    })
    const result = await postCart('cart-a', 'attempt-a')
    expect(result.status).toBe(409)
    expect(sessionCalls()).toHaveLength(0)
  })

  /**
   * NOT driven through the handler, and that is the finding.
   *
   * The obvious version of this test — post the same cart under the same
   * idempotency key twice and assert the second is admitted — passes with the
   * exclusion REMOVED, because the second post never reaches the hold at all:
   * `claimAttempt` recognises the key and replays the recorded response. It is
   * a green check that reads as coverage of `exceptHoldKey` and covers
   * nothing. Verified by mutation, not by inspection.
   *
   * The window the exclusion actually exists for is a retry that does NOT
   * replay — the first attempt took the hold and then failed before
   * `claim.record`, and its release did not land. The attempt re-derives the
   * same `stripeKey`, so it meets its own reservation. That is the helper's
   * contract and it is tested at the helper.
   */
  it('lets ONE attempt re-claim the units it is already holding', async () => {
    const hostRef = fakeFirestore.collection('hosts').doc('host-1')
    const lines = [{ productId: 'product-1', variantId: 'oak', quantity: 1 }]
    const first = await holdStock({
      firestore: fakeFirestore,
      hostRef,
      holdKey: 'attempt-key',
      lines,
      label: 'test',
    })
    expect(first.ok).toBe(true)
    // The same attempt again: one shopper pressing one button twice.
    const again = await holdStock({
      firestore: fakeFirestore,
      hostRef,
      holdKey: 'attempt-key',
      lines,
      label: 'test',
    })
    expect(again.ok).toBe(true)
    expect(holdCount(product())).toBe(1)
    // A DIFFERENT attempt is a different shopper, and is refused — which is
    // what proves the line above is an exclusion and not a missing check.
    const other = await holdStock({
      firestore: fakeFirestore,
      hostRef,
      holdKey: 'another-attempt',
      lines,
      label: 'test',
    })
    expect(other.ok).toBe(false)
    expect((other as any).reason).toBe('sold-out')
    expect(holdCount(product())).toBe(1)
  })

  it('shrinks the reservation when the attempt retries with a smaller cart', async () => {
    const hostRef = fakeFirestore.collection('hosts').doc('host-1')
    docs.set('hosts/host-1/products/product-1', {
      name: 'Walnut desk',
      type: 'physical',
      status: 'active',
      oversellPolicy: 'deny',
      inventory: 5,
      variants: [{ id: 'oak', priceUsd: 83, inventory: 5 }],
    })
    await holdStock({
      firestore: fakeFirestore,
      hostRef,
      holdKey: 'attempt-key',
      lines: [{ productId: 'product-1', variantId: 'oak', quantity: 4 }],
      label: 'test',
    })
    await holdStock({
      firestore: fakeFirestore,
      hostRef,
      holdKey: 'attempt-key',
      lines: [{ productId: 'product-1', variantId: 'oak', quantity: 1 }],
      label: 'test',
    })
    // A whole-object write for this key, never a nested merge: a deep merge of
    // `units` would keep reserving the three units the shopper dropped.
    expect(CommerceModel.heldVariantUnits(product(), 'oak', Date.now())).toBe(1)
  })

  it('counts a LAPSED hold as released without anybody writing anything', async () => {
    // A hold whose expiry has passed. Nothing swept it; nothing had to.
    docs.set('hosts/host-1/products/product-1', {
      name: 'Walnut desk',
      type: 'physical',
      status: 'active',
      oversellPolicy: 'deny',
      inventory: 1,
      variants: [{ id: 'oak', priceUsd: 83, inventory: 1 }],
      stockHolds: {
        'ghost-key': { expiresAtMs: Date.now() - 1_000, units: { oak: 1 } },
      },
    })
    const result = await postCart('cart-a', 'attempt-a')
    expect(result.status).toBe(200)
    // And the dead key is SWEPT by sentinel, so the document does not grow one
    // entry per abandoned checkout forever.
    expect(Object.keys(holdsOf(product()))).not.toContain('ghost-key')
    expect(holdCount(product())).toBe(1)
  })

  it('treats a CORRUPT hold as expired rather than eternal', async () => {
    docs.set('hosts/host-1/products/product-1', {
      name: 'Walnut desk',
      type: 'physical',
      status: 'active',
      oversellPolicy: 'deny',
      inventory: 1,
      variants: [{ id: 'oak', priceUsd: 83, inventory: 1 }],
      // No `expiresAtMs` at all. Stranding the unit forever on one malformed
      // map entry is the single direction with no recovery inside the product.
      stockHolds: { 'broken-key': { units: { oak: 1 } } },
    })
    const result = await postCart('cart-a', 'attempt-a')
    expect(result.status).toBe(200)
  })

  it('reserves NOTHING for an untracked variant, and writes no map', async () => {
    docs.set('hosts/host-1/products/product-1', {
      name: 'Walnut desk',
      type: 'physical',
      status: 'active',
      variants: [{ id: 'oak', priceUsd: 83, inventory: null }],
    })
    const result = await postCart('cart-a', 'attempt-a')
    expect(result.status).toBe(200)
    expect(product().stockHolds).toBeUndefined()
    // No key on the session either, so the webhook has nothing to release.
    expect(sessionCalls()[0].params.get('metadata[stockHoldKey]')).toBeNull()
    expect(indexDocs()).toHaveLength(0)
  })

  it('reserves NOTHING on a backorder product, whose merchant chose to sell past zero', async () => {
    docs.set('hosts/host-1/products/product-1', {
      name: 'Walnut desk',
      type: 'physical',
      status: 'active',
      oversellPolicy: 'backorder',
      inventory: 1,
      variants: [{ id: 'oak', priceUsd: 83, inventory: 1 }],
    })
    const first = await postCart('cart-a', 'attempt-a')
    const second = await postCart('cart-b', 'attempt-b')
    expect([first.status, second.status]).toEqual([200, 200])
    expect(product().stockHolds).toBeUndefined()
  })

  it('sends a session that expires inside the hold, never Stripe’s 24-hour default', async () => {
    await postCart('cart-a', 'attempt-a')
    const expiresAt = Number(sessionCalls()[0].params.get('expires_at')) * 1000
    // Stripe REFUSES anything under 30 minutes out, and a hold that lapsed
    // while its session was still payable would reopen the whole window.
    expect(expiresAt - Date.now()).toBeGreaterThan(30 * 60 * 1000)
    expect(expiresAt).toBeLessThan(Date.now() + CommerceModel.STOCK_HOLD_TTL_MS)
  })
})

describe('the last unit — buy now (AGL-2356)', () => {
  it('refuses the second CONCURRENT buy-now instead of overselling', async () => {
    let second: any = { status: 0, body: {} }
    parkOnRead = {
      match: '/products/',
      run: async () => {
        second = await postBuyNow('attempt-b', { variantId: 'oak' })
      },
    }
    const first = await postBuyNow('attempt-a', { variantId: 'oak' })
    const both = [first, second]
    expect(both.map((result) => result.status).sort()).toEqual([200, 409])
    expect(both.find((result) => result.status === 409).body.error).toBe(
      CommerceModel.STOCK_HELD_MESSAGE,
    )
    expect(sessionCalls()).toHaveLength(1)
    expect(holdCount(product())).toBe(1)
    expect(abortedRetries).toBeGreaterThan(0)
  })

  it('holds the FULL quantity, not one unit', async () => {
    docs.set('hosts/host-1/products/product-1', {
      name: 'Walnut desk',
      type: 'physical',
      status: 'active',
      oversellPolicy: 'deny',
      inventory: 5,
      variants: [{ id: 'oak', priceUsd: 83, inventory: 5 }],
    })
    const result = await postBuyNow('attempt-a', {
      variantId: 'oak',
      quantity: 4,
    })
    expect(result.status).toBe(200)
    expect(CommerceModel.heldVariantUnits(product(), 'oak', Date.now())).toBe(4)
    // One unit left, so a two-unit shopper is refused and a one-unit shopper
    // is not — the arithmetic, not just the presence of a hold.
    const greedy = await postBuyNow('attempt-b', {
      variantId: 'oak',
      quantity: 2,
    })
    expect(greedy.status).toBe(409)
    const modest = await postBuyNow('attempt-c', {
      variantId: 'oak',
      quantity: 1,
    })
    expect(modest.status).toBe(200)
  })
})

/**
 * The line that fails must be one the PRE-FILTER lets through, or this proves
 * nothing.
 *
 * `cart-checkout.ts` still runs `canPurchase` per line while it re-prices, and
 * an empty shelf is refused there — above the claim, above the hold, with the
 * transaction never entered. Seeding the second product at `inventory: 0` was
 * the obvious way to write this test and it passed with the atomicity removed,
 * because the handler never got that far. Verified by mutation.
 *
 * So the second product has stock the SHELF can cover and a live reservation
 * already spoken for it: `canPurchase` says yes, `canReserveStock` says no, and
 * the refusal happens where atomicity is the only thing that can save the first
 * product from being left holding a unit for a basket nobody bought.
 */
describe('a cart of several products reserves all of them or none (AGL-2356)', () => {
  beforeEach(() => {
    docs.set('hosts/host-1/products/product-2', {
      name: 'Oak stool',
      type: 'physical',
      status: 'active',
      oversellPolicy: 'deny',
      inventory: 1,
      variants: [{ id: 'ash', priceUsd: 41, inventory: 1 }],
      stockHolds: {
        'someone-elses-checkout': {
          expiresAtMs: Date.now() + 20 * 60 * 1000,
          units: { ash: 1 },
        },
      },
    })
    docs.set('hosts/host-1/carts/cart-a', {
      lines: [
        { productId: 'product-1', variantId: 'oak', quantity: 1 },
        { productId: 'product-2', variantId: 'ash', quantity: 1 },
      ],
    })
  })

  it('reaches the hold at all — the shelf alone would have admitted this cart', () => {
    const stool = docs.get('hosts/host-1/products/product-2') as any
    expect(CommerceModel.canPurchase(stool, 'ash', 1)).toBe(true)
    expect(CommerceModel.canReserveStock(stool, 'ash', 1, Date.now())).toBe(
      false,
    )
  })

  it('leaves NO reservation on the product it could fill when another line cannot be filled', async () => {
    const result = await postCart('cart-a', 'attempt-a')
    expect(result.status).toBe(409)
    // The available product must not be left holding a unit for a basket that
    // was refused — a partial reservation is this issue's own defect arriving
    // through its fix.
    expect(product().stockHolds).toBeUndefined()
    expect(sessionCalls()).toHaveLength(0)
  })

  it('reserves BOTH products when both can be filled', async () => {
    docs.set('hosts/host-1/products/product-2', {
      name: 'Oak stool',
      type: 'physical',
      status: 'active',
      oversellPolicy: 'deny',
      inventory: 1,
      variants: [{ id: 'ash', priceUsd: 41, inventory: 1 }],
    })
    const result = await postCart('cart-a', 'attempt-a')
    expect(result.status).toBe(200)
    const key = sessionCalls()[0].params.get('metadata[stockHoldKey]') as string
    expect(holdsOf(product())[key]).toBeTruthy()
    expect(
      holdsOf(docs.get('hosts/host-1/products/product-2') as any)[key],
    ).toBeTruthy()
    // One index doc naming both, so ONE key releases the whole basket.
    expect(indexDocs()).toHaveLength(1)
    expect((docs.get(indexDocs()[0]) as any).productIds.sort()).toEqual([
      'product-1',
      'product-2',
    ])
  })
})

describe('the hold comes back (AGL-2356)', () => {
  it('releases on checkout.session.expired', async () => {
    await postCart('cart-a', 'attempt-a')
    const key = sessionCalls()[0].params.get('metadata[stockHoldKey]') as string
    expect(holdCount(product())).toBe(1)

    await deliver('checkout.session.expired', {
      id: 'cs_1',
      metadata: { hostId: 'host-1', stockHoldKey: key },
    })
    expect(holdCount(product())).toBe(0)
    // And the release index goes with it, so nothing is left naming a hold
    // that no longer exists.
    expect(indexDocs()).toHaveLength(0)
    // The unit is buyable again.
    const next = await postCart('cart-b', 'attempt-b')
    expect(next.status).toBe(200)
  })

  it('releases when the sale SETTLES, and the shelf moves exactly once', async () => {
    await postCart('cart-a', 'attempt-a')
    const key = sessionCalls()[0].params.get('metadata[stockHoldKey]') as string

    await deliver('checkout.session.completed', {
      id: 'cs_paid_1',
      payment_status: 'paid',
      payment_intent: 'pi_1',
      amount_total: 8300,
      customer_details: { email: 'buyer@example.com', name: 'Ada' },
      total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 0 },
      metadata: {
        type: 'commerce-cart',
        hostId: 'host-1',
        cartId: 'cart-a',
        feeCents: '166',
        stockHoldKey: key,
      },
    })
    // The count moved ONCE — the hold never decremented anything, and the
    // settlement is the same single atomic decrement it was before this issue.
    expect(inventoryOf(product())).toBe(0)
    expect(holdCount(product())).toBe(0)
    expect(indexDocs()).toHaveLength(0)
  })

  it('still decrements a paid order whose hold has already lapsed', async () => {
    // A session paid after its reservation expired. The hold refuses the SECOND
    // shopper; it must never gate the FIRST one's goods.
    await deliver('checkout.session.completed', {
      id: 'cs_paid_2',
      payment_status: 'paid',
      payment_intent: 'pi_2',
      amount_total: 8300,
      customer_details: { email: 'buyer@example.com', name: 'Ada' },
      total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 0 },
      metadata: {
        type: 'commerce-cart',
        hostId: 'host-1',
        cartId: 'cart-a',
        feeCents: '166',
        stockHoldKey: 'a-key-nobody-holds',
      },
    })
    expect(inventoryOf(product())).toBe(0)
  })

  it('releases in the checkout handler when a refusal below the claim fires', async () => {
    // An undecided tax setting refuses BELOW the hold, which is exactly the
    // shape that would otherwise strand a unit until the TTL.
    docs.set('hosts/host-1/settings/store', {})
    const result = await postCart('cart-a', 'attempt-a')
    expect(result.status).toBe(409)
    expect(product().stockHolds).toEqual({})
    expect(indexDocs()).toHaveLength(0)
  })
})
