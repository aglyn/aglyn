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
 *
 * @jest-environment node
 */

/**
 * The person erasure notes route (AGL-4042): whoever may file an erasure hears
 * what it keeps, and it asks exactly what filing asks.
 */

import { registerPersonErasureNoteSource } from '@aglyn/aglyn/plugin-manager/plugin-person-erasure-notes'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'

const mockVerifyIdToken = jest.fn()
const mockHolds = jest.fn()
const mockLockdown = jest.fn()
let mockMember: Record<string, unknown> | null

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      firestore: () => ({
        collection: () => ({
          doc: (id: string) => ({
            get: async () => ({ exists: id === 'org-1', data: () => ({ name: 'Acme Builders' }) }),
          }),
        }),
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  lockdownRefusal: (...args: unknown[]) => mockLockdown(...args),
  resolveOrgMembership: async () => (mockMember ? { member: mockMember } : null),
  memberHasOrgPermission: (...args: unknown[]) => mockHolds(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: null,
    headers: Object.fromEntries(request.headers),
  }),
}))

const { GET } = require('./route') as { GET: (request: Request) => Promise<Response> }

const REFUSAL = 'Your role does not include "Privacy requests" — ask an organization admin'

const get = (query = 'orgId=org-1', token: string | null = 'token', method = 'GET') =>
  GET(
    new Request(`https://app.aglyn.com/api/person-erasure-notes?${query}`, {
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  )

describe('GET /api/person-erasure-notes', () => {
  beforeEach(() => {
    resetPluginServicesForTests()
    registerPersonErasureNoteSource(
      { notes: async () => [{ id: 'kept', text: 'Tickets stay as issued.' }] },
      { pluginId: 'tickets' },
    )
    mockVerifyIdToken.mockReset().mockResolvedValue({ uid: 'admin-1', email_verified: true })
    mockHolds.mockReset().mockResolvedValue(true)
    mockLockdown.mockReset().mockResolvedValue(null)
    mockMember = { role: 'admin' }
  })

  it('tells a holder of "Privacy requests" what the erasure keeps, and asks that key', async () => {
    const response = await get()
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      notes: [{ id: 'kept', text: 'Tickets stay as issued.', pluginId: 'tickets' }],
      unavailable: [],
    })
    expect(mockHolds).toHaveBeenCalledWith('org-1', mockMember, 'org.privacy')
  })

  it('follows the key, not the role: an admin refused it is refused, naming the permission', async () => {
    mockHolds.mockResolvedValue(false)
    const response = await get()
    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe(REFUSAL)
  })

  it('follows the key, not the role: an editor granted it is answered', async () => {
    mockMember = { role: 'editor', allHosts: true }
    expect((await get()).status).toBe(200)
  })

  it('refuses a site collaborator even with the key, as filing does', async () => {
    mockMember = { role: 'editor', allHosts: false, hostAccess: { 'host-1': 'editor' } }
    const response = await get()
    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe(REFUSAL)
  })

  it('refuses someone outside the workspace, staff included', async () => {
    mockMember = null
    mockVerifyIdToken.mockResolvedValue({ uid: 'staff-1', email_verified: true, staff: true })
    expect((await get()).status).toBe(403)
  })

  it('answers a locked workspace with the lockdown', async () => {
    mockLockdown.mockResolvedValue(Response.json({ error: 'Locked' }, { status: 423 }))
    expect((await get()).status).toBe(423)
  })

  it('refuses the wrong method, a missing org, no token, a bad token and an unverified email', async () => {
    expect((await get('orgId=org-1', 'token', 'POST')).status).toBe(405)
    expect((await get('')).status).toBe(400)
    expect((await get('orgId=org-1', null)).status).toBe(401)
    mockVerifyIdToken.mockRejectedValueOnce(Object.assign(new Error('bad'), { code: 'auth/argument-error' }))
    expect((await get()).status).toBe(401)
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'admin-1', email_verified: false })
    expect((await get()).status).toBe(403)
  })

  it('answers 404 for a workspace that is not there', async () => {
    expect((await get('orgId=org-gone')).status).toBe(404)
  })
})
