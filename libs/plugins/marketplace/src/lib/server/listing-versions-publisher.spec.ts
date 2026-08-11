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
 * The publisher-scoped version history (AGL-1079).
 *
 * `pluginVersions` is server-only because the docs carry publish
 * internals, so this route is the only way a publisher sees their own
 * review state — and the only thing standing between that and everyone
 * else. What matters: an unauthenticated caller gets nothing, a signed-in
 * stranger gets nothing, and the PUBLIC branch of the same route never
 * starts returning review state, rejection reasons or shas because this
 * one does.
 */

jest.mock('@aglyn/aglyn/server', () => ({
  compareArtifactVersions: () => 0,
}))

jest.mock('../model/marketplace', () => ({
  listingArtifactType: () => 'plugin',
  newestApprovedVersion: () => null,
  // The REAL predicate, not a stub: the public branch now filters on it
  // (AGL-976), so faking it would test the filter against itself.
  isVersionApproved: (version: { reviewState?: string } | null | undefined) =>
    version?.reviewState === 'approved',
}))

jest.mock('./version-stats', () => ({
  versionCollectionFor: () => 'pluginVersions',
  // The REAL reconciliation (AGL-1418), not a stub: the arithmetic IS what
  // these tests are about, and faking it would check the route against a
  // fiction of itself.
  reconcileInstallTallies: jest.requireActual('./version-stats')
    .reconcileInstallTallies,
}))

jest.mock('./publisher-profile', () => ({
  canActAsPublisher: async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const store = jest.requireMock('./publisher-profile') as {
      __isPublisher: boolean
    }
    return store.__isPublisher
  },
  __isPublisher: true,
}))

const VERSION_FIELDS: Record<string, unknown> = {
  version: '1.0.1',
  sha256: 'deadbeef',
  reviewState: 'rejected',
  reviewRejectionReason: 'The network allowlist is wider than you need.',
  changelog: 'Fixed a thing',
  publisherAttestation: {
    repository: { sha256: 'deadbeef', by: 'uid-1' },
  },
  // The publisher's own install of their unapproved version — nobody else
  // can have one (AGL-1418 fixture).
  installCount: 1,
  activeInstalls: 1,
}

/**
 * An APPROVED version alongside the rejected one (AGL-976).
 *
 * Both branches need it. The publisher must still see the rejected version —
 * it is their submission and the reason is theirs to act on — while a buyer
 * must see only this one. With a single rejected doc in the fixture, "the
 * public branch returns nothing" and "the filter works" are indistinguishable.
 */
const APPROVED_VERSION_FIELDS: Record<string, unknown> = {
  version: '1.0.0',
  sha256: 'cafebabe',
  reviewState: 'approved',
  changelog: 'First release',
  installCount: 3,
  activeInstalls: 1,
}

