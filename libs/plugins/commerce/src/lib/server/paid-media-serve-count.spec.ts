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
 * A PAID LINK THAT LEAVES FROM ELSEWHERE IS COUNTED WHERE IT IS HANDED OUT.
 *
 * Only the links whose bytes never reach `serveMediaCdn` are counted here: a
 * signed CDN URL is counted by the CDN itself, and counting it here too would
 * bill it twice.
 */

const mockRecorded: unknown[] = []
jest.mock('@aglyn/tenant-data-admin/server/media-serve-count', () => ({
  recordMediaServe: async (count: unknown) => {
    mockRecorded.push(count)
  },
}))

import { countOffRouteServe } from './paid-media-serve-count'

const firestore = {} as never

beforeEach(() => {
  mockRecorded.length = 0
})

describe('countOffRouteServe (AGL-3474)', () => {
  it('counts a delivery provider’s session at the copy’s size, as a redirect of the asset', async () => {
    await countOffRouteServe(firestore, {
      ok: true,
      via: 'delivery',
      location: 'https://video.delivery.test/x',
      expiresAtMs: 1,
      scope: 'org:acme:host-1',
      mediaId: 'med-film',
      collection: 'orgs',
      scopeId: 'acme',
      sizeBytes: 7_000_000,
    })
    expect(mockRecorded).toEqual([
      {
        firestore,
        collection: 'orgs',
        scopeId: 'acme',
        mediaId: 'med-film',
        bandwidthBytes: 7_000_000,
        redirect: true,
      },
    ])
  })

  it('counts a signed Storage read at the object’s size', async () => {
    await countOffRouteServe(firestore, {
      ok: true,
      via: 'signed-storage',
      location: 'https://storage.test/signed',
      expiresAtMs: 1,
      objectPath: 'hosts/host-1/media/Programs/week-1.mp4',
      collection: 'hosts',
      scopeId: 'host-1',
      sizeBytes: 48_000_000,
    })
    expect(mockRecorded).toEqual([
      { firestore, collection: 'hosts', scopeId: 'host-1', bandwidthBytes: 48_000_000 },
    ])
  })

  it('NEGATIVE: a signed CDN URL is the CDN’s to count, an unsized read and a refusal count nothing', async () => {
    await countOffRouteServe(firestore, {
      ok: true,
      via: 'signed-cdn',
      location: 'https://cdn.test/x',
      expiresAtMs: 1,
      scope: 'host-1',
      mediaId: 'med-film',
    })
    await countOffRouteServe(firestore, {
      ok: true,
      via: 'signed-storage',
      location: 'https://storage.test/signed',
      expiresAtMs: 1,
      objectPath: 'hosts/host-1/media/a.mp4',
      collection: 'hosts',
      scopeId: 'host-1',
      sizeBytes: 0,
    })
    await countOffRouteServe(firestore, { ok: true, via: 'external', location: 'https://x.test' })
    await countOffRouteServe(firestore, { ok: false, refusal: 'not-private' })
    expect(mockRecorded).toEqual([])
  })
})
