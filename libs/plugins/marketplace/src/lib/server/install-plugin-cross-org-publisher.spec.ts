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
 * The publisher waiver is about the publisher's OWN sites (AGL-2484).
 *
 * `canActAsPublisher` answers a question about ONE org: is this uid an
 * owner/admin of the org that owns the listing. The install target is
 * validated separately, against the host's org. Nothing correlated the two,
 * so a single flag computed from org P waived three gates on an install
 * landing in org Q:
 *
 *   - the review gate — pending or REJECTED bytes install anyway;
 *   - the version resolver — it falls back to `latestVersion` rather than
 *     the newest approved one;
 *   - `requirePurchase` — the install is free.
 *
 * A user who administers publisher org P and holds `installPlugins` on a
 * host in org Q therefore pushed P's unreviewed bundle onto Q's live public
 * site, for free. The code carried a comment claiming "it reaches only their
 * own sites"; nothing enforced that sentence.
 *
 * Every refusal below is paired with the SAME install into the publisher's
 * own org, because "refuses cross-org" passes against a route that refuses
 * everything — and the own-org waiver is a deliberate, documented feature
 * (a publisher testing their plugin before submitting it).
 */

jest.mock('@aglyn/aglyn/server', () => ({
  ...jest.requireActual('@aglyn/aglyn/server'),
}))

/** The org the INSTALL lands in; resolved from the host, never the body. */
const __targetOrgId = { value: 'buyer-org' }
/** Whether the caller is an owner/admin of the org that owns the listing. */
const __actsAsPublisher = { value: true }
/** Every `requirePurchase` call, so the payment waiver is observable. */
const __purchaseCalls: Array<Record<string, unknown>> = []

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({
    orgId: __targetOrgId.value,
    permissions: { installPlugins: true },
  }),
}))

jest.mock('./publisher-profile', () => ({
  canActAsPublisher: async () => __actsAsPublisher.value,
}))

jest.mock('./purchase-entitlement', () => ({
  // Models the real predicate closely enough for what is under test: a paid
  // listing is unpaid unless the OWNER waiver applies. An unfaithful double
  // here would fabricate a green for exactly the case that matters.
  requirePurchase: async (args: Record<string, unknown>) => {
    __purchaseCalls.push(args)
    if (Number(args.priceUsd) <= 0) return undefined
    if (args.ownsListing === true) return undefined
    return { error: 'Purchase required' }
  },
}))

jest.mock('./provenance', () => ({
  pinnedProvenance: () => ({ listingId: 'listing-1' }),
}))

jest.mock('./version-stats', () => ({
  recordVersionMove: async () => undefined,
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const state = {
    versions: {} as Record<string, Record<string, unknown>>,
    listing: {} as Record<string, unknown>,
    pins: [] as Array<Record<string, unknown>>,
  }

  const versionsCollection = {
    doc: (id: string) => ({
      get: async () => ({
        exists: Boolean(state.versions[id]),
        data: () => state.versions[id],
      }),
    }),
    orderBy: () => ({
      limit: () => ({
        get: async () => ({
          docs: Object.entries(state.versions).map(([id, data]) => ({
            id,
            get: (field: string) => data[field],
            data: () => data,
          })),
        }),
      }),
    }),
  }

  const installDoc = {
    get: async () => ({ exists: false, get: () => undefined }),
    set: async (data: Record<string, unknown>) => {
      state.pins.push(data)
    },
  }

  const hostRef = {
    get: async () => ({
      exists: true,
      get: (field: string) =>
        field === 'memberRoles' ? { 'publisher-admin': 'admin' } : undefined,
    }),
    collection: () => ({ doc: () => installDoc }),
  }

  const listingRef = {
    get: async () => ({
      data: () => ({
        // The listing is owned by the PUBLISHER org throughout this file.
        profileId: 'seller-org',
        artifactType: 'plugin',
        reviewStatus: 'listed',
        displayName: 'Fancy plugin',
        priceUsd: 0,
        latestVersion: '2.0.0',
        latestApprovedVersion: '1.0.0',
        ...state.listing,
      }),
    }),
    collection: (name: string) => {
      if (name === 'pluginVersions') return versionsCollection
      throw new Error(`unexpected listing subcollection: ${name}`)
    },
    update: async () => undefined,
  }

  const firestore = {
    collection: (name: string) => {
      if (name === 'hosts') return { doc: () => hostRef }
      if (name === 'marketplaceListings') return { doc: () => listingRef }
      if (name === 'revocations') {
        return {
          doc: () => ({ get: async () => ({ exists: false, data: () => undefined }) }),
        }
      }
      if (name === 'orgs') {
        return {
          doc: () => ({
            get: async () => ({ get: () => undefined }),
            collection: () => ({ doc: () => installDoc }),
          }),
        }
      }
      throw new Error(`unexpected collection: ${name}`)
    },
  }

  return {
    __state: state,
    // The host's org IS the target org — the same value the permission gate
    // resolved above, which is what makes the two comparable.
    resolveOrgIdForHost: async () => __targetOrgId.value,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async () => ({ uid: 'publisher-admin' }),
        }),
        firestore: () => firestore,
      }),
      firestore: {
        FieldValue: {
          serverTimestamp: () => 'NOW',
          increment: (by: number) => by,
        },
      },
    },
  }
})

