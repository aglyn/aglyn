/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header
 * it is silently ignored and this runs on jsdom, where the route's
 * Response helpers are unavailable.
 *
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

/**
 * `by: "media"` — the mode the AGL-1687 staff form drives.
 *
 * The other two modes take a key the caller states. This one takes an ASSET
 * and derives every key from its document, which is what makes a form safe
 * to hand to a person mid-incident. Each property below is a transcription
 * failure the form would otherwise reintroduce, and each fails SILENTLY in
 * production — a quarantine that looks set and refuses nothing:
 *
 *  1. **The strong digest wins.** AGL-1631 exists because the runbook named
 *     the weaker of the two fields. A form must not be able to.
 *  2. **The scope segment is derived, never typed.** The DAM looks a
 *     per-asset key up under `org:{orgId}` / `{hostId}`; a hand-built
 *     three-part segment matches nothing.
 *  3. **A release clears everything that is biting.** An asset can be
 *     covered by two keys at once, and a half-lift leaves the red badge up
 *     while reporting success — the AGL-1571 failure exactly.
 *  4. **A media-mode request cannot be steered by a digest in the body.**
 *     The key comes from the document; a `contentHash` alongside is ignored,
 *     which is `/api/media/quarantine`'s posture kept on the write path.
 *  5. **The audit trail records the copy the operator was looking at**, from
 *     the document rather than from what they typed.
 */

import {
  MEDIA_QUARANTINE_INDEX_DOC_ID,
  MEDIA_QUARANTINE_MAX_ENTRIES,
  MEDIA_QUARANTINES_COLLECTION,
} from '@aglyn/aglyn/server'

const INDEX_PATH = `${MEDIA_QUARANTINES_COLLECTION}/${MEDIA_QUARANTINE_INDEX_DOC_ID}`

const SHA =
  '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
const LEGACY = '0123456789abcdef'
const ORG = 'acme'
const MEDIA = 'm1'
const SHA_KEY = `hash--${SHA}`
const LEGACY_KEY = `hash--${LEGACY}`
const ASSET_KEY = `asset--org:${ORG}--${MEDIA}`

let mockStore: Record<string, Record<string, unknown>> = {}
let mockAuditRows: Record<string, unknown>[] = []
let mockWrites: string[] = []
const mockDecodedToken: Record<string, unknown> = {}

const mockServerTimestamp = Symbol('serverTimestamp')
const mockDelete = Symbol('delete')

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => mockServerTimestamp,
    delete: () => mockDelete,
  },
}))

/** Firestore's merge semantics, including the delete sentinel. */
function mergeInto(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    if (value === mockDelete) {
      delete next[key]
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Recurse even when the parent map does not exist yet. Firestore does:
      // a merged delete against a MISSING document creates `entries: {}`, and
      // a mock that instead stored the sentinel as a value would report a
      // released key as still set — a spec failing on its own fixture.
      const existing = next[key]
      next[key] = mergeInto(
        existing && typeof existing === 'object' && !Array.isArray(existing)
          ? (existing as Record<string, unknown>)
          : {},
        value as Record<string, unknown>,
      )
    } else {
      next[key] = value
    }
  }
  return next
}

/**
 * Subcollections matter here, unlike the AGL-1512 spec: `by: "media"` reads
 * `orgs/{id}/media/{mediaId}`, and modelling the path is how "it read the
 * document the caller named" stays provable.
 */
const mockDocHandle = (path: string): any => ({
  get: async () => {
    const data = mockStore[path] ? { ...mockStore[path] } : undefined
    return {
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => data?.[field],
    }
  },
  set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
    mockWrites.push(path)
    mockStore[path] = options?.merge
      ? mergeInto(mockStore[path] ?? {}, data)
      : data
  },
  collection: (child: string) => mockCollectionHandle(`${path}/${child}`),
})

const mockCollectionHandle = (prefix: string): any => ({
  add: async (data: Record<string, unknown>) => {
    mockWrites.push(`${prefix}/<generated>`)
    if (prefix !== 'adminAudit') throw new Error(`unexpected add: ${prefix}`)
    mockAuditRows.push(data)
    return { id: `audit-${mockAuditRows.length}` }
  },
  doc: (id: string) => mockDocHandle(`${prefix}/${id}`),
})

const mockFirestore = { collection: mockCollectionHandle }

