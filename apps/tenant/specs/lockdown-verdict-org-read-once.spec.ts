/**
 * @jest-environment node
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
 * The lockdown verdict reads the org document once (AGL-4121).
 *
 * Its `videoEmbedPosters` answer is a per-org release flag, and the verdict
 * already holds the org through `getOrgBilling`. It used to ask the flag
 * through a second read of the same document; it now targets from the copy in
 * hand. Asserted by answer, not by spying on a helper: an org override that
 * exists ONLY on the document `getOrgBilling` returned turns the flag on, and
 * no Firestore read is made for it at all.
 */

const mockGetHost = jest.fn()
const mockGetOrgBilling = jest.fn(async (): Promise<unknown> => ({ org: null }))
const mockFirestoreReads: string[] = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  getPlatformLockdown: async () => null,
  getDomainLockdown: async () => null,
  firebaseAdmin: {
    app: () => ({
      firestore: () => {
        mockFirestoreReads.push('firestore')
        throw new Error('no Firestore in this spec')
      },
    }),
  },
}))
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  getHost: (...args: unknown[]) => mockGetHost(...(args as [])),
  default: (...args: unknown[]) => mockGetHost(...(args as [])),
  CNAME_HOST_PREFIX: 'cname--',
}))
jest.mock('../utils/get-org-billing', () => ({
  __esModule: true,
  getOrgBilling: (...args: unknown[]) => mockGetOrgBilling(...(args as [])),
  default: (...args: unknown[]) => mockGetOrgBilling(...(args as [])),
}))

import { __resetReleaseFlagCaches } from '@aglyn/tenant-data-admin/server/release-flags'
import { GET } from '../app/api/lockdown-verdict/route'

const site = { $id: 'host-1', orgId: 'org-1', subdomain: 'acme' }

const verdict = async () => {
  const response = await GET(
    new Request('https://tenant.example/api/lockdown-verdict?host=acme'),
  )
  return (await response.json()) as Record<string, unknown>
}

beforeEach(() => {
  mockFirestoreReads.length = 0
  __resetReleaseFlagCaches()
  mockGetHost.mockResolvedValue({ host: site })
})

describe('the verdict targets its release flag from the org it already holds (AGL-4121)', () => {
  it('turns the flag on from an override on the loaded org', async () => {
    mockGetOrgBilling.mockResolvedValue({
      org: { plan: 'free', releaseFlags: { release_video_embed_posters: true } },
    })
    const body = await verdict()
    expect(body['videoEmbedPosters']).toBe(true)
    expect(mockFirestoreReads).toEqual([])
  })

  it('keeps the shipped default (off) when the loaded org overrides nothing', async () => {
    mockGetOrgBilling.mockResolvedValue({ org: { plan: 'free' } })
    expect((await verdict())['videoEmbedPosters']).toBe(false)
  })

  it('answers off when there is no org, as an unreadable org did', async () => {
    mockGetOrgBilling.mockResolvedValue({ org: null })
    expect((await verdict())['videoEmbedPosters']).toBe(false)
  })

  it('answers an explicit override off, even where the default would differ', async () => {
    mockGetOrgBilling.mockResolvedValue({
      org: { plan: 'business', releaseFlags: { release_video_embed_posters: false } },
    })
    expect((await verdict())['videoEmbedPosters']).toBe(false)
  })
})
