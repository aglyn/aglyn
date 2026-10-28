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
 *
 * AGL-4049 · a starter picked from the marketplace (`starter: { listingId }`)
 * is resolved through the core seam before anything is spent, and every
 * refusal of it happens before the claim: no site exists for a refused pick.
 * The page ceiling is the REAL plan's (`checkQuota` is not stubbed), with a
 * control that a starter of exactly Free's five pages passes.
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
  mockResolve.mockResolvedValue(starterPayload(3))
  mockSourceRegistered = true
  mockStaff = false
  mockOrg = { plan: 'business', slug: 'acme' }
})

/** A base starter of `pages` pages, the first its Home. */
function starterPayload(pages: number, mode: 'base' | 'ai' = 'base') {
  return {
    mode,
    facets: { kind: null, base: 'starter', fonts: null, pages, mode },
    theme: { kind: 'builtin', base: 'starter', brand: { light: {} }, fonts: null },
    screens: Array.from({ length: pages }, (_, i) => ({
      displayName: i ? `Page ${i}` : 'Home',
      slug: i ? `page-${i}` : '/',
      nodes: {},
    })),
    layout: { displayName: 'Header and footer', nodes: {} },
    ...(mode === 'ai' ? { answers: {} } : {}),
  }
}

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

describe('POST /api/hosts/create with a starter from the marketplace (AGL-4049)', () => {
  it('resolves the pick and creates the site from it, offering no guided start', async () => {
    const response = await create({ starter: { listingId: 'listing-1' } })
    expect(response.status).toBe(200)
    expect(mockResolve).toHaveBeenCalledWith({ listingId: 'listing-1' }, { orgId: 'org-1', uid: 'user-1' })
    expect(mockClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        starter: {
          payload: starterPayload(3),
          listing: { listingId: 'listing-1', version: 'latest', displayName: 'Starter' },
        },
      }),
    )
    expect(mockGuidedStart).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      hostId: 'host-1',
      guidedStart: false,
      starter: { listingId: 'listing-1', version: null },
    })
    expect(mockInstalled).toHaveBeenCalledWith(
      { listingId: 'listing-1' },
      { orgId: 'org-1', uid: 'user-1' },
      { hostId: 'host-1' },
    )
    expect(mockAnnounceNewSite).toHaveBeenCalledWith(expect.objectContaining({ start: 'marketplace-starter' }))
  })

  it('takes the pick over `start: starter` when a body carries both, and keeps a pinned version', async () => {
    const response = await create({ start: 'starter', starter: { listingId: 'listing-1', version: '2' } })
    expect(response.status).toBe(200)
    expect(mockClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        starter: expect.objectContaining({ listing: expect.objectContaining({ version: '2' }) }),
      }),
    )
    await expect(response.json()).resolves.toMatchObject({ starter: { listingId: 'listing-1', version: '2' } })
  })

  it('answers 400 for a starter that is not a pick, before anything else', async () => {
    const response = await create({ starter: { listingId: 'a/b' } })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Unknown starter' })
    expect(mockResolve).not.toHaveBeenCalled()
    expect(mockClaim).not.toHaveBeenCalled()
  })

  it('answers 403 with the flag off, before the marketplace is read, and creates nothing', async () => {
    mockFlagOn.mockResolvedValue(false)
    const response = await create({ starter: { listingId: 'listing-1' } })
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Site starters are not available for this workspace yet',
    })
    expect(mockFlagOn).toHaveBeenCalledWith('release_site_starters', 'org-1')
    expect(mockRegisterDeclarations).not.toHaveBeenCalled()
    expect(mockResolve).not.toHaveBeenCalled()
    expect(mockClaim).not.toHaveBeenCalled()
    // A refused pick burns no rate-limit token.
    expect(mockRateLimit).not.toHaveBeenCalled()
  })

  it('lets staff through with the flag off', async () => {
    mockStaff = true
    mockFlagOn.mockResolvedValue(false)
    const response = await create({ starter: { listingId: 'listing-1' } })
    expect(response.status).toBe(200)
    expect(mockClaim).toHaveBeenCalled()
  })

  it('answers 503 when no plugin serves starters', async () => {
    mockSourceRegistered = false
    const response = await create({ starter: { listingId: 'listing-1' } })
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Starters are unavailable right now. Try again in a moment.',
    })
    expect(mockClaim).not.toHaveBeenCalled()
  })

  it('answers an unpaid priced starter 402 with what buying it needs, and creates nothing', async () => {
    mockResolve.mockResolvedValue({ error: 'Purchase required', status: 402, priceUsd: 29 })
    const response = await create({ starter: { listingId: 'listing-1' } })
    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toEqual({
      error: 'Purchase required',
      code: 'purchase_required',
      listingId: 'listing-1',
      priceUsd: 29,
    })
    expect(mockClaim).not.toHaveBeenCalled()
    expect(mockRateLimit).not.toHaveBeenCalled()
  })

  it('passes a 404 from the source on', async () => {
    mockResolve.mockResolvedValue({ error: 'That starter is no longer available', status: 404 })
    const response = await create({ starter: { listingId: 'listing-1' } })
    expect(response.status).toBe(404)
    expect(mockClaim).not.toHaveBeenCalled()
  })

  it('answers 409 for an AI starter until the AI start takes one', async () => {
    mockResolve.mockResolvedValue(starterPayload(3, 'ai'))
    const response = await create({ starter: { listingId: 'listing-1' } })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'This starter needs the AI start, which is coming soon',
    })
    expect(mockClaim).not.toHaveBeenCalled()
  })

  it("refuses more pages than Free's real ceiling, and passes exactly as many", async () => {
    mockOrg = { plan: 'free', slug: 'acme' }
    mockResolve.mockResolvedValue(starterPayload(6))
    const refused = await create({ starter: { listingId: 'listing-1' } })
    expect(refused.status).toBe(403)
    await expect(refused.json()).resolves.toEqual({
      error: 'This starter has 6 pages; your plan includes 5. Pick a smaller starter or upgrade in Billing.',
    })
    expect(mockClaim).not.toHaveBeenCalled()

    mockResolve.mockResolvedValue(starterPayload(5))
    const passed = await create({ starter: { listingId: 'listing-1' } })
    expect(passed.status).toBe(200)
    expect(mockClaim).toHaveBeenCalledTimes(1)
  })

  it('reads nothing about starters for a body without one', async () => {
    await create({ start: 'starter' })
    await create()
    expect(mockFlagOn).not.toHaveBeenCalled()
    expect(mockResolve).not.toHaveBeenCalled()
    expect(mockClaim.mock.calls.map(([input]) => input['starter'])).toEqual([true, false])
  })
})
