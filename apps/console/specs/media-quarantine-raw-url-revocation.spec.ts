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
 * A quarantine kills the raw download URL too (AGL-1615).
 *
 * ## The hole this closes, which is not a caching residual
 *
 * Asset quarantine refuses at `serveMediaCdn`, and `serveMediaCdn` is ours,
 * so the deny list works there. But a media document also carries a `url`
 * field of the form
 *
 *     https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{path}
 *       ?alt=media&token={firebaseStorageDownloadTokens}
 *
 * served by Google, where **no code of ours runs**. The deny list is not
 * slow on that path — it is never consulted. And that path is not exotic:
 * the console DAM and `GET /api/v1/media` both fall back to `url` whenever
 * an asset has no `cdnPath`, which is every free-tier workspace, every
 * private asset and every upload predating AGL-829.
 *
 * So a DMCA'd or malware-flagged file on a free workspace could be
 * quarantined, show `Disabled` in the console, 410 at our CDN — and go on
 * serving its bytes to anyone holding the link, indefinitely. AGL-1526
 * built the only lever that reaches there (rotate the object's token, which
 * makes Google's edge answer 403 at once), but wired it to a `security`
 * lockdown of a whole scope, so per-asset quarantine never got it.
 *
 * ## Why this is the ONLY thing here that is a genuine invalidation
 *
 * Everything else AGL-1615 lists is a cache window that expires on its own:
 * ~15 s at our origin, 60 s in a browser, up to an hour at the image edge.
 * Token rotation is different in kind — it makes an already-published URL
 * stop working immediately, at an origin we do not control. It is also
 * IRREVERSIBLE for embeds, which is why it is reported, auditable, and
 * refusable by the operator rather than silent.
 */

import {
  MEDIA_QUARANTINE_INDEX_DOC_ID,
  MEDIA_QUARANTINES_COLLECTION,
} from '@aglyn/aglyn/server'

const INDEX_PATH = `${MEDIA_QUARANTINES_COLLECTION}/${MEDIA_QUARANTINE_INDEX_DOC_ID}`

const SHA = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
const ORG = 'acme'
const MEDIA = 'm1'
const OBJECT_PATH = `orgs/${ORG}/media/${MEDIA}`

let mockStore: Record<string, Record<string, unknown>> = {}
let mockAuditRows: Record<string, unknown>[] = []
/** Storage object path → its custom metadata map. */
let mockObjects: Record<string, Record<string, unknown>> = {}
/** Object paths whose metadata was rewritten, in order. */
let mockMetadataWrites: string[] = []
let mockStorageThrows = false
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

function mergeInto(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    if (value === mockDelete) {
      delete next[key]
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
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
    mockStore[path] = options?.merge
      ? mergeInto(mockStore[path] ?? {}, data)
      : data
  },
  collection: (child: string) => mockCollectionHandle(`${path}/${child}`),
})

const mockCollectionHandle = (prefix: string): any => ({
  add: async (data: Record<string, unknown>) => {
    if (prefix !== 'adminAudit') throw new Error(`unexpected add: ${prefix}`)
    mockAuditRows.push(data)
    return { id: `audit-${mockAuditRows.length}` }
  },
  doc: (id: string) => mockDocHandle(`${prefix}/${id}`),
})

const mockFirestore = { collection: mockCollectionHandle }

/**
 * The bucket, modelled the way `rotateOne` in `media-download-tokens.ts`
 * actually uses it: the custom-metadata map is READ from `metadata.metadata`
 * and a `setMetadata` REPLACES the whole map. Modelling the replace is what
 * makes "customer metadata survives a rotation" provable rather than
 * assumed — a double that merged would hide the exact trap that module's
 * `rotateOne` documents.
 */
const mockBucketFile = (path: string) => ({
  name: path,
  metadata: { metadata: mockObjects[path] },
  exists: async () => [mockObjects[path] !== undefined],
  setMetadata: async (patch: { metadata?: Record<string, unknown> }) => {
    if (mockStorageThrows) throw new Error('storage said no')
    mockMetadataWrites.push(path)
    mockObjects[path] = { ...(patch.metadata ?? {}) }
  },
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  // The REAL rotation. A stub would leave this file asserting that a mock
  // was called, which is the shape of a test that keeps passing after the
  // control is deleted.
  ...jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/media-download-tokens',
  ),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => mockDecodedToken }),
      firestore: () => mockFirestore,
      storage: () => ({
        bucket: () => ({ name: 'bucket', file: mockBucketFile }),
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  invalidateMediaQuarantineCache: () => undefined,
}))

