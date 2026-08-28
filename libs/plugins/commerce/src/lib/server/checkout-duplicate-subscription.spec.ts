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
import { checkoutHandler } from './checkout'
import { memberCookieName, mintMemberSession } from './membership'

/**
 * Storefront duplicate-subscription guard (AGL-1849).
 *
 * ## The defect
 *
 * The AGL-1697 idempotency key closes the RETRY shape — one attempt, one key,
 * one subscription. It does nothing about a deliberate second submit under a
 * FRESH key, and `product-detail.tsx` mints a new UUID on every variant /
 * quantity / billing change. Two completed `mode: subscription` sessions for
 * one product and one buyer are two RECURRING charges that bill forever.
 *
 * ## The premise this file overturns
 *
 * The issue filed the guard as impossible: the buy-now path is anonymous, so
 * there is no buyer to ask about. The path ADMITS anonymous buyers, but it is
 * not only anonymous — a signed-in member's `aglyn_member_{hostId}` cookie is
 * already delivered on this request, and the handler never read it. These
 * tests hold both halves of that: a signed-in member is refused, a logged-out
 * one is still served, and the second fact is a stated limit rather than a
 * bug.
 *
 * The cookie is minted with the real `mintMemberSession`, not hand-rolled —
 * an unfaithful token would prove the guard works against a fake it cannot
 * meet in production. The HMAC secret falls back to a per-boot random, so
 * minting and reading in one process verifies without env setup.
 *
 * `global.fetch` is replaced for the whole file: nothing here may reach
 * api.stripe.com, localhost carries the LIVE secret key. Firestore is an
 * in-memory map so the tests COUNT the sessions that were actually minted.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
let autoIdCounter = 0

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
 * `where(...).limit(n).get()`, equality only — the shape borrowed from the
 * marketplace duplicate-purchase spec. The four existing `checkout*.spec.ts`
 * fakes have no `where()` at all, which is why this guard needed a new file
 * rather than a case bolted onto one of them.
 */
function makeQuery(path: string, filters: Array<[string, unknown]>): any {
  const run = (cap: number) => ({
    docs: childPaths(path)
      .map(makeSnapshot)
      .filter((snapshot) =>
        filters.every(([field, value]) => snapshot.get(field) === value),
      )
      .slice(0, cap),
  })
  return {
    where: (field: string, _op: string, value: unknown) =>
      makeQuery(path, [...filters, [field, value]]),
    limit: (n: number) => ({ get: async () => run(n) }),
    get: async () => run(Infinity),
  }
}

function makeCollectionRef(path: string): any {
  return {
    doc: (id?: string) =>
      makeDocRef(`${path}/${id ?? `auto-${++autoIdCounter}`}`),
    // Chainable, so the host-level discounts read resolves through the same
    // `get()` below rather than throwing on a missing method.
    limit: () => makeCollectionRef(path),
    get: async () => ({ docs: childPaths(path).map(makeSnapshot) }),
    where: (field: string, op: string, value: unknown) =>
      makeQuery(path, []).where(field, op, value),
  }
}

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
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
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
  },
  getOrgForHost: async () => mockOrg,
}))

// ---------------------------------------------------------------------------
// Stripe boundary — counted, never reached
// ---------------------------------------------------------------------------

const stripeCalls: Array<{ url: string; params: URLSearchParams }> = []
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
  return {
    ok: true,
    json: async () => ({
      id: `cs_${++stripeObjectCounter}`,
      url: `https://checkout.stripe.com/pay/session-${stripeObjectCounter}`,
    }),
  }
})

// ---------------------------------------------------------------------------
// Request / response plumbing
// ---------------------------------------------------------------------------

const HOST_ID = 'host-1'
const MEMBER_ID = 'member-1'
const MEMBER_EMAIL = 'buyer@example.com'

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

