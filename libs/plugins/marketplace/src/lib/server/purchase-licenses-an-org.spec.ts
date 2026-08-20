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
 *
 * @jest-environment node
 */

/**
 * A MARKETPLACE PURCHASE LICENSES AN ORGANIZATION (AGL-2331).
 *
 * The defect had two faces and they pulled in opposite directions, so this
 * file drives BOTH doors — the install gate and the checkout guard — against
 * one shared in-memory Firestore. They were keyed on the same predicate, and
 * they have to stay keyed on the same predicate or the marketplace can take
 * money for something it will not install, or refuse to sell something it will
 * not install either.
 *
 * THE AGENCY. One person, two client workspaces, one purchase:
 *
 *   revenue leaked   — the licence bought for Northwind installed into Contoso
 *                      as well, and into every other workspace that uid could
 *                      reach. Agencies are the primary customer for this
 *                      marketplace, so this is not an edge case, it is the
 *                      shape of the median buyer.
 *   the sale blocked — and the same person could not buy a SECOND licence
 *                      either: the duplicate-purchase guard shares the
 *                      predicate, so checkout answered `409 already_purchased`
 *                      to exactly the sale we want to make.
 *
 * WHAT MUST NOT REGRESS is the customer who already paid. A purchase written
 * before AGL-2331 carries no buyer org at all, and reading that as "licensed
 * to nobody" would revoke access somebody bought. The legacy cases below are
 * the ones to be most suspicious of a green on: they assert that nothing is
 * migrated, nothing is claimed, and nothing is taken away.
 *
 * The Stripe boundary is mocked absolutely and every call counted — localhost
 * carries the LIVE secret key.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore, keyed by document path.
//
// It FILTERS on the `where` clauses, unlike the older marketplace doubles that
// return every seeded purchase whatever was asked for. That is load-bearing
// here rather than tidiness: the whole change is which field the query is
// keyed on, so a fake that ignores the key would return the same GREEN for the
// person-scoped predicate and the org-scoped one.
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()

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
    ref: makeDocRef(path),
    exists: data !== undefined,
    data: () => data,
    get: (field: string) =>
      field
        .split('.')
        .reduce<any>((value, key) => (value ?? {})[key], data ?? {}),
  }
}

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => makeSnapshot(path),
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      docs.set(
        path,
        options?.merge ? { ...(docs.get(path) ?? {}), ...value } : value,
      )
    },
    update: async (value: Record<string, any>) => {
      docs.set(path, { ...(docs.get(path) ?? {}), ...value })
    },
    /** Firestore refuses a create on an existing doc — that IS the dedupe. */
    create: async (value: Record<string, any>) => {
      if (docs.has(path)) {
        const error: any = new Error(`ALREADY_EXISTS: ${path}`)
        error.code = 6
        throw error
      }
      docs.set(path, value)
    },
    delete: async () => {
      docs.delete(path)
    },
  }
}

function makeQuery(path: string, filters: Array<[string, unknown]>): any {
  const run = (max?: number) => {
    const matched = childPaths(path)
      .map(makeSnapshot)
      .filter((snapshot) =>
        filters.every(([field, value]) => snapshot.get(field) === value),
      )
    const sliced = max === undefined ? matched : matched.slice(0, max)
    return { empty: sliced.length === 0, docs: sliced, size: sliced.length }
  }
  return {
    where: (field: string, _op: string, value: unknown) =>
      makeQuery(path, [...filters, [field, value]]),
    limit: (max: number) => ({ get: async () => run(max) }),
    get: async () => run(),
  }
}

function makeCollectionRef(name: string): any {
  return {
    doc: (id: string) => makeDocRef(`${name}/${id}`),
    where: (field: string, op: string, value: unknown) =>
      makeQuery(name, []).where(field, op, value),
  }
}

const fakeFirestore = { collection: makeCollectionRef }

