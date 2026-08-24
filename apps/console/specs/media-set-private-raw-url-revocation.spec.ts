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
 * "Make private" actually makes it private (AGL-1881).
 *
 * ## What was wrong
 *
 * `POST /api/media/folders {action:'set-private'}` set `private: true` and
 * deleted `cdnPath`. Both of those close the path OUR code serves. Neither
 * touches the other one: every upload route also mints a Firebase download
 * token and stores
 *
 *     https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{path}
 *       ?alt=media&token={firebaseStorageDownloadTokens}
 *
 * on the document's `url`, and **no code of ours runs on that origin**. The
 * `private` flag is a Firestore field Google's edge has never heard of. So
 * the URL that had already been copied into a brief, an email or a Slack
 * thread went on serving the bytes — forever — while the console said the
 * file was private and the confirmation dialog promised it would "stop
 * working anywhere it is already used".
 *
 * That sentence is the finding. A private setting that does not make the
 * thing private is a promise we publish.
 *
 * `rotateDownloadTokenForObject` has existed since AGL-1526 and was wired to
 * lockdown and to asset quarantine. This wires it to the third caller, and
 * pins the two halves that make the wiring honest: an outstanding link dies
 * IMMEDIATELY, and publishing again is not a one-way door.
 *
 * ## What this suite does NOT claim
 *
 * Bytes already delivered. A browser cache, a downstream CDN, a scraper's
 * disk. Rotation stops new fetches at an origin we do not control; it is not
 * a recall, and the confirmation copy says so.
 */

const ORG = 'acme'
const MEDIA = 'm1'
const OBJECT_PATH = `orgs/${ORG}/media/${MEDIA}`
const MEDIA_DOC = `orgs/${ORG}/media/${MEDIA}`
const PUBLISHED_TOKEN = 'the-token-already-handed-out'

let mockStore: Record<string, Record<string, unknown>> = {}
/** Storage object path → its custom metadata map. */
let mockObjects: Record<string, Record<string, unknown>> = {}
/** Object paths whose metadata was rewritten, in order. */
let mockMetadataWrites: string[] = []
let mockStorageThrows = false
let mockOrgWide = true

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
    if (value === mockDelete) delete next[key]
    else next[key] = value
  }
  return next
}

const mockDocHandle = (path: string): any => {
  const handle: any = {
    id: path.split('/').pop(),
    get: async () => {
      const data = mockStore[path] ? { ...mockStore[path] } : undefined
      return {
        id: handle.id,
        exists: data !== undefined,
        data: () => data,
        get: (field: string) => data?.[field],
        ref: handle,
      }
    },
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      mockStore[path] = options?.merge
        ? mergeInto(mockStore[path] ?? {}, data)
        : data
    },
    collection: (child: string) => mockCollectionHandle(`${path}/${child}`),
  }
  return handle
}

const mockCollectionHandle = (prefix: string): any => ({
  doc: (id: string) => mockDocHandle(`${prefix}/${id}`),
  where: () => ({ get: async () => ({ docs: [] }) }),
  limit: () => ({ get: async () => ({ docs: [] }) }),
})

const mockFirestore = { collection: mockCollectionHandle }

/**
 * The bucket, modelled the way `@google-cloud/storage` actually behaves —
 * and the second property is the one that matters here.
 *
 *  1. `setMetadata` REPLACES the whole custom map rather than merging, so
 *     "customer metadata survives a revocation" is a real assertion.
 *  2. `bucket.file(path)` returns a BARE handle: `.metadata` is `{}` until
 *     something fetches it. Modelling it hydrated is how the sibling
 *     quarantine suite stayed green for a control that never fired.
 */