jest.mock('@aglyn/tenant-data-admin', () => {
  const versionDoc = {
    id: '1.0.1',
    get: (key: string) =>
      key === 'publishedAt'
        ? { toMillis: () => 1_760_000_000_000 }
        : VERSION_FIELDS[key],
  }
  const approvedDoc = {
    id: '1.0.0',
    get: (key: string) =>
      key === 'publishedAt'
        ? { toMillis: () => 1_750_000_000_000 }
        : APPROVED_VERSION_FIELDS[key],
  }
  const store = () =>
    jest.requireMock('@aglyn/tenant-data-admin') as {
      __listing: Record<string, unknown> | undefined
      __pins: { total: number; byVersion: Record<string, number> } | 'no-index'
      __aggregations: string[]
      __writes: Array<Record<string, unknown>>
    }
  const listingRef = {
    get: async () => ({
      data: () => store().__listing,
      get: (key: string) => store().__listing?.[key],
      updateTime: 'update-time-token',
    }),
    set: async () => undefined,
    update: async (patch: Record<string, unknown>) => {
      store().__writes.push(patch)
      return undefined
    },
    collection: () => ({
      orderBy: () => ({
        // Newest first, as the real query orders them.
        limit: () => ({ get: async () => ({ docs: [versionDoc, approvedDoc] }) }),
      }),
    }),
  }
  /**
   * The live pins (AGL-1419). `count()` and never `get()`: the aggregation
   * returns an integer, so no other tenant's pin ever leaves the query.
   */
  const collectionGroup = (name: string) => {
    expect(name).toBe('installs')
    const answer = (key: string, count: () => number) => ({
      count: () => ({
        get: async () => {
          store().__aggregations.push(key)
          if (store().__pins === 'no-index') {
            throw Object.assign(
              new Error(
                '9 FAILED_PRECONDITION: The query requires a ' +
                  'COLLECTION_GROUP_ASC index for collection installs and ' +
                  'field listingId.',
              ),
              { code: 9 },
            )
          }
          return { data: () => ({ count: count() }) }
        },
      }),
    })
    return {
      where: (_field: string, _op: '==', listingId: unknown) => ({
        ...answer(String(listingId), () =>
          store().__pins === 'no-index'
            ? 0
            : (store().__pins as { total: number }).total,
        ),
        where: (_vField: string, _vOp: '==', version: unknown) =>
          answer(`${String(listingId)}@${String(version)}`, () =>
            store().__pins === 'no-index'
              ? 0
              : ((store().__pins as { byVersion: Record<string, number> })
                  .byVersion?.[String(version)] ?? 0),
          ),
      }),
    }
  }
  return {
    __listing: {
      profileId: 'org-1',
      latestVersion: '1.0.1',
      latestApprovedVersion: '1.0.0',
      reviewStatus: 'listed',
      // The listing's own copy of the same two quantities the versions carry
      // (AGL-1418), and ahead of them — three live installs where the
      // versions account for two.
      installCount: 7,
      activeInstalls: 3,
    } as Record<string, unknown> | undefined,
    // Three live pins, agreeing with the listing's accumulator. The AGL-1418
    // expectations below hold unchanged on the derived path, which is the
    // point: deriving does not move a number that was already right.
    __pins: { total: 3, byVersion: { '1.0.1': 1, '1.0.0': 1 } } as
      | { total: number; byVersion: Record<string, number> }
      | 'no-index',
    __aggregations: [] as string[],
    __writes: [] as Array<Record<string, unknown>>,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: 'uid-1' }) }),
        firestore: () => ({
          collection: () => ({ doc: () => listingRef }),
          collectionGroup,
        }),
      }),
    },
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const profileMock = jest.requireMock('./publisher-profile') as {
  __isPublisher: boolean
}
const adminMock = jest.requireMock('@aglyn/tenant-data-admin') as {
  __listing: Record<string, unknown> | undefined
  __pins: { total: number; byVersion: Record<string, number> } | 'no-index'
  __aggregations: string[]
  __writes: Array<Record<string, unknown>>
}
const DEFAULT_LISTING = { ...adminMock.__listing }

import { listingVersionsHandler } from './listing-versions'
import { resetPinCountBackoff } from './install-pin-counts'

function respond() {
  const result: { status: number; body: any } = { status: 0, body: null }
  const res = {
    status(code: number) {
      result.status = code
      return {
        json(body: unknown) {
          result.body = body
          return body
        },
      }
    },
  }
  return { res, result }
}

async function call(query: Record<string, string>, authed = true) {
  const { res, result } = respond()
  await listingVersionsHandler(
    {
      method: 'GET',
      query,
      headers: authed ? { authorization: 'Bearer token' } : {},
    } as never,
    res as never,
  )
  return result
}