// ---------------------------------------------------------------------------
// The acting membership. `resolveOrgPermissions` is the ONLY thing that says
// which org a caller is acting for on either door, so the tests move this to
// move workspaces — never a request body field, which is the point.
//
// The mutable state lives inside a virtual module's mock factory rather than a
// module-scope `const`, because `jest.mock` calls are hoisted above every
// declaration in the file and reaching a `const` from one is a TDZ error.
// ---------------------------------------------------------------------------

jest.mock(
  './__spec-state',
  () => ({
    /** The org a caller resolves to when the request names none. */
    orgId: 'org-northwind' as string | null,
    installPlugins: true,
    /** uid → the orgs that uid is actually on the roster of. */
    rosters: {
      'uid-agency': ['org-northwind', 'org-contoso'],
      'uid-colleague': ['org-northwind'],
    } as Record<string, string[]>,
    /** hostId → owning org, read by both the permission mock and the admin one. */
    hostOrg: {} as Record<string, string>,
    /** Whose id token the auth mock returns. */
    callerUid: 'uid-agency',
  }),
  { virtual: true },
)

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async (
    uid: string,
    context: { orgId?: string | null; hostId?: string | null },
  ) => {
    const state = jest.requireMock('./__spec-state') as any
    // Precedence: an explicitly requested org, then the org owning the site
    // named on the request, then whatever the test has set as the default.
    // Written as statements rather than a `??` chain because
    // `strictNullChecks` is off repo-wide and the compiler reads the middle
    // arm of the chained form as always-nullish.
    let requested: string | null = context.orgId || null
    if (!requested && context.hostId) {
      requested = state.hostOrg[context.hostId] || null
    }
    if (!requested) requested = state.orgId
    // Fails CLOSED for a uid that is not on that org's roster, exactly as the
    // real resolver does (AGL-506) — the negative control for "a buyer cannot
    // license an org they have no standing in" depends on it.
    const onRoster = (state.rosters[uid] ?? []).includes(requested as string)
    return {
      orgId: requested,
      permissions: { installPlugins: onRoster ? state.installPlugins : false },
    }
  },
}))

// The publisher's Connect readiness is a different question from who holds the
// licence, and checkout asks it through its own module. Stubbed ready so an
// onboarding refusal can never masquerade as an entitlement result — and
// `virtual` so this file does not depend on that module existing.
jest.mock(
  '@aglyn/tenant-data-admin/server/stripe-account-mode',
  () => ({ connectLinkageIsReady: () => true }),
  { virtual: true },
)

jest.mock('./publisher-profile', () => ({
  canActAsPublisher: async () => false,
  resolvePublisherProfile: async () => ({
    orgId: 'org-seller',
    handle: 'acme',
    stripeAccountId: 'acct_seller',
    stripeChargesEnabled: true,
  }),
}))

jest.mock('./provenance', () => ({
  hasDivergedFromBase: async () => false,
  recordInstallProvenance: async () => ({
    installedFrom: { sha256: 'sha' },
    baseStored: true,
  }),
}))

jest.mock('./version-stats', () => ({ recordVersionMove: async () => undefined }))

jest.mock('@aglyn/aglyn/server', () => {
  const actual = jest.requireActual('@aglyn/aglyn/server')
  return {
    ...actual,
    // The REAL claim: its atomicity is what the concurrent case rests on.
    claimAttempt: jest.requireActual('@aglyn/aglyn/app-utils/api-idempotency')
      .claimAttempt,
    buildRoute: (_route: string, params: Record<string, string>) =>
      `/${params.orgSlug}/marketplace`,
    createResourceUid: () => 'component-new',
  }
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({
          uid: (jest.requireMock('./__spec-state') as any).callerUid,
          email: 'agency@example.com',
        }),
      }),
      firestore: () => fakeFirestore,
    }),
    firestore: {
      FieldValue: {
        serverTimestamp: () => 'NOW',
        increment: (by: number) => ({ __increment: by }),
      },
    },
  },
  getOrgForHost: async (hostId: string) => {
    const orgId = (jest.requireMock('./__spec-state') as any).hostOrg[hostId]
    return orgId ? { orgId, org: { id: orgId, plan: 'pro' } } : undefined
  },
}))

