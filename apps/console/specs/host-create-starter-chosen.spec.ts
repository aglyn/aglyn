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
 * AGL-3761 · a site whose starter was chosen before it existed is born with it.
 *
 * "Create site" now asks how the site starts before creating it, so the
 * starter is a choice the create already knows. `start: 'starter'` makes the
 * site with the starter in the same claim, and says it will not be offered
 * the guided start; without it the create decides exactly as before.
 */

export {}

const mockClaim = jest.fn(async (_input: Record<string, unknown>) => ({
  allowed: true,
  hostId: 'host-1',
}))
const mockGuidedStart = jest.fn(async () => true)

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'user-1', email: 'a@example.com', email_verified: true }),
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({ get: async () => ({ data: () => ({ plan: 'business', slug: 'acme' }) }) }),
        }),
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () => Response.json({ error: 'unverified' }, { status: 403 }),
  resolveOrgMembership: async (_uid: string, orgId: string) => ({ orgId, member: { role: 'owner' } }),
  ensureOrgForUser: async () => ({ orgId: 'org-1', member: { role: 'owner' } }),
  memberHasOrgPermission: async () => true,
  freeWorkspaceCapRefusalResponse: () => null,
  logHostActivity: async () => undefined,
  lockdownRefusal: async () => null,
  consumeRateLimit: async () => ({ allowed: true, limit: 20, remaining: 19, resetMs: Date.now() }),
}))
jest.mock('@aglyn/tenant-data-admin/server/account-acquisition', () => ({
  recordSignUpAcquisition: async () => undefined,
}))
jest.mock('@aglyn/tenant-data-admin/server/console/provision-host', () => ({
  claimHostForOrg: (input: Record<string, unknown>) => mockClaim(input),
  findSubdomainConflict: async () => null,
  resumeUnfinishedCreate: async () => null,
  HostRegistrationIncompleteError: class extends Error {},
  isTransientFirestoreError: () => false,
  NEW_SITE_ENABLED_PLUGINS: ['accounts'],
}))
jest.mock('../utils/server/guided-start-offered', () => ({
  guidedStartOffered: () => mockGuidedStart(),
}))
jest.mock('../utils/report-server-error', () => ({ reportServerError: async () => 'written' }))
jest.mock('../app/api/_lib/growth-announcements', () => ({
  announceNewSite: async () => undefined,
  announceNewWorkspace: async () => undefined,
}))

const { POST } = require('../app/api/hosts/create/route') as {
  POST: (request: Request) => Promise<Response>
}

const create = (extra: Record<string, unknown> = {}) =>
  POST(
    new Request('https://console.aglyn.com/api/hosts/create', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Royal Styles', subdomain: 'royal-styles', orgId: 'org-1', ...extra }),
    }),
  )

beforeEach(() => {
  mockClaim.mockClear()
  mockGuidedStart.mockClear()
  mockGuidedStart.mockResolvedValue(true)
})

describe('POST /api/hosts/create with the starter chosen (AGL-3761)', () => {
  it('creates the site with the starter, and offers it no guided start', async () => {
    const response = await create({ start: 'starter' })
    expect(response.status).toBe(200)
    expect(mockClaim).toHaveBeenCalledWith(expect.objectContaining({ starter: true }))
    expect(mockGuidedStart).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({ hostId: 'host-1', guidedStart: false })
  })

  it('decides as before without it: no starter for a creator offered the start', async () => {
    const response = await create()
    expect(mockClaim).toHaveBeenCalledWith(expect.objectContaining({ starter: false }))
    await expect(response.json()).resolves.toMatchObject({ guidedStart: true })
  })

  it('and the starter for a creator who will not be offered it', async () => {
    mockGuidedStart.mockResolvedValueOnce(false)
    const response = await create({ start: 'anything-else' })
    expect(mockClaim).toHaveBeenCalledWith(expect.objectContaining({ starter: true }))
    await expect(response.json()).resolves.toMatchObject({ guidedStart: false })
  })
})
