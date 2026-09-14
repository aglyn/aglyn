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
 * The site an org-library upload was made from is checked before the org's
 * Default sharing narrows the new asset to it.
 *
 * `defaultScopeForNewResource`, `visibleToTokens` and `scopeAllows` are the
 * REAL ones: the verdicts below are about which scope a file would be written
 * with and who could then see it, and a stub of either answers whatever the
 * stub was told.
 */

/** host id → owning org, as `hostIndex` answers it. */
const mockHostIndex: Record<string, string> = {
  'host-a': 'org-1',
  'host-b': 'org-1',
  'host-foreign': 'org-2',
}
const mockLookups: string[] = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  resolveOrgIdForHost: async (hostId: string) => {
    mockLookups.push(hostId)
    return mockHostIndex[hostId] ?? null
  },
}))

import {
  resolveUploadSite,
  UPLOAD_SITE_NOT_IN_ORG,
  UPLOAD_SITE_OUT_OF_REACH,
} from './media-upload-site'

type Scope = Parameters<typeof resolveUploadSite>[0]

/** The organization library, as an org-wide member resolves it. */
const orgLibrary = (overrides: Partial<Scope> = {}): Scope => ({
  collection: 'orgs',
  orgId: 'org-1',
  billing: { plan: 'pro', defaultResourceScope: 'host' },
  viewerTokens: ['org'],
  viewerOrgWide: true,
  ...overrides,
})

/** The same library, as a collaborator granted `host-a` alone resolves it. */
const collaborator = (overrides: Partial<Scope> = {}): Scope =>
  orgLibrary({
    viewerTokens: ['org', 'host:host-a'],
    viewerOrgWide: false,
    ...overrides,
  })

beforeEach(() => {
  mockLookups.length = 0
})

describe('no site to check', () => {
  it('is settled for an upload that names none — the org Media page', async () => {
    await expect(resolveUploadSite(orgLibrary(), {})).resolves.toEqual({
      hostId: null,
    })
    expect(mockLookups).toEqual([])
  })

  it("is settled for a site's own library, which stores no scope", async () => {
    // A site library's documents carry no `visibleTo`, so a site named on its
    // upload has nothing to narrow and is not even looked up.
    await expect(
      resolveUploadSite(
        orgLibrary({ collection: 'hosts' }),
        { forHostId: 'host-foreign' },
      ),
    ).resolves.toEqual({ hostId: null })
    expect(mockLookups).toEqual([])
  })
})

describe("one of the org's own sites", () => {
  it('is returned, after the index agrees', async () => {
    await expect(
      resolveUploadSite(orgLibrary(), { forHostId: 'host-a' }),
    ).resolves.toEqual({ hostId: 'host-a' })
    expect(mockLookups).toEqual(['host-a'])
  })

  it('is returned for a collaborator working in it', async () => {
    await expect(
      resolveUploadSite(collaborator(), { forHostId: 'host-a' }),
    ).resolves.toEqual({ hostId: 'host-a' })
  })
})

describe('a site the org does not own is refused', () => {
  it.each(['host', 'org'])(
    "another org's site, under the '%s' default",
    async (defaultResourceScope) => {
      await expect(
        resolveUploadSite(
          orgLibrary({ billing: { plan: 'pro', defaultResourceScope } }),
          { forHostId: 'host-foreign' },
        ),
      ).resolves.toEqual({
        error: { status: 400, message: UPLOAD_SITE_NOT_IN_ORG },
      })
    },
  )

  it('a site that does not exist', async () => {
    await expect(
      resolveUploadSite(orgLibrary(), { forHostId: 'host-nowhere' }),
    ).resolves.toEqual({
      error: { status: 400, message: UPLOAD_SITE_NOT_IN_ORG },
    })
  })

  it('an id that could not be a document id, without asking the index', async () => {
    await expect(
      resolveUploadSite(orgLibrary(), { forHostId: 'host-a/media/x' }),
    ).resolves.toEqual({
      error: { status: 400, message: UPLOAD_SITE_NOT_IN_ORG },
    })
    expect(mockLookups).toEqual([])
  })
})

describe("a collaborator's upload stays inside their own access", () => {
  it('refuses a site of the org they were not granted', async () => {
    // The file would be shared with `host-b` alone, and this uploader could
    // never see it again.
    await expect(
      resolveUploadSite(collaborator(), { forHostId: 'host-b' }),
    ).resolves.toEqual({
      error: { status: 403, message: UPLOAD_SITE_OUT_OF_REACH },
    })
  })

  it('does not refuse it when the org shares new files with every site', async () => {
    // All sites is visible to every member, so the site changes nothing about
    // who can see the file and there is nothing to refuse.
    await expect(
      resolveUploadSite(
        collaborator({ billing: { plan: 'pro', defaultResourceScope: 'org' } }),
        { forHostId: 'host-b' },
      ),
    ).resolves.toEqual({ hostId: 'host-b' })
  })
})