import { checkoutHandler } from './checkout'
import { installHandler } from './install'

/** The mock's own state object — the tests drive the world through it. */
const side = jest.requireMock('./__spec-state') as any
const hostOrg = side.hostOrg as Record<string, string>

// ---------------------------------------------------------------------------
// Stripe — counted, never reached.
// ---------------------------------------------------------------------------

const stripeCalls: Array<{ body: URLSearchParams }> = []
let stripeCounter = 0

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined as any,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
  }
  return res
}

/** Buy `listing-1` as `uid`, acting for `orgId`. */
async function buy(
  uid: string,
  orgId: string | null,
  body: Record<string, unknown> = {},
) {
  side.callerUid = uid
  const res = makeRes()
  await checkoutHandler(
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        origin: 'https://console.aglyn.com',
        'idempotency-key': `attempt-${Math.random().toString(36).slice(2)}`,
      },
      body: { listingId: 'listing-1', ...(orgId ? { orgId } : {}), ...body },
    } as any,
    res,
  )
  return res
}

/** Install `listing-1` into `hostId` as `uid`. */
async function install(uid: string, hostId: string) {
  side.callerUid = uid
  const res = makeRes()
  await installHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: { listingId: 'listing-1', hostId },
    } as any,
    res,
  )
  return res
}

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_spec'
})

beforeEach(() => {
  docs.clear()
  stripeCalls.length = 0
  stripeCounter = 0
  side.orgId = 'org-northwind'
  side.installPlugins = true
  side.callerUid = 'uid-agency'
  for (const key of Object.keys(hostOrg)) delete hostOrg[key]
  // Two client workspaces, one site each. The agency owner is on both
  // rosters; the colleague only on Northwind's.
  hostOrg['host-northwind'] = 'org-northwind'
  hostOrg['host-contoso'] = 'org-contoso'
  docs.set('orgs/org-northwind', { slug: 'northwind', plan: 'pro' })
  docs.set('orgs/org-contoso', { slug: 'contoso', plan: 'pro' })
  docs.set('orgs/org-seller', { slug: 'seller', plan: 'pro' })
  for (const host of ['host-northwind', 'host-contoso']) {
    docs.set(`hosts/${host}`, {
      memberRoles: { 'uid-agency': 'admin', 'uid-colleague': 'admin' },
    })
  }
  docs.set('marketplaceListings/listing-1', {
    priceUsd: 100,
    profileId: 'org-seller',
    displayName: 'Fancy hero',
    latestVersion: 1,
    reviewStatus: 'listed',
  })
  docs.set('marketplaceListings/listing-1/versions/1', {
    nodes: { root: {} },
    rootId: 'root',
  })

  global.fetch = jest.fn(async (url: any, init: any): Promise<any> => {
    const target = String(url)
    if (!target.includes('api.stripe.com')) {
      throw new Error(`Unexpected fetch to ${target}`)
    }
    stripeCalls.push({ body: new URLSearchParams(String(init?.body ?? '')) })
    return {
      ok: true,
      json: async () => ({
        url: `https://checkout.stripe.com/c/session-${++stripeCounter}`,
      }),
    }
  }) as unknown as typeof fetch
})

/** What the webhook would write from the session this checkout just opened. */
function recordPurchaseFromLastSession(id = `cs_${stripeCalls.length}`) {
  const params = stripeCalls[stripeCalls.length - 1].body
  docs.set(`marketplacePurchases/${id}`, {
    listingId: params.get('metadata[listingId]'),
    buyerUid: params.get('metadata[buyerUid]'),
    // The field under test. `??` rather than a default: if checkout stops
    // stamping it, this seeds `undefined` and the org gate stops holding —
    // which is the failure this whole file is about, not a detail to paper
    // over in the harness.
    buyerOrgId: params.get('metadata[buyerOrgId]') ?? undefined,
    sellerOrgId: params.get('metadata[sellerOrgId]'),
  })
  return id
}

