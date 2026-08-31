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
import { storefrontProcessingCostCents } from '@aglyn/aglyn/server'
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

import { mergePluginConfig } from '@aglyn/aglyn'
import { COMMERCE_CONFIG_SCHEMA } from '../plugin-config'

/**
 * STATIC, aliased behind `mock`-prefixed names for the hoisted factory below.
 * A `require('@aglyn/aglyn')` inside the factory reads to nx as a DYNAMIC edge
 * and fails `@nx/enforce-module-boundaries` on every static import of `aglyn`
 * in the repo (AGL-2161).
 */
const mockMergePluginConfig = mergePluginConfig
const mockCommerceSchema = COMMERCE_CONFIG_SCHEMA

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

/**
 * `FieldValue.increment` as Firestore actually applies it (AGL-2111).
 *
 * The offline-fee accrual is written with `set(..., { merge: true })` carrying
 * increment sentinels, and a double that stored the sentinel object verbatim
 * would report green for a counter that never counted — and would make two
 * sales look identical to one. So the sentinel is RESOLVED here, against the
 * value already in the document, with a missing field treated as 0, which is
 * Firestore's own rule.
 *
 * `arrayUnion` is deliberately left as an opaque sentinel: the AGL-1760 folio
 * tests assert on that exact shape.
 */
function resolveIncrements(
  existing: Record<string, any> | undefined,
  value: Record<string, any>,
): Record<string, any> {
  const resolved: Record<string, any> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (raw && typeof raw === 'object' && '__increment' in raw) {
      const base = Number(existing?.[key] ?? 0)
      resolved[key] = (Number.isFinite(base) ? base : 0) + raw.__increment
    } else {
      resolved[key] = raw
    }
  }
  return resolved
}

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => makeSnapshot(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      const existing = docs.get(path)
      const applied = resolveIncrements(existing, value)
      docs.set(path, options?.merge ? { ...(existing ?? {}), ...applied } : applied)
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
    // Chainable `limit()` (AGL-305): the handler reads
    // `hosts/{id}/discounts` on every call now, and a double without it threw
    // where Firestore would simply have returned nothing.
    limit: () => makeCollectionRef(path),
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
/** Every manager notification the handler fired (AGL-1826). */
const notifications: any[] = []

const mockVerifyIdToken = jest.fn(async () => ({ uid: 'cashier-1' }))

/**
 * The org-permission resolver (AGL-2474). MOCKED, and mocked here rather than
 * left to the real one: the real module reads the org, the membership and the
 * custom role through `@aglyn/tenant-data-admin`, which this file replaces
 * with a closed-world double — so it would fail closed and 403 every test in
 * the suite for a reason that has nothing to do with what they assert.
 *
 * Defaults to GRANTED so the existing cases keep measuring what they were
 * written to measure; the `managePos` block below drives it to false.
 */
const mockResolveOrgPermissions = jest.fn(async () => ({
  orgId: 'org-1',
  role: 'admin',
  isOwner: true,
  permissions: { managePos: true } as Record<string, boolean>,
  orgWide: true,
  hostRole: 'admin',
}))
/**
 * The org's stored commerce plugin settings (AGL-2161). `undefined` is the
 * common case — no settings doc — and every test that sets it restores it in
 * a `finally`, so the register's ceiling cannot leak between suites.
 */
let mockPluginSettings: Record<string, unknown> | undefined

const mockOrg: any = {
  org: {
    id: 'org-1',
    plan: 'business',
    subscriptionStatus: 'active',
    ownerUid: 'owner-1',
    slug: 'acme',
  },
}

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  ...jest.requireActual('@aglyn/tenant-runtime/org-permissions'),
  resolveOrgPermissions: (...args: any[]) =>
    mockResolveOrgPermissions(...(args as [])),
}))

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
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: any[]) => mockVerifyIdToken(...(args as [])) }),
      firestore: () => fakeFirestore,
    }),
    firestore: {
      FieldValue: {
        serverTimestamp: () => '<server-timestamp>',
        arrayUnion: (value: any) => ({ __arrayUnion: value }),
        // Resolved by `resolveIncrements` on write — see the note there.
        increment: (value: number) => ({ __increment: value }),
      },
    },
  },
  getOrgForHost: async () => mockOrg,
  // Modelled through the REAL `mergePluginConfig` against the REAL commerce
  // schema (AGL-2161), not a hand-written `{ posMaxDiscountPct: n }`. The
  // production read defaults, coerces and CLAMPS a stored value into the
  // declared range, so a double that just handed the raw value back would
  // report green for a ceiling that production would never have accepted —
  // and would hide the schema going missing entirely.
  getPluginConfig: async (_orgId: unknown, pluginId: string) => {
    if (pluginId !== 'commerce') return {}
    return mockMergePluginConfig(mockCommerceSchema, mockPluginSettings)
  },
  notifyHostManagers: async (hostId: string, notification: any) => {
    notifications.push({ hostId, ...notification })
  },
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
  /** The form body, so the session's own metadata can be asserted (AGL-1953). */
  body: URLSearchParams
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
  stripeCalls.push({
    url: target,
    idempotencyKey,
    body: new URLSearchParams(String(init?.body ?? '')),
  })
  // Stripe replays a prior response for a repeated key rather than creating a
  // second session. Reproduced so a test can tell "we never called twice" from
  // "we called twice but Stripe absorbed it" — only the first is a real fix,
  // but both leave one session, and the assertion below checks the CALLS.
  if (idempotencyKey && stripeSessionsByKey.has(idempotencyKey)) {
    const replayed = stripeSessionsByKey.get(idempotencyKey) as string
    return {
      ok: true,
      json: async () => ({ url: replayed, id: sessionIdFor(replayed) }),
    }
  }
  const sessionUrl = `https://checkout.stripe.com/pay/session-${++stripeSessionCounter}`
  if (idempotencyKey) stripeSessionsByKey.set(idempotencyKey, sessionUrl)
  // Real Stripe always answers with an `id` beside the `url`, and AGL-2244
  // stores it so a cancelled QR sale can have its live page expired. A fake
  // that omitted it would report the store as working with nothing in it.
  return {
    ok: true,
    json: async () => ({ url: sessionUrl, id: sessionIdFor(sessionUrl) }),
  }
})

