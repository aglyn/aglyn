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

export {}

/** The resolved entitlements a workspace's members may ask for (AGL-3670). */

const mockVerifyIdToken = jest.fn()
const mockHosts = new Map<string, Record<string, unknown>>()
const mockOrgs = new Map<string, Record<string, unknown>>()
const mockMembers = new Map<string, boolean>()

jest.mock('@aglyn/aglyn/server', () => ({
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: Object.fromEntries(new URL(request.url).searchParams),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  emailUnverifiedResponse: () => Response.json({ error: 'unverified' }, { status: 403 }),
  isImpersonationSession: () => false,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: mockVerifyIdToken }),
      firestore: () => ({
        collection: () => ({
          doc: (id: string) => ({
            get: async () => ({
              exists: mockHosts.has(id),
              get: (field: string) => mockHosts.get(id)?.[field],
            }),
          }),
        }),
      }),
    }),
  },
  getOrgDoc: async (orgId: string) => mockOrgs.get(orgId) ?? null,
  getOrgForHost: async (hostId: string) => {
    const orgId = mockHosts.get(hostId)?.['orgId'] as string | undefined
    return orgId && mockOrgs.has(orgId) ? { orgId, org: mockOrgs.get(orgId) } : null
  },
  resolveOrgMembership: async (uid: string, orgId: string) =>
    mockMembers.get(`${orgId}:${uid}`) ? { orgId, member: { uid } } : null,
}))

import { GET } from './route'

const ask = (query: string, token = 'token') =>
  GET(new Request(`https://app.example.test/api/orgs/entitlements?${query}`, { headers: { authorization: `Bearer ${token}` } }))

describe('GET /api/orgs/entitlements', () => {
  beforeEach(() => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email_verified: true })
    mockHosts.clear()
    mockOrgs.clear()
    mockMembers.clear()
    mockOrgs.set('o1', { plan: 'pro' })
    mockOrgs.set('o2', {})
  })

  it('answers a member with the resolved plan, features and quotas', async () => {
    mockMembers.set('o1:u1', true)
    const response = await ask('orgId=o1')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.plan).toBe('pro')
    expect(body.features.screenAnalytics).toBe(true)
    expect(typeof body.quotas.hostLimit).toBe('number')
  })

  it('resolves a workspace with no plan as Free', async () => {
    mockMembers.set('o2:u1', true)
    const body = await (await ask('orgId=o2')).json()
    expect(body.plan).toBe('free')
    expect(body.features.screenAnalytics).toBe(false)
  })

  it('answers a site collaborator for the workspace that owns the site', async () => {
    mockHosts.set('h1', { orgId: 'o1', memberRoles: { u1: 'editor' } })
    const body = await (await ask('hostId=h1')).json()
    expect(body.orgId).toBe('o1')
    expect(body.plan).toBe('pro')
  })

  it('refuses anyone else', async () => {
    expect((await ask('orgId=o1')).status).toBe(403)
    mockHosts.set('h1', { orgId: 'o1', memberRoles: { u2: 'editor' } })
    expect((await ask('hostId=h1')).status).toBe(403)
    expect((await ask('')).status).toBe(400)
    expect((await GET(new Request('https://app.example.test/api/orgs/entitlements?orgId=o1'))).status).toBe(401)
  })
})
