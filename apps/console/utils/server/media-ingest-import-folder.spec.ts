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
 * The media library door's two calls for a product import (AGL-4245): the
 * folder imported photos are filed in, found or made at the top of the
 * site's library, and an undo's delete, which touches only a file the import
 * stored and goes through the library's own tombstone.
 */

let mockFolders: Array<{ id: string; data: Record<string, unknown> }> = []
const mockFolderSets: Array<{ id: string; data: Record<string, unknown> }> = []
let mockMedia: Record<string, Record<string, unknown>> = {}
const mockDeleted: Array<{ mediaId: string; objectPath: string; uid: string }> = []
let mockScope: 'hosts' | 'orgs' | null = 'hosts'
/** The site's documents the usage scan reads, as text, and what it covered. */
let mockSiteDocs: Array<{ name: string; text: string }> = []
let mockCoverage: 'full' | 'published' | 'partial' = 'full'
const mockScopeCalls: unknown[][] = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({ storage: () => ({ bucket: () => ({ name: 'bucket-1' }) }) }),
    firestore: { FieldValue: {} },
  },
  deleteMediaWithTombstone: async (options: { mediaId: string; objectPath: string; uid: string }) => {
    mockDeleted.push({ mediaId: options.mediaId, objectPath: options.objectPath, uid: options.uid })
    return { deleted: true }
  },
  generateMediaVariants: async () => null,
  getMediaQuarantine: async () => null,
  mediaVariantDocFields: () => ({}),
}))

jest.mock('./media-scope', () => ({
  __esModule: true,
  resolveMediaScope: async (...args: unknown[]) => {
    mockScopeCalls.push(args)
    if (!mockScope) return { error: { status: 403, message: 'No access' } }
    const scopeRef = {
      get: async () => ({ get: () => 'shop', data: () => ({ subdomain: 'shop' }) }),
      collection: (name: string) => ({
        limit: () => ({
          get: async () => ({
            docs: mockFolders.map((folder) => ({
              id: folder.id,
              get: (field: string) => folder.data[field],
              data: () => folder.data,
            })),
          }),
        }),
        doc: (id: string) => ({
          id,
          set: async (data: Record<string, unknown>) => {
            if (name === 'mediaFolders') mockFolderSets.push({ id, data })
          },
          get: async () => {
            const data = name === 'media' ? mockMedia[id] : undefined
            return {
              id,
              exists: Boolean(data),
              data: () => data,
              get: (path: string) =>
                path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], data),
            }
          },
        }),
      }),
    }
    return { scope: { base: 'hosts/host-1', collection: mockScope, scopeId: 'host-1', orgId: 'org-1', scopeRef } }
  },
  mediaObjectPath: (snapshot: { id: string }, base: string) => `${base}/media/imported-products/${snapshot.id}`,
  mediaCdnPathUpdate: () => null,
  folderStoragePath: async () => '',
}))

jest.mock('./scan-media-references', () => ({
  __esModule: true,
  scanMediaReferences: async (options: { isReferenced: (haystack: string) => boolean }) => {
    const references = mockSiteDocs.filter((doc) => options.isReferenced(doc.text)).map((doc) => ({ kind: 'plugin', name: doc.name }))
    return { references, complete: mockCoverage === 'full', coverage: mockCoverage }
  },
}))

jest.mock('./media-upload-site', () => ({ __esModule: true, resolveUploadSite: async () => ({ hostId: null }) }))
jest.mock('./media-storage-band', () => ({ __esModule: true, resolveOrgMediaBand: async () => ({ usedBytes: 0, allowanceMb: 100 }) }))
jest.mock('../storage-overage', () => ({
  __esModule: true,
  mediaStorageGate: () => ({ allowed: true }),
  scopeBillsStorageOverage: () => false,
}))
jest.mock('./media-embedded', () => ({ __esModule: true, embeddedMetadataAtIngress: async () => null }))

import { consoleMediaIngest } from './media-ingest'

beforeEach(() => {
  mockFolders = []
  mockFolderSets.length = 0
  mockMedia = {}
  mockDeleted.length = 0
  mockScope = 'hosts'
  mockScopeCalls.length = 0
  mockSiteDocs = []
  mockCoverage = 'full'
})

