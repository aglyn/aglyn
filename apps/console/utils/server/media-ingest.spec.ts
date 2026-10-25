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
 */

/**
 * The media library's server door (AGL-3660): a picture a plugin holds is
 * stored through the upload route's own checks, as the member named, and a
 * stock photo already in the site's library is found by its source key.
 */

const mockSaved: Array<{ path: string; bytes: number }> = []
const mockCreated: Array<{ id: string; data: Record<string, unknown> }> = []
const mockCounters: Array<Record<string, unknown>> = []
let mockScopeError: { status: number; message: string } | null = null
let mockQuarantined = false
let mockGateAllowed = true
let mockStored: Array<{ id: string; data: Record<string, unknown> }> = []
const mockScopeCalls: unknown[] = []
const mockReads: string[] = []
let mockOrgBilling: Record<string, unknown> = { plan: 'pro' }
let mockUploadSiteError: { status: number; message: string } | null = null

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      storage: () => ({
        bucket: () => ({
          name: 'bucket-1',
          file: (path: string) => ({
            save: async (bytes: Uint8Array) => {
              mockSaved.push({ path, bytes: bytes.length })
            },
          }),
        }),
      }),
      firestore: () => ({
        collection: (name: string) => ({
          doc: (id: string) => ({
            collection: (sub: string) => ({
              where: (field: string, _op: string, value: unknown) => ({
                limit: () => ({
                  get: async () => ({
                    // Which library was read: `{collection}/{id}/media`.
                    path: mockReads.push(`${name}/${id}/${sub}`),
                    docs: mockStored
                      .filter((entry) =>
                        field === 'stockPhoto.key'
                          ? (entry.data['stockPhoto'] as { key?: string })?.key === value
                          : field === 'importedFrom.key'
                            ? (entry.data['importedFrom'] as { key?: string })?.key === value
                            : field === 'ownerPhoto' && entry.data['ownerPhoto'] === value,
                      )
                      .map((entry) => ({ id: entry.id, data: () => entry.data })),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
    firestore: { FieldValue: { increment: (by: number) => ({ increment: by }) } },
  },
  generateMediaVariants: async () => ({ variants: [320, 640] }),
  getMediaQuarantine: async () => (mockQuarantined ? { reason: 'takedown' } : null),
  mediaVariantDocFields: (outcome: { variants: number[] }) => ({ variants: outcome.variants }),
}))

jest.mock('./media-scope', () => ({
  __esModule: true,
  resolveMediaScope: async (...args: unknown[]) => {
    mockScopeCalls.push(args)
    if (mockScopeError) return { error: mockScopeError }
    const orgId = (args[0] as { orgId?: string }).orgId
    const scopeRef = {
      firestore: {},
      collection: (name: string) => ({
        doc: (id: string) => ({
          create: async (data: Record<string, unknown>) => {
            if (name === 'media') mockCreated.push({ id, data })
          },
          set: async (data: Record<string, unknown>) => {
            if (name === 'counters') mockCounters.push(data)
          },
        }),
      }),
    }
    return {
      scope: orgId
        ? {
            base: `orgs/${orgId}`,
            collection: 'orgs',
            scopeId: orgId,
            orgId,
            scopeRef,
            billing: mockOrgBilling,
            cdnScope: `org:${orgId}`,
          }
        : {
            base: 'hosts/host-1',
            collection: 'hosts',
            scopeId: 'host-1',
            orgId: 'org-1',
            scopeRef,
            billing: { plan: 'pro' },
            cdnScope: 'host-1',
          },
    }
  },
  mediaCdnPathUpdate: ({ cdnScope, mediaId }: { cdnScope: string; mediaId: string }) =>
    `/api/media/cdn/${cdnScope}/${mediaId}`,
  // The library holds one folder, `owner`, named "From the owner"; any other id is stale.
  folderStoragePath: async (_scopeRef: unknown, folderId: string | null) => (folderId === 'owner' ? 'From the owner' : ''),
}))

jest.mock('./media-upload-site', () => ({
  __esModule: true,
  resolveUploadSite: async (_scope: unknown, body: { forHostId?: string }) =>
    mockUploadSiteError ? { error: mockUploadSiteError } : { hostId: body?.forHostId ?? null },
}))

jest.mock('./media-storage-band', () => ({
  __esModule: true,
  resolveOrgMediaBand: async () => ({ usedBytes: 0, allowanceMb: 100 }),
}))

jest.mock('../storage-overage', () => ({
  __esModule: true,
  mediaStorageGate: () =>
    mockGateAllowed
      ? { allowed: true, status: 200, error: null, limitMb: 100 }
      : { allowed: false, status: 403, error: 'Storage limit reached (100 MB)', limitMb: 100 },
  scopeBillsStorageOverage: () => false,
}))

jest.mock('./media-embedded', () => ({
  __esModule: true,
  embeddedMetadataAtIngress: async () => null,
}))

import { consoleMediaIngest } from './media-ingest'

/** A 1×1 JPEG. */
const JPEG = Uint8Array.from(
  Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
    'base64',
  ),
)

const STOCK = {
  key: 'pixabay:7101001',
  provider: 'pixabay',
  providerLabel: 'Pixabay',
  id: '7101001',
  pageUrl: 'https://pixabay.com/photos/yoga-7101001/',
  photographer: 'StudioLight',
  license: 'Pixabay Content License',
  licenseUrl: 'https://pixabay.com/service/license-summary/',
  attributionRequired: false,
}

beforeEach(() => {
  mockSaved.length = 0
  mockCreated.length = 0
  mockCounters.length = 0
  mockScopeCalls.length = 0
  mockScopeError = null
  mockQuarantined = false
  mockGateAllowed = true
  mockStored = []
  mockReads.length = 0
  mockOrgBilling = { plan: 'pro' }
  mockUploadSiteError = null
})

describe('the console media ingest (AGL-3660)', () => {
  it('stores a photo in the site library as the member, with its credit', async () => {
    const result = await consoleMediaIngest.ingest({
      hostId: 'host-1',
      uid: 'member-1',
      fileName: 'pixabay-7101001.jpg',
      contentType: 'image/jpeg',
      bytes: JPEG,
      alt: 'A yoga class in a bright studio',
      description: 'Photo by StudioLight on Pixabay.',
      stockPhoto: STOCK,
    })
    expect(result).toMatchObject({ ok: true })
    const { mediaId, src } = result as { mediaId: string; src: string }
    expect(src).toBe(`media:host-1/${mediaId}`)
    // As the member, with the uploads gate an upload passes.
    expect(mockScopeCalls[0]).toEqual([{ hostId: 'host-1' }, {}, 'member-1', { feature: 'uploads' }])
    expect(mockSaved[0]).toEqual({ path: `hosts/host-1/media/${mediaId}`, bytes: JPEG.length })
    expect(mockCreated[0].data).toMatchObject({
      fileName: 'pixabay-7101001.jpg',
      contentType: 'image/jpeg',
      sizeBytes: JPEG.length,
      alt: 'A yoga class in a bright studio',
      description: 'Photo by StudioLight on Pixabay.',
      uploadedBy: 'member-1',
      cdnPath: `/api/media/cdn/host-1/${mediaId}`,
      variants: [320, 640],
      stockPhoto: { ...STOCK, importedAt: expect.anything() },
      hasAlt: true,
    })
    expect(mockCounters[0]).toEqual({ bytes: { increment: JPEG.length }, count: { increment: 1 } })
  })

  it('refuses what is not a raster photo, or not the image it claims', async () => {
    const base = { hostId: 'host-1', uid: 'member-1', fileName: 'a.svg', bytes: JPEG }
    expect(await consoleMediaIngest.ingest({ ...base, contentType: 'image/svg+xml' })).toMatchObject({
      ok: false,
      status: 415,
    })
    expect(
      await consoleMediaIngest.ingest({
        ...base,
        fileName: 'a.png',
        contentType: 'image/png',
        bytes: Uint8Array.from(Buffer.from('MZ not an image at all')),
      }),
    ).toMatchObject({ ok: false, status: 415 })
    expect(mockSaved).toHaveLength(0)
  })

  it('stores nothing for a member who lost the site, a takedown, or a full band', async () => {
    const request = { hostId: 'host-1', uid: 'member-1', fileName: 'a.jpg', contentType: 'image/jpeg', bytes: JPEG }
    mockScopeError = { status: 403, message: 'Not a site admin' }
    expect(await consoleMediaIngest.ingest(request)).toEqual({ ok: false, status: 403, reason: 'Not a site admin' })
    mockScopeError = null
    mockQuarantined = true
    expect(await consoleMediaIngest.ingest(request)).toMatchObject({ ok: false, status: 451 })
    mockQuarantined = false
    mockGateAllowed = false
    expect(await consoleMediaIngest.ingest(request)).toMatchObject({ ok: false, status: 403 })
    expect(mockSaved).toHaveLength(0)
    expect(mockCreated).toHaveLength(0)
  })

  it('finds a stock photo the site already holds by its source key, live and public only', async () => {
    mockStored = [
      { id: 'gone', data: { stockPhoto: STOCK, contentType: 'image/jpeg', cdnPath: '/api/media/cdn/host-1/gone', deletedAt: 1 } },
      { id: 'secret', data: { stockPhoto: STOCK, contentType: 'image/jpeg', private: true } },
      {
        id: 'm1',
        data: { stockPhoto: STOCK, contentType: 'image/jpeg', cdnPath: '/api/media/cdn/host-1/m1', width: 1280, height: 853 },
      },
    ]
    expect(await consoleMediaIngest.findStockPhoto({ hostId: 'host-1', sourceKey: 'pixabay:7101001' })).toEqual({
      mediaId: 'm1',
      src: 'media:host-1/m1',
      width: 1280,
      height: 853,
    })
    expect(await consoleMediaIngest.findStockPhoto({ hostId: 'host-1', sourceKey: 'pixabay:9' })).toBeNull()
  })

  it("stores a stock photo in the workspace's shared library, shared as its Default sharing says (AGL-4066)", async () => {
    const request = {
      hostId: '',
      orgId: 'org-1',
      uid: 'member-1',
      fileName: 'pixabay-7101001.jpg',
      contentType: 'image/jpeg',
      bytes: JPEG,
      description: 'Photo by StudioLight on Pixabay.',
      stockPhoto: STOCK,
    }
    const result = await consoleMediaIngest.ingest(request)
    expect(result).toMatchObject({ ok: true })
    const { mediaId } = result as { mediaId: string }
    expect(mockScopeCalls[0]).toEqual([{ orgId: 'org-1' }, {}, 'member-1', { feature: 'uploads' }])
    expect(mockSaved[0]).toEqual({ path: `orgs/org-1/media/${mediaId}`, bytes: JPEG.length })
    // No site on screen: every site may use it, as an upload from the workspace Media page.
    expect(mockCreated[0].data).toMatchObject({ visibleTo: ['org'], stockPhoto: { ...STOCK, importedAt: expect.anything() } })

    // A workspace that shares new media with the site it came from, and a site on screen.
    mockOrgBilling = { plan: 'pro', defaultMediaScope: 'host' }
    await consoleMediaIngest.ingest({ ...request, hostId: 'host-1' })
    expect(mockScopeCalls[1]).toEqual([{ orgId: 'org-1', forHostId: 'host-1' }, {}, 'member-1', { feature: 'uploads' }])
    expect(mockCreated[1].data).toMatchObject({ visibleTo: ['host:host-1'] })

    // A site the member cannot reach is refused, never widened.
    mockUploadSiteError = { status: 403, message: 'Your access to this organization does not reach that site' }
    expect(await consoleMediaIngest.ingest({ ...request, hostId: 'host-2' })).toEqual({
      ok: false,
      status: 403,
      reason: 'Your access to this organization does not reach that site',
    })
    expect(mockCreated).toHaveLength(2)
  })

  it("stamps no sharing on a site library's asset", async () => {
    await consoleMediaIngest.ingest({ hostId: 'host-1', uid: 'member-1', fileName: 'a.jpg', contentType: 'image/jpeg', bytes: JPEG })
    expect(mockCreated[0].data).not.toHaveProperty('visibleTo')
  })

  it('finds a workspace copy of a stock photo only where it is shared with every site, or the one named (AGL-4066)', async () => {
    mockStored = [
      { id: 'narrow', data: { stockPhoto: STOCK, contentType: 'image/jpeg', cdnPath: '/api/media/cdn/org:org-1/narrow', visibleTo: ['host:other'] } },
      { id: 'unshared', data: { stockPhoto: STOCK, contentType: 'image/jpeg', cdnPath: '/api/media/cdn/org:org-1/unshared' } },
    ]
    expect(await consoleMediaIngest.findStockPhoto({ hostId: '', orgId: 'org-1', sourceKey: 'pixabay:7101001' })).toBeNull()
    expect(mockReads).toContain('orgs/org-1/media')
    mockStored.push({
      id: 'site',
      data: { stockPhoto: STOCK, contentType: 'image/jpeg', cdnPath: '/api/media/cdn/org:org-1/site', visibleTo: ['host:host-1'] },
    })
    expect(await consoleMediaIngest.findStockPhoto({ hostId: '', orgId: 'org-1', sourceKey: 'pixabay:7101001' })).toBeNull()
    expect(await consoleMediaIngest.findStockPhoto({ hostId: 'host-1', orgId: 'org-1', sourceKey: 'pixabay:7101001' })).toMatchObject({
      mediaId: 'site',
    })
    mockStored.push({
      id: 'all',
      data: { stockPhoto: STOCK, contentType: 'image/jpeg', cdnPath: '/api/media/cdn/org:org-1/all', visibleTo: ['org'] },
    })
    expect(await consoleMediaIngest.findStockPhoto({ hostId: '', orgId: 'org-1', sourceKey: 'pixabay:7101001' })).toMatchObject({
      mediaId: 'all',
      src: 'media:org:org-1/all',
    })
    // A site's own library is read as before, by its id.
    mockReads.length = 0
    await consoleMediaIngest.findStockPhoto({ hostId: 'host-1', sourceKey: 'pixabay:7101001' })
    expect(mockReads).toEqual(['hosts/host-1/media'])
  })

  it("files a photo link's photo in its folder, marked as the owner's (AGL-3957)", async () => {
    const result = await consoleMediaIngest.ingest({
      hostId: 'host-1',
      uid: 'member-1',
      fileName: 'IMG_0412.jpg',
      contentType: 'image/jpeg',
      bytes: JPEG,
      folderId: 'owner',
      ownerPhotoLinkId: 'link-1',
    })
    expect(result).toMatchObject({ ok: true })
    const { mediaId } = result as { mediaId: string }
    expect(mockSaved[0]).toEqual({ path: `hosts/host-1/media/From the owner/${mediaId}`, bytes: JPEG.length })
    expect(mockCreated[0].data).toMatchObject({
      folderId: 'owner',
      storagePath: `hosts/host-1/media/From the owner/${mediaId}`,
      ownerPhoto: true,
      photoLinkId: 'link-1',
    })
    // A stale folder files at the root, and a stock photo is nobody's own.
    const stale = await consoleMediaIngest.ingest({
      hostId: 'host-1',
      uid: 'member-1',
      fileName: 'a.jpg',
      contentType: 'image/jpeg',
      bytes: JPEG,
      folderId: 'gone',
    })
    const staleId = (stale as { mediaId: string }).mediaId
    expect(mockSaved[1]).toEqual({ path: `hosts/host-1/media/${staleId}`, bytes: JPEG.length })
    expect(mockCreated[1].data).toMatchObject({ folderId: 'gone' })
    expect(mockCreated[1].data).not.toHaveProperty('ownerPhoto')
  })

  it('stamps a picture a site import brought in, and finds it again by its key, live and public only (AGL-3976)', async () => {
    const importedFrom = {
      key: 'import:0f3c9a',
      url: 'https://static.wixstatic.com/media/loaf.jpg',
      domain: 'rosies-bakery.com',
    }
    const result = await consoleMediaIngest.ingest({
      hostId: 'host-1',
      uid: 'member-1',
      fileName: 'loaf.jpg',
      contentType: 'image/jpeg',
      bytes: JPEG,
      alt: 'A sourdough loaf',
      importedFrom,
    })
    expect(result).toMatchObject({ ok: true })
    expect(mockCreated[0].data).toMatchObject({ importedFrom: { ...importedFrom, importedAt: expect.anything() } })
    // Nobody's own photo, and no stock credit.
    expect(mockCreated[0].data).not.toHaveProperty('ownerPhoto')
    expect(mockCreated[0].data).not.toHaveProperty('stockPhoto')
    mockStored = [
      { id: 'gone', data: { importedFrom, contentType: 'image/jpeg', cdnPath: '/api/media/cdn/host-1/gone', deletedAt: 1 } },
      { id: 'secret', data: { importedFrom, contentType: 'image/jpeg', private: true } },
      {
        id: 'm1',
        data: { importedFrom, contentType: 'image/jpeg', cdnPath: '/api/media/cdn/host-1/m1', width: 980, height: 600, alt: 'A sourdough loaf' },
      },
    ]
    expect(await consoleMediaIngest.findImportedPhoto({ hostId: 'host-1', sourceKey: 'import:0f3c9a' })).toEqual({
      mediaId: 'm1',
      src: 'media:host-1/m1',
      width: 980,
      height: 600,
      alt: 'A sourdough loaf',
    })
    expect(await consoleMediaIngest.findImportedPhoto({ hostId: 'host-1', sourceKey: 'import:other' })).toBeNull()
    expect(await consoleMediaIngest.findImportedPhoto({ hostId: '', sourceKey: 'import:0f3c9a' })).toBeNull()
  })

  it("lists the site's own photos newest first, live and public only, with their alt text (AGL-3957)", async () => {
    const at = (ms: number) => ({ toMillis: () => ms })
    mockStored = [
      { id: 'stock', data: { stockPhoto: STOCK, contentType: 'image/jpeg', cdnPath: '/api/media/cdn/host-1/stock' } },
      { id: 'old', data: { ownerPhoto: true, contentType: 'image/jpeg', cdnPath: '/api/media/cdn/host-1/old', width: 800, height: 600, createdAt: at(1) } },
      { id: 'gone', data: { ownerPhoto: true, contentType: 'image/jpeg', cdnPath: '/api/media/cdn/host-1/gone', deletedAt: 1 } },
      { id: 'secret', data: { ownerPhoto: true, contentType: 'image/jpeg', private: true } },
      {
        id: 'new',
        data: { ownerPhoto: true, contentType: 'image/png', cdnPath: '/api/media/cdn/host-1/new', width: 1200, height: 1600, alt: 'The van', createdAt: at(2) },
      },
    ]
    expect(await consoleMediaIngest.listOwnerPhotos({ hostId: 'host-1' })).toEqual([
      { mediaId: 'new', src: 'media:host-1/new', width: 1200, height: 1600, alt: 'The van' },
      { mediaId: 'old', src: 'media:host-1/old', width: 800, height: 600 },
    ])
    expect(await consoleMediaIngest.listOwnerPhotos({ hostId: 'host-1', limit: 1 })).toHaveLength(1)
    expect(await consoleMediaIngest.listOwnerPhotos({ hostId: '' })).toEqual([])
  })
})