/** The session id Stripe would have minted alongside this url. */
function sessionIdFor(sessionUrl: string): string {
  return `cs_test_${sessionUrl.split('-').pop()}`
}

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
  notifications.length = 0
  stripeCalls.length = 0
  stripeSessionsByKey.clear()
  autoIdCounter = 0
  stripeSessionCounter = 0
  afterTransaction = null
  mockPluginSettings = undefined
  fetchMock.mockClear()
  mockVerifyIdToken.mockClear()
  mockResolveOrgPermissions.mockClear()
  mockResolveOrgPermissions.mockResolvedValue({
    orgId: 'org-1',
    role: 'admin',
    isOwner: true,
    permissions: { managePos: true },
    orgWide: true,
    hostRole: 'admin',
  } as any)

  // `editor`, not `manager` (AGL-2262): the projection has no such role,
  // and the register admitted it only because the gate was a denylist.
  docs.set('hosts/host-1', { memberRoles: { 'cashier-1': 'editor' } })
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
  // AGL-1999: `{ tax: {} }` is the UNDECIDED state and now refuses. A
  // register that genuinely rings no tax states the decision.
  docs.set('hosts/host-1/settings/store', { tax: { mode: 'none' } })
  docs.set('profiles/owner-1', {
    stripeAccountId: 'acct_live_merchant',
    stripeChargesEnabled: true,
  })
  docs.set('hostIndex/host-1', { subdomain: 'acme-cafe' })
})

// ---------------------------------------------------------------------------

/**
 * A POS card sale says on the Stripe object how much of it was tax
 * (AGL-1953).
 *
 * The whole basket goes over as ONE "In-store purchase" line at
 * `totals.totalCents`, so the origin tax this handler computes is invisible to
 * Stripe: `total_details.amount_tax` is 0 and nothing on the session says any
 * part of the charge was tax. The figure survived on the order document, but
 * no reader of the Stripe object could decompose it — including
 * `recordStorefrontTax`, which reads exactly this key and was therefore
 * filing every POS card sale as `taxMode: 'none'`.
 */
describe('the POS card sale tax witness (AGL-1953)', () => {
  /** 8.25% of a $4.00 item is 33 cents — a figure no other total here shares. */
  const TAXED_STORE = {
    tax: {
      mode: 'manual',
      origin: { country: 'US', state: 'TX' },
      rates: [{ country: 'US', state: 'TX', pct: 8.25, label: 'TX sales tax' }],
    },
  }

  it('states the tax in the session metadata', async () => {
    docs.set('hosts/host-1/settings/store', TAXED_STORE)
    const result = await post({ payment: 'link' })
    expect(result.status).toBe(200)
    expect(stripeCalls[0].body.get('metadata[taxCents]')).toBe('33')
    // The charge itself is unchanged — this is a witness, not a second tax.
    expect(stripeCalls[0].body.get('line_items[0][price_data][unit_amount]'))
      .toBe('433')
  })

  /** It agrees with the order document, which is the other half of the join. */
  it('agrees with the figure stored on the order', async () => {
    docs.set('hosts/host-1/settings/store', TAXED_STORE)
    await post({ payment: 'link' })
    expect(orderDocs()[0]?.totals?.taxCents).toBe(33)
    expect(stripeCalls[0].body.get('metadata[taxCents]')).toBe(
      String(orderDocs()[0]?.totals?.taxCents),
    )
  })

  /** A store that charges no tax says so explicitly rather than omitting it. */
  it('says zero when the store configured no tax', async () => {
    const result = await post({ payment: 'link' })
    expect(result.status).toBe(200)
    expect(stripeCalls[0].body.get('metadata[taxCents]')).toBe('0')
  })

  /**
   * WHICH REGIME THE REGISTER SOLD UNDER (AGL-2451), on the order itself.
   *
   * The cash and folio tenders never reach Stripe at all, so no Stripe object
   * will ever state this and nothing downstream can supply it later: the
   * decision resolved at ring-up is the only witness there will be. A register
   * order that cannot say which tax it carried cannot be reconciled against
   * the merchant's return afterwards, which is the whole point of the field.
   */
  it('stamps the tax regime on a CASH sale, which Stripe never sees', async () => {
    docs.set('hosts/host-1/settings/store', TAXED_STORE)
    const result = await post({ payment: 'cash', cashReceivedCents: 500 })
    expect(result.status).toBe(200)
    expect(orderDocs()[0]?.totals?.taxCents).toBe(33)
    expect(orderDocs()[0]?.taxMode).toBe('manual')
  })

  /** The card tender's pending order carries it too, before the webhook lands. */
  it('stamps the tax regime on a CARD sale at the moment it is rung', async () => {
    docs.set('hosts/host-1/settings/store', TAXED_STORE)
    await post({ payment: 'link' })
    expect(orderDocs()[0]?.taxMode).toBe('manual')
  })

  /**
   * A store that decided to collect nothing says `none` — a recorded decision,
   * not an absent field. Absent means NOT RECORDED and belongs only to orders
   * written before this shipped.
   */
  it('stamps none when the store collects no tax, on both tenders', async () => {
    docs.set('hosts/host-1/settings/store', { tax: { mode: 'none' } })
    await post({ payment: 'cash', cashReceivedCents: 500 })
    expect(orderDocs()[0]?.taxMode).toBe('none')
  })

  /**
   * NEGATIVE CONTROL for the derivation: `stripe-automatic` must never appear
   * on a register order. AGL-2145 refuses that store in person — there is no
   * shopper address at a till — so the mode is unreachable here by refusal,
   * and this pins that the stamp did not invent it anyway.
   */
  it('never stamps stripe-automatic at the register', async () => {
    docs.set('hosts/host-1/settings/store', { tax: { mode: 'stripe' } })
    const result = await post({ payment: 'cash', cashReceivedCents: 500 })
    expect(result.status).toBe(409)
    expect(orderDocs()).toHaveLength(0)
  })
})

/**
 * THE PLATFORM FEE ON AN IN-PERSON CARD SALE (AGL-2110).
 *
 * A POS card sale opens a DESTINATION charge with no `transfer_data[amount]`,
 * so Stripe hands the merchant the whole charge and debits its own processing
 * fee (2.9% + 30¢) from the PLATFORM's balance. Before this, no
 * `application_fee_amount` went with it: every in-person card sale moved money
 * out of Aglyn, on every plan, forever, with no symptom anywhere — the online
 * paths have carried the fee since AGL-307 and the register simply never did.
 *
 * Driven on DIGITAL goods, because of a collision in the plan table that a
 * careless suite would be defeated by: the only plans that sell POS at all
 * (`features.pos`) are Business and up, and every one of them charges a
 * deliberate **0%** on physical goods. A fee suite written on the physical
 * rate would therefore assert "nothing is sent" and pass just as happily
 * against the defect. Business's DIGITAL rate is 2%, and that is the rate
 * driven here. (Starter charges 2% physical but cannot run a register —
 * `posRegisters: 0` — so it 403s before Stripe.)
 *
 * Forced red by deleting the `application_fee_amount` spread in
 * `pos-order.ts`: the first three expectations below all fail.
 */
