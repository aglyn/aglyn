/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * The sanitizer is WIRED, at every path that can put bytes in the bucket
 * (AGL-1474).
 *
 * `sanitize-svg.spec.ts` proves the function strips script. That is the
 * cheaper half. The half that decays is whether every write path calls it —
 * the standing lesson being that a control which exists and is never invoked
 * reads exactly like a control. So these assertions run the REAL route
 * handlers and read what was handed to `file.save`.
 *
 * AGL-1474 named two chokepoints and reasoned that they were complete
 * coverage, because Storage rules deny all direct client writes. The rules
 * claim holds. The route inventory did not: a legacy fourth org-media upload
 * route was a third byte-write path onto `orgs/{orgId}/media/{id}` — the exact
 * object path and collection the CDN resolves for the `org:` scope — and it
 * had no type allowlist at all, so it accepted `text/html` outright. It was
 * covered here until AGL-1485 DELETED it: its last caller went in AGL-821, and
 * it also minted a document missing `storagePath`, `contentHash`, `cdnPath`,
 * `variants` and `folderId` while never moving `counters/media`. The coverage
 * claim this file makes is now true of three paths because there are three,
 * which `media-create-shape.spec.ts` is what keeps honest.
 *
 * `/api/media/upload-url` is the third. Its bytes never pass through the
 * server on the way in (the browser PUTs them straight to GCS), so the strip
 * happens at finalize; the assertion is that finalize downloads, rewrites and
 * re-reads the object's identity rather than filing the doc against bytes it
 * never looked at.
 */

const mockVerifyIdToken = jest.fn()
const mockFileSave = jest.fn()
const mockMediaSet = jest.fn()
const mockFileDownload = jest.fn()
const mockSetMetadata = jest.fn()

const state: {
  org: Record<string, unknown>
  /** What `getMetadata()` reports for the signed-upload object. */
  objectMetadata: Record<string, unknown>
  /** What it reports AFTER a sanitizing re-save, when the test sets one. */
  rewrittenMetadata: Record<string, unknown> | null
  metadataCalls: number
  /** The existing doc `/api/media/replace` reads. */
  existing: Record<string, unknown>
} = {
  org: { plan: 'pro' },
  objectMetadata: {},
  rewrittenMetadata: null,
  metadataCalls: 0,
  existing: {},
}

const counterDoc = () => ({
  get: async () => ({ exists: true, get: () => 0 }),
  set: async () => undefined,
})

const mediaDoc = (): Record<string, unknown> => ({
  get: async () => ({
    exists: true,
    get: (field: string) => state.existing[field],
    // The upload routes read the ORG doc for its AGL-1048
    // `defaultResourceScope` before stamping an upload (AGL-1478).
    data: () => state.org,
  }),
  set: (...args: unknown[]) => {
    mockMediaSet(...args)
    return Promise.resolve()
  },
  delete: async () => undefined,
  collection: () => ({ doc: () => mediaDoc() }),
})

const scopeRef = {
  collection: (name: string) => ({
    doc: () => (name === 'counters' ? counterDoc() : mediaDoc()),
  }),
}

const storageFile = () => ({
  name: 'object',
  exists: async () => [true],
  getMetadata: async () => {
    state.metadataCalls++
    return [
      state.metadataCalls > 1 && state.rewrittenMetadata
        ? state.rewrittenMetadata
        : state.objectMetadata,
    ]
  },
  download: async () => [mockFileDownload()],
  setMetadata: (...args: unknown[]) => {
    mockSetMetadata(...args)
    return Promise.resolve()
  },
  save: (...args: unknown[]) => {
    mockFileSave(...args)
    return Promise.resolve()
  },
  delete: async () => undefined,
  getSignedUrl: async () => ['https://storage.test/put'],
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  // Finalize generates variants for signed-path images now (AGL-1476), so it
  // depends on this module. The REAL one, not a stub: it is what guarantees an
  // SVG and a video return `{ variants: [] }` without a download, which is the
  // property the "never downloads a non-SVG" case below is asserting.
  ...jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/media-variants',
  ),
  firebaseAdmin: {
    firestore: {
      FieldValue: {
        increment: (by: number) => ({ __increment: by }),
        serverTimestamp: () => ({ __serverTimestamp: true }),
        delete: () => ({ __delete: true }),
      },
    },
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({ collection: () => ({ doc: () => mediaDoc() }) }),
      storage: () => ({
        bucket: () => ({ name: 'bucket', file: storageFile }),
      }),
    }),
  },
  generateMediaVariants: jest.fn(async () => ({ variants: [], error: undefined })),
  isImpersonationSession: () => false,
  resolveOrgMembership: async () => ({ member: { role: 'owner' } }),
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  createResourceUid: () => 'media-1',
  readImageDimensions: () => undefined,
  defaultScopeForNewResource: () => ['org'],
  newResourceScopeFields: (visibleTo: string[] | null) =>
    visibleTo ? { visibleTo } : {},
  orgRoleAtLeast: () => true,
  ORG_SCOPE_TOKEN: 'org',
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

