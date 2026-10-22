/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, the suite runs on jsdom, and `Response.json` is undefined.
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
 * "Used by" on the platform marketing site's email blocks lists the platform
 * emails that place them (AGL-3318).
 *
 * Aglyn's own emails borrow that site's header and footer, and they live at
 * the root, `systemEmailTemplates/{key}`, under no site. A scan that read only
 * the site's own collections answered "nothing uses this" for the footer every
 * account email carries, which is an invitation to delete it. The root read
 * belongs to that one site alone: any other site's scan must not make it.
 */

import type { UsageCandidate } from '../utils/server/scan-artifact-usage'

const mockReadUsageCandidates = jest.fn()
const mockReadSystemEmails = jest.fn()
const mockPlatformHost = jest.fn((): string | null => null)

jest.mock('../utils/server/read-usage-candidates', () => ({
  readUsageCandidates: (...args: unknown[]) => mockReadUsageCandidates(...args),
  readSystemEmailUsageCandidates: (...args: unknown[]) =>
    mockReadSystemEmails(...args),
}))

jest.mock('@aglyn/tenant-data-admin/server/platform-marketing-consent', () => ({
  platformMarketingHostId: () => mockPlatformHost(),
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const hostSnapshot = {
    exists: true,
    get: (field: string) =>
      field === 'memberRoles' ? { 'uid-admin': 'admin' } : undefined,
    data: () => ({}),
  }
  return {
    emailUnverifiedResponse: () =>
      Response.json({ error: 'Email unverified' }, { status: 403 }),
    getOrgForHost: async () => null,
    isImpersonationSession: () => false,
    lockdownRefusal: async () => null,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async () => ({ uid: 'uid-admin', email_verified: true }),
        }),
        firestore: () => ({
          collection: () => ({
            doc: () => ({ get: async () => hostSnapshot }),
          }),
        }),
      }),
    },
  }
})

import { POST } from '../app/api/hosts/where-used/route'

const MARKETING_HOST = 'aglyn-marketing'

/** A published tree placing `refId`, as the besigner stores it. */
const placing = (refId: string) => ({
  '_@_': { $id: '_@_', componentId: 'div', nodes: ['block'] },
  block: {
    $id: 'block',
    componentId: 'reusableInstance',
    parentId: '_@_',
    props: { refId },
    nodes: [],
  },
})

const systemEmail = (
  id: string,
  overrides: Partial<UsageCandidate> = {},
): UsageCandidate => ({ id, displayName: id, ...overrides })

const request = (hostId: string) =>
  new Request('https://app.aglyn.com/api/hosts/where-used', {
    method: 'POST',
    headers: {
      authorization: 'Bearer id-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ hostId, kind: 'component', id: 'footer-1' }),
  })

describe('/api/hosts/where-used and the platform’s own emails (AGL-3318)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPlatformHost.mockReturnValue(MARKETING_HOST)
    // The site's own collections place nothing, so every dependent below is
    // one the root read found.
    mockReadUsageCandidates.mockResolvedValue({
      candidates: [],
      truncated: false,
    })
    mockReadSystemEmails.mockResolvedValue({
      candidates: [
        systemEmail('org-invite', {
          displayName: 'Organization invite',
          versionId: 'v3',
          nodes: placing('footer-1'),
        }),
        systemEmail('welcome', {
          displayName: 'Welcome',
          versionId: 'v1',
          nodes: placing('header-1'),
        }),
      ],
      truncated: false,
    })
  })

  it('lists the platform emails that place a block of the marketing site', async () => {
    const response = await POST(request(MARKETING_HOST))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.dependents).toEqual([
      {
        type: 'systemEmail',
        id: 'org-invite',
        name: 'Organization invite',
        via: ['id'],
        versionId: 'v3',
      },
    ])
    expect(body.complete).toBe(true)
    expect(mockReadSystemEmails).toHaveBeenCalledWith(expect.anything(), {
      limit: 200,
    })
  })

  it('never reads them for any other site', async () => {
    const body = await (await POST(request('customer-site'))).json()
    expect(mockReadSystemEmails).not.toHaveBeenCalled()
    expect(body.dependents).toEqual([])
  })

  it('never reads them when the deployment names no marketing site', async () => {
    mockPlatformHost.mockReturnValue(null)
    await POST(request(MARKETING_HOST))
    expect(mockReadSystemEmails).not.toHaveBeenCalled()
  })

  it('says the answer is incomplete when they were too many to read', async () => {
    mockReadSystemEmails.mockResolvedValue({ candidates: [], truncated: true })
    const body = await (await POST(request(MARKETING_HOST))).json()
    expect(body.complete).toBe(false)
  })
})