/**
 * A REGISTER CANNOT COLLECT STRIPE TAX, SO IT MUST NOT PRETEND TO (AGL-2145).
 *
 * A POS card sale sends the whole basket as ONE opaque `In-store purchase`
 * line at `totals.totalCents` and sets no `automatic_tax[enabled]` — it
 * cannot, there is no customer address at a till — and the cash and folio
 * tenders never reach Stripe at all. A store that chose "Stripe computes my
 * tax" therefore got **zero** tax on every in-person sale, on both tenders,
 * with no refusal and no log. That is the AGL-1999 defect, still open at the
 * one place a shopper is standing in front of you, and the liability lands on
 * the merchant.
 *
 * Forced red by dropping `{ inPerson: true }` from the call in
 * `pos-order.ts`: the sale goes through untaxed and all three refusals fail.
 */
describe('the register refuses a sale it cannot tax (AGL-2145)', () => {
  it('refuses a CARD sale at a Stripe-Tax store, before Stripe', async () => {
    docs.set('hosts/host-1/settings/store', { tax: { mode: 'stripe' } })
    const result = await post({ payment: 'link' })
    expect(result.status).toBe(409)
    expect(String(result.body.error)).toContain('automatic tax')
    // Nothing was minted and no order exists — the refusal is complete.
    expect(stripeCalls).toHaveLength(0)
    expect(orderDocs()).toHaveLength(0)
  })

  it('refuses a CASH sale too — the tender does not change the liability', async () => {
    docs.set('hosts/host-1/settings/store', { tax: { mode: 'stripe' } })
    const result = await post({ payment: 'cash', cashReceivedCents: 400 })
    expect(result.status).toBe(409)
    expect(orderDocs()).toHaveLength(0)
  })

  it('refuses a manual store with no origin country', async () => {
    docs.set('hosts/host-1/settings/store', {
      tax: { mode: 'manual', rates: [{ country: 'US', state: 'TX', pct: 8.25 }] },
    })
    const result = await post({ payment: 'cash', cashReceivedCents: 400 })
    expect(result.status).toBe(409)
    expect(String(result.body.error)).toContain('no store address')
    expect(orderDocs()).toHaveLength(0)
  })

  /**
   * POSITIVE CONTROLS. Without these the describe is satisfied by a register
   * that refuses everything — which would pass every assertion above and
   * delete the product.
   */
  it('POSITIVE CONTROL: a manual store WITH an origin still rings, and taxes', async () => {
    docs.set('hosts/host-1/settings/store', {
      tax: {
        mode: 'manual',
        origin: { country: 'US', state: 'TX' },
        rates: [{ country: 'US', state: 'TX', pct: 8.25 }],
      },
    })
    const result = await post({ payment: 'cash', cashReceivedCents: 500 })
    expect(result.status).toBe(200)
    // 8.25% of $4.00 = 33c, so the refusal is not standing in front of a
    // register that had stopped taxing anyway.
    expect(orderDocs()[0]?.totals?.taxCents).toBe(33)
  })

  it('POSITIVE CONTROL: a store that decided to collect NOTHING still rings', async () => {
    // `mode: 'none'` is a recorded decision and is honoured silently — the
    // whole point of `storefrontTaxDecision`'s distinction. It is also the
    // fixture the rest of this file runs on, so breaking it would be loud.
    const result = await post({ payment: 'cash', cashReceivedCents: 400 })
    expect(result.status).toBe(200)
    expect(orderDocs()[0]?.totals?.taxCents).toBe(0)
  })
})

/**
 * AGL-2229. The cashier's discount arrived as `Math.min(100, Math.max(0,
 * Number(body.discountPct ?? 0)))`, which looks like a clamp and is not one:
 * both `Math.min` and `Math.max` PROPAGATE `NaN`. A register that posted a
 * non-numeric percentage therefore produced `discountCents: NaN`, and from
 * there every figure on the sale — the platform fee, the origin tax and
 * `totals.totalCents` — was `NaN` too.
 *
 * The money consequence is not the wrong number, it is the DEFEATED
 * COMPARISON: `cashReceivedCents < NaN` is `false`, so the "cash received is
 * short" guard let the sale through with nothing in the drawer, and the order
 * was written `paid`.
 */
describe('POS discount percent that is not a number (AGL-2229)', () => {
  /**
   * AGL-2161 STRENGTHENED THE ANSWER. This used to read the unusable
   * percentage as `0` and ring the sale at full price — safe for the till,
   * but it charged a customer full price on a request the route could not
   * read, and told nobody. The `NaN` property these tests exist to protect is
   * unchanged and is now protected earlier: the request never reaches
   * `computeOrderTotals` at all.
   */
  it('refuses the sale rather than taking no cash for it', async () => {
    const result = await post({
      payment: 'cash',
      cashReceivedCents: 0,
      discountPct: 'half',
    })
    expect(result.status).toBe(400)
    expect(String(result.body.error)).toContain('Invalid discount')
    expect(orderDocs()).toHaveLength(0)
  })

  it('refuses it even when the cash WOULD have covered the sale', async () => {
    // The cash covering it is exactly the case the old behaviour rang up: a
    // full-price sale nobody asked for. Refusing regardless is what makes the
    // guard about the unreadable request rather than about the tender.
    const result = await post({
      payment: 'cash',
      cashReceivedCents: 500,
      discountPct: 'half',
    })
    expect(result.status).toBe(400)
    expect(String(result.body.error)).toContain('Invalid discount')
    expect(orderDocs()).toHaveLength(0)
  })

  it('refuses a NEGATIVE percentage, which used to clamp to full price', async () => {
    const result = await post({
      payment: 'cash',
      cashReceivedCents: 500,
      discountPct: -20,
    })
    expect(result.status).toBe(400)
    expect(orderDocs()).toHaveLength(0)
  })

  /**
   * POSITIVE CONTROL: a real percentage still discounts, so the two
   * assertions above are not satisfied by a register that ignores the field.
   */
  it('POSITIVE CONTROL: a numeric 25% still comes off the basket', async () => {
    const result = await post({
      payment: 'cash',
      cashReceivedCents: 500,
      discountPct: 25,
    })
    expect(result.status).toBe(200)
    expect((orderDocs()[0]?.totals as any).discountCents).toBe(100)
    expect((orderDocs()[0]?.totals as any).totalCents).toBe(300)
  })
})