import { installPluginHandler } from './install-plugin'

const state = (
  jest.requireMock('@aglyn/tenant-data-admin') as {
    __state: {
      versions: Record<string, Record<string, unknown>>
      listing: Record<string, unknown>
      pins: Array<Record<string, unknown>>
    }
  }
).__state

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

const makeReq = (body: Record<string, unknown> = {}) =>
  ({
    method: 'POST',
    headers: { authorization: 'Bearer token' },
    body: { listingId: 'listing-1', hostId: 'host-1', ...body },
  }) as any

const version = (reviewState: string) => ({
  reviewState,
  sha256: 'sha',
  objectPath: 'path',
  manifest: { id: 'com.example.plugin' },
  publishedAt: { toMillis: () => 1 },
})

/** The version the route actually pinned, or null when it wrote no pin. */
const pinnedVersion = () =>
  state.pins.length ? String(state.pins[0]['version']) : null

beforeEach(() => {
  for (const key of Object.keys(state.versions)) delete state.versions[key]
  for (const key of Object.keys(state.listing)) delete state.listing[key]
  state.pins.length = 0
  __purchaseCalls.length = 0
  __actsAsPublisher.value = true
  __targetOrgId.value = 'buyer-org'
  // v1.0.0 is the approved, installable build. v2.0.0 is the one still in
  // review — the bytes nobody outside the publisher org may run.
  state.versions['1.0.0'] = version('approved')
  state.versions['2.0.0'] = version('pending')
})

describe('an EXPLICIT pin at an unreviewed version (AGL-2484)', () => {
  it('refuses it when the install lands in someone else’s org', async () => {
    const res = makeRes()
    await installPluginHandler(makeReq({ version: '2.0.0' }), res)
    expect(res.statusCode).toBe(409)
    expect(res.body.error).toMatch(/review/i)
    expect(state.pins).toHaveLength(0)
  })

  it('refuses a REJECTED version cross-org too, not just a pending one', async () => {
    state.versions['2.0.0'] = version('rejected')
    const res = makeRes()
    await installPluginHandler(makeReq({ version: '2.0.0' }), res)
    expect(res.statusCode).toBe(409)
    expect(state.pins).toHaveLength(0)
  })

  it('CONTROL: allows it into the publisher’s OWN org', async () => {
    // The deliberate capability: this is how a publisher tests a build
    // before submitting it for review.
    __targetOrgId.value = 'seller-org'
    const res = makeRes()
    await installPluginHandler(makeReq({ version: '2.0.0' }), res)
    expect(res.statusCode).toBe(200)
    expect(pinnedVersion()).toBe('2.0.0')
  })

  it('CONTROL: an APPROVED version still installs cross-org', async () => {
    // Without this, "refuses cross-org" would pass against a route that
    // refuses every cross-org install, which would break the marketplace.
    const res = makeRes()
    await installPluginHandler(makeReq({ version: '1.0.0' }), res)
    expect(res.statusCode).toBe(200)
    expect(pinnedVersion()).toBe('1.0.0')
  })
})

