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

import {
  type MediaDeliveryProvider,
  registerMediaDeliveryProvider,
} from '@aglyn/aglyn/plugin-manager/media-delivery-provider'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { deleteMediaWithTombstone, restoreMediaFromTombstone } from './media-tombstone'

/**
 * A DAM delete takes the asset's delivery copies with it, and a restore does
 * not bring back a record of copies that are gone (AGL-2824). Driven through
 * the real delete and restore with an in-memory Firestore and bucket; the
 * tombstone's own behavior is `media-tombstone.emulator.spec.ts`'s.
 */

jest.mock('./firebase-admin', () => ({ firebaseAdmin: { app: () => ({}) } }))
jest.mock('./release-flags', () => ({ isServerReleaseFlagOnForOrg: async () => false }))

/** Documents by path, with the three write shapes the tombstone uses. */
function fakeLibrary(collection: 'hosts' | 'orgs', scopeId: string) {
  const docs = new Map<string, Record<string, unknown>>()
  const snapshot = (path: string) => ({
    exists: docs.has(path),
    get: (field: string) => docs.get(path)?.[field],
    data: () => docs.get(path),
  })
  const docRef = (path: string): Record<string, unknown> => ({
    path,
    id: path.split('/').pop(),
    get: async () => snapshot(path),
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => ({ doc: (id: string) => docRef(`${path}/${name}/${id}`) }),
  })
  const scopePath = `${collection}/${scopeId}`
  const scopeRef = {
    ...docRef(scopePath),
    id: scopeId,
    parent: { id: collection },
    firestore: {
      runTransaction: async <T>(
        run: (transaction: Record<string, (...args: never[]) => unknown>) => Promise<T>,
      ) =>
        run({
          get: (async (ref: { path: string }) => snapshot(ref.path)) as never,
          set: ((ref: { path: string }, data: Record<string, unknown>) => {
            // A counter moves by `FieldValue.increment`, whose operand is the
            // one field of the sentinel.
            const current = docs.get(ref.path) ?? {}
            const next: Record<string, unknown> = { ...current }
            for (const [field, value] of Object.entries(data)) {
              const operand = (value as { operand?: unknown } | null)?.operand
              next[field] =
                typeof operand === 'number' ? Number(current[field] ?? 0) + operand : value
            }
            docs.set(ref.path, next)
          }) as never,
          delete: ((ref: { path: string }) => {
            docs.delete(ref.path)
          }) as never,
        }),
    },
  }
  return { docs, scopeRef: scopeRef as never, mediaPath: (id: string) => `${scopePath}/media/${id}` }
}

const bucket = {
  file: () => ({
    getMetadata: async () => [{ generation: '1700000000000000' }],
    delete: async () => undefined,
    exists: async () => [true],
    restore: async () => undefined,
  }),
}

function recordingProvider() {
  const prefixes: string[] = []
  const provider: MediaDeliveryProvider = {
    isConfigured: () => true,
    putObject: async () => undefined,
    deleteObject: async () => undefined,
    deleteObjectsWithPrefix: async (prefix) => {
      prefixes.push(prefix)
      return 2
    },
    deliveryUrl: async () => 'https://delivery.test/x',
  }
  return { provider, prefixes }
}

const FILM = {
  fileName: 'film.mp4',
  contentType: 'video/mp4',
  sizeBytes: 100,
  contentHash: '0123456789abcdef',
  variants: [],
  deliveryCopies: {
    master: {
      key: 'hosts/host-1/med-film/0123456789abcdef/master/0123456789abcdef',
      sourceHash: '0123456789abcdef',
      objectHash: '0123456789abcdef',
      contentType: 'video/mp4',
      sizeBytes: 100,
      copiedAtMs: 1,
    },
  },
}

afterEach(() => resetPluginServicesForTests())

describe('a delete removes the asset’s delivery copies (AGL-2824)', () => {
  it('removes every copy under the asset’s prefix once the delete commits', async () => {
    const library = fakeLibrary('hosts', 'host-1')
    library.docs.set(library.mediaPath('med-film'), { ...FILM })
    const { provider, prefixes } = recordingProvider()
    registerMediaDeliveryProvider(provider, { pluginId: 'delivery-spec' })
    const result = await deleteMediaWithTombstone({
      scopeRef: library.scopeRef,
      bucket,
      mediaId: 'med-film',
      objectPath: 'hosts/host-1/media/med-film',
      uid: 'user-1',
    })
    expect(result.deleted).toBe(true)
    expect(prefixes).toEqual(['hosts/host-1/med-film/'])
  })

  it('removes an org library asset’s copies under the org’s prefix', async () => {
    const library = fakeLibrary('orgs', 'acme')
    library.docs.set(library.mediaPath('med-film'), { ...FILM })
    const { provider, prefixes } = recordingProvider()
    registerMediaDeliveryProvider(provider, { pluginId: 'delivery-spec' })
    await deleteMediaWithTombstone({
      scopeRef: library.scopeRef,
      bucket,
      mediaId: 'med-film',
      objectPath: 'orgs/acme/media/med-film',
      uid: 'user-1',
    })
    expect(prefixes).toEqual(['orgs/acme/med-film/'])
  })

  it('does nothing at the provider when none is configured', async () => {
    const library = fakeLibrary('hosts', 'host-1')
    library.docs.set(library.mediaPath('med-film'), { ...FILM })
    const { provider, prefixes } = recordingProvider()
    registerMediaDeliveryProvider(
      { ...provider, isConfigured: () => false },
      { pluginId: 'delivery-spec' },
    )
    const result = await deleteMediaWithTombstone({
      scopeRef: library.scopeRef,
      bucket,
      mediaId: 'med-film',
      objectPath: 'hosts/host-1/media/med-film',
      uid: 'user-1',
    })
    expect(result.deleted).toBe(true)
    expect(prefixes).toEqual([])
  })

  it('restores the document without the record of copies the delete removed', async () => {
    const library = fakeLibrary('hosts', 'host-1')
    library.docs.set(library.mediaPath('med-film'), { ...FILM })
    await deleteMediaWithTombstone({
      scopeRef: library.scopeRef,
      bucket,
      mediaId: 'med-film',
      objectPath: 'hosts/host-1/media/med-film',
      uid: 'user-1',
    })
    // The tombstone keeps the document verbatim, copy record included.
    const tombstone = library.docs.get('hosts/host-1/mediaTombstones/med-film')
    expect((tombstone?.['media'] as Record<string, unknown>)['deliveryCopies']).toBeDefined()

    const restored = await restoreMediaFromTombstone({
      scopeRef: library.scopeRef,
      bucket,
      mediaId: 'med-film',
      billing: { plan: 'enterprise' },
    })
    expect(restored.ok).toBe(true)
    const media = library.docs.get(library.mediaPath('med-film'))
    expect(media?.['fileName']).toBe('film.mp4')
    expect(media?.['deliveryCopies']).toBeUndefined()
  })
})