describe('POS card sales carry the platform fee (AGL-2110)', () => {
  /** $4.00 digital at Business's 2% = 8¢. No other figure in this file is 8. */
  const DIGITAL_PRODUCT = {
    name: 'Recipe PDF',
    type: 'digital',
    status: 'active',
    variants: [{ id: 'default', priceUsd: 4, inventory: null }],
  }

  beforeEach(() => {
    docs.set('hosts/host-1/products/product-1', DIGITAL_PRODUCT)
  })

  it('sends 2% of a $4.00 digital sale PLUS the card cost (AGL-2152)', async () => {
    const result = await post({ payment: 'link' })
    expect(result.status).toBe(200)
    // 8¢ is the take. The rest is Stripe's own fee on this charge, which on a
    // DESTINATION charge is debited from the PLATFORM's balance — sending the
    // take alone left Aglyn 54¢ down on a 400¢ sale (AGL-2152).
    const expected = 8 + storefrontProcessingCostCents(400)
    expect(
      stripeCalls[0].body.get('payment_intent_data[application_fee_amount]'),
    ).toBe(String(expected))
    // The witness the completing webhook reads, and the merchant ledger.
    expect(stripeCalls[0].body.get('metadata[feeCents]')).toBe(String(expected))
    expect(orderDocs()[0]?.totals?.feeCents).toBe(expected)
    // The shopper's charge is untouched — a fee is a split, not a surcharge.
    expect(
      stripeCalls[0].body.get('line_items[0][price_data][unit_amount]'),
    ).toBe('400')
  })

  /** A cashier discount reduces what was paid, so it reduces the cut too. */
  it('scales the TAKE by the cashier discount', async () => {
    await post({ payment: 'link', discountPct: 50 })
    // The take halves with the goods; the card cost is recomputed on the
    // discounted charge rather than scaled, because Stripe bills it on what
    // the card actually runs for.
    const expected = 4 + storefrontProcessingCostCents(200)
    expect(
      stripeCalls[0].body.get('payment_intent_data[application_fee_amount]'),
    ).toBe(String(expected))
    expect(orderDocs()[0]?.totals?.feeCents).toBe(expected)
  })

  /**
   * A mixed basket is priced PER LINE. Business charges 2% on digital and a
   * deliberate 0% on physical, so one basket-wide rate would price one of the
   * two wrong — this is the assertion that fails if anyone "simplifies" the
   * reduce into a single `resolveTransactionFeePct(org, type)` call.
   */
  it('prices each line at its own product type', async () => {
    docs.set('hosts/host-1/products/product-2', {
      name: 'Flat white',
      type: 'physical',
      status: 'active',
      variants: [{ id: 'default', priceUsd: 10, inventory: null }],
    })
    await post({
      payment: 'link',
      lines: [
        { productId: 'product-1', quantity: 1 },
        { productId: 'product-2', quantity: 1 },
      ],
    })
    // The TAKE is 2% of 400 = 8, plus 0% of 1000 = 0 → 8. A basket-wide
    // DIGITAL rate would take 28; a basket-wide PHYSICAL rate would take 0.
    // The card cost rides the whole 1400¢ basket once (AGL-2152).
    expect(
      stripeCalls[0].body.get('payment_intent_data[application_fee_amount]'),
    ).toBe(String(8 + storefrontProcessingCostCents(1400)))
  })

  /**
   * A 0% TAKE IS NOT A 0% FEE ANY MORE (AGL-2152). This test used to assert
   * that a Business physical sale sent NO `application_fee_amount` at all,
   * which is precisely the defect: the register took a destination charge,
   * Stripe debited 2.9%–6% + 30¢ from the PLATFORM's balance, and Aglyn
   * collected nothing back on every in-person physical sale.
   *
   * The advertised 0% platform take is intact — the fee below is Stripe's cost
   * and nothing else, so Aglyn's margin on this sale is still exactly zero.
   */
  it('sends the card cost alone when the take rate is 0%', async () => {
    docs.set('hosts/host-1/products/product-1', {
      name: 'Flat white',
      type: 'physical',
      status: 'active',
      variants: [{ id: 'default', priceUsd: 4, inventory: null }],
    })
    const result = await post({ payment: 'link' })
    expect(result.status).toBe(200)
    const expected = storefrontProcessingCostCents(400)
    expect(
      stripeCalls[0].body.get('payment_intent_data[application_fee_amount]'),
    ).toBe(String(expected))
    expect(stripeCalls[0].body.get('metadata[feeCents]')).toBe(String(expected))
    // The take really is zero: the whole fee is the cost recovery.
    expect(expected - storefrontProcessingCostCents(400)).toBe(0)
  })

  /**
   * A cash sale reaches no Stripe charge, and it still carries the fee —
   * AGL-2111 answered the pricing question this test used to record as
   * settled. It stays here as the CARD-side regression: the card path must be
   * byte-for-byte what it was, and this is the sale beside it.
   */
  it('records the fee on a cash sale too, and still rings the sale', async () => {
    await post({ payment: 'cash', cashReceivedCents: 400 })
    expect(stripeCalls).toHaveLength(0)
    expect(orderDocs()[0]?.totals?.feeCents).toBe(8)
    // Not passing it on: the shopper's total is untouched, exactly as on card.
    expect(orderDocs()[0]?.totals?.totalCents).toBe(400)
    expect(orderDocs()[0]?.status).toBe('paid')
  })
})

/**
 * THE PLATFORM FEE FOLLOWS THE SALE, NOT THE TENDER (AGL-2111).
 *
 * Cash and folio tenders recorded `feeCents: 0`, deliberately, because there
 * is no Stripe charge to take an `application_fee_amount` out of. The
 * consequence was an avoidance route a merchant could simply choose: ring
 * every in-person sale as cash and pay the platform nothing, while the
 * identical basket on a card paid the plan's rate.
 *
 * the decision, 2026-08-19: the same rate on every tender. Cash is cheaper
 * for us, not dearer — no Stripe processing is debited against it — so a
 * discount for cash would be unjustified as well as leaving the incentive
 * intact. What differs is COLLECTION: there is no payout to net it from, so
 * the fee accrues to `orgs/{id}/offlineFees/{YYYY-MM}` and `report-usage`
 * sweeps it onto the org's own monthly invoice.
 *
 * `mockOrg` is on Business — 2% digital, a deliberate 0% physical — so the
 * digital product below is the one that can tell a rate from a zero.
 */
