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
 * Both media upload routes apply the org's Default sharing to the site an
 * upload was made from, and only to a site that upload can have been made from.
 *
 * The setting "New datasets and files are shared with" narrows a new file to
 * its site when the org chose "Only the site they were created in". Both
 * routes always read it from `forHostId` — and the media library never sent
 * one, so every file uploaded on a site's Media tab or through a site's picker
 * landed on All sites.
 *
 * `media-upload-site.spec.ts` holds the verdicts. This file holds the wiring,
 * with the REAL helper and the REAL scope tokens behind it: that each route
 * asks, asks before it stores or mints anything, writes what it was told, and
 * leaves nothing behind when the answer is no.
 *
 * The finalize is the request that writes the document, so it is checked
 * there even though the mint already checked: a mint is not a promise the
 * finalize can lean on, and a refusal there has to delete the object the
 * client already PUT.
 */

import { createHash } from 'crypto'
import { Readable } from 'stream'

import { uploadFixtureBase64 } from './upload-fixture-bytes'

const mockVerifyIdToken = jest.fn()
const mockFileSave = jest.fn()
const mockFileDelete = jest.fn()
const mockSignedUrl = jest.fn()
const mockMediaSet = jest.fn()
const mockCounterSet = jest.fn()

/** host id → owning org, as `hostIndex` answers it. */
const mockHostIndex: Record<string, string> = {
  'host-a': 'org-1',
  'host-b': 'org-1',
  'host-foreign': 'org-2',
}

const mockState: {
  org: Record<string, unknown>
  /** The resolved caller: org-wide by default, a collaborator when narrowed. */
  viewer: { viewerTokens: string[]; viewerOrgWide: boolean }
  objectMetadata: Record<string, unknown>
  objectBytes: Buffer
} = {
  org: {},
  viewer: { viewerTokens: ['org'], viewerOrgWide: true },
  objectMetadata: {},
  objectBytes: Buffer.alloc(0),
}

const counterDoc = () => ({
  get: async () => ({ exists: true, get: () => 0 }),
  set: (...args: unknown[]) => {
    mockCounterSet(...args)
    return Promise.resolve()
  },
})

const mediaDoc = (): Record<string, unknown> => ({
  get: async () => ({ exists: true, get: () => undefined, data: () => ({}) }),
  set: (...args: unknown[]) => {
    mockMediaSet(...args)
    return Promise.resolve()
  },
  delete: async () => undefined,
  collection: () => ({ doc: () => mediaDoc() }),
})

/** The org's media pool, answered the way `resolveOrgMediaBand` reads it. */
const mockScopeRef = {
  firestore: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        path: `${name}/${id}`,
        collection: (sub: string) => ({
          doc: (subId: string) => ({ path: `${name}/${id}/${sub}/${subId}` }),
        }),
      }),
      where: () => ({ select: () => ({ get: async () => ({ docs: [] }) }) }),
    }),
    getAll: async (...refs: Array<{ path: string }>) =>
      refs.map(() => ({ get: () => undefined })),
  },
  collection: (name: string) => ({
    doc: () => (name === 'counters' ? counterDoc() : mediaDoc()),
  }),
}

const storageFile = () => ({
  name: 'object',
  exists: async () => [true],
  getMetadata: async () => [mockState.objectMetadata],
  download: async (options?: { start?: number; end?: number }) => {
    if (!options || typeof options.start !== 'number') {
      return [mockState.objectBytes]
    }
    const end =
      typeof options.end === 'number'
        ? options.end
        : mockState.objectBytes.length - 1
    return [mockState.objectBytes.subarray(options.start, end + 1)]
  },
  createReadStream: () => Readable.from([mockState.objectBytes]),
  setMetadata: async () => undefined,
  save: (...args: unknown[]) => {
    mockFileSave(...args)
    return Promise.resolve()
  },
  delete: (...args: unknown[]) => {
    mockFileDelete(...args)
    return Promise.resolve()
  },
  getSignedUrl: async (...args: unknown[]) => {
    mockSignedUrl(...args)
    return ['https://storage.test/put']
  },
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  ...jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/media-variants',
  ),
  ...jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/media-strong-digest',
  ),
  mediaStoragePathInScope: (o: { base: string; mediaId: string }) =>
    `${o.base}/media/${o.mediaId}`,
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
  isServerReleaseFlagOnForOrg: async () => true,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  quarantinedUploadRefusal: async () => null,
  // The index the helper checks a site against.
  resolveOrgIdForHost: async (hostId: string) => mockHostIndex[hostId] ?? null,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/media-metadata'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/upload-inspection'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  // The REAL scope tokens: `defaultScopeForNewResource` decides the stored
  // `visibleTo` these cases read, and `visibleToTokens` decides reach.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/scope-tokens'),
  createResourceUid: () => 'media-1',
  readImageDimensions: () => undefined,
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
      orgId: 'org-1',
      scopeRef: mockScopeRef,
      billing: mockState.org,
      cdnScope: 'org:org-1',
      ...mockState.viewer,
    },
  }),
  folderStoragePath: async () => '',
  mediaObjectPath: () => 'orgs/org-1/media/media-1',
  mediaCdnPathUpdate: () => '/api/media/cdn/org:org-1/media-1',
  // The real predicate, so a collaborator's reach is decided as it is live.
  scopeAllows: jest.requireActual('../utils/server/media-scope').scopeAllows,
}))

