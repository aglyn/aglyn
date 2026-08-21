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
 * Revoking ONE build must not make the listing uninstallable (AGL-2368).
 *
 * The route resolved an unpinned install with `newestApprovedVersion` —
 * approval only — and consulted the kill switch afterwards, as a veto on a
 * choice it had already made. So with v2.0.0 revoked and v1.0.0 approved and
 * perfectly installable, it picked v2.0.0 and answered 409. `requirePurchase`
 * runs BEFORE version resolution, so the buyer had already paid.
 *
 * A per-version revocation is deliberately not listing-wide
 * (`isListingWideRevocation`); that ordering made it so anyway.
 *
 * Both halves are asserted throughout. "Refuses the revoked version" passes
 * against a route that refuses everything, so every case that expects a
 * refusal is paired with one that expects an install, and each asserts the
 * PIN — the version actually written — not merely the status code.
 */

jest.mock('@aglyn/aglyn/server', () => ({
  // Not a closed world. `isPluginRevoked`, `newestInstallableVersion` and
  // `compareArtifactVersions` are the entire subject of this file; a
  // wholesale mock would leave them `undefined` and the guard would test
  // nothing while reporting green.
  ...jest.requireActual('@aglyn/aglyn/server'),
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({
    // The org the install LANDS in. The publisher waiver requires this to be
    // the listing's own org (AGL-2484), so the cases below that exercise the
    // waiver move it to `seller-org` — leaving it here would let them pass
    // with the waiver switched off, testing nothing they claim to test.
    orgId: __actingOrgId.value,
    permissions: { installPlugins: true },
  }),
}))

/** The install target's org; `seller-org` is the publisher's own workspace. */
const __actingOrgId = { value: 'buyer-org' }

jest.mock('./publisher-profile', () => ({
  canActAsPublisher: async () => __ownsListing.value,
}))

jest.mock('./purchase-entitlement', () => ({
  // The buyer has paid. That is the point: the money is already gone by the
  // time the route resolves a version.
  requirePurchase: async () => undefined,
}))

jest.mock('./provenance', () => ({
  pinnedProvenance: () => ({ listingId: 'listing-1' }),
}))

jest.mock('./version-stats', () => ({
  recordVersionMove: async () => undefined,
}))

/** Flipped per-case; `jest.mock` factories may not close over later consts. */
const __ownsListing = { value: false }

jest.mock('@aglyn/tenant-data-admin', () => {
  const state = {
    /** Keyed by version id; the value is that version's document. */
    versions: {} as Record<string, Record<string, unknown>>,
    /** `revocations/listing-1`, or null for "no kill switch". */
    revocation: null as Record<string, unknown> | null,
    listing: {} as Record<string, unknown>,
    /** Every write to the install pin. */
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
        field === 'memberRoles' ? { 'buyer-1': 'admin' } : undefined,
    }),
    collection: () => ({ doc: () => installDoc }),
  }

  const listingRef = {
    get: async () => ({
      data: () => ({
        profileId: 'seller-org',
        artifactType: 'plugin',
        reviewStatus: 'listed',
        displayName: 'Fancy plugin',
        priceUsd: 100,
        latestVersion: '2.0.0',
        latestApprovedVersion: '2.0.0',
        ...state.listing,
      }),
    }),
    collection: (name: string) => {
      if (name === 'pluginVersions') return versionsCollection
      throw new Error(`unexpected listing subcollection: ${name}`)
    },
    update: async () => undefined,
  }

  const revocationDoc = {
    get: async () => ({
      exists: state.revocation != null,
      data: () => state.revocation ?? undefined,
    }),
  }

  /**
   * NAME-AWARE on purpose. A double that answers every `collection()` with
   * one ref is how a case "passes" against a document that was never under
   * test — here the revocation and the listing are read from the same
   * `firestore.collection(...)` call site pattern, and conflating them would
   * make a revoked listing indistinguishable from a healthy one.
   */
  const firestore = {
    collection: (name: string) => {
      if (name === 'hosts') return { doc: () => hostRef }
      if (name === 'marketplaceListings') return { doc: () => listingRef }
      if (name === 'revocations') return { doc: () => revocationDoc }
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
    resolveOrgIdForHost: async () => 'buyer-org',
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: 'buyer-1' }) }),
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
      revocation: Record<string, unknown> | null
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