describe('the platform fee follows the sale, not the tender (AGL-2111)', () => {
  /** $4.00 digital at Business's 2% = 8¢. */
  const DIGITAL_PRODUCT = {
    name: 'Recipe PDF',
    type: 'digital',
    status: 'active',
    variants: [{ id: 'default', priceUsd: 4, inventory: null }],
  }

  /** The org-month accrual document, by the same UTC key the handler mints. */
  function accrual() {
    const month = new Date().toISOString().slice(0, 7)
    return docs.get(`orgs/org-1/offlineFees/${month}`)
  }

  beforeEach(() => {
    docs.set('hosts/host-1/products/product-1', DIGITAL_PRODUCT)
    docs.set('hosts/host-1/reservations/stay-1', {
      status: 'checked-in',
      guestEmail: 'Guest@example.com',
      guestName: 'Ada',
    })
  })

  it("charges a CASH sale the plan's rate — 2% of $4.00, the same 8c a card sale is charged", async () => {
    await post({ payment: 'cash', cashReceivedCents: 400 })
    // The FIGURE, not a comparison against whatever the card leg happens to
    // total. AGL-2152 is adding Stripe's own processing cost to the CARD
    // tender beside this one, and that cost is real on card and absent on
    // cash — so an `expect(cash).toBe(card)` here would be asserting the two
    // are identical in a way the platform's economics say they are not. What
    // must be equal is the PLATFORM'S TAKE, and 8 is Business's 2% of $4.00.
    expect(orderDocs()[0]?.totals?.feeCents).toBe(8)
  })

  it('charges a FOLIO (room-charge) sale the same fee', async () => {
    const result = await post({ payment: 'folio', reservationId: 'stay-1' })
    expect(result.status).toBe(200)
    expect(orderDocs()[0]?.totals?.feeCents).toBe(8)
    // The guest's folio line is the SALE, not the sale plus our cut — the fee
    // is the merchant's cost, and billing it to the room would be a surcharge.
    const folio = docs.get('hosts/host-1/reservations/stay-1')?.folio
    expect(folio?.__arrayUnion?.amountCents).toBe(400)
  })

  it('does not raise what the shopper pays on any tender', async () => {
    await post({ payment: 'cash', cashReceivedCents: 400 })
    expect(orderDocs()[0]?.totals?.totalCents).toBe(400)
  })

  /*=====================================================================
   * WIRED TO A COLLECTION ROUTE, not just written down. A fee recorded on an
   * order that no invoice ever reads is the same zero it replaced.
   *====================================================================*/

  it('accrues the cash fee to the org-month `report-usage` sweeps', async () => {
    await post({ payment: 'cash', cashReceivedCents: 400 })
    expect(accrual()?.feeCents).toBe(8)
    expect(accrual()?.orders).toBe(1)
    expect(orderDocs()[0]?.feeCollection).toBe('invoice')
  })

  it('accrues a folio fee to the same org-month document', async () => {
    await post({ payment: 'folio', reservationId: 'stay-1' })
    expect(accrual()?.feeCents).toBe(8)
    expect(orderDocs()[0]?.feeCollection).toBe('invoice')
  })

  it('ADDS across sales rather than overwriting the month', async () => {
    await post({ payment: 'cash', cashReceivedCents: 400 })
    await post({ payment: 'cash', cashReceivedCents: 400 })
    await post({ payment: 'folio', reservationId: 'stay-1' })
    expect(accrual()?.feeCents).toBe(24)
    expect(accrual()?.orders).toBe(3)
  })

  it('keys the accrual by the UTC billing month the sweep reads', async () => {
    await post({ payment: 'cash', cashReceivedCents: 400 })
    // The same expression `apps/console/utils/billing-month.ts` uses. A
    // local-time key would strand every sale rung in the offset window on a
    // document no sweep ever opens.
    const month = new Date().toISOString().slice(0, 7)
    expect(/^\d{4}-\d{2}$/.test(month)).toBe(true)
    expect(docs.has(`orgs/org-1/offlineFees/${month}`)).toBe(true)
    expect(docs.get(`orgs/org-1/offlineFees/${month}`)?.month).toBe(month)
  })

  /*=====================================================================
   * NEGATIVE CONTROLS.
   *====================================================================*/

  it('a CARD sale accrues NOTHING — Stripe already took it', async () => {
    await post({ payment: 'link' })
    expect(accrual()).toBeUndefined()
    expect(orderDocs()[0]?.feeCollection).toBe('payout')
    // And the card path still collects the way it always did — through
    // Stripe, at charge time. The EXACT figure is asserted by the AGL-2110
    // suite above (and moved by AGL-2152); what this negative control has to
    // prove is that the card tender did not ALSO accrue an invoice line,
    // which would bill the merchant twice for one sale.
    expect(
      Number(
        stripeCalls[0].body.get('payment_intent_data[application_fee_amount]'),
      ),
    ).toBeGreaterThan(0)
  })

  it('a 0%-rate line accrues nothing and records no collection route', async () => {
    docs.set('hosts/host-1/products/product-1', {
      name: 'Flat white',
      type: 'physical',
      status: 'active',
      variants: [{ id: 'default', priceUsd: 4, inventory: null }],
    })
    const result = await post({ payment: 'cash', cashReceivedCents: 400 })
    expect(result.status).toBe(200)
    expect(orderDocs()[0]?.totals?.feeCents).toBe(0)
    expect(orderDocs()[0]?.feeCollection).toBeUndefined()
    expect(accrual()).toBeUndefined()
  })

  it('a 100% comp takes nothing, and accrues nothing', async () => {
    const result = await post({
      payment: 'cash',
      cashReceivedCents: 0,
      discountPct: 100,
    })
    expect(result.status).toBe(200)
    expect(orderDocs()[0]?.totals?.feeCents).toBe(0)
    expect(accrual()).toBeUndefined()
  })

  it('scales the cash fee by the cashier discount, as the card fee is', async () => {
    await post({ payment: 'cash', cashReceivedCents: 200, discountPct: 50 })
    expect(orderDocs()[0]?.totals?.feeCents).toBe(4)
    expect(accrual()?.feeCents).toBe(4)
  })
})

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

// ---------------------------------------------------------------------------

/**
 * The low-stock crossing alert at the register (AGL-1826).
 *
 * THE DEFECT. Only the buy-now branch of `billing-webhook.ts` followed its
 * decrement with the AGL-281 crossing check, so whether a merchant was told
 * they were running out depended on which door the sale came through — and the
 * register, the channel most likely to be selling down the last few units of
 * physical shelf stock, crossed in silence. The shared
 * `alertLowStockCrossing` now sits beside this loop's decrement too, fed the
 * pre/post pair the loop just computed (never a re-read).
 */
