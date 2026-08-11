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
  const listingRef = {
    get: async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const store = jest.requireMock('@aglyn/tenant-data-admin') as {
        __listing: Record<string, unknown> | undefined
      }
      return {
        data: () => store.__listing,
        get: (key: string) => store.__listing?.[key],
      }
    },
    set: async () => undefined,
    collection: () => ({
      orderBy: () => ({
        // Newest first, as the real query orders them.
        limit: () => ({ get: async () => ({ docs: [versionDoc, approvedDoc] }) }),
      }),
    }),
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
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: 'uid-1' }) }),
        firestore: () => ({ collection: () => ({ doc: () => listingRef }) }),
      }),
    },
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const profileMock = jest.requireMock('./publisher-profile') as {
  __isPublisher: boolean
}

import { listingVersionsHandler } from './listing-versions'

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

  it('still shows the publisher their rejected version', async () => {
    // The other half, and the one a filter is likely to break: a publisher
    // who cannot see their own rejected submission cannot act on the reason.
    const result = await call({ listingId: 'l1', scope: 'publisher' })
    expect(result.body.versions.map((v: { version: string }) => v.version)).toContain(
      '1.0.1',
    )
  })
})
