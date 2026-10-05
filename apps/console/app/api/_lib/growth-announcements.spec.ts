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
 * AGL-3491: the announcements every creation door shares. A new site is told
 * to staff as `staff.siteCreated`; the canary's own never is; and nothing
 * here can throw into the route that created the thing.
 */

const mockNotifyStaff = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {},
  meterOrgEmail: async () => undefined,
  notifyStaff: (...args: unknown[]) => mockNotifyStaff(...args),
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => false,
  sendEmail: jest.fn(),
}))

jest.mock('./render-system-email', () => ({
  __esModule: true,
  renderSystemEmail: async () => null,
}))

import { announceNewSite, announceNewWorkspace } from './growth-announcements'

const SITE = {
  hostId: 'host-1',
  displayName: 'Paperlink',
  subdomain: 'paperlink',
  orgSlug: 'dongare',
  createdBy: 'owner@example.com',
}

beforeEach(() => {
  jest.clearAllMocks()
  mockNotifyStaff.mockResolvedValue(undefined)
})

describe('AGL-3491 · announceNewSite', () => {
  it('tells staff, linking the staff site page', async () => {
    await announceNewSite(SITE)

    expect(mockNotifyStaff).toHaveBeenCalledWith({
      type: 'staff.siteCreated',
      title: 'New site: Paperlink',
      body: 'owner@example.com created Paperlink (paperlink).',
      link: '/admin/sites/host-1',
    })
  })

  it("is silent for the canary's own, by workspace slug or by address", async () => {
    await announceNewSite({ ...SITE, orgSlug: 'signup-canary-abc' })
    await announceNewSite({ ...SITE, createdBy: 'ops+signup-canary-m2rso@example.com' })

    expect(mockNotifyStaff).not.toHaveBeenCalled()
  })

  it('never throws into the route', async () => {
    mockNotifyStaff.mockRejectedValue(new Error('feed down'))
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(announceNewSite(SITE)).resolves.toBeUndefined()

    quiet.mockRestore()
  })
})

describe('AGL-3491 · announceNewWorkspace', () => {
  const WORKSPACE = {
    orgId: 'org-1',
    name: 'Dongare Enterprises',
    slug: 'dongare',
    owner: { uid: 'u-1', email: 'owner@example.com', displayName: null },
    origin: 'https://app.aglyn.com',
  }

  it('tells staff with the slug and the owner', async () => {
    await announceNewWorkspace(WORKSPACE)

    expect(mockNotifyStaff).toHaveBeenCalledWith({
      type: 'staff.orgCreated',
      title: 'New workspace: Dongare Enterprises',
      body: 'owner@example.com created Dongare Enterprises (/dongare).',
      link: '/admin/orgs/org-1',
    })
  })

  it("is silent for a workspace the canary's address made", async () => {
    await announceNewWorkspace({
      ...WORKSPACE,
      owner: { ...WORKSPACE.owner, email: 'ops+signup-canary-x1@example.com' },
    })

    expect(mockNotifyStaff).not.toHaveBeenCalled()
  })
})