jest.mock('../utils/server/media-scope', () => ({
  __esModule: true,
  resolveMediaScope: async () => ({
    scope: {
      base: 'orgs/org-1',
      collection: 'orgs',
      scopeId: 'org-1',
      scopeRef,
      billing: state.org,
      cdnScope: 'org:org-1',
      viewerTokens: ['org'],
      viewerOrgWide: true,
    },
  }),
  folderStoragePath: async () => '',
  mediaObjectPath: () => 'orgs/org-1/media/media-1',
  mediaCdnPathUpdate: () => '/api/media/cdn/org:org-1/media-1',
  scopeAllows: () => true,
}))

import { POST as uploadPost } from '../app/api/media/upload/route'
import { POST as replacePost } from '../app/api/media/replace/route'
import { PATCH as finalize } from '../app/api/media/upload-url/route'

/** The payload AGL-1474 names, inside an otherwise ordinary brand mark. */
const HOSTILE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
  '<script>alert(document.domain)</script>' +
  '<path d="M4 4h16v16H4z" fill="#0B5FFF"/></svg>'

const CLEAN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
  '<path d="M4 4h16v16H4z" fill="#0B5FFF"/></svg>'

/** What the route actually handed to Storage. */
const savedBytes = (): string => String(mockFileSave.mock.calls[0]?.[0] ?? '')