beforeEach(() => {
  for (const key of Object.keys(state.versions)) delete state.versions[key]
  for (const key of Object.keys(state.listing)) delete state.listing[key]
  state.revocation = null
  state.pins.length = 0
  __ownsListing.value = false
  __actingOrgId.value = 'buyer-org'
  // Two approved versions. v2.0.0 is the newer one and the one the mirror
  // names; v1.0.0 is what a working kill switch has to fall back to.
  state.versions['1.0.0'] = version('approved')
  state.versions['2.0.0'] = version('approved')
})

/** The version the route actually pinned, or null if it wrote no pin. */
const pinnedVersion = () =>
  state.pins.length ? String(state.pins[0]['version']) : null

describe('an unpinned install and the kill switch (AGL-2368)', () => {
  it('CONTROL: with no revocation it installs the newest approved version', async () => {
    const res = makeRes()
    await installPluginHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(pinnedVersion()).toBe('2.0.0')
  })

  it('falls back to the older INSTALLABLE version when the newest is revoked', async () => {
    state.revocation = { versions: ['2.0.0'] }
    const res = makeRes()
    await installPluginHandler(makeReq(), res)
    // The whole defect: this used to be 409, after the buyer had paid.
    expect(res.statusCode).toBe(200)
    expect(pinnedVersion()).toBe('1.0.0')
  })

  it('still refuses when EVERY approved version is revoked', async () => {
    state.revocation = { versions: ['1.0.0', '2.0.0'] }
    const res = makeRes()
    await installPluginHandler(makeReq(), res)
    expect(res.statusCode).toBe(409)
    expect(state.pins).toHaveLength(0)
  })

  it('refuses a LISTING-WIDE takedown, which revokes every version', async () => {
    // `'all'` is the takedown form (`isListingWideRevocation`) and is a
    // different state from a per-version stop — the pair of cases is what
    // proves this route tells them apart.
    state.revocation = { versions: 'all' }
    const res = makeRes()
    await installPluginHandler(makeReq(), res)
    expect(res.statusCode).toBe(409)
    expect(state.pins).toHaveLength(0)
  })

  it('does not offer an UNAPPROVED version just because it is unrevoked', async () => {
    // Revocation is an extra condition on the offer, never a replacement for
    // review (AGL-966). Without this, a fix that swapped the predicates
    // rather than intersecting them would pass every case above.
    state.versions['2.0.0'] = version('pending')
    state.revocation = { versions: ['1.0.0'] }
    const res = makeRes()
    await installPluginHandler(makeReq(), res)
    expect(res.statusCode).toBe(409)
    expect(state.pins).toHaveLength(0)
  })
})

describe('an EXPLICIT version pin still meets the kill switch (AGL-1085)', () => {
  it('CONTROL: installs the exact version asked for when it is not revoked', async () => {
    const res = makeRes()
    await installPluginHandler(makeReq({ version: '1.0.0' }), res)
    expect(res.statusCode).toBe(200)
    expect(pinnedVersion()).toBe('1.0.0')
  })

  it('409s a pin at a revoked version rather than quietly substituting one', async () => {
    // The post-resolution check stays load-bearing. Someone asking for these
    // exact bytes is told they are stopped; they are not silently handed
    // different code than they asked for.
    state.revocation = { versions: ['1.0.0'] }
    const res = makeRes()
    await installPluginHandler(makeReq({ version: '1.0.0' }), res)
    expect(res.statusCode).toBe(409)
    expect(res.body.error).toMatch(/revoked/i)
    expect(state.pins).toHaveLength(0)
  })
})

describe("the publisher's own-unreviewed-bytes fallback (AGL-1083)", () => {
  beforeEach(() => {
    __ownsListing.value = true
    // Installing into the PUBLISHING org, which is the only place the
    // waiver applies (AGL-2484).
    __actingOrgId.value = 'seller-org'
  })

  it('CONTROL: the owner gets the approved version while one exists', async () => {
    state.versions['2.0.0'] = version('pending')
    state.listing.latestVersion = '2.0.0'
    const res = makeRes()
    await installPluginHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(pinnedVersion()).toBe('1.0.0')
  })

  it('refuses the owner a fallback onto their own REVOKED latest', async () => {
    // With every approved version revoked the fallback engages and lands on
    // `latestVersion` — which the kill switch has also stopped. The
    // post-resolution check is the only thing standing here.
    state.revocation = { versions: ['1.0.0', '2.0.0'] }
    state.listing.latestVersion = '2.0.0'
    const res = makeRes()
    await installPluginHandler(makeReq(), res)
    expect(res.statusCode).toBe(409)
    expect(state.pins).toHaveLength(0)
  })
})
