/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type MediaDeliveryProvider,
  registerMediaDeliveryProvider,
} from '@aglyn/aglyn/plugin-manager/media-delivery-provider'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { code } from './source-text'

/**
 * The console's half of the delivery copies (AGL-2824).
 *
 * The copy itself — what is copied, under which key, when the flag allows
 * it — is `media-delivery.spec.ts` in `tenant-data-admin` and the plugin's
 * end-to-end flow. This file holds the two things neither can see:
 *
 * - **The helpers the routes call** do nothing at all without a provider
 *   configured to store: no `after()`, no read, no write. That is what keeps
 *   every existing upload, replace and restore exactly as it was.
 * - **No ingress was missed.** Each route that stores a video schedules the
 *   copy after its document write; the replace removes the previous bytes'
 *   copies first; a restore copies again; a takedown removes them.
 */

const mockAfter: Array<() => Promise<void>> = []
jest.mock('next/server', () => ({
  after: (task: () => Promise<void>) => {
    mockAfter.push(task)
  },
}))

const mockSync = jest.fn<Promise<Record<string, unknown>>, [unknown]>(async () => ({
  status: 'synced',
  copied: ['master'],
  kept: [],
  removed: [],
  failed: [],
}))
const mockRemove = jest.fn<Promise<{ removed: number; failed: boolean }>, [unknown]>(
  async () => ({ removed: 2, failed: false }),
)
const mockMerges: Array<Record<string, unknown>> = []
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  syncMediaDeliveryCopies: (options: unknown) => mockSync(options),
  removeMediaDeliveryCopies: (options: unknown) => mockRemove(options),
  firebaseAdmin: {
    app: () => ({ storage: () => ({ bucket: (name: string) => ({ name }) }) }),
    firestore: { FieldValue: { delete: () => '__delete__' } },
  },
}))

import {
  removeAssetDeliveryCopies,
  scheduleMediaDeliveryCopies,
  takeDownAssetDeliveryCopies,
} from '../utils/server/media-delivery-copies'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const read = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8')

function provider(configured: boolean): MediaDeliveryProvider {
  return {
    isConfigured: () => configured,
    putObject: async () => undefined,
    deleteObject: async () => undefined,
    deleteObjectsWithPrefix: async () => 0,
    deliveryUrl: async () => 'https://delivery.test/x',
  }
}

const scopeRef = {
  collection: () => ({ doc: (id: string) => ({ id, path: `hosts/host-1/media/${id}` }) }),
} as never

const SCOPE = { collection: 'hosts' as const, scopeId: 'host-1', orgId: 'acme', scopeRef }

beforeEach(() => {
  resetPluginServicesForTests()
  mockAfter.length = 0
  mockMerges.length = 0
  mockSync.mockClear()
  mockRemove.mockClear()
})

describe('the route helpers do nothing without a provider configured to store (AGL-2824)', () => {
  it('schedules nothing, reads nothing and removes nothing', async () => {
    expect(scheduleMediaDeliveryCopies({ scope: SCOPE, mediaId: 'm1', contentType: 'video/mp4' })).toBe(
      false,
    )
    registerMediaDeliveryProvider(provider(false), { pluginId: 'delivery-spec' })
    expect(scheduleMediaDeliveryCopies({ scope: SCOPE, mediaId: 'm1', contentType: 'video/mp4' })).toBe(
      false,
    )
    expect(
      await removeAssetDeliveryCopies({ collection: 'hosts', scopeId: 'host-1', mediaId: 'm1' }),
    ).toBeNull()
    expect(mockAfter).toEqual([])
    expect(mockSync).not.toHaveBeenCalled()
    expect(mockRemove).not.toHaveBeenCalled()
  })
})