describe('THE AGENCY: one buyer, two client workspaces, one purchase (AGL-2331)', () => {
  it('the SECOND workspace does not get a free install', async () => {
    // Northwind buys. This is the sale that actually happened.
    side.orgId = 'org-northwind'
    expect((await buy('uid-agency', 'org-northwind')).statusCode).toBe(200)
    recordPurchaseFromLastSession()

    // Northwind installs — the licence covers the workspace that bought it.
    expect((await install('uid-agency', 'host-northwind')).statusCode).toBe(200)

    // THE DEFECT. The same person, the same purchase, a DIFFERENT client's
    // workspace. Person-scoped entitlement handed Contoso the component for
    // nothing; an organizational licence does not reach it.
    const contoso = await install('uid-agency', 'host-contoso')
    expect(contoso.statusCode).toBe(402)
    expect(contoso.body).toEqual({ error: 'Purchase required', priceUsd: 100 })
  })

  it('and the SECOND licence is a real sale, not a 409', async () => {
    side.orgId = 'org-northwind'
    expect((await buy('uid-agency', 'org-northwind')).statusCode).toBe(200)
    recordPurchaseFromLastSession()

    // THE DEFECT, from the other side: the duplicate-purchase guard shared the
    // person-scoped predicate, so the customer who WANTED to pay us again was
    // refused. A licence for Contoso is a different good from a licence for
    // Northwind.
    const second = await buy('uid-agency', 'org-contoso')
    expect(second.statusCode).toBe(200)
    expect(stripeCalls).toHaveLength(2)
    recordPurchaseFromLastSession('cs_contoso')

    // And now Contoso really does install.
    expect((await install('uid-agency', 'host-contoso')).statusCode).toBe(200)
  })

  it('CONTROL — the same workspace still cannot buy the same listing twice', async () => {
    // The rule AGL-1697 added must survive being re-keyed. Buying twice for
    // ONE workspace buys nothing, so it is still a 409.
    expect((await buy('uid-agency', 'org-northwind')).statusCode).toBe(200)
    recordPurchaseFromLastSession()
    const again = await buy('uid-agency', 'org-northwind')
    expect(again.statusCode).toBe(409)
    expect(again.body.code).toBe('already_purchased')
    expect(stripeCalls).toHaveLength(1)
  })

  it('a COLLEAGUE who never bought it installs what the org owns', async () => {
    // The other half of "the licence belongs to the organization". Before
    // AGL-2331 the only person who could install a paid listing was the uid on
    // the purchase document — so a licence died with the employee who bought
    // it, and a teammate had to buy a second copy of something the company
    // already owned.
    expect((await buy('uid-agency', 'org-northwind')).statusCode).toBe(200)
    recordPurchaseFromLastSession()
    expect((await install('uid-colleague', 'host-northwind')).statusCode).toBe(
      200,
    )
    // ...and that colleague still gets nothing in a workspace they are not
    // even a member of.
    expect((await install('uid-colleague', 'host-contoso')).statusCode).toBe(403)
  })
})