/** A cookie jar carrying a REAL signed member session. */
function memberCookies(memberId: string = MEMBER_ID) {
  return {
    [memberCookieName(HOST_ID)]: mintMemberSession(HOST_ID, memberId),
  }
}

async function post(
  body: Record<string, unknown> = {},
  cookies: Record<string, string> = {},
) {
  const { res, result } = makeResponse()
  const request = {
    method: 'POST',
    query: {},
    body: {
      hostId: HOST_ID,
      productId: 'product-1',
      quantity: 1,
      billing: 'subscribe',
      ...body,
    },
    headers: {
      host: 'acme.aglyn.app',
      'idempotency-key': `attempt-${Math.random().toString(36).slice(2)}`,
    },
    cookies,
    socket: {},
  } as unknown as PluginApiRequest
  await checkoutHandler(request, res)
  return result
}

/** Seed a tenant-side subscription row as `billing-webhook.ts` writes it. */
function seedSubscription(
  status: string,
  { productId = 'product-1', email = MEMBER_EMAIL } = {},
) {
  docs.set(`hosts/${HOST_ID}/subscriptions/sub_${status}_${productId}`, {
    productId,
    customerEmail: email,
    status,
    checkoutSessionId: 'cs_previous',
  })
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
})

beforeEach(() => {
  docs.clear()
  stripeCalls.length = 0
  autoIdCounter = 0
  stripeObjectCounter = 0
  fetchMock.mockClear()

  docs.set(`hosts/${HOST_ID}`, {})
  docs.set(`hosts/${HOST_ID}/products/product-1`, {
    name: 'Coffee club',
    type: 'digital',
    status: 'active',
    subscription: { interval: 'month' },
    variants: [{ id: 'default', priceUsd: 20, inventory: null }],
  })
  docs.set(`hosts/${HOST_ID}/settings/store`, { tax: { mode: 'none' } })
  docs.set('profiles/owner-1', {
    stripeAccountId: 'acct_live_merchant',
    stripeChargesEnabled: true,
  })
  docs.set(`hosts/${HOST_ID}/siteMembers/${MEMBER_ID}`, {
    email: MEMBER_EMAIL,
  })
})

// ---------------------------------------------------------------------------