describe('with a provider configured to store (AGL-2824)', () => {
  beforeEach(() => {
    registerMediaDeliveryProvider(provider(true), { pluginId: 'delivery-spec' })
  })

  it('schedules a video’s copy after the response, never an image’s', async () => {
    expect(scheduleMediaDeliveryCopies({ scope: SCOPE, mediaId: 'img', contentType: 'image/png' })).toBe(
      false,
    )
    expect(mockAfter).toHaveLength(0)
    expect(scheduleMediaDeliveryCopies({ scope: SCOPE, mediaId: 'm1', contentType: 'video/mp4' })).toBe(
      true,
    )
    // Nothing ran inside the request.
    expect(mockSync).not.toHaveBeenCalled()
    await mockAfter[0]?.()
    expect(mockSync).toHaveBeenCalledWith({
      docRef: { id: 'm1', path: 'hosts/host-1/media/m1' },
      asset: { collection: 'hosts', scopeId: 'host-1', mediaId: 'm1' },
      bucket: { name: process.env['NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'] },
      orgId: 'acme',
    })
  })

  it('lets the copy resolve the org when the caller does not have it', async () => {
    scheduleMediaDeliveryCopies({
      scope: { collection: 'hosts', scopeId: 'host-1', scopeRef },
      mediaId: 'm1',
    })
    await mockAfter[0]?.()
    expect(mockSync.mock.calls[0]?.[0]).not.toHaveProperty('orgId')
  })

  it('never lets a failed copy escape the task', async () => {
    mockSync.mockRejectedValueOnce(new Error('provider down'))
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    scheduleMediaDeliveryCopies({ scope: SCOPE, mediaId: 'm1', contentType: 'video/mp4' })
    await expect(mockAfter[0]?.()).resolves.toBeUndefined()
    error.mockRestore()
  })

  it('a takedown removes the copies and then clears their record', async () => {
    const docRef = {
      update: async (data: Record<string, unknown>) => {
        mockMerges.push(data)
      },
    } as never
    expect(
      await takeDownAssetDeliveryCopies({
        asset: { collection: 'orgs', scopeId: 'acme', mediaId: 'm1' },
        docRef,
      }),
    ).toEqual({ removed: 2, failed: false })
    expect(mockRemove).toHaveBeenCalledWith({
      asset: { collection: 'orgs', scopeId: 'acme', mediaId: 'm1' },
    })
    // An update, which refuses a missing document: a merged set would
    // recreate one deleted while the copies were being removed.
    expect(mockMerges).toEqual([{ deliveryCopies: '__delete__' }])
  })

  it('a takedown of a document deleted meanwhile creates nothing and reports the removal', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const docRef = {
      update: async () => {
        throw Object.assign(new Error('5 NOT_FOUND: no entity to update'), { code: 5 })
      },
      set: async (data: Record<string, unknown>) => {
        mockMerges.push(data)
      },
    } as never
    expect(
      await takeDownAssetDeliveryCopies({
        asset: { collection: 'orgs', scopeId: 'acme', mediaId: 'm1' },
        docRef,
      }),
    ).toEqual({ removed: 2, failed: false })
    expect(mockMerges).toEqual([])
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it('a takedown whose removal failed keeps the record, so nothing claims the copies went', async () => {
    mockRemove.mockResolvedValueOnce({ removed: 0, failed: true })
    const docRef = {
      update: async (data: Record<string, unknown>) => {
        mockMerges.push(data)
      },
      set: async (data: Record<string, unknown>) => {
        mockMerges.push(data)
      },
    } as never
    expect(
      await takeDownAssetDeliveryCopies({
        asset: { collection: 'orgs', scopeId: 'acme', mediaId: 'm1' },
        docRef,
      }),
    ).toEqual({ removed: 0, failed: true })
    expect(mockMerges).toEqual([])
  })
})

describe('every video ingress reaches the delivery copy (AGL-2824)', () => {
  const body = (path: string) => code(read(path), path)

  it.each([
    ['apps/console/app/api/media/upload/route.ts', "collection('media').doc(mediaId).set("],
    ['apps/console/app/api/media/upload-url/route.ts', "collection('media').doc(mediaId).set("],
    ['apps/console/utils/api-v1-resources.ts', "collection('media').doc(mediaId).create("],
  ])('%s schedules the copy after it writes the document', (path, write) => {
    const text = body(path)
    const written = text.indexOf(write)
    const scheduled = text.indexOf('scheduleMediaDeliveryCopies(', written)
    expect(written).toBeGreaterThan(-1)
    expect(scheduled).toBeGreaterThan(written)
  })

  it('a replace clears the record in its write, removes the old copies, then copies the new bytes', () => {
    const text = body('apps/console/app/api/media/replace/route.ts')
    const write = text.indexOf('await mediaRef.set(')
    const cleared = text.indexOf('deliveryCopies: remove', write)
    const removed = text.indexOf('await removeAssetDeliveryCopies(', write)
    const scheduled = text.indexOf('scheduleMediaDeliveryCopies(', removed)
    expect(write).toBeGreaterThan(-1)
    expect(cleared).toBeGreaterThan(write)
    expect(removed).toBeGreaterThan(cleared)
    expect(scheduled).toBeGreaterThan(removed)
  })

  it('a restore copies again once the document is back', () => {
    const text = body('apps/console/app/api/media/restore/route.ts')
    expect(text.indexOf('scheduleMediaDeliveryCopies(')).toBeGreaterThan(
      text.indexOf('await restoreMediaFromTombstone('),
    )
    expect(text).toContain('if (result.ok) scheduleMediaDeliveryCopies(')
  })

  it('a takedown removes the copies, and a release copies again', () => {
    const text = body('apps/console/app/api/admin/media-quarantine/route.ts')
    expect(text).toMatch(/action === 'quarantine' && asset\s*\?\s*await takeDownAssetDeliveryCopies\(/)
    expect(text).toMatch(/if \(action === 'release' && asset\) \{\s*scheduleMediaDeliveryCopies\(/)
  })

  it('a delete removes the copies inside the one delete every caller shares', () => {
    const text = body('libs/tenant/data/admin/src/lib/server/media-tombstone.ts')
    expect(text.match(/await removeDeliveryCopies\(scopeRef, mediaId\)/g) ?? []).toHaveLength(2)
  })
})