describe('NOBODY LOSES WHAT THEY PAID FOR: pre-AGL-2331 purchases (AGL-2331)', () => {
  /** Exactly what the webhook wrote before this change: no buyer org at all. */
  const seedLegacyPurchase = () =>
    docs.set('marketplacePurchases/cs_legacy', {
      listingId: 'listing-1',
      buyerUid: 'uid-agency',
      sellerOrgId: 'org-seller',
    })

  it('a legacy purchase still installs — in BOTH workspaces, exactly as before', async () => {
    // The migration, and there is deliberately none: no backfill, no claiming
    // by the first org to use it, no window where a paying customer is locked
    // out. A purchase that named no organization keeps the meaning it had when
    // the money changed hands. It resolves in the customer's favour because
    // reinterpreting it any other way would take away access they bought.
    seedLegacyPurchase()
    expect((await install('uid-agency', 'host-northwind')).statusCode).toBe(200)
    expect((await install('uid-agency', 'host-contoso')).statusCode).toBe(200)
  })

  it('a legacy purchase does NOT license a colleague', async () => {
    // It grandfathers the BUYER, not the org — anything wider would be a new
    // grant invented by the migration rather than access somebody paid for.
    seedLegacyPurchase()
    expect((await install('uid-colleague', 'host-northwind')).statusCode).toBe(
      402,
    )
  })

  it('a legacy buyer is not charged again for what they already hold', async () => {
    // The 409 has to follow the entitlement wherever it goes: this buyer can
    // already install this listing in every workspace they reach, so selling
    // them a second copy would take money for nothing.
    seedLegacyPurchase()
    const res = await buy('uid-agency', 'org-contoso')
    expect(res.statusCode).toBe(409)
    expect(res.body.code).toBe('already_purchased')
    expect(stripeCalls).toHaveLength(0)
  })

  it('a legacy purchase belonging to SOMEONE ELSE licenses nothing here', async () => {
    docs.set('marketplacePurchases/cs_legacy_other', {
      listingId: 'listing-1',
      buyerUid: 'uid-stranger',
      sellerOrgId: 'org-seller',
    })
    expect((await install('uid-agency', 'host-northwind')).statusCode).toBe(402)
  })

  it('a REFUNDED licence stops entitling the org, and the org can re-buy', async () => {
    // AGL-1546 must survive the re-key: `refundedAt` is tested on the org
    // branch as well as the legacy one.
    docs.set('marketplacePurchases/cs_refunded', {
      listingId: 'listing-1',
      buyerUid: 'uid-agency',
      buyerOrgId: 'org-northwind',
      sellerOrgId: 'org-seller',
      refundedAt: 1_700_000_000_000,
    })
    expect((await install('uid-agency', 'host-northwind')).statusCode).toBe(402)
    expect((await buy('uid-agency', 'org-northwind')).statusCode).toBe(200)
  })
})

describe('the buyer org on the session is VALIDATED, never taken on trust (AGL-2331)', () => {
  it('stamps the resolved org on the Checkout metadata', async () => {
    // The data half. Without this the webhook has nothing to write, and the
    // gate above has nothing to read — which is exactly why the entitlement
    // could only ever be person-scoped.
    expect((await buy('uid-agency', 'org-northwind')).statusCode).toBe(200)
    const params = stripeCalls[0].body
    expect(params.get('metadata[buyerOrgId]')).toBe('org-northwind')
    expect(params.get('payment_intent_data[metadata][buyerOrgId]')).toBe(
      'org-northwind',
    )
  })

  it('refuses to license an org the buyer is not a member of', async () => {
    // The hole the old derivation left wide open: `hostId` → `hostIndex.orgId`
    // with no membership test, so posting any host id stamped the purchase
    // with a stranger's org and entitled it.
    const res = await buy('uid-colleague', 'org-contoso')
    expect(res.statusCode).toBe(403)
    expect(stripeCalls).toHaveLength(0)
  })

  it('refuses a purchase that cannot name the organization it licenses', async () => {
    // A session with no buyer org would produce a purchase document that is
    // indistinguishable from a grandfathered one — silently minting a NEW
    // person-scoped licence under cover of the legacy grant.
    side.orgId = null
    const res = await buy('uid-agency', null, { hostId: '' })
    expect(res.statusCode).toBe(400)
    expect(stripeCalls).toHaveLength(0)
  })

  it('falls back to the host when an older bundle sends no orgId', async () => {
    // A cached client must not start failing mid-checkout; the org is resolved
    // from the site instead, still through the caller's own membership.
    side.orgId = null
    const res = await buy('uid-agency', null, { hostId: 'host-contoso' })
    expect(res.statusCode).toBe(200)
    expect(stripeCalls[0].body.get('metadata[buyerOrgId]')).toBe('org-contoso')
  })
})