describe('a signed-in member cannot double-subscribe (AGL-1849)', () => {
  it('refuses a second subscription to a product they already subscribe to', async () => {
    seedSubscription('active')

    const result = await post({}, memberCookies())

    expect(result.status).toBe(409)
    expect(result.body.code).toBe('already_subscribed')
    // The refusal happened BEFORE Stripe — no session was minted, so there is
    // nothing for the buyer to pay and nothing to reconcile away later.
    expect(sessionCalls()).toHaveLength(0)
  })

  /**
   * THE FIRST DIRECTION THE GUARD MUST FAIL IN.
   *
   * A guard that refused on the mere EXISTENCE of a subscription row would
   * pass the test above and still be broken: a member who cancelled could
   * never buy again, which turns a duplicate guard into a permanent lockout
   * of a returning customer. This is the AGL-1715 lesson on the tenant side,
   * so both dead statuses are asserted rather than one.
   */
  it.each(['canceled', 'incomplete_expired'])(
    'lets a member re-subscribe after %s',
    async (status) => {
      seedSubscription(status)

      const result = await post({}, memberCookies())

      expect(result.status).toBe(200)
      expect(result.body.url).toContain('checkout.stripe.com')
      expect(sessionCalls()).toHaveLength(1)
    },
  )

  /**
   * THE SECOND DIRECTION. `past_due` is dunning, not death — Stripe is still
   * retrying the card and the member still has the subscription. Letting them
   * buy a second one because the first is mid-retry is the duplicate this
   * guard exists to refuse, so dropping `past_due` from the live list must
   * fail here.
   */
  it('refuses while the existing subscription is past_due', async () => {
    seedSubscription('past_due')

    const result = await post({}, memberCookies())

    expect(result.status).toBe(409)
    expect(sessionCalls()).toHaveLength(0)
  })

  it('refuses while the existing subscription is trialing', async () => {
    seedSubscription('trialing')

    const result = await post({}, memberCookies())

    expect(result.status).toBe(409)
    expect(sessionCalls()).toHaveLength(0)
  })

  /**
   * SCOPING, both axes. A guard keyed too loosely would refuse a member who
   * subscribes to a DIFFERENT product, or one whose namesake at another email
   * subscribes — either would block real sales, which is the failure mode a
   * merchant notices last and forgives least.
   */
  it('does not refuse a different product', async () => {
    seedSubscription('active', { productId: 'product-2' })

    const result = await post({}, memberCookies())

    expect(result.status).toBe(200)
    expect(sessionCalls()).toHaveLength(1)
  })

  it('does not refuse a different buyer with a live subscription', async () => {
    seedSubscription('active', { email: 'someone-else@example.com' })

    const result = await post({}, memberCookies())

    expect(result.status).toBe(200)
    expect(sessionCalls()).toHaveLength(1)
  })

  /**
   * A one-time purchase of the same product is not a subscription, so the
   * guard must not touch it. Without this, a store selling a product both
   * ways would refuse the one-off sale to anyone already subscribed.
   */
  it('does not refuse a ONE-TIME purchase of the same product', async () => {
    docs.set(`hosts/${HOST_ID}/products/product-1`, {
      name: 'Coffee club',
      type: 'digital',
      status: 'active',
      subscription: { interval: 'month' },
      // Top-level, as `resolveCheckoutBillingMode` reads it — nesting this
      // inside `subscription` made the fixture answer "subscription" for a
      // `billing: 'once'` request and the test failed for the wrong reason.
      subscriptionOptional: true,
      variants: [{ id: 'default', priceUsd: 20, inventory: null }],
    })
    seedSubscription('active')

    const result = await post({ billing: 'once' }, memberCookies())

    expect(result.status).toBe(200)
    expect(sessionCalls()).toHaveLength(1)
    expect(sessionCalls()[0].params.get('mode')).toBe('payment')
  })
})

describe('the guard covers exactly what identity it has (AGL-1849)', () => {
  /**
   * THE STATED LIMIT, pinned as a test so it stays a decision.
   *
   * A logged-out buyer is served even when a live subscription exists at the
   * email they will type at Stripe, because the handler cannot know that
   * email before the hosted page. This is the honest scope of the guard —
   * "a member cannot silently double-subscribe", not "nobody can" — and
   * closing it means requiring sign-in to buy, a UX change that belongs to a
   * product decision rather than to this guard.
   */
  it('still serves an anonymous buyer (no cookie, no identity)', async () => {
    seedSubscription('active')

    const result = await post({}, {})

    expect(result.status).toBe(200)
    expect(sessionCalls()).toHaveLength(1)
  })

  /**
   * A forged or stale cookie must not be trusted into a refusal OR out of
   * one. This asserts the guard leans on the real HMAC check rather than on
   * the cookie merely being present.
   */
  it('ignores a cookie that does not verify', async () => {
    seedSubscription('active')

    const result = await post(
      {},
      { [memberCookieName(HOST_ID)]: `${HOST_ID}.${MEMBER_ID}.99999999999.deadbeef` },
    )

    expect(result.status).toBe(200)
    expect(sessionCalls()).toHaveLength(1)
  })

  /**
   * A cookie for a member whose doc is gone reads as anonymous, so the guard
   * must not throw on the missing snapshot — a crash here would 500 the whole
   * checkout for a deleted member rather than selling to them as a guest.
   */
  it('treats a deleted member as anonymous rather than erroring', async () => {
    docs.delete(`hosts/${HOST_ID}/siteMembers/${MEMBER_ID}`)
    seedSubscription('active')

    const result = await post({}, memberCookies())

    expect(result.status).toBe(200)
    expect(sessionCalls()).toHaveLength(1)
  })
})
