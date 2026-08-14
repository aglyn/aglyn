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
 * The SERVER half of per-org release-flag overrides (AGL-1635).
 *
 * This is the half that matters for the reported bug. `release_edit_bar` has
 * no client gate at all — the admin bar slot, the edit-context redemption
 * route and the edit-access mint route each resolve it server-side. If the
 * override were applied only in the console hook, granting an org the admin
 * bar would change nothing on the published site.
 */

const mockGetTemplate = jest.fn()
const mockOrgGet = jest.fn()
const mockDoc = jest.fn(() => ({ get: mockOrgGet }))
const mockCollection = jest.fn(() => ({ doc: mockDoc }))

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      remoteConfig: () => ({ getTemplate: mockGetTemplate }),
      firestore: () => ({ collection: mockCollection }),
    }),
  },
}))

import {
  __resetReleaseFlagCaches,
  getOrgReleaseFlagOverrides,
  isServerReleaseFlagOnForOrg,
} from './release-flags'

/** A Remote Config template with `release_edit_bar` in a given state. */
const template = (raw: string) => ({
  etag: 'etag-1',
  parameters: { release_edit_bar: { defaultValue: { value: raw } } },
})

const orgSnapshot = (data: Record<string, unknown> | undefined) => ({
  data: () => data,
})

describe('server per-org release flag overrides (AGL-1635)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    __resetReleaseFlagCaches()
  })

  describe('getOrgReleaseFlagOverrides', () => {
    it('reads and narrows the org doc field', async () => {
      mockOrgGet.mockResolvedValue(
        orgSnapshot({
          releaseFlags: {
            release_edit_bar: true,
            release_not_a_flag: true,
            release_contacts: 'yes',
          },
        }),
      )
      await expect(getOrgReleaseFlagOverrides('org-1')).resolves.toEqual({
        release_edit_bar: true,
      })
      expect(mockCollection).toHaveBeenCalledWith('orgs')
      expect(mockDoc).toHaveBeenCalledWith('org-1')
    })

    it('never reads Firestore without an org id', async () => {
      await expect(getOrgReleaseFlagOverrides(null)).resolves.toEqual({})
      await expect(getOrgReleaseFlagOverrides(undefined)).resolves.toEqual({})
      await expect(getOrgReleaseFlagOverrides('')).resolves.toEqual({})
      // A subject may be a uid or a hostId; neither may be looked up as an
      // org, and the common no-org path must cost nothing.
      expect(mockCollection).not.toHaveBeenCalled()
    })

    it('inherits rather than throwing when the read fails', async () => {
      // A denied or unavailable read must gate as "no override", never take
      // a published page down.
      mockOrgGet.mockRejectedValue(new Error('permission denied'))
      await expect(getOrgReleaseFlagOverrides('org-1')).resolves.toEqual({})
    })

    it('tolerates an org doc with no releaseFlags at all', async () => {
      mockOrgGet.mockResolvedValue(orgSnapshot({ plan: 'pro' }))
      await expect(getOrgReleaseFlagOverrides('org-1')).resolves.toEqual({})
      mockOrgGet.mockResolvedValue(orgSnapshot(undefined))
      __resetReleaseFlagCaches()
      await expect(getOrgReleaseFlagOverrides('org-2')).resolves.toEqual({})
    })

    it('caches per org, and keeps orgs separate', async () => {
      mockOrgGet.mockResolvedValueOnce(
        orgSnapshot({ releaseFlags: { release_edit_bar: true } }),
      )
      mockOrgGet.mockResolvedValueOnce(
        orgSnapshot({ releaseFlags: { release_edit_bar: false } }),
      )
      await expect(getOrgReleaseFlagOverrides('org-1')).resolves.toEqual({
        release_edit_bar: true,
      })
      await expect(getOrgReleaseFlagOverrides('org-2')).resolves.toEqual({
        release_edit_bar: false,
      })
      // Second look at org-1 is served from cache — one read per org.
      await expect(getOrgReleaseFlagOverrides('org-1')).resolves.toEqual({
        release_edit_bar: true,
      })
      expect(mockOrgGet).toHaveBeenCalledTimes(2)
    })
  })

  describe('isServerReleaseFlagOnForOrg', () => {
    it('grants a globally-dark flag to one org — the reported case', async () => {
      mockGetTemplate.mockResolvedValue(template('{"enabled":false}'))
      mockOrgGet.mockResolvedValue(
        orgSnapshot({ releaseFlags: { release_edit_bar: true } }),
      )
      await expect(
        isServerReleaseFlagOnForOrg('release_edit_bar', 'org-1'),
      ).resolves.toBe(true)
    })

    it('leaves every other org dark', async () => {
      mockGetTemplate.mockResolvedValue(template('{"enabled":false}'))
      mockOrgGet.mockResolvedValue(orgSnapshot({}))
      await expect(
        isServerReleaseFlagOnForOrg('release_edit_bar', 'org-2'),
      ).resolves.toBe(false)
    })

    it('revokes a globally-on flag for one org', async () => {
      mockGetTemplate.mockResolvedValue(template('{"enabled":true}'))
      mockOrgGet.mockResolvedValue(
        orgSnapshot({ releaseFlags: { release_edit_bar: false } }),
      )
      await expect(
        isServerReleaseFlagOnForOrg('release_edit_bar', 'org-1'),
      ).resolves.toBe(false)
    })

    it('falls back to the registry default with no Remote Config', async () => {
      // Emulator/local: no template. `release_edit_bar` defaults OFF, and an
      // override must still be honoured on top of that fallback.
      mockGetTemplate.mockRejectedValue(new Error('no remote config'))
      mockOrgGet.mockResolvedValue(orgSnapshot({}))
      await expect(
        isServerReleaseFlagOnForOrg('release_edit_bar', 'org-1'),
      ).resolves.toBe(false)

      __resetReleaseFlagCaches()
      mockGetTemplate.mockRejectedValue(new Error('no remote config'))
      mockOrgGet.mockResolvedValue(
        orgSnapshot({ releaseFlags: { release_edit_bar: true } }),
      )
      await expect(
        isServerReleaseFlagOnForOrg('release_edit_bar', 'org-1'),
      ).resolves.toBe(true)
    })

    it('resolves without an org id instead of throwing', async () => {
      mockGetTemplate.mockResolvedValue(template('{"enabled":true}'))
      await expect(
        isServerReleaseFlagOnForOrg('release_edit_bar', null),
      ).resolves.toBe(true)
      expect(mockCollection).not.toHaveBeenCalled()
    })
  })
})