describe('the unpinned `latestVersion` fallback (AGL-2484)', () => {
  it('does not hand another org the unreviewed latest', async () => {
    const res = makeRes()
    await installPluginHandler(makeReq(), res)
    // The approved v1.0.0 is what any other org gets — never v2.0.0.
    expect(res.statusCode).toBe(200)
    expect(pinnedVersion()).toBe('1.0.0')
  })

  it('refuses outright when nothing is approved and the target is foreign', async () => {
    state.versions['1.0.0'] = version('pending')
    const res = makeRes()
    await installPluginHandler(makeReq(), res)
    expect(res.statusCode).toBe(409)
    expect(state.pins).toHaveLength(0)
  })

  it('CONTROL: the publisher’s own org still falls back to latestVersion', async () => {
    __targetOrgId.value = 'seller-org'
    state.versions['1.0.0'] = version('pending')
    const res = makeRes()
    await installPluginHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(pinnedVersion()).toBe('2.0.0')
  })
})

describe('the payment waiver (AGL-2484)', () => {
  beforeEach(() => {
    state.listing.priceUsd = 100
  })

  it('does not make a paid plugin free in another org', async () => {
    const res = makeRes()
    await installPluginHandler(makeReq({ version: '1.0.0' }), res)
    expect(res.statusCode).toBe(402)
    expect(state.pins).toHaveLength(0)
    // The flag itself, not only its consequence: `requirePurchase` decides
    // on `ownsListing`, so a fix that refuses for some other reason would
    // still leave the waiver wrong.
    expect(__purchaseCalls).toHaveLength(1)
    expect(__purchaseCalls[0].ownsListing).toBe(false)
  })

  it('CONTROL: the publisher still installs their own paid listing free', async () => {
    __targetOrgId.value = 'seller-org'
    const res = makeRes()
    await installPluginHandler(makeReq({ version: '1.0.0' }), res)
    expect(res.statusCode).toBe(200)
    expect(__purchaseCalls[0].ownsListing).toBe(true)
  })
})

describe('a PRIVATE listing is the owning org’s alone (AGL-968/2489)', () => {
  beforeEach(() => {
    state.listing.visibility = 'private'
  })

  it('404s a private listing installed into a foreign org', async () => {
    const res = makeRes()
    await installPluginHandler(makeReq({ version: '1.0.0' }), res)
    expect(res.statusCode).toBe(404)
    expect(state.pins).toHaveLength(0)
  })

  it('CONTROL: the owning org installs its private listing', async () => {
    __targetOrgId.value = 'seller-org'
    const res = makeRes()
    await installPluginHandler(makeReq({ version: '1.0.0' }), res)
    expect(res.statusCode).toBe(200)
    expect(pinnedVersion()).toBe('1.0.0')
  })
})

describe('the waiver still requires the publisher ROLE (AGL-652)', () => {
  it('CONTROL: a non-member of the publisher org gets no waiver in its own org', async () => {
    // Same-org is a necessary condition, not a sufficient one: correlating
    // the two orgs must not degenerate into replacing the role check with a
    // comparison. Green before this issue and green after — it exists to
    // fail a fix that swaps one condition for the other.
    __actsAsPublisher.value = false
    __targetOrgId.value = 'seller-org'
    const res = makeRes()
    await installPluginHandler(makeReq({ version: '2.0.0' }), res)
    expect(res.statusCode).toBe(409)
    expect(state.pins).toHaveLength(0)
  })
})