describe('POS low-stock crossing alert (AGL-1826)', () => {
  const lowStockAlerts = () =>
    notifications.filter(
      (notification) => notification.type === 'content.lowStock',
    )

  beforeEach(() => {
    docs.set('hosts/host-1/products/product-6', {
      name: 'Candle',
      type: 'physical',
      status: 'active',
      lowStockThreshold: 8,
      variants: [{ id: 'default', priceUsd: 12, inventory: 10 }],
    })
    docs.set('hosts/host-1/products/product-7', {
      name: 'Beanie',
      type: 'physical',
      status: 'active',
      lowStockThreshold: 10,
      variants: [
        { id: 'wool', priceUsd: 22, inventory: 9 },
        { id: 'cotton', priceUsd: 18, inventory: 4 },
      ],
    })
  })

  /**
   * THE DEFECT: before the fix this array was empty — the same basket bought
   * through the storefront's buy-now button notified every manager.
   */
  it('alerts when a cash sale crosses the threshold', async () => {
    await post(
      {
        payment: 'cash',
        cashReceivedCents: 5000,
        lines: [{ productId: 'product-6', quantity: 3 }],
      },
      { 'idempotency-key': 'low-a' },
    )
    expect(lowStockAlerts()).toEqual([
      {
        hostId: 'host-1',
        type: 'content.lowStock',
        title: 'Low stock — Candle',
        body: '7 left across tracked variants',
        link: '/host-1/products',
      },
    ])
  })

  /**
   * Two lines of one product cross ONCE, on the line that breaches — the
   * AGL-1828 carry-forward is what makes the second line's `lifted` the first
   * line's `updated` (13 becomes 11 becomes 10, crossing the threshold of 10
   * on the cotton line), so this can neither double-fire nor miss.
   */
  it('fires once for two lines of one product, on the breaching line', async () => {
    await post(
      {
        payment: 'cash',
        cashReceivedCents: 10000,
        lines: [
          { productId: 'product-7', variantId: 'wool', quantity: 2 },
          { productId: 'product-7', variantId: 'cotton', quantity: 1 },
        ],
      },
      { 'idempotency-key': 'low-b' },
    )
    expect(lowStockAlerts()).toHaveLength(1)
    expect(lowStockAlerts()[0].title).toBe('Low stock — Beanie')
    expect(lowStockAlerts()[0].body).toBe('10 left across tracked variants')
  })

  /**
   * One nudge per threshold breach, not one per order after it — the buy-now
   * branch's own dedupe, preserved verbatim. Holds either side of the fix.
   */
  it('does not re-alert a product already below its threshold', async () => {
    docs.set('hosts/host-1/products/product-6', {
      name: 'Candle',
      type: 'physical',
      status: 'active',
      lowStockThreshold: 20,
      variants: [{ id: 'default', priceUsd: 12, inventory: 10 }],
    })
    await post(
      {
        payment: 'cash',
        cashReceivedCents: 5000,
        lines: [{ productId: 'product-6', quantity: 3 }],
      },
      { 'idempotency-key': 'low-c' },
    )
    expect(lowStockAlerts()).toHaveLength(0)
  })

  /** No threshold configured means no alert, ever. Holds either side. */
  it('does not alert a product with no threshold', async () => {
    docs.set('hosts/host-1/products/product-6', {
      name: 'Candle',
      type: 'physical',
      status: 'active',
      variants: [{ id: 'default', priceUsd: 12, inventory: 10 }],
    })
    await post(
      {
        payment: 'cash',
        cashReceivedCents: 5000,
        lines: [{ productId: 'product-6', quantity: 3 }],
      },
      { 'idempotency-key': 'low-d' },
    )
    expect(lowStockAlerts()).toHaveLength(0)
  })

  /**
   * A replayed settlement never reaches the loop — the `claimAttempt` above
   * it is the redelivery guard the webhook branches get from their `created`
   * transactions, so the crossing is computed once and alerted once.
   */
  it('alerts once for a replayed settlement', async () => {
    const body = {
      payment: 'cash',
      cashReceivedCents: 5000,
      lines: [{ productId: 'product-6', quantity: 3 }],
    }
    await post(body, { 'idempotency-key': 'low-e' })
    await post(body, { 'idempotency-key': 'low-e' })
    expect(orderDocs()).toHaveLength(1)
    expect(lowStockAlerts()).toHaveLength(1)
  })
})

/**
 * The AGL-1999 refusal on the register.
 *
 * `pos-order.ts` tested only `mode === 'manual'`, so an undecided store rang
 * every in-person sale untaxed — and a register is the path where an
 * unremitted liability accrues fastest.
 */
describe('an undecided store cannot ring a sale (AGL-1999)', () => {
  it('REFUSES when no settings document exists', async () => {
    docs.delete('hosts/host-1/settings/store')
    const result = await post({ payment: 'link' })
    expect(result.status).toBe(409)
    expect(String(result.body?.error)).toContain('sales tax')
    // Refused before anything was rung or charged.
    expect(orderDocs()).toHaveLength(0)
    expect(stripeCalls).toHaveLength(0)
  })

  it('REFUSES a settings doc that states no tax mode', async () => {
    docs.set('hosts/host-1/settings/store', { tax: {} })
    const result = await post({ payment: 'link' })
    expect(result.status).toBe(409)
    expect(orderDocs()).toHaveLength(0)
  })

  // Positive controls: a decided store still rings, taxed or not.
  it('RINGS a sale for a store that decided not to collect', async () => {
    docs.set('hosts/host-1/settings/store', { tax: { mode: 'none' } })
    const result = await post({ payment: 'link' })
    expect(result.status).toBe(200)
    expect(orderDocs()[0]?.totals?.taxCents ?? 0).toBe(0)
  })

  it('RINGS a taxed sale for a manual-mode store', async () => {
    docs.set('hosts/host-1/settings/store', {
      tax: {
        mode: 'manual',
        origin: { country: 'US', state: 'TX' },
        rates: [{ country: 'US', state: 'TX', pct: 8.25, label: 'TX sales tax' }],
      },
    })
    const result = await post({ payment: 'link' })
    expect(result.status).toBe(200)
    expect(orderDocs()[0]?.totals?.taxCents).toBe(33)
  })
})


/**
 * AGL-2244. A POS card sale opens a live Checkout Session the customer scans,
 * and the order carried no handle on it — `draft-order.ts` has stored
 * `checkoutSessionId` since it shipped, the register never did. So cancelling
 * a QR sale left the page on the customer's phone payable, and paying it
 * captured money the completing webhook then discarded as a redelivery.
 */
describe('a POS card sale records its Stripe session (AGL-2244)', () => {
  it('stores the session id the cancel path expires', async () => {
    const result = await post({ payment: 'link' })
    expect(result.status).toBe(200)
    expect(orderDocs()[0]?.checkoutSessionId).toBe('cs_test_1')
  })

  it('leaves a CASH sale without one — it never opened a session', async () => {
    const result = await post({ payment: 'cash', cashReceivedCents: 500 })
    expect(result.status).toBe(200)
    expect(orderDocs()[0]?.checkoutSessionId).toBeUndefined()
  })
})

/**
 * AGL-2256, the register's half. POS rounds TWICE — once per line, then again
 * when the cashier's discount scales the sum — and floored neither, so a small
 * basket on a low rate produced 0 and the emission guard read that as "this
 * plan charges no fee". Every other door floors at `Math.max(1, …)` when the
 * rate is above zero.
 */
