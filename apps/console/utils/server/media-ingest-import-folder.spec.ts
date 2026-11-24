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

describe("an undo's delete of an imported photo", () => {
  it('goes through the tombstone, only for a file that still carries the import key', async () => {
    mockMedia = {
      imported: { importedFrom: { key: 'import:abc' } },
      owner: { fileName: 'owner.jpg' },
    }
    expect(
      await consoleMediaIngest.removeImportedPhoto({ hostId: 'host-1', uid: 'uid-2', mediaId: 'owner', sourceKey: 'import:abc' }),
    ).toBe(false)
    expect(
      await consoleMediaIngest.removeImportedPhoto({ hostId: 'host-1', uid: 'uid-2', mediaId: 'imported', sourceKey: 'import:other' }),
    ).toBe(false)
    expect(mockDeleted).toEqual([])
    expect(
      await consoleMediaIngest.removeImportedPhoto({ hostId: 'host-1', uid: 'uid-2', mediaId: 'imported', sourceKey: 'import:abc' }),
    ).toBe(true)
    expect(mockDeleted).toEqual([{ mediaId: 'imported', objectPath: 'hosts/host-1/media/imported-products/imported', uid: 'uid-2' }])
  })

  it('is done already for a file that is gone, and refused to a member without the site', async () => {
    expect(
      await consoleMediaIngest.removeImportedPhoto({ hostId: 'host-1', uid: 'uid-2', mediaId: 'gone', sourceKey: 'import:abc' }),
    ).toBe(true)
    mockScope = null
    mockMedia = { imported: { importedFrom: { key: 'import:abc' } } }
    expect(
      await consoleMediaIngest.removeImportedPhoto({ hostId: 'host-1', uid: 'uid-2', mediaId: 'imported', sourceKey: 'import:abc' }),
    ).toBe(false)
    expect(mockDeleted).toEqual([])
  })
})