describe('publisher-scoped listing versions (AGL-1079)', () => {
  beforeEach(() => {
    profileMock.__isPublisher = true
    adminMock.__listing = { ...DEFAULT_LISTING }
    adminMock.__pins = { total: 3, byVersion: { '1.0.1': 1, '1.0.0': 1 } }
    adminMock.__aggregations = []
    adminMock.__writes = []
    // The backoff and single-flight maps outlive a test otherwise, and a
    // suite that passes because a previous test poisoned a cache is worse
    // than one that fails.
    resetPinCountBackoff()
    jest.restoreAllMocks()
  })

  it('refuses an unauthenticated caller', async () => {
    const result = await call({ listingId: 'l1', scope: 'publisher' }, false)
    expect(result.status).toBe(401)
  })

  it('refuses a signed-in stranger, without confirming the listing exists', async () => {
    profileMock.__isPublisher = false
    const result = await call({ listingId: 'l1', scope: 'publisher' })
    // 404 rather than 403: whether a listing exists is not a stranger's
    // business, and a 403 answers that question for them.
    expect(result.status).toBe(404)
    expect(result.body.versions).toBeUndefined()
  })

  it('gives the publisher review state, the reason, the sha and the attestation', async () => {
    const result = await call({ listingId: 'l1', scope: 'publisher' })
    expect(result.status).toBe(200)
    const entry = result.body.versions[0]
    expect(entry.reviewState).toBe('rejected')
    expect(entry.rejectionReason).toMatch(/network allowlist/)
    expect(entry.sha256).toBe('deadbeef')
    // Pinned to the bytes, exactly like the review page reads it.
    expect(entry.attestation).toEqual(['repository'])
  })

  it('reports the version that installs, not the newest one', async () => {
    // `latestVersion` names a version installs may refuse (AGL-966/1016).
    const result = await call({ listingId: 'l1', scope: 'publisher' })
    expect(result.body.latestApprovedVersion).toBe('1.0.0')
    expect(result.body.latestVersion).toBe('1.0.1')
  })

  it('keeps the PUBLIC branch free of any of it', async () => {
    // The regression that would matter: widening the buyer projection to
    // serve the publisher, so every stranger reads why a version was
    // rejected and what its bytes hash to.
    const result = await call({ listingId: 'l1' })
    expect(result.status).toBe(200)
    const entry = result.body.versions[0]
    expect(entry.reviewState).toBeUndefined()
    expect(entry.rejectionReason).toBeUndefined()
    expect(entry.sha256).toBeUndefined()
    expect(entry.attestation).toBeUndefined()
  })

  it('shows buyers approved versions only (AGL-976)', async () => {
    // The listing's Version history reads this. Before the filter it listed
    // pending and rejected versions too — with "Latest" on whichever was
    // newest — so a version rejected for undeclared network access was
    // advertised to buyers as the current release, changelog and all.
    const result = await call({ listingId: 'l1' })
    expect(result.body.versions.map((v: { version: string }) => v.version)).toEqual([
      '1.0.0',
    ])
  })

  /**
   * The listing page showed three different numbers for one version because
   * nothing ever compared the listing's counters to the versions' (AGL-1418).
   * The route is where that comparison now happens, so both branches have to
   * serve the totals — a card cannot agree with a header it never sees.
   */
  describe('reconciled install totals (AGL-1418)', () => {
    it('serves the totals to the buyer branch', async () => {
      const result = await call({ listingId: 'l1' })
      expect(result.body.activeInstalls).toBe(3)
      expect(result.body.installCount).toBe(7)
    })

    it('serves the same totals to the publisher branch', async () => {
      const result = await call({ listingId: 'l1', scope: 'publisher' })
      expect(result.body.activeInstalls).toBe(3)
      expect(result.body.installCount).toBe(7)
    })

    it('never credits a hidden version’s installs to a visible one', async () => {
      // The trap in reconciling on the buyer projection instead of the raw
      // collection: 1.0.1 is filtered out for buyers (AGL-976), so a naive
      // reconcile would hand its install — and the listing's untracked one —
      // to 1.0.0, and the only approved version would claim installs that
      // are running rejected code.
      const result = await call({ listingId: 'l1' })
      expect(result.body.versions).toHaveLength(1)
      expect(result.body.versions[0]).toMatchObject({
        version: '1.0.0',
        activeInstalls: 1,
        installCount: 3,
      })
    })

    it('reports the shortfall rather than hiding it in a version', async () => {
      // Two versions account for 2 of the listing's 3 live installs. The
      // remaining one predates per-version tracking and belongs to no version
      // anyone can name, so it is reported as exactly that.
      const result = await call({ listingId: 'l1' })
      expect(result.body.untrackedActiveInstalls).toBe(1)
      expect(result.body.untrackedInstallCount).toBe(3)
    })

    it('gives the publisher the reconciled per-version numbers too', async () => {
      // Review status and Version history print the same string for the same
      // version; they used to read two different fields off two different
      // routes and could not be made to agree.
      const result = await call({ listingId: 'l1', scope: 'publisher' })
      const byVersion = Object.fromEntries(
        result.body.versions.map((entry: { version: string; activeInstalls: number }) => [
          entry.version,
          entry.activeInstalls,
        ]),
      )
      expect(byVersion).toEqual({ '1.0.0': 1, '1.0.1': 1 })
    })
  })

  /**
   * The counts now come from the pins (AGL-1419).
   *
   * AGL-1418 made the four cards agree; it could not make them true, because
   * both stored levels are accumulators and no arithmetic over two
   * accumulators can bring a count back down. These are the cases where the
   * pins disagree with BOTH of them.
   */
  describe('install counts derived from the pins (AGL-1419)', () => {
    it('serves the pin count to the buyer branch, correcting downwards', async () => {
      // The production shape: the listing claims 3 live installs and only two
      // pins exist. Before this, 3 was unfalsifiable.
      adminMock.__pins = { total: 2, byVersion: { '1.0.0': 1, '1.0.1': 1 } }
      const result = await call({ listingId: 'l1' })
      expect(result.body.activeInstalls).toBe(2)
      expect(result.body.untrackedActiveInstalls).toBe(0)
    })

    it('serves the publisher branch the same derived number', async () => {
      // Review status and the listing header read different routes. They must
      // not be able to derive different truths.
      adminMock.__pins = { total: 2, byVersion: { '1.0.0': 1, '1.0.1': 1 } }
      const result = await call({ listingId: 'l1', scope: 'publisher' })
      expect(result.body.activeInstalls).toBe(2)
    })

    it('writes the derived value back over the drifted accumulator', async () => {
      // What makes the stored counter a self-healing cache instead of an
      // independent number: every other reader of `marketplaceListings` — the
      // browse grid, the staff console, the client-side header fallback — is
      // corrected by this write without knowing anything about pins.
      adminMock.__pins = { total: 2, byVersion: { '1.0.0': 1, '1.0.1': 1 } }
      await call({ listingId: 'l1' })
      expect(adminMock.__writes).toHaveLength(1)
      expect(adminMock.__writes[0]).toMatchObject({
        activeInstalls: 2,
        pinnedActiveInstalls: 2,
      })
      expect(adminMock.__writes[0]['pinsVerifiedAtMs']).toEqual(expect.any(Number))
    })

    it('costs a fresh listing ZERO aggregations', async () => {
      // The cost claim for a buyer-facing page. The listing document is read
      // by the route regardless, so a cache hit adds nothing at all.
      adminMock.__listing = {
        ...DEFAULT_LISTING,
        activeInstalls: 2,
        pinnedActiveInstalls: 2,
        pinnedVersionInstalls: { '1.0.0': 1, '1.0.1': 1 },
        pinsVerifiedAtMs: Date.now(),
      }
      const result = await call({ listingId: 'l1' })
      expect(adminMock.__aggregations).toEqual([])
      expect(adminMock.__writes).toEqual([])
      expect(result.body.activeInstalls).toBe(2)
    })

    it('spends one aggregation per version and no more on a miss', async () => {
      await call({ listingId: 'l1' })
      // The listing total, then one per version doc — bounded by the route's
      // own limit(20), and paid once per TTL rather than once per request.
      expect(adminMock.__aggregations).toEqual(['l1', 'l1@1.0.1', 'l1@1.0.0'])
    })

    it('falls back to AGL-1418 when the index is missing, never to zero', async () => {
      // A `FAILED_PRECONDITION` swallowed into a `0` would be written back
      // over every listing on the platform inside one TTL window. The page
      // degrades to the previous release instead, loudly.
      const errors = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)
      adminMock.__pins = 'no-index'
      const result = await call({ listingId: 'l1' })
      expect(result.status).toBe(200)
      expect(result.body.activeInstalls).toBe(3)
      expect(result.body.installCount).toBe(7)
      expect(adminMock.__writes).toEqual([])
      expect(String(errors.mock.calls[0]?.join(' '))).toMatch(/index is MISSING/)
    })

    it('derives nothing for an artifact that installs by copying', async () => {
      // Themes, components, layouts, email templates and dataset schemas hold
      // no pin at all. Counting them would write a derived zero over a real
      // number — and this route serves every artifact type.
      const model = jest.requireMock('../model/marketplace') as {
        listingArtifactType: () => string
      }
      const original = model.listingArtifactType
      model.listingArtifactType = () => 'theme'
      try {
        const result = await call({ listingId: 'l1' })
        expect(adminMock.__aggregations).toEqual([])
        expect(adminMock.__writes).toEqual([])
        expect(result.body.activeInstalls).toBe(3)
      } finally {
        model.listingArtifactType = original
      }
    })
  })

  it('still shows the publisher their rejected version', async () => {
    // The other half, and the one a filter is likely to break: a publisher
    // who cannot see their own rejected submission cannot act on the reason.
    const result = await call({ listingId: 'l1', scope: 'publisher' })
    expect(result.body.versions.map((v: { version: string }) => v.version)).toContain(
      '1.0.1',
    )
  })
})