const mockBucketFile = (path: string) => ({
  name: path,
  metadata: {},
  exists: async () => [mockObjects[path] !== undefined],
  getMetadata: async () => {
    if (mockStorageThrows) throw new Error('storage said no')
    if (mockObjects[path] === undefined) throw new Error('404 No such object')
    return [{ name: path, metadata: { ...mockObjects[path] } }]
  },
  setMetadata: async (patch: { metadata?: Record<string, unknown> }) => {
    if (mockStorageThrows) throw new Error('storage said no')
    mockMetadataWrites.push(path)
    mockObjects[path] = { ...(patch.metadata ?? {}) }
  },
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  // The REAL rotation and the REAL URL rebuild. Stubbing them would leave
  // this file asserting that a mock was called, which is the shape of a test
  // that keeps passing after the control is deleted.
  ...jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/media-download-tokens',
  ),
  // The REAL scope check too (AGL-1881/AGL-2484): `storagePath` is client
  // data handed to `bucket.file()` on the Admin SDK. Stubbing it would let
  // this suite pass on a route that addressed any object in the bucket —
  // and a barrel mock missing an export the route calls is how six media
  // specs went green on a route that 500'd.
  ...jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/media-storage-path',
  ),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'u1', email_verified: true }),
      }),
      firestore: () => mockFirestore,
      storage: () => ({
        bucket: () => ({ name: 'aglyn-media', file: mockBucketFile }),
      }),
    }),
    firestore: {
      FieldValue: {
        serverTimestamp: () => mockServerTimestamp,
        delete: () => mockDelete,
      },
    },
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

/** The org media library's document ref, which the route writes through. */
const mockOrgScopeRef = mockDocHandle(`orgs/${ORG}`)

jest.mock('../utils/server/media-scope', () => {
  const actual = jest.requireActual('../utils/server/media-scope')
  return {
    __esModule: true,
    ...actual,
    resolveMediaScope: async () => ({
      scope: {
        scopeRef: mockOrgScopeRef,
        base: `orgs/${ORG}`,
        cdnScope: `org:${ORG}`,
        billing: { plan: 'business' },
        viewerOrgWide: mockOrgWide,
        viewerTokens: ['org'],
      },
      error: undefined,
    }),
  }
})

const route = require('../app/api/media/folders/route') as {
  POST: (request: Request) => Promise<Response>
}

async function setPrivate(isPrivate: boolean): Promise<Response> {
  return route.POST(
    new Request('https://app.aglyn.com/api/media/folders', {
      method: 'POST',
      headers: {
        authorization: 'Bearer id-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        orgId: ORG,
        action: 'set-private',
        mediaId: MEDIA,
        private: isPrivate,
      }),
    }),
  )
}

const tokenOf = () => mockObjects[OBJECT_PATH]?.['firebaseStorageDownloadTokens']
const doc = () => mockStore[MEDIA_DOC] ?? {}

const publishedUrl = (token: string) =>
  `https://firebasestorage.googleapis.com/v0/b/aglyn-media/o/` +
  `${encodeURIComponent(OBJECT_PATH)}?alt=media&token=${token}`

beforeEach(() => {
  mockStore = {
    [MEDIA_DOC]: {
      fileName: 'q3-pricing.pdf',
      storagePath: OBJECT_PATH,
      url: publishedUrl(PUBLISHED_TOKEN),
      cdnPath: `/api/media/cdn/org:${ORG}/${MEDIA}`,
      private: false,
    },
  }
  mockObjects = {
    [OBJECT_PATH]: {
      firebaseStorageDownloadTokens: PUBLISHED_TOKEN,
      // A pair the customer set. It must survive a revocation.
      shootDate: '2026-03-02',
    },
  }
  mockMetadataWrites = []
  mockStorageThrows = false
  mockOrgWide = true
})

