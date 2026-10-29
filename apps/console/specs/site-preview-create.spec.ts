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
 * "Start in preview" at creation (AGL-4086): `POST /api/hosts/create` passes
 * the person's choice to the claim, and without one starts a site brought in
 * from somewhere else (`start: 'import'`) in preview and every other site
 * public. The response says so, so the client does not report a site nobody
 * can see as published. The harness is `host-create-starter-chosen.spec.ts`'s.
 */

export {}

const mockClaim = jest.fn(async (_input: Record<string, unknown>) => ({
  allowed: true,
  hostId: 'host-1',
}))
const mockGuidedStart = jest.fn(async () => true)
const mockFlagOn = jest.fn(async (_flag: string, _orgId: string) => true)
const mockRateLimit = jest.fn(async () => ({ allowed: true, limit: 20, remaining: 19, resetMs: Date.now() }))
const mockRegisterDeclarations = jest.fn(async () => undefined)
const mockResolve = jest.fn()
const mockInstalled = jest.fn(async () => undefined)
const mockAnnounceNewSite = jest.fn(async (_site: Record<string, unknown>) => undefined)
let mockSourceRegistered = true
let mockStaff = false
let mockOrg: Record<string, unknown> = { plan: 'business', slug: 'acme' }

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({
          uid: 'user-1',
          email: 'a@example.com',
          email_verified: true,
          ...(mockStaff ? { staff: true } : {}),
        }),
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({ get: async () => ({ data: () => mockOrg }) }),
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
  consumeRateLimit: () => mockRateLimit(),
  isServerReleaseFlagOnForOrg: (flag: string, orgId: string) => mockFlagOn(flag, orgId),
}))
jest.mock('../constants/plugins.declarations.server.generated', () => ({
  registerPluginServerDeclarations: () => mockRegisterDeclarations(),
}))
jest.mock('@aglyn/aglyn/plugin-manager/plugin-site-starters', () => ({
  resolveSiteStarterSource: () =>
    mockSourceRegistered
      ? {
          search: async () => [],
          resolve: (...args: unknown[]) => mockResolve(...args),
          installed: (...args: unknown[]) => mockInstalled(...(args as [])),
        }
      : null,
}))
jest.mock('@aglyn/tenant-data-admin/server/account-acquisition', () => ({
  recordSignUpAcquisition: async () => undefined,
}))
jest.mock('../utils/server/provision-host', () => ({
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
  announceNewSite: (site: Record<string, unknown>) => mockAnnounceNewSite(site),
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
  jest.clearAllMocks()
  mockGuidedStart.mockResolvedValue(true)
  mockFlagOn.mockResolvedValue(true)
  mockSourceRegistered = true
  mockStaff = false
  mockOrg = { plan: 'business', slug: 'acme' }
})

describe('POST /api/hosts/create: Start in preview (AGL-4086)', () => {
  it('starts a site brought in from somewhere else in preview', async () => {
    const response = await create({ start: 'import' })
    expect(response.status).toBe(200)
    expect(mockClaim).toHaveBeenCalledWith(expect.objectContaining({ preview: true }))
    await expect(response.json()).resolves.toMatchObject({ preview: true })
  })

  it('lets the person start an import in public', async () => {
    await create({ start: 'import', preview: false })
    expect(mockClaim).toHaveBeenCalledWith(expect.objectContaining({ preview: false }))
  })

  it('starts every other site public, unless the person asked for preview', async () => {
    await create({ start: 'starter' })
    expect(mockClaim).toHaveBeenLastCalledWith(expect.objectContaining({ preview: false }))
    await create()
    expect(mockClaim).toHaveBeenLastCalledWith(expect.objectContaining({ preview: false }))
    const asked = await create({ start: 'starter', preview: true })
    expect(mockClaim).toHaveBeenLastCalledWith(expect.objectContaining({ preview: true }))
    await expect(asked.json()).resolves.toMatchObject({ preview: true })
  })

  it('reads only a boolean as a choice', async () => {
    await create({ start: 'import', preview: 'no' })
    expect(mockClaim).toHaveBeenLastCalledWith(expect.objectContaining({ preview: true }))
  })
})