describe('the folder imported photos are filed in', () => {
  it('is the top-level folder of that name, in any case, as the member may upload', async () => {
    mockFolders = [
      { id: 'nested', data: { name: 'Imported products', parentId: 'brand' } },
      { id: 'top', data: { name: 'imported PRODUCTS', parentId: null } },
    ]
    expect(await consoleMediaIngest.ensureFolder({ hostId: 'host-1', uid: 'uid-1', name: 'Imported products' })).toBe('top')
    expect(mockFolderSets).toEqual([])
    expect(mockScopeCalls[0]).toEqual([{ hostId: 'host-1' }, {}, 'uid-1', { feature: 'uploads' }])
  })

  it('is made, as the library makes one, when the site has none', async () => {
    mockFolders = [{ id: 'nested', data: { name: 'Imported products', parentId: 'brand' } }]
    const id = await consoleMediaIngest.ensureFolder({ hostId: 'host-1', uid: 'uid-1', name: '  Imported   products ' })
    expect(id).toEqual(expect.any(String))
    expect(mockFolderSets).toEqual([{ id, data: expect.objectContaining({ name: 'Imported products', parentId: null }) }])
    expect(mockFolderSets[0]?.data).not.toHaveProperty('visibleTo')
  })

  it('is nothing for a member who may not upload, or for a workspace library', async () => {
    mockScope = null
    expect(await consoleMediaIngest.ensureFolder({ hostId: 'host-1', uid: 'uid-1', name: 'Imported products' })).toBeNull()
    mockScope = 'orgs'
    expect(await consoleMediaIngest.ensureFolder({ hostId: 'host-1', uid: 'uid-1', name: 'Imported products' })).toBeNull()
    expect(mockFolderSets).toEqual([])
  })
})

describe("an undo's delete of imported photos", () => {
  const imported = (key: string, jobId = 'job-1') => ({ importedFrom: { key, jobId }, url: `https://storage.test/${key}` })
  const remove = (photos: Array<{ mediaId: string; sourceKey: string }>, jobId = 'job-1') =>
    consoleMediaIngest.removeImportedPhotos({ hostId: 'host-1', uid: 'uid-2', jobId, photos })

  it("removes, through the tombstone, only the files this job stored that the library's scan finds unused", async () => {
    mockMedia = {
      a: imported('import:a'),
      b: imported('import:b'),
      other: imported('import:o', 'job-0'),
      owner: { fileName: 'owner.jpg' },
    }
    // A page still shows b, by its media reference; nothing shows a.
    mockSiteDocs = [{ name: 'Home', text: '{"src":"media:host-1/b"}' }]
    const answer = await remove([
      { mediaId: 'a', sourceKey: 'import:a' },
      { mediaId: 'b', sourceKey: 'import:b' },
      { mediaId: 'other', sourceKey: 'import:o' },
      { mediaId: 'owner', sourceKey: 'import:a' },
      { mediaId: 'gone', sourceKey: 'import:g' },
    ])
    expect(answer).toEqual({ removed: ['gone', 'a'], kept: ['b'], usedBy: ['Home'] })
    expect(mockDeleted).toEqual([{ mediaId: 'a', objectPath: 'hosts/host-1/media/imported-products/a', uid: 'uid-2' }])
  })

  it('keeps a file a product variant still names, and every file when the scan could not read the live site', async () => {
    mockMedia = { a: imported('import:a') }
    mockSiteDocs = [{ name: 'Desk lamp', text: '{"variants":[{"imageUrl":"media:host-1/a"}]}' }]
    expect(await remove([{ mediaId: 'a', sourceKey: 'import:a' }])).toEqual({ removed: [], kept: ['a'], usedBy: ['Desk lamp'] })
    mockSiteDocs = []
    mockCoverage = 'partial'
    expect(await remove([{ mediaId: 'a', sourceKey: 'import:a' }])).toEqual({
      removed: [],
      kept: ['a'],
      usedBy: ['parts of the site that could not be checked'],
    })
    expect(mockDeleted).toEqual([])
  })

  it('touches nothing for a member without the site', async () => {
    mockScope = null
    mockMedia = { a: imported('import:a') }
    expect(await remove([{ mediaId: 'a', sourceKey: 'import:a' }])).toEqual({ removed: [], kept: [], usedBy: [] })
    expect(mockDeleted).toEqual([])
  })
})
