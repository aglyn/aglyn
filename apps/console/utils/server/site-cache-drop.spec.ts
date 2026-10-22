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
 * The app's site cache drops a whole site, or only the pages a plugin named.
 *
 * A plugin that can place a change exactly — a form published, which renders
 * on the pages that place it — names those addresses per site (`paths`), and
 * those sites lose only them. Every other site named loses every page, which
 * is what a revoked bundle needs. Getting the split wrong in either direction
 * is silent: a whole-site drop on every form publish re-renders the site for
 * nothing, and a narrowed revoke leaves the stopped bundle serving.
 */

const mockAnnounceLivePaths = jest.fn()
const mockDropSiteCaches = jest.fn()
const mockHostGet = jest.fn()

jest.mock('./announce-live-paths', () => ({
  announceLivePaths: (...args: unknown[]) => mockAnnounceLivePaths(...args),
}))
jest.mock('./tenant-revalidate', () => ({
  dropSiteCaches: (...args: unknown[]) => mockDropSiteCaches(...args),
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: (hostId: string) => ({ get: () => mockHostGet(hostId) }),
        }),
      }),
    }),
  },
}))

import { consoleSiteCache } from './site-cache-drop'

beforeEach(() => {
  mockAnnounceLivePaths.mockReset().mockResolvedValue(true)
  mockDropSiteCaches.mockReset().mockImplementation(async (_firestore, { hostIds }) => ({
    hosts: hostIds.map((hostId: string) => ({ hostId })),
    hostsDropped: 0,
  }))
  mockHostGet.mockReset().mockImplementation(async (hostId: string) => ({ id: hostId }))
})

describe('the console site cache', () => {
  it('drops every page of a site named without paths', async () => {
    const result = await consoleSiteCache.drop({
      hostIds: ['h1', 'h2'],
      reason: 'listing revoked',
    })
    expect(mockDropSiteCaches).toHaveBeenCalledWith(expect.anything(), {
      hostIds: ['h1', 'h2'],
      reason: 'listing revoked',
    })
    expect(mockAnnounceLivePaths).not.toHaveBeenCalled()
    expect(result).toEqual({ dropped: 2, skipped: 0, complete: true })
  })

  it('drops only the named pages of a site named with paths', async () => {
    const result = await consoleSiteCache.drop({
      hostIds: ['h1'],
      paths: { h1: ['/', '/contact'] },
      reason: 'a form was published',
    })
    expect(mockAnnounceLivePaths).toHaveBeenCalledWith({
      hostSnapshot: { id: 'h1' },
      hostId: 'h1',
      paths: ['/', '/contact'],
    })
    // The whole-site fan-out is asked about no site at all.
    expect(mockDropSiteCaches).toHaveBeenCalledWith(expect.anything(), {
      hostIds: [],
      reason: 'a form was published',
    })
    expect(result).toEqual({ dropped: 1, skipped: 0, complete: true })
  })

  it('drops nothing for a site named with an empty list', async () => {
    const result = await consoleSiteCache.drop({
      hostIds: ['h1'],
      paths: { h1: [] },
      reason: 'a form was published',
    })
    expect(mockAnnounceLivePaths).not.toHaveBeenCalled()
    expect(mockHostGet).not.toHaveBeenCalled()
    expect(result).toEqual({ dropped: 0, skipped: 0, complete: true })
  })

  it('splits one request between the two', async () => {
    await consoleSiteCache.drop({
      hostIds: ['narrow', 'whole'],
      paths: { narrow: ['/pricing'] },
      reason: 'mixed',
    })
    expect(mockAnnounceLivePaths).toHaveBeenCalledTimes(1)
    expect(mockAnnounceLivePaths.mock.calls[0][0].hostId).toBe('narrow')
    expect(mockDropSiteCaches).toHaveBeenCalledWith(expect.anything(), {
      hostIds: ['whole'],
      reason: 'mixed',
    })
  })
})
