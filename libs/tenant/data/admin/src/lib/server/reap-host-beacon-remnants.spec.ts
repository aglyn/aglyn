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
 * A deleted site's late beacons leave counters under a host with no document
 * (AGL-3744). The reaper may take exactly that shape and nothing else: a live
 * host, or a phantom holding anything but the beacon's own collections, stays.
 */

type FakeRef = { id: string; listCollections: () => Promise<Array<{ id: string }>> }

const mockRecursiveDelete = jest.fn(async (_ref: FakeRef) => undefined)
let mockHosts: Array<{ id: string; exists: boolean; collections: string[] }> = []

jest.mock('./firebase-admin', () => {
  const ref = (host: { id: string; collections: string[] }): FakeRef => ({
    id: host.id,
    listCollections: async () => host.collections.map((id) => ({ id })),
  })
  return {
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collection: () => ({
            listDocuments: async () => mockHosts.map(ref),
          }),
          getAll: async (...refs: FakeRef[]) =>
            refs.map((r) => {
              const host = mockHosts.find((h) => h.id === r.id)!
              return { id: r.id, exists: host.exists, ref: r }
            }),
          recursiveDelete: (r: FakeRef) => mockRecursiveDelete(r),
        }),
      }),
    },
  }
})

import { reapHostBeaconRemnants } from './erase'

describe('reapHostBeaconRemnants (AGL-3744)', () => {
  beforeEach(() => {
    mockRecursiveDelete.mockClear()
    mockHosts = [
      { id: 'live', exists: true, collections: ['analytics', 'screens'] },
      { id: 'gone-dwell', exists: false, collections: ['screenAnalytics'] },
      { id: 'gone-views', exists: false, collections: ['analytics', 'screenAnalytics'] },
      { id: 'gone-other', exists: false, collections: ['analytics', 'forms'] },
    ]
  })

  it('deletes only phantoms that hold nothing but beacon counters', async () => {
    const result = await reapHostBeaconRemnants()

    expect(result.reaped).toEqual(['gone-dwell', 'gone-views'])
    expect(mockRecursiveDelete.mock.calls.map(([r]) => r.id)).toEqual([
      'gone-dwell',
      'gone-views',
    ])
  })

  it('reports, never deletes, a phantom holding anything else', async () => {
    const result = await reapHostBeaconRemnants()

    expect(result.left).toEqual([
      { hostId: 'gone-other', collections: ['analytics', 'forms'] },
    ])
  })

  it('a dry run deletes nothing', async () => {
    const result = await reapHostBeaconRemnants({ dryRun: true })

    expect(result.reaped).toEqual(['gone-dwell', 'gone-views'])
    expect(mockRecursiveDelete).not.toHaveBeenCalled()
  })
})