describe('a POS platform fee that rounds to zero (AGL-2256)', () => {
  const realPlan = mockOrg.org.plan

  afterEach(() => {
    mockOrg.org.plan = realPlan
  })

  beforeEach(() => {
    // Scale: 1% digital. One $0.30 sticker pack is 0.3c of fee.
    mockOrg.org.plan = 'scale'
    docs.set('hosts/host-1/products/product-1', {
      name: 'Sticker pack',
      type: 'digital',
      status: 'active',
      variants: [{ id: 'default', priceUsd: 0.3, inventory: null }],
    })
  })

  it('still takes a cent of TAKE rather than dropping it entirely', async () => {
    const result = await post({ payment: 'link' })
    expect(result.status).toBe(200)
    // The 1¢ floor is what this issue is about; the rest is Stripe's cost on
    // the same charge, added since AGL-2152 and subtracted here so the floor
    // is still the thing being asserted.
    const expected = 1 + storefrontProcessingCostCents(30)
    expect(
      stripeCalls[0].body.get('payment_intent_data[application_fee_amount]'),
    ).toBe(String(expected))
    expect(stripeCalls[0].body.get('metadata[feeCents]')).toBe(String(expected))
  })

  it('survives the SECOND rounding, the cashier discount', async () => {
    // 1% of 50c is 0.5c, which rounds UP to 1 — so the per-line round is not
    // the one under test here. A 70% discount then scales that 1c by 15/50,
    // i.e. 0.3c, which rounds to 0.
    docs.set('hosts/host-1/products/product-1', {
      name: 'Recipe PDF',
      type: 'digital',
      status: 'active',
      variants: [{ id: 'default', priceUsd: 0.5, inventory: null }],
    })
    const result = await post({ payment: 'link', discountPct: 70 })
    expect(result.status).toBe(200)
    expect(
      stripeCalls[0].body.get('payment_intent_data[application_fee_amount]'),
    ).toBe(String(1 + storefrontProcessingCostCents(15)))
  })

  /**
   * THE OTHER BRANCH. A plan whose rate is a real zero must invent no TAKE —
   * a cent of margin on an advertised 0% tier would be a pricing lie. Since
   * AGL-2152 the parameter is still emitted, because Stripe's own cost on the
   * charge is real money leaving the platform's balance whatever the take is;
   * what must be zero is the margin, and that is what this asserts.
   */
  it('takes no margin on a plan whose rate is a real zero', async () => {
    mockOrg.org.plan = 'advanced'
    const result = await post({ payment: 'link' })
    expect(result.status).toBe(200)
    const sent = Number(
      stripeCalls[0].body.get('payment_intent_data[application_fee_amount]'),
    )
    expect(sent - storefrontProcessingCostCents(30)).toBe(0)
    expect(stripeCalls[0].body.get('metadata[feeCents]')).toBe(String(sent))
  })

  it('sends NOTHING when the cashier discounts the basket to zero', async () => {
    const result = await post({ payment: 'link', discountPct: 100 })
    expect(result.status).toBe(200)
    expect(
      stripeCalls[0].body.get('payment_intent_data[application_fee_amount]'),
    ).toBeNull()
  })
})

/**
 * AGL-2262. Both money routes that the console reaches with a manager's id
 * token gated on `!role || role === 'viewer'` — a DENYLIST of one value, on
 * the routes that take cash, mint a card QR, decrement real inventory and
 * (for drafts) create a live Stripe payment link.
 *
 * `cancel-order.ts`, `fulfill-order.ts` and `refund.ts` all use an allowlist,
 * and the Firestore rules' own host-write predicate is
 * `hostMemberRole(hostId) in ['admin','editor']`. So the denylist form was
 * strictly WIDER than the rules it claimed to mirror: any role string that was
 * not literally `viewer` transacted.
 */
/**
 * `managePos` IS ENFORCED (AGL-2474).
 *
 * The key was declared by `COMMERCE_PERMISSIONS`, registered by both surfaces,
 * resolved into every permission map — and read by nothing anywhere in the
 * repo. A permission that cannot deny anything is not a permission; it is a
 * label the customer is told is a control. These cases are what make it one.
 */
describe('the managePos permission gates the register (AGL-2474)', () => {
  it('refuses a host admin whose managePos was revoked', async () => {
    // The host allowlist still ADMITS this user — `memberRoles` says admin.
    // Before this change that was the entire test, so a revoked `managePos`
    // rang the sale anyway.
    docs.set('hosts/host-1', { memberRoles: { 'cashier-1': 'admin' } })
    mockResolveOrgPermissions.mockResolvedValue({
      orgId: 'org-1',
      role: 'admin',
      isOwner: true,
      permissions: { managePos: false },
      orgWide: true,
      hostRole: 'admin',
    } as any)
    const result = await post({ payment: 'cash', cashReceivedCents: 500 })
    expect(result.status).toBe(403)
    // The refusal must be a refusal, not a 403 with a sale behind it.
    expect(orderDocs()).toHaveLength(0)
  })

  it('POSITIVE CONTROL: the same admin rings the sale when it is granted', async () => {
    // Without this the test above passes for any reason at all — a broken
    // fixture, a 403 from the allowlist, an exception in the handler.
    docs.set('hosts/host-1', { memberRoles: { 'cashier-1': 'admin' } })
    const result = await post({ payment: 'cash', cashReceivedCents: 500 })
    expect(result.status).toBe(200)
    expect(orderDocs()).toHaveLength(1)
  })

  it('resolves the permission against the HOST in context', async () => {
    docs.set('hosts/host-1', { memberRoles: { 'cashier-1': 'admin' } })
    await post({ payment: 'cash', cashReceivedCents: 500 })
    // A resolver called with no host resolves an org-wide question and would
    // hand a site collaborator someone else's standing.
    expect(mockResolveOrgPermissions).toHaveBeenCalledWith('cashier-1', {
      hostId: 'host-1',
    })
  })
})

describe('who may ring a sale (AGL-2262)', () => {
  async function postAs(role: unknown) {
    docs.set('hosts/host-1', { memberRoles: { 'cashier-1': role } })
    return post({ payment: 'cash', cashReceivedCents: 500 })
  }

  it('refuses a role the projection could never have written', async () => {
    // A legacy value, a typo, or a role someone adds later — and none of them
    // is a decision to let that person take money.
    //
    // `manager` is on this list because it is the role people REACH for when
    // they mean "the person who may override at the till" (AGL-2372), and it
    // has never existed: `HostAccessRole` is `admin | editor | author |
    // viewer`. Anyone building an elevated register control has to build it
    // out of those four, or decide to mint a fifth.
    for (const role of ['manager', 'contributor', 'billing', 'member', '']) {
      const result = await postAs(role)
      expect(result.status).toBe(403)
    }
    expect(orderDocs()).toHaveLength(0)
  })

  it('still refuses a viewer and a stranger', async () => {
    expect((await postAs('viewer')).status).toBe(403)
    expect((await postAs(undefined)).status).toBe(403)
    expect(orderDocs()).toHaveLength(0)
  })

  /**
   * AND REFUSES AN `author`, which is a role the projection CAN produce.
   *
   * The cases above are all values `hostRoleFor` could never write, so they
   * prove the allowlist rejects nonsense and nothing more. `author` (AGL-2334)
   * arrived AFTER AGL-2262 closed, is grantable on any host through
   * `/api/hosts/members`, and is admitted by the `!role || role === 'viewer'`
   * denylist this route used to carry — so it is the one value that
   * distinguishes the two forms on a role that really exists. An author edits
   * content; taking cash and minting a card QR is not editing content.
   */
  it('refuses an author, a role that DOES exist and is not a cashier', async () => {
    expect((await postAs('author')).status).toBe(403)
    expect(orderDocs()).toHaveLength(0)
  })

  it('POSITIVE CONTROL: admin and editor still ring the sale', async () => {
    expect((await postAs('admin')).status).toBe(200)
    expect((await postAs('editor')).status).toBe(200)
  })
})


