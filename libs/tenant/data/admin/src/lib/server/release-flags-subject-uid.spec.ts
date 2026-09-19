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
 * The staff preview for a TOKENLESS request its route vouched for (AGL-2978).
 *
 * A released-off plugin admits staff through a bearer token's `staff` claim.
 * A provider's OAuth redirect back to the platform carries no token, so a
 * staff member previewing a dark plugin could start a provider connect and
 * then be 404'd on the way back. The route proves the account from its own signed
 * state and hands the uid over as `subjectUid`; the gate reads the same claim
 * off that account.
 *
 * Both edges are pinned: a token, when present, is the only identity that
 * counts, and an account that is not staff — or cannot be looked up — gets
 * the anonymous answer.
 */

const mockGetTemplate = jest.fn()
const mockOrgGet = jest.fn()
const mockGetUser = jest.fn()
const mockVerifyIdToken = jest.fn()

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      remoteConfig: () => ({ getTemplate: mockGetTemplate }),
      firestore: () => ({
        collection: () => ({ doc: () => ({ get: mockOrgGet }) }),
      }),
      auth: () => ({ getUser: mockGetUser, verifyIdToken: mockVerifyIdToken }),
    }),
  },
}))

import {
  __resetReleaseFlagCaches,
  filterEnabledPluginsByReleaseFlags,
} from './release-flags'

/** A first-party plugin whose flag the template below turns off. */
const PLUGIN = 'marketplace'

beforeEach(() => {
  jest.clearAllMocks()
  __resetReleaseFlagCaches()
  mockGetTemplate.mockResolvedValue({
    etag: 'etag-1',
    parameters: {
      release_marketplace: { defaultValue: { value: JSON.stringify({ enabled: false }) } },
    },
  })
  mockOrgGet.mockResolvedValue({ data: () => ({}) })
})

describe('filterEnabledPluginsByReleaseFlags — subjectUid (AGL-2978)', () => {
  it('admits a tokenless request for a staff account its route named', async () => {
    mockGetUser.mockResolvedValue({ customClaims: { staff: true } })
    await expect(
      filterEnabledPluginsByReleaseFlags([PLUGIN], { orgId: 'org-1', subjectUid: 'staff-1' }),
    ).resolves.toEqual([PLUGIN])
    expect(mockGetUser).toHaveBeenCalledWith('staff-1')
  })

  it('refuses a named account that is not staff, or cannot be looked up', async () => {
    mockGetUser.mockResolvedValueOnce({ customClaims: { staff: false } })
    await expect(
      filterEnabledPluginsByReleaseFlags([PLUGIN], { orgId: 'org-1', subjectUid: 'member-1' }),
    ).resolves.toEqual([])
    mockGetUser.mockRejectedValueOnce(new Error('auth/user-not-found'))
    await expect(
      filterEnabledPluginsByReleaseFlags([PLUGIN], { orgId: 'org-1', subjectUid: 'gone-1' }),
    ).resolves.toEqual([])
  })

  it('never consults the named account when the request carries a token', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'member-1', staff: false })
    mockGetUser.mockResolvedValue({ customClaims: { staff: true } })
    await expect(
      filterEnabledPluginsByReleaseFlags([PLUGIN], {
        orgId: 'org-1',
        authorization: 'Bearer member-token',
        subjectUid: 'staff-1',
      }),
    ).resolves.toEqual([])
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('pays for no lookup when nothing was subtracted', async () => {
    mockGetTemplate.mockResolvedValue({ etag: 'etag-2', parameters: {} })
    __resetReleaseFlagCaches()
    // `marketplace` defaults on in the registry, so an empty template admits it.
    await expect(
      filterEnabledPluginsByReleaseFlags([PLUGIN], { orgId: 'org-1', subjectUid: 'staff-1' }),
    ).resolves.toEqual([PLUGIN])
    expect(mockGetUser).not.toHaveBeenCalled()
  })
})
