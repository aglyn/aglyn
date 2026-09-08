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
import { checkoutHandler } from './checkout'

/**
 * A STOREFRONT SUBSCRIPTION CARRIES THE CARD COST AS A PERCENT (AGL-2655).
 *
 * AGL-2152 made every one-time storefront charge recover Stripe's processing
 * cost inside `application_fee_amount` and deliberately left the recurring
 * path alone: a Stripe Subscription accepts only `application_fee_percent`,
 * which cannot carry a fixed 30¢ as cents. So a membership sold on a 0% tier
 * went out with no fee parameter at all, and Aglyn paid Stripe's cost on
 * every cycle out of its own balance.
 *
 * The 30¢ is now folded into the rate — `(rate × amount + fixed) ÷ amount`,
 * rounded UP to two decimals, on top of the plan's own percent — and this
 * file asserts it AT THE STRIPE BOUNDARY: the form body the handler posts to
 * `/v1/checkout/sessions`. The arithmetic itself is proved beside the
 * resolver in `subscription-processing-pass-through.spec.ts`; this one
 * proves the figure ARRIVES.
 *
 * Stripe is mocked absolutely, as in `checkout-platform-margin.spec.ts`:
 * localhost carries the LIVE secret key, so nothing here may reach
 * api.stripe.com.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()

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

/**
 * Buffered writes applied at commit, and nothing else — the handler's stock
 * hold runs in a transaction, so a double without one fails before it reaches
 * anything this file is about. Contention is modelled elsewhere.
 */
async function runTransaction(
  body: (transaction: any) => Promise<any>,
): Promise<any> {
  const writes: Array<[string, Record<string, any>, boolean]> = []
  const transaction = {
    get: async (ref: any) => makeSnapshot(ref.path),
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
      writeDoc(path, value, Boolean(options?.merge))
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  return {
    doc: (id: string) => makeDocRef(`${path}/${id}`),
    limit: () => makeCollectionRef(path),
    get: async () => ({ docs: [] as unknown[] }),
  }
}

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
  runTransaction,
}

/**
 * Reassigned per scenario: the PLAN decides the fee, and the point of this
 * file is that a 0% tier and a fee tier both come out carrying the
 * pass-through, by different arithmetic.
 */
const mockOrg: any = {
  org: {
    id: 'org-1',
    plan: 'advanced',
    subscriptionStatus: 'active',
    ownerUid: 'owner-1',
    slug: 'acme',
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
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
// Stripe boundary — captured, never reached
// ---------------------------------------------------------------------------

let sessionBody: URLSearchParams | null = null

const fetchMock = jest.fn(async (url: any, init: any): Promise<any> => {
  const target = String(url)
  if (!target.startsWith('https://api.stripe.com')) {
    throw new Error(`Unexpected fetch to ${target}`)
  }
  if (target.endsWith('/v1/checkout/sessions')) {
    sessionBody = new URLSearchParams(String(init?.body ?? ''))
    return {
      ok: true,
      json: async () => ({
        id: 'cs_test_1',
        url: 'https://checkout.stripe.com/pay/cs_test_1',
      }),
    }
  }
  throw new Error(`Unexpected Stripe endpoint ${target}`)
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

interface Scenario {
  /** The seller's plan. Decides `transactionFeeDigitalPct`. */
  plan: string
  /** Recurring price in whole dollars. */
  priceUsd: number
}

/** Seeds a host selling one digital monthly membership at `priceUsd`. */
async function runCheckout(scenario: Scenario) {
  mockOrg.org.plan = scenario.plan
  docs.clear()
  docs.set('hosts/host-1', { name: 'Acme' })
  docs.set('profiles/owner-1', {
    stripeAccountId: 'acct_1',
    stripeChargesEnabled: true,
  })
  docs.set('hosts/host-1/products/p1', {
    name: 'Members-only zine',
    status: 'active',
    type: 'digital',
    subscription: { interval: 'month' },
    variants: [{ id: 'v1', priceUsd: scenario.priceUsd, inventory: null }],
  })
  // A store that decided not to collect tax (AGL-1999); nothing here is
  // about tax, and an undecided store refuses the sale before the fee.
  docs.set('hosts/host-1/settings/store', { tax: { mode: 'none' } })
  sessionBody = null
  const { res, result } = makeResponse()
  const req = {
    method: 'POST',
    body: { hostId: 'host-1', productId: 'p1', variantId: 'v1', quantity: 1 },
    cookies: {},
    headers: { host: 'shop.example.com' },
    query: {},
  } as unknown as PluginApiRequest
  await checkoutHandler(req, res)
  return { result, body: sessionBody as URLSearchParams | null }
}

describe('a storefront subscription carries the card cost as a percent (AGL-2655)', () => {
  const realFetch = global.fetch
  const realKey = process.env.STRIPE_SECRET_KEY

  beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_never_used'
  })

  afterAll(() => {
    global.fetch = realFetch
    process.env.STRIPE_SECRET_KEY = realKey as string
    mockOrg.org.plan = 'advanced'
  })

  beforeEach(() => {
    fetchMock.mockClear()
  })

  /**
   * THE ISSUE ITSELF. Advanced advertises 0% on digital goods, and before
   * this the session went out with no fee parameter at all. The pass-through
   * at 6% + 30¢ is 9% of $10, 7.2% of $25 and 6.3% of $100 — the 30¢ is a
   * bigger share of a smaller price.
   */
  it.each([
    [10, '9'],
    [25, '7.2'],
    [100, '6.3'],
  ])('a 0% tier at $%i carries exactly the pass-through, %s%%', async (priceUsd, percent) => {
    const { result, body } = await runCheckout({ plan: 'advanced', priceUsd })
    expect(result.status).toBe(200)
    expect(body?.get('mode')).toBe('subscription')
    expect(body?.get('line_items[0][price_data][unit_amount]')).toBe(
      String(priceUsd * 100),
    )
    expect(body?.get('subscription_data[application_fee_percent]')).toBe(percent)
    // A subscription session has no cents fee to send instead.
    expect(body?.has('payment_intent_data[application_fee_amount]')).toBe(false)
  })

  /**
   * THE RULE MIRRORED FROM AGL-2152: a fee tier carries its take PLUS the
   * pass-through. Business digital is 2%, so $100 goes out at 8.3% and the
   * recorded `feeCents` is what that percent takes of the opening goods.
   */
  it('a fee tier carries its take plus the pass-through', async () => {
    const { result, body } = await runCheckout({ plan: 'business', priceUsd: 100 })
    expect(result.status).toBe(200)
    expect(body?.get('subscription_data[application_fee_percent]')).toBe('8.3')
    expect(body?.get('metadata[feeCents]')).toBe('830')
  })

  it('the 0% tier records what the pass-through takes of the opening cycle', async () => {
    const { body } = await runCheckout({ plan: 'advanced', priceUsd: 25 })
    // 7.2% of $25 is $1.80 — the figure `metadata[feeCents]` records as kept.
    expect(body?.get('metadata[feeCents]')).toBe('180')
  })
})