/**
 * The register WARNS about a shortfall, and never refuses (AGL-2357).
 *
 * `pos-order.ts` had no `canPurchase` call at all — every storefront door
 * gates on it and the register did not — so a merchant who chose
 * `oversellPolicy: 'deny'` in the product editor silently got `backorder` at
 * the counter. That silence is the defect.
 *
 * the decision: warn, never block. A till is the wrong place for a stale
 * number to stop a real sale, because the cashier is holding the goods. So
 * EVERY case here asserts both halves — the warning is reported AND the sale
 * completes with an order document and a 200. A test that asserted only the
 * warning would pass just as happily against a register that refused.
 */
describe('the register warns about a shortfall and sells anyway (AGL-2357)', () => {
  /** A tracked variant with `deny`, which is the product editor's default. */
  function denyProduct(inventory: number) {
    docs.set('hosts/host-1/products/product-1', {
      name: 'Flat white',
      type: 'physical',
      status: 'active',
      oversellPolicy: 'deny',
      variants: [{ id: 'default', priceUsd: 4, inventory }],
    })
  }

  it('reports the shortfall on a cash sale — and rings it through', async () => {
    denyProduct(1)

    const result = await post({
      payment: 'cash',
      cashReceivedCents: 2000,
      lines: [{ productId: 'product-1', quantity: 3 }],
    })

    expect(result.status).toBe(200)
    expect(result.body.error).toBeUndefined()
    expect(result.body.stockWarnings).toEqual([
      {
        productId: 'product-1',
        name: 'Flat white',
        requested: 3,
        available: 1,
      },
    ])
    // THE SALE HAPPENED. Not a refusal dressed as a warning.
    expect(orderDocs()).toHaveLength(1)
    expect((orderDocs()[0] as any).status).toBe('paid')
    expect((orderDocs()[0] as any).totals.itemsCents).toBe(1200)
  })

  it('reports it on a card sale too, and still mints the QR', async () => {
    denyProduct(0)

    const result = await post({
      payment: 'link',
      lines: [{ productId: 'product-1', quantity: 2 }],
    })

    expect(result.status).toBe(200)
    expect(result.body.url).toContain('https://')
    expect(result.body.stockWarnings).toEqual([
      {
        productId: 'product-1',
        name: 'Flat white',
        requested: 2,
        available: 0,
      },
    ])
  })

  /**
   * POSITIVE CONTROL — the quiet branch, asserted separately. A warning that
   * fired on every sale would satisfy the cases above and be useless at the
   * counter.
   */
  it('says nothing when the shelf covers the basket', async () => {
    denyProduct(5)

    const result = await post({
      payment: 'cash',
      cashReceivedCents: 2000,
      lines: [{ productId: 'product-1', quantity: 3 }],
    })

    expect(result.status).toBe(200)
    expect(result.body.stockWarnings).toBeUndefined()
    expect(orderDocs()).toHaveLength(1)
  })

  /**
   * A `backorder` merchant CHOSE to sell past zero. Warning them would be
   * noise about a setting they set on purpose, and it is the deny promise —
   * not the count — that the register was breaking.
   */
  it('says nothing on a backorder product, however short', async () => {
    docs.set('hosts/host-1/products/product-1', {
      name: 'Flat white',
      type: 'physical',
      status: 'active',
      oversellPolicy: 'backorder',
      variants: [{ id: 'default', priceUsd: 4, inventory: 0 }],
    })

    const result = await post({
      payment: 'cash',
      cashReceivedCents: 2000,
      lines: [{ productId: 'product-1', quantity: 4 }],
    })

    expect(result.status).toBe(200)
    expect(result.body.stockWarnings).toBeUndefined()
    expect(orderDocs()).toHaveLength(1)
  })

  it('says nothing about an untracked variant, which has no count to be short against', async () => {
    const result = await post({
      payment: 'cash',
      cashReceivedCents: 9900,
      lines: [{ productId: 'product-1', quantity: 20 }],
    })

    expect(result.status).toBe(200)
    expect(result.body.stockWarnings).toBeUndefined()
  })

  /** One entry per short line, and only for the short ones. */
  it('reports each short line and leaves the covered one out', async () => {
    denyProduct(1)
    docs.set('hosts/host-1/products/product-2', {
      name: 'Croissant',
      type: 'physical',
      status: 'active',
      oversellPolicy: 'deny',
      variants: [
        { id: 'large', priceUsd: 3, inventory: 9, options: { size: 'Large' } },
      ],
    })

    const result = await post({
      payment: 'cash',
      cashReceivedCents: 5000,
      lines: [
        { productId: 'product-1', quantity: 2 },
        { productId: 'product-2', variantId: 'large', quantity: 2 },
      ],
    })

    expect(result.status).toBe(200)
    expect(result.body.stockWarnings).toHaveLength(1)
    expect(result.body.stockWarnings[0].productId).toBe('product-1')
    expect(orderDocs()).toHaveLength(1)
  })

  /**
   * The variant label rides along, because a cashier holding one of three
   * sizes needs to know WHICH one the count is short on.
   */
  it('names the variant when the short line has one', async () => {
    docs.set('hosts/host-1/products/product-2', {
      name: 'Croissant',
      type: 'physical',
      status: 'active',
      oversellPolicy: 'deny',
      variants: [
        { id: 'large', priceUsd: 3, inventory: 1, options: { size: 'Large' } },
      ],
    })

    const result = await post({
      payment: 'cash',
      cashReceivedCents: 5000,
      lines: [{ productId: 'product-2', variantId: 'large', quantity: 4 }],
    })

    expect(result.body.stockWarnings).toEqual([
      {
        productId: 'product-2',
        variantId: 'large',
        name: 'Croissant',
        variantLabel: 'Large',
        requested: 4,
        available: 1,
      },
    ])
    expect(orderDocs()).toHaveLength(1)
  })
})