const savedDoc = (): Record<string, unknown> =>
  (mockMediaSet.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>

const json = (body: unknown) =>
  JSON.stringify(body as Record<string, unknown>)

beforeEach(() => {
  jest.clearAllMocks()
  state.org = { plan: 'pro' }
  state.existing = { contentType: 'image/svg+xml', visibleTo: ['org'] }
  state.objectMetadata = {
    contentType: 'image/svg+xml',
    size: HOSTILE_SVG.length,
    md5Hash: Buffer.from('0123456789abcdef', 'hex').toString('base64'),
  }
  state.rewrittenMetadata = null
  state.metadataCalls = 0
  mockFileDownload.mockReturnValue(Buffer.from(HOSTILE_SVG, 'utf8'))
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
})

describe('/api/media/upload strips the payload before it is stored (AGL-1474)', () => {
  const upload = (svg: string, contentType = 'image/svg+xml') =>
    uploadPost(
      new Request('https://app.aglyn.com/api/media/upload', {
        method: 'POST',
        headers: { authorization: 'Bearer tok' },
        body: json({
          orgId: 'org-1',
          fileName: 'mark.svg',
          contentType,
          data: Buffer.from(svg, 'utf8').toString('base64'),
        }),
      }),
    )

  it('stores bytes with no script in them', async () => {
    expect((await upload(HOSTILE_SVG)).status).toBe(200)
    expect(savedBytes()).not.toContain('alert')
    expect(savedBytes()).not.toContain('<script')
    // The mark itself survives — this is a strip, not a rejection.
    expect(savedBytes()).toContain('M4 4h16v16H4z')
  })

  it('accepts the SVG rather than 415ing it — logos stay uploadable', async () => {
    expect((await upload(CLEAN_SVG)).status).toBe(200)
  })

  it('leaves a clean SVG byte-identical', async () => {
    await upload(CLEAN_SVG)
    expect(savedBytes()).toBe(CLEAN_SVG)
    expect(savedDoc()['svgSanitized']).toBeUndefined()
  })

  it('writes down WHAT was removed, so a hostile upload is findable later', async () => {
    await upload(HOSTILE_SVG)
    expect(savedDoc()['svgSanitized']).toEqual(['script'])
  })

  it('meters the bytes it actually stored', async () => {
    await upload(HOSTILE_SVG)
    expect(savedDoc()['sizeBytes']).toBe(
      Buffer.byteLength(String(savedBytes()), 'utf8'),
    )
  })

  it('does not touch a PNG — the sanitizer is type-scoped', async () => {
    const png = '\x89PNG not-really <script>alert(1)</script>'
    await upload(png, 'image/png')
    expect(savedBytes()).toBe(png)
  })
})

describe('/api/media/replace closes the LATER door (AGL-1474)', () => {
  const replace = (svg: string, contentType = 'image/svg+xml') =>
    replacePost(
      new Request('https://app.aglyn.com/api/media/replace', {
        method: 'POST',
        headers: { authorization: 'Bearer tok' },
        body: json({
          orgId: 'org-1',
          mediaId: 'media-1',
          contentType,
          data: Buffer.from(svg, 'utf8').toString('base64'),
        }),
      }),
    )

  it('sanitizes bytes swapped in under an already-published cdnPath', async () => {
    // Replace deliberately keeps the stable `cdnPath` so references never
    // break — which is exactly what makes it the more dangerous door: the URL
    // is already embedded in published pages.
    expect((await replace(HOSTILE_SVG)).status).toBe(200)
    expect(savedBytes()).not.toContain('alert')
    expect(savedDoc()['svgSanitized']).toEqual(['script'])
  })

  it('CLEARS the marker on a clean replace — it is a merge write', async () => {
    await replace(CLEAN_SVG)
    expect(savedBytes()).toBe(CLEAN_SVG)
    expect(savedDoc()['svgSanitized']).toEqual({ __delete: true })
  })
})

describe('/api/media/upload-url finalizes on bytes it has LOOKED at (AGL-1474)', () => {
  const patch = () =>
    finalize(
      new Request('https://app.aglyn.com/api/media/upload-url', {
        method: 'PATCH',
        headers: { authorization: 'Bearer tok' },
        body: json({ orgId: 'org-1', mediaId: 'media-1', fileName: 'mark.svg' }),
      }),
    )

  it('downloads, strips and REWRITES the object the browser PUT', async () => {
    // The bytes never passed through this server on the way in, so finalize
    // is the first moment anything of ours can see them.
    expect((await patch()).status).toBe(200)
    expect(mockFileDownload).toHaveBeenCalled()
    expect(savedBytes()).not.toContain('alert')
    expect(savedDoc()['svgSanitized']).toEqual(['script'])
  })

  it('re-reads size and hash after the rewrite instead of reusing stale ones', async () => {
    // The ETag and the immutable content-hashed URL are both built from these.
    // Filing the pre-sanitization md5 would pin a hash for bytes that are no
    // longer in the bucket, and the immutable URL would 404 forever.
    state.rewrittenMetadata = {
      contentType: 'image/svg+xml',
      size: 4242,
      md5Hash: Buffer.from('fedcba9876543210', 'hex').toString('base64'),
    }
    await patch()
    expect(savedDoc()['sizeBytes']).toBe(4242)
    expect(savedDoc()['contentHash']).not.toBe('0123456789abcdef')
  })

  it('never downloads a non-SVG — the 200 MB videos stay in the bucket', async () => {
    state.objectMetadata = {
      contentType: 'video/mp4',
      size: 200 * 1024 * 1024,
      md5Hash: Buffer.from('0123456789abcdef', 'hex').toString('base64'),
    }
    expect((await patch()).status).toBe(200)
    expect(mockFileDownload).not.toHaveBeenCalled()
    expect(mockFileSave).not.toHaveBeenCalled()
  })
})

/**
 * The write path that used to be asserted fourth here — the legacy org-media
 * upload route — was deleted in AGL-1485 rather than kept in coverage. It had
 * had no caller since AGL-821 and minted a divergent document, so the coverage
 * question it raised is now answered by its absence.
 *
 * `apps/console/specs/media-create-shape.spec.ts` holds that ground: it
 * DISCOVERS the routes that mint a media document rather than listing them, so
 * the failure mode both issues share — a write path nobody counted — surfaces
 * as a test failure the moment a fifth one appears.
 */