let mockInvalidations = 0
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => mockDecodedToken }),
      firestore: () => mockFirestore,
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  invalidateMediaQuarantineCache: () => {
    mockInvalidations += 1
  },
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const route = require('../app/api/admin/media-quarantine/route') as {
  GET: (request: Request) => Promise<Response>
  POST: (request: Request) => Promise<Response>
}

async function post(body: Record<string, unknown>): Promise<Response> {
  return route.POST(
    new Request('https://app.aglyn.com/api/admin/media-quarantine', {
      method: 'POST',
      headers: {
        authorization: 'Bearer staff-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  )
}

async function get(query: string): Promise<Response> {
  return route.GET(
    new Request(`https://app.aglyn.com/api/admin/media-quarantine${query}`, {
      headers: { authorization: 'Bearer staff-token' },
    }),
  )
}

const entries = () =>
  (mockStore[INDEX_PATH]?.['entries'] ?? {}) as Record<
    string,
    Record<string, unknown>
  >

/** The media document, with whichever digests this case is about. */
function seedAsset(fields: Record<string, unknown> = {}) {
  mockStore[`orgs/${ORG}/media/${MEDIA}`] = {
    fileName: 'invoice.pdf',
    contentSha256: SHA,
    contentHash: LEGACY,
    ...fields,
  }
}

const mediaBody = (over: Record<string, unknown> = {}) => ({
  action: 'quarantine',
  by: 'media',
  orgId: ORG,
  mediaId: MEDIA,
  reason: 'dmca',
  ...over,
})

beforeEach(() => {
  mockStore = {}
  mockAuditRows = []
  mockWrites = []
  mockInvalidations = 0
  Object.assign(mockDecodedToken, {
    uid: 'staff-super-1',
    email: 'ops@aglyn.com',
    email_verified: true,
    staff: true,
    staffRole: 'super',
  })
})

describe('AGL-1687 · the key comes from the document', () => {
  it('prefers the STRONG digest when the document has one (AGL-1631)', async () => {
    seedAsset()
    const payload = await (await post(mediaBody())).json()
    expect(payload.key).toBe(SHA_KEY)
    expect(payload.keyKind).toBe('sha256')
    expect(Object.keys(entries())).toEqual([SHA_KEY])
  })

  it('falls back to the legacy digest when there is no sha256', async () => {
    seedAsset({ contentSha256: null })
    const payload = await (await post(mediaBody())).json()
    expect(payload.key).toBe(LEGACY_KEY)
    expect(payload.keyKind).toBe('legacy')
  })

  it('falls back to the per-asset key when the file carries no digest at all', async () => {
    seedAsset({ contentSha256: null, contentHash: null })
    const payload = await (await post(mediaBody())).json()
    expect(payload.key).toBe(ASSET_KEY)
    expect(payload.keyKind).toBe('asset')
    expect(payload.asset.hasStrongDigest).toBe(false)
    expect(payload.asset.hasLegacyDigest).toBe(false)
  })

  it('derives the scope segment rather than accepting one — a typed segment cannot miss', async () => {
    seedAsset({ contentSha256: null, contentHash: null })
    const payload = await (
      await post(
        // A three-part segment is a real CDN URL shape and a key the DAM
        // never looks up. In media mode it is ignored outright.
        mediaBody({ scopeSegment: `org:${ORG}:site-7` }),
      )
    ).json()
    expect(payload.key).toBe(ASSET_KEY)
    expect(payload.asset.scopeSegment).toBe(`org:${ORG}`)
  })

  it('uses the host id verbatim for a site library', async () => {
    mockStore[`hosts/site-7/media/${MEDIA}`] = { contentSha256: null, contentHash: null }
    const payload = await (
      await post(mediaBody({ orgId: undefined, hostId: 'site-7' }))
    ).json()
    expect(payload.key).toBe(`asset--site-7--${MEDIA}`)
  })

  it('ignores a digest sent alongside — media mode is never steered by the body', async () => {
    seedAsset()
    const payload = await (
      await post(mediaBody({ contentHash: 'deadbeefdeadbeef' }))
    ).json()
    expect(payload.key).toBe(SHA_KEY)
    expect(entries()['hash--deadbeefdeadbeef']).toBeUndefined()
  })

  it('honours prefer: "asset" — the deliberate narrow takedown', async () => {
    seedAsset()
    const payload = await (await post(mediaBody({ prefer: 'asset' }))).json()
    expect(payload.key).toBe(ASSET_KEY)
    expect(Object.keys(entries())).toEqual([ASSET_KEY])
  })

  it('records the copy the operator was looking at, from the document', async () => {
    seedAsset()
    await post(mediaBody({ scopeSegment: 'typed-wrong', mediaId: MEDIA }))
    expect(entries()[SHA_KEY]['originScopeSegment']).toBe(`org:${ORG}`)
    expect(entries()[SHA_KEY]['originMediaId']).toBe(MEDIA)
  })
})

describe('AGL-1687 · resolving the asset', () => {
  it('404s a media id that does not exist rather than quarantining nothing', async () => {
    const response = await post(mediaBody())
    expect(response.status).toBe(404)
    expect(mockWrites).toEqual([])
  })

  it('refuses both orgId and hostId together', async () => {
    seedAsset()
    expect((await post(mediaBody({ hostId: 'site-7' }))).status).toBe(400)
  })

  it('refuses neither', async () => {
    expect((await post(mediaBody({ orgId: undefined }))).status).toBe(400)
  })

  it('refuses a scope id carrying a colon — the joiner is ours to add', async () => {
    expect((await post(mediaBody({ orgId: `org:${ORG}` }))).status).toBe(400)
  })

  it('quarantines a trashed file, and says so', async () => {
    seedAsset({ deletedAt: 1_700_000_000_000 })
    const payload = await (await post(mediaBody())).json()
    expect(payload.asset.deleted).toBe(true)
    expect(payload.confirmed).toBe(true)
  })
})

describe('AGL-1687 · release clears everything that is biting', () => {
  it('removes BOTH digest keys and the per-asset key in one action', async () => {
    seedAsset()
    mockStore[INDEX_PATH] = {
      entries: {
        [SHA_KEY]: { reason: 'dmca' },
        [LEGACY_KEY]: { reason: 'malware' },
        [ASSET_KEY]: { reason: 'abuse' },
      },
    }
    const payload = await (
      await post({ action: 'release', by: 'media', orgId: ORG, mediaId: MEDIA })
    ).json()
    expect(payload.keys.sort()).toEqual([ASSET_KEY, LEGACY_KEY, SHA_KEY].sort())
    expect(entries()).toEqual({})
    expect(payload.confirmed).toBe(true)
  })

  it('leaves an unrelated entry alone', async () => {
    seedAsset()
    mockStore[INDEX_PATH] = {
      entries: { [SHA_KEY]: { reason: 'dmca' }, 'hash--aaaaaaaaaaaaaaaa': { reason: 'abuse' } },
    }
    await post({ action: 'release', by: 'media', orgId: ORG, mediaId: MEDIA })
    expect(Object.keys(entries())).toEqual(['hash--aaaaaaaaaaaaaaaa'])
  })

  it('audits one row PER key released — two entries are two facts', async () => {
    seedAsset()
    mockStore[INDEX_PATH] = {
      entries: { [SHA_KEY]: { reason: 'dmca' }, [ASSET_KEY]: { reason: 'abuse' } },
    }
    await post({ action: 'release', by: 'media', orgId: ORG, mediaId: MEDIA })
    expect(mockAuditRows).toHaveLength(2)
    expect(mockAuditRows.map((row) => (row['before'] as any).reason).sort()).toEqual(
      ['abuse', 'dmca'],
    )
    for (const row of mockAuditRows) {
      expect(row['action']).toBe('mediaQuarantine.release')
      expect((row['after'] as any).quarantined).toBe(false)
    }
  })

  it('audits a release that found nothing, rather than losing it', async () => {
    seedAsset()
    const payload = await (
      await post({ action: 'release', by: 'media', orgId: ORG, mediaId: MEDIA })
    ).json()
    expect(payload.keys).toEqual([SHA_KEY])
    expect(mockAuditRows).toHaveLength(1)
    expect((mockAuditRows[0]['before'] as any).quarantined).toBe(false)
    expect(payload.confirmed).toBe(true)
  })

  it('reports NOT CONFIRMED when a key survives the write', async () => {
    seedAsset()
    mockStore[INDEX_PATH] = {
      entries: { [SHA_KEY]: { reason: 'dmca' }, [ASSET_KEY]: { reason: 'abuse' } },
    }
    // A write that returns while the state disagrees is the exact failure
    // AGL-1571's read-back exists to catch. Forced by making the delete of
    // the per-asset key a no-op.
    const realMerge = mockStore[INDEX_PATH]
    const handle = mockDocHandle(INDEX_PATH)
    jest
      .spyOn(mockFirestore, 'collection')
      .mockImplementation(((name: string) =>
        name === MEDIA_QUARANTINES_COLLECTION
          ? {
              doc: () => ({
                ...handle,
                set: async () => {
                  mockStore[INDEX_PATH] = {
                    entries: { [ASSET_KEY]: (realMerge as any).entries[ASSET_KEY] },
                  }
                },
              }),
            }
          : mockCollectionHandle(name)) as any)
    const payload = await (
      await post({ action: 'release', by: 'media', orgId: ORG, mediaId: MEDIA })
    ).json()
    expect(payload.confirmed).toBe(false)
    ;(mockFirestore.collection as unknown as jest.Mock).mockRestore()
  })
})

describe('AGL-1687 · the gates that already existed still hold', () => {
  it('refuses a support-role operator', async () => {
    mockDecodedToken['staffRole'] = 'support'
    seedAsset()
    expect((await post(mediaBody())).status).toBe(403)
    expect(mockWrites).toEqual([])
  })

  it('refuses a lockdown reason code — the vocabularies are not the same', async () => {
    seedAsset()
    expect((await post(mediaBody({ reason: 'security' }))).status).toBe(400)
  })

  it('refuses a new entry once the deny list is full', async () => {
    seedAsset()
    mockStore[INDEX_PATH] = {
      entries: Object.fromEntries(
        Array.from({ length: MEDIA_QUARANTINE_MAX_ENTRIES }, (_unused, index) => [
          `hash--full${index}`,
          { reason: 'manual' },
        ]),
      ),
    }
    const response = await post(mediaBody())
    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain('full')
  })
})

describe('AGL-1687 · the unwritten lookup', () => {
  it('answers with every key, what is set, and the cap', async () => {
    seedAsset()
    mockStore[INDEX_PATH] = {
      entries: { [LEGACY_KEY]: { reason: 'dmca', note: 'Notice #4417' } },
    }
    const payload = await (await get(`?orgId=${ORG}&mediaId=${MEDIA}`)).json()
    expect(payload.keys.map((entry: any) => entry.kind)).toEqual([
      'sha256',
      'legacy',
      'asset',
    ])
    expect(payload.quarantined).toBe(true)
    expect(payload.keys[0].state).toBeNull()
    expect(payload.keys[1].state.reason).toBe('dmca')
    expect(payload.maxEntries).toBe(MEDIA_QUARANTINE_MAX_ENTRIES)
    expect(payload.count).toBe(1)
  })

  it('carries the staff note — this route is staff-gated end to end', async () => {
    seedAsset()
    mockStore[INDEX_PATH] = {
      entries: { [SHA_KEY]: { reason: 'dmca', note: 'Notice #4417' } },
    }
    const payload = await (await get(`?orgId=${ORG}&mediaId=${MEDIA}`)).json()
    expect(payload.keys[0].note).toBe('Notice #4417')
    // …and never through `state`, which is the shape a customer surface reads.
    expect(payload.keys[0].state.note).toBeUndefined()
  })

  it('is open to a support-role reader — "is this already disabled" is a support question', async () => {
    mockDecodedToken['staffRole'] = 'support'
    seedAsset()
    expect((await get(`?orgId=${ORG}&mediaId=${MEDIA}`)).status).toBe(200)
  })

  it('writes nothing', async () => {
    seedAsset()
    await get(`?orgId=${ORG}&mediaId=${MEDIA}`)
    expect(mockWrites).toEqual([])
    expect(mockAuditRows).toEqual([])
  })

  it('404s an unknown file', async () => {
    expect((await get(`?orgId=${ORG}&mediaId=nope`)).status).toBe(404)
  })

  it('leaves the plain listing untouched', async () => {
    mockStore[INDEX_PATH] = { entries: { [SHA_KEY]: { reason: 'dmca' } } }
    const payload = await (await get('')).json()
    expect(payload.records).toEqual([{ key: SHA_KEY, reason: 'dmca' }])
  })
})