describe('set-private revokes the raw download URL (AGL-1881)', () => {
  it('kills the link that was ALREADY handed out, immediately', async () => {
    // The finding, in one assertion. Against the un-wired route the token is
    // untouched and the URL keeps serving the bytes indefinitely.
    const response = await setPrivate(true)
    expect(response.status).toBe(200)
    expect(tokenOf()).toBeTruthy()
    expect(tokenOf()).not.toBe(PUBLISHED_TOKEN)
    // There is no grace period, and none is wanted: the whole complaint is
    // that the outstanding link kept working.
    expect(mockMetadataWrites).toEqual([OBJECT_PATH])
  })

  it('does not leave the dead URL on the document', async () => {
    // After a rotation the stored value is a dead link, and a dead link in
    // the field the DAM renders from is a broken tile rather than an honest
    // placeholder.
    await setPrivate(true)
    expect(doc()['url']).toBeUndefined()
    expect(doc()['private']).toBe(true)
    // `cdnPath` still moves with the flag — that half was never broken.
    expect(doc()['cdnPath']).toBeUndefined()
  })

  it('keeps the customer metadata the object already carried', async () => {
    // `setMetadata` replaces the whole custom map. Making a file private is
    // not a data-loss event.
    await setPrivate(true)
    expect(mockObjects[OBJECT_PATH]?.['shootDate']).toBe('2026-03-02')
  })

  it('REPORTS the revocation instead of assuming it', async () => {
    const payload = await (await setPrivate(true)).json()
    expect(payload.rawUrlRevoked).toBe(true)
    expect(payload.rawUrlRevocation).toBe('rotated')
    expect(payload.rawUrlCleared).toBe(true)
  })

  it('still flips the flag when Storage is unreachable — and SAYS the link may live', async () => {
    // FAIL SOFT: a Storage blip must not become a "you cannot make this
    // private" outage. But telling someone their public link is dead when it
    // is not is the exact failure this change is about, so the response says
    // which of the two happened.
    mockStorageThrows = true
    const response = await setPrivate(true)
    expect(response.status).toBe(200)
    expect(doc()['private']).toBe(true)
    const payload = await response.json()
    expect(payload.rawUrlRevoked).toBe(false)
    expect(payload.rawUrlCleared).toBe(false)
  })

  it('MINTS NOTHING on an object that never had a raw URL', async () => {
    // Writing a token where none existed would CREATE the public URL this
    // lever exists to remove. `no-token` is the correct benign case, and it
    // must not be reported as a failed revocation — there is no live link.
    mockObjects[OBJECT_PATH] = { shootDate: '2026-03-02' }
    const payload = await (await setPrivate(true)).json()
    expect(tokenOf()).toBeUndefined()
    expect(mockMetadataWrites).toEqual([])
    expect(payload.rawUrlRevoked).toBe(false)
    expect(payload.rawUrlCleared).toBe(true)
  })
})

describe('publishing again is not a one-way door', () => {
  it('rebuilds `url` from the token the object CURRENTLY carries', async () => {
    // For a workspace without `mediaCdn`, `url` is the only delivery path.
    // Deleting it on going private and never restoring it would turn
    // "Publish" into a button that leaves the asset unreachable.
    await setPrivate(true)
    const rotated = String(tokenOf())
    expect(doc()['url']).toBeUndefined()

    await setPrivate(false)
    expect(doc()['private']).toBe(false)
    expect(doc()['url']).toBe(publishedUrl(rotated))
  })

  it('does NOT un-rotate — every pre-private URL stays dead', async () => {
    // The restore READS the current token; it does not mint one and it does
    // not put the old one back. Anything holding the original link is still
    // refused at Google's edge.
    await setPrivate(true)
    const rotated = String(tokenOf())
    mockMetadataWrites = []
    await setPrivate(false)
    expect(tokenOf()).toBe(rotated)
    expect(tokenOf()).not.toBe(PUBLISHED_TOKEN)
    expect(mockMetadataWrites).toEqual([])
    expect(String(doc()['url'])).not.toContain(PUBLISHED_TOKEN)
  })

  it('writes no `url` at all when there is no token to rebuild from', async () => {
    // A `url: ''` on the document is a value every renderer then has to
    // reason about; absence already means "no raw delivery path".
    mockObjects[OBJECT_PATH] = {}
    mockStore[MEDIA_DOC] = {
      fileName: 'q3-pricing.pdf',
      storagePath: OBJECT_PATH,
      private: true,
    }
    await setPrivate(false)
    expect(doc()['url']).toBeUndefined()
    expect(doc()['private']).toBe(false)
  })
})

describe('the gate around it is unchanged', () => {
  it('refuses a site-scoped collaborator, as it always did', async () => {
    // Turning an asset public is a publish, and a collaborator scoped to one
    // client site has no standing to publish the agency's files. Asserted
    // here because this change added two Storage calls to the branch and a
    // reordering could easily have put them above the check.
    mockOrgWide = false
    const response = await setPrivate(true)
    expect(response.status).toBe(403)
    expect(tokenOf()).toBe(PUBLISHED_TOKEN)
    expect(mockMetadataWrites).toEqual([])
  })
})
