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
        collection: () => ({
          doc: () => ({
            collection: () => ({
              where: (field: string, _op: string, value: string) => ({
                limit: () => ({
                  get: async () => ({
                    docs: mockStored
                      .filter((entry) => (entry.data['stockPhoto'] as { key?: string })?.key === value && field === 'stockPhoto.key')
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
      scope: {
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
})
