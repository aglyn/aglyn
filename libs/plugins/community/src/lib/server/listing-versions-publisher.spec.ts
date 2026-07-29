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

jest.mock('../model/community', () => ({
  listingArtifactType: () => 'plugin',
  newestApprovedVersion: () => null,
}))

jest.mock('./version-stats', () => ({
  versionCollectionFor: () => 'pluginVersions',
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
}

jest.mock('@aglyn/tenant-data-admin', () => {
  const versionDoc = {
    id: '1.0.1',
    get: (key: string) =>
      key === 'publishedAt'
        ? { toMillis: () => 1_760_000_000_000 }
        : VERSION_FIELDS[key],
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
        limit: () => ({ get: async () => ({ docs: [versionDoc] }) }),
      }),
    }),
  }
  return {
    __listing: {
      profileId: 'org-1',
      latestVersion: '1.0.1',
      latestApprovedVersion: '1.0.0',
      reviewStatus: 'listed',
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
})