import { POST as upload } from '../app/api/media/upload/route'
import { PATCH as finalize, POST as mint } from '../app/api/media/upload-url/route'

const PDF = Buffer.from('%PDF-1.7 the rate card for one client', 'utf8')

const request = (url: string, method: string, body: Record<string, unknown>) =>
  new Request(`https://app.aglyn.com${url}`, {
    method,
    headers: { authorization: 'Bearer tok' },
    body: JSON.stringify({ orgId: 'org-1', ...body }),
  })

const uploadDirect = (site: Record<string, unknown> = {}) =>
  upload(
    request('/api/media/upload', 'POST', {
      fileName: 'rates.pdf',
      contentType: 'application/pdf',
      data: uploadFixtureBase64('application/pdf', 2048),
      ...site,
    }),
  )

const mintSigned = (site: Record<string, unknown> = {}) =>
  mint(
    request('/api/media/upload-url', 'POST', {
      fileName: 'rates.pdf',
      contentType: 'application/pdf',
      sizeBytes: PDF.length,
      ...site,
    }),
  )

const finalizeSigned = (site: Record<string, unknown> = {}) =>
  finalize(
    request('/api/media/upload-url', 'PATCH', {
      mediaId: 'media-1',
      fileName: 'rates.pdf',
      ...site,
    }),
  )

/** The media document the route wrote, if it wrote one. */
const writtenDocument = () =>
  mockMediaSet.mock.calls[0]?.[0] as Record<string, unknown> | undefined

beforeEach(() => {
  jest.clearAllMocks()
  // "Only the site they were created in" — the setting that makes the site
  // matter at all.
  mockState.org = { plan: 'pro', defaultResourceScope: 'host' }
  mockState.viewer = { viewerTokens: ['org'], viewerOrgWide: true }
  mockState.objectBytes = PDF
  mockState.objectMetadata = {
    contentType: 'application/pdf',
    size: PDF.length,
    md5Hash: createHash('md5').update(new Uint8Array(PDF)).digest('base64'),
  }
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
})

describe('the direct upload route', () => {
  it("writes the site alone when the org chose 'Only the site they were created in'", async () => {
    const response = await uploadDirect({ forHostId: 'host-a' })

    expect(response.status).toBe(200)
    expect(writtenDocument()?.['visibleTo']).toEqual(['host:host-a'])
  })

  it('writes All sites for an upload made where no site is on screen', async () => {
    const response = await uploadDirect()

    expect(response.status).toBe(200)
    expect(writtenDocument()?.['visibleTo']).toEqual(['org'])
  })

  it("writes All sites when the org shares new files with every site", async () => {
    mockState.org = { plan: 'pro', defaultResourceScope: 'org' }
    const response = await uploadDirect({ forHostId: 'host-a' })

    expect(response.status).toBe(200)
    expect(writtenDocument()?.['visibleTo']).toEqual(['org'])
  })

  it("refuses another org's site before storing a byte", async () => {
    const response = await uploadDirect({ forHostId: 'host-foreign' })

    expect(response.status).toBe(400)
    expect(mockFileSave).not.toHaveBeenCalled()
    expect(mockMediaSet).not.toHaveBeenCalled()
    expect(mockCounterSet).not.toHaveBeenCalled()
  })

  it("refuses a collaborator a site they were not granted", async () => {
    mockState.viewer = {
      viewerTokens: ['org', 'host:host-a'],
      viewerOrgWide: false,
    }
    const refused = await uploadDirect({ forHostId: 'host-b' })
    expect(refused.status).toBe(403)
    expect(mockFileSave).not.toHaveBeenCalled()

    // …and not the one they were.
    const allowed = await uploadDirect({ forHostId: 'host-a' })
    expect(allowed.status).toBe(200)
    expect(writtenDocument()?.['visibleTo']).toEqual(['host:host-a'])
  })
})

describe('the signed upload route', () => {
  it("refuses another org's site at the mint, before a URL exists", async () => {
    const response = await mintSigned({ forHostId: 'host-foreign' })

    expect(response.status).toBe(400)
    expect(mockSignedUrl).not.toHaveBeenCalled()
  })

  it('mints for one of the org’s own sites', async () => {
    const response = await mintSigned({ forHostId: 'host-a' })

    expect(response.status).toBe(200)
    expect(mockSignedUrl).toHaveBeenCalledTimes(1)
  })

  it('writes the site alone at finalize', async () => {
    const response = await finalizeSigned({ forHostId: 'host-a' })

    expect(response.status).toBe(200)
    expect(writtenDocument()?.['visibleTo']).toEqual(['host:host-a'])
  })

  it('writes All sites at finalize when no site is named', async () => {
    const response = await finalizeSigned()

    expect(response.status).toBe(200)
    expect(writtenDocument()?.['visibleTo']).toEqual(['org'])
  })

  it("refuses another org's site at finalize and removes the object", async () => {
    // The mint is not trusted: this is the request that writes the document.
    const response = await finalizeSigned({ forHostId: 'host-foreign' })

    expect(response.status).toBe(400)
    expect(mockMediaSet).not.toHaveBeenCalled()
    expect(mockCounterSet).not.toHaveBeenCalled()
    // Already in the bucket, and with no document it is billed to nobody and
    // readable by nobody, so it must not stay.
    expect(mockFileDelete).toHaveBeenCalled()
  })
})