const route = require('../app/api/admin/media-quarantine/route') as {
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

const entries = () =>
  (mockStore[INDEX_PATH]?.['entries'] ?? {}) as Record<
    string,
    Record<string, unknown>
  >

const tokenOf = (path = OBJECT_PATH) =>
  mockObjects[path]?.['firebaseStorageDownloadTokens']

function seedAsset(fields: Record<string, unknown> = {}) {
  mockStore[`orgs/${ORG}/media/${MEDIA}`] = {
    fileName: 'invoice.pdf',
    contentSha256: SHA,
    storagePath: OBJECT_PATH,
    ...fields,
  }
}

const quarantine = (over: Record<string, unknown> = {}) => ({
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
  mockObjects = {
    [OBJECT_PATH]: {
      firebaseStorageDownloadTokens: 'the-published-token',
      // A pair a customer set. It must survive.
      shootDate: '2026-03-02',
    },
  }
  mockMetadataWrites = []
  mockStorageThrows = false
  Object.assign(mockDecodedToken, {
    uid: 'staff-super-1',
    email: 'ops@aglyn.com',
    email_verified: true,
    staff: true,
    staffRole: 'super',
  })
})

describe('quarantine revokes the raw Storage URL (AGL-1615)', () => {
  it('rotates the object token, so the published link dies at once', async () => {
    seedAsset()
    const response = await post(quarantine())
    expect(response.status).toBe(200)
    expect(tokenOf()).toBeTruthy()
    expect(tokenOf()).not.toBe('the-published-token')
  })

  it('keeps the customer metadata the object already carried', async () => {
    // `setMetadata` replaces the whole custom map. A rotation that dropped
    // it would silently erase customer-set pairs — a takedown is not a
    // data-loss event.
    seedAsset()
    await post(quarantine())
    expect(mockObjects[OBJECT_PATH]?.['shootDate']).toBe('2026-03-02')
  })

  it('reports the revocation, so the console can say it rather than assume it', async () => {
    seedAsset()
    const payload = await (await post(quarantine())).json()
    expect(payload.rawUrlRevoked).toBe(true)
  })

  it('does NOT mint a token on an object that had none', async () => {
    // Writing one where none existed would CREATE a public raw URL for a
    // file that never had one — the exposure this lever exists to remove.
    mockObjects[OBJECT_PATH] = { shootDate: '2026-03-02' }
    seedAsset()
    const payload = await (await post(quarantine())).json()
    expect(tokenOf()).toBeUndefined()
    expect(mockMetadataWrites).toEqual([])
    expect(payload.rawUrlRevoked).toBe(false)
  })

  it('still takes the file down when Storage is unreachable', async () => {
    // FAIL SOFT. A Storage outage must not become a takedown outage: the
    // deny-list entry is the primary control and it must land regardless.
    mockStorageThrows = true
    seedAsset()
    const response = await post(quarantine())
    expect(response.status).toBe(200)
    expect(entries()[`hash--${SHA}`]).toBeTruthy()
    const payload = await response.json()
    // …and it says so, rather than reporting a revocation that did not happen.
    expect(payload.rawUrlRevoked).toBe(false)
  })

  it('lets an operator decline the revocation for a suspected false positive', async () => {
    // Rotation is irreversible for embeds, and quarantine's whole promise is
    // that it is reversible. So the operator can keep that promise intact
    // when the takedown is precautionary rather than legal.
    seedAsset()
    const payload = await (await post(quarantine({ revokeRawUrl: false }))).json()
    expect(tokenOf()).toBe('the-published-token')
    expect(payload.rawUrlRevoked).toBe(false)
  })

  it('does NOT rotate on a release — the old link stays dead', async () => {
    // There is no un-rotate. Minting a fresh token on release would hand
    // back a WORKING raw URL under a new value while every embed of the old
    // one stays broken, which helps nobody and re-publishes the bytes.
    seedAsset()
    await post(quarantine())
    const afterTakedown = tokenOf()
    mockMetadataWrites = []
    await post(quarantine({ action: 'release' }))
    expect(tokenOf()).toBe(afterTakedown)
    expect(mockMetadataWrites).toEqual([])
  })

  it('records the revocation in the audit row', async () => {
    // An irreversible act on customer data with no record is the shape of a
    // control nobody can explain a year later.
    seedAsset()
    await post(quarantine())
    expect(mockAuditRows.some((row) => row['rawUrlRevoked'] === true)).toBe(true)
  })

  it('revokes only the copy the operator was looking at', async () => {
    // A hash key covers every document sharing those bytes, in every
    // workspace. Rotation reaches ONE object — the one whose document the
    // route read. Chasing the rest would mean a collection-group scan on a
    // takedown path. Asserted so the limit is a decision, not a surprise.
    mockObjects['hosts/other/media/m9'] = {
      firebaseStorageDownloadTokens: 'someone-elses-token',
    }
    seedAsset()
    await post(quarantine())
    expect(mockObjects['hosts/other/media/m9']?.['firebaseStorageDownloadTokens']).toBe(
      'someone-elses-token',
    )
  })

  it('skips silently when the document records no object path', async () => {
    seedAsset({ storagePath: undefined })
    const response = await post(quarantine())
    expect(response.status).toBe(200)
    expect(mockMetadataWrites).toEqual([])
  })
})
