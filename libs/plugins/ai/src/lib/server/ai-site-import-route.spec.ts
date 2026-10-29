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
 * The "Bring my site" doors (AGL-3974): the gate's rungs in order, the
 * ownership actions reaching the claim module, and the crawl refusing a
 * domain with no current proof before it reads a page.
 */

const mockVerifyIdToken = jest.fn()
const mockGetOrgForUser = jest.fn()
const mockFlagOn = jest.fn(async (..._args: unknown[]) => true)
const mockConsumeRateLimit = jest.fn(async (..._args: unknown[]) => ({ allowed: true }))
const mockAddAdminAudit = jest.fn(async (..._args: unknown[]) => undefined)
const mockIssue = jest.fn()
const mockCheck = jest.fn()
const mockSend = jest.fn()
const mockConfirm = jest.fn()
const mockList = jest.fn(async (..._args: unknown[]) => [])
const mockProven = jest.fn(async (..._args: unknown[]) => false)
const mockCrawl = jest.fn()

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      firestore: () => ({}),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
}))
jest.mock('@aglyn/tenant-data-admin/server/id-token-refusal', () => ({
  __esModule: true,
  invalidIdTokenResponse: () => Response.json({ error: 'Unauthenticated' }, { status: 401 }),
}))
jest.mock('@aglyn/tenant-data-admin/server/lockdown', () => ({
  __esModule: true,
  lockdownRefusal: async () => null,
}))
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  // "Bring a site in" (`ai.import`, AGL-4047), answered by the real catalog
  // with the AI plugin's declarations registered.
  memberHasOrgPermission: async (_orgId: string, member: unknown, permission: string) => {
    jest.requireActual('../declarations').registerAiDeclarations()
    return jest.requireActual('@aglyn/aglyn/app-utils/org-permissions').resolveOrgPermissions(member, null)[permission] === true
  },
  __esModule: true,
  getOrgForUser: (...args: unknown[]) => mockGetOrgForUser(...args),
}))
jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  __esModule: true,
  isServerReleaseFlagOnForOrg: (...args: unknown[]) => mockFlagOn(...args),
}))
jest.mock('@aglyn/tenant-data-admin/server/rate-limit-store', () => ({
  __esModule: true,
  consumeRateLimit: (...args: unknown[]) => mockConsumeRateLimit(...args),
}))
jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({
  __esModule: true,
  addAdminAudit: (...args: unknown[]) => mockAddAdminAudit(...args),
}))
jest.mock('@aglyn/tenant-data-admin/server/domain-ownership', () => ({
  __esModule: true,
  DOMAIN_OWNERSHIP_META_NAME: 'aglyn-site-verification',
  normalizeOwnershipDomain: (input: string) =>
    /\./.test(input) ? { domain: input.replace(/^www\./, ''), error: null } : { domain: null, error: 'bad' },
  issueDomainOwnershipClaim: (...args: unknown[]) => mockIssue(...args),
  checkDomainOwnership: (...args: unknown[]) => mockCheck(...args),
  sendDomainOwnershipCode: (...args: unknown[]) => mockSend(...args),
  confirmDomainOwnershipCode: (...args: unknown[]) => mockConfirm(...args),
  listDomainOwnershipClaims: (...args: unknown[]) => mockList(...args),
  isDomainOwnershipProven: (...args: unknown[]) => mockProven(...args),
}))
jest.mock('../site-import/site-import-crawl', () => ({
  __esModule: true,
  crawlSiteForImport: (...args: unknown[]) => mockCrawl(...args),
  readSiteVerificationMeta: async () => ({ answered: true, values: [] }),
}))

import {
  listSiteImportOwnership,
  postSiteImportCrawl,
  postSiteImportOwnership,
  SITE_IMPORT_DOOR_MAX_PAGES,
  SITE_IMPORT_RELEASE_FLAG,
  siteImportOfferFor,
} from './ai-site-import-route'

const PAID_ORG = { plan: 'pro', name: 'Rosie’s' }

function member(role: string, org: Record<string, unknown> = PAID_ORG) {
  return { orgId: 'org-1', org, member: { uid: 'uid-1', role } }
}

function post(body: unknown, token: string | null = 'tok'): Request {
  return new Request('https://app.aglyn.com/api/ai/site-import/ownership', {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' } : {},
    body: JSON.stringify(body),
  })
}

const CLAIM_VIEW = { domain: 'rosies-bakery.com', status: 'pending', email: { pendingAddress: null } }

beforeEach(() => {
  jest.clearAllMocks()
  mockVerifyIdToken.mockResolvedValue({ uid: 'uid-1', email: 'zed@rosies-bakery.com', email_verified: true })
  mockGetOrgForUser.mockResolvedValue(member('owner'))
  mockFlagOn.mockResolvedValue(true)
  mockConsumeRateLimit.mockResolvedValue({ allowed: true })
  mockProven.mockResolvedValue(false)
})

describe('the gate', () => {
  it('401 without a token', async () => {
    expect((await postSiteImportOwnership(post({ orgId: 'org-1' }, null))).status).toBe(401)
  })

  it('400 when the request names no org', async () => {
    expect((await postSiteImportOwnership(post({ action: 'claim' }))).status).toBe(400)
  })

  it('403 for someone outside the org', async () => {
    mockGetOrgForUser.mockResolvedValue(null)
    expect((await postSiteImportOwnership(post({ orgId: 'org-1' }))).status).toBe(403)
  })

  it('404 while the release flag is off, before any role or plan is disclosed', async () => {
    mockFlagOn.mockResolvedValue(false)
    mockGetOrgForUser.mockResolvedValue(member('viewer', { plan: 'free' }))
    const response = await postSiteImportOwnership(post({ orgId: 'org-1', action: 'claim', domain: 'rosies-bakery.com' }))
    expect(response.status).toBe(404)
    expect(mockFlagOn).toHaveBeenCalledWith(SITE_IMPORT_RELEASE_FLAG, 'org-1')
    expect(mockIssue).not.toHaveBeenCalled()
  })

  it('lets staff preview through the flag', async () => {
    mockFlagOn.mockResolvedValue(false)
    mockVerifyIdToken.mockResolvedValue({ uid: 'uid-1', email_verified: true, staff: true })
    mockIssue.mockResolvedValue({ claim: CLAIM_VIEW, error: null })
    expect((await postSiteImportOwnership(post({ orgId: 'org-1', action: 'claim', domain: 'rosies-bakery.com' }))).status).toBe(200)
  })

  it('403 role for an editor or a viewer', async () => {
    for (const role of ['editor', 'viewer']) {
      mockGetOrgForUser.mockResolvedValue(member(role))
      const response = await postSiteImportOwnership(post({ orgId: 'org-1', action: 'claim', domain: 'rosies-bakery.com' }))
      expect(response.status).toBe(403)
      expect((await response.json()).reason).toBe('role')
    }
  })

  it('403 plan on Free, and on a paid plan whose subscription died', async () => {
    for (const org of [{ plan: 'free' }, { plan: 'pro', billingStatus: 'canceled' }, {}]) {
      mockGetOrgForUser.mockResolvedValue(member('admin', org))
      const response = await postSiteImportOwnership(post({ orgId: 'org-1', action: 'claim', domain: 'rosies-bakery.com' }))
      expect(response.status).toBe(403)
      expect((await response.json()).reason).toBe('plan')
    }
  })
})

describe('the ownership door', () => {
  it('lists the org’s claims', async () => {
    mockList.mockResolvedValue([CLAIM_VIEW] as never)
    const response = await listSiteImportOwnership(
      new Request('https://app.aglyn.com/api/ai/site-import/ownership?orgId=org-1', {
        headers: { authorization: 'Bearer tok' },
      }),
    )
    expect(await response.json()).toEqual({ claims: [CLAIM_VIEW] })
    expect(mockList.mock.calls[0][0]).toBe('org-1')
  })

  it('starts a claim for the caller, and audits it', async () => {
    mockIssue.mockResolvedValue({ claim: CLAIM_VIEW, error: null })
    const response = await postSiteImportOwnership(post({ orgId: 'org-1', action: 'claim', domain: 'rosies-bakery.com' }))
    expect(response.status).toBe(200)
    expect(mockIssue.mock.calls[0].slice(0, 3)).toEqual(['org-1', 'rosies-bakery.com', 'uid-1'])
    expect(mockAddAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'site-import.ownership.claim', target: 'orgs/org-1/domainOwnershipClaims/rosies-bakery.com' }),
    )
  })

  it('checks DNS or the meta tag under an hourly window, and audits a proof', async () => {
    mockCheck.mockResolvedValue({
      result: { status: 'proven', claim: { ...CLAIM_VIEW, status: 'proven', provenDetail: '_aglyn-challenge.rosies-bakery.com' } },
      error: null,
    })
    const response = await postSiteImportOwnership(post({ orgId: 'org-1', action: 'check', method: 'dns', domain: 'rosies-bakery.com' }))
    expect(response.status).toBe(200)
    expect(mockConsumeRateLimit.mock.calls[0][0]).toBe('site-import-ownership-check:org-1')
    expect(mockCheck.mock.calls[0].slice(0, 3)).toEqual(['org-1', 'rosies-bakery.com', 'dns'])
    expect(typeof (mockCheck.mock.calls[0][3] as { readVerificationMeta?: unknown }).readVerificationMeta).toBe('function')
    expect(mockAddAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'site-import.ownership.proven' }),
    )
    expect((await postSiteImportOwnership(post({ orgId: 'org-1', action: 'check', method: 'whois', domain: 'x.com' }))).status).toBe(400)
    mockConsumeRateLimit.mockResolvedValue({ allowed: false })
    expect((await postSiteImportOwnership(post({ orgId: 'org-1', action: 'check', method: 'meta', domain: 'x.com' }))).status).toBe(429)
  })

  it('sends and confirms a code, handing the org through for the email’s brand', async () => {
    mockSend.mockResolvedValue({ claim: { ...CLAIM_VIEW, email: { pendingAddress: 'owner@rosies-bakery.com' } }, error: null, status: 200 })
    await postSiteImportOwnership(post({ orgId: 'org-1', action: 'send-code', domain: 'rosies-bakery.com', email: 'owner@rosies-bakery.com' }))
    expect(mockSend.mock.calls[0].slice(0, 4)).toEqual(['org-1', 'rosies-bakery.com', 'owner@rosies-bakery.com', { org: PAID_ORG }])
    mockSend.mockResolvedValue({ claim: null, error: 'Enter an email address that ends in @rosies-bakery.com.', status: 400 })
    expect((await postSiteImportOwnership(post({ orgId: 'org-1', action: 'send-code', domain: 'rosies-bakery.com', email: 'x@gmail.com' }))).status).toBe(400)
    mockConfirm.mockResolvedValue({ result: { status: 'not-yet', claim: CLAIM_VIEW, message: 'no' }, error: null })
    const confirmed = await postSiteImportOwnership(post({ orgId: 'org-1', action: 'confirm-code', domain: 'rosies-bakery.com', code: '123456' }))
    expect(confirmed.status).toBe(200)
    expect(mockConfirm.mock.calls[0].slice(0, 3)).toEqual(['org-1', 'rosies-bakery.com', '123456'])
  })

  it('400 for an action it does not know', async () => {
    expect((await postSiteImportOwnership(post({ orgId: 'org-1', action: 'delete', domain: 'x.com' }))).status).toBe(400)
  })
})

describe('the crawl door', () => {
  const crawl = (body: Record<string, unknown>) =>
    postSiteImportCrawl(
      new Request('https://app.aglyn.com/api/ai/site-import/crawl', {
        method: 'POST',
        headers: { authorization: 'Bearer tok' },
        body: JSON.stringify({ orgId: 'org-1', ...body }),
      }),
    )
  const INVENTORY = { pages: [], skipped: [{ url: 'x', reason: 'login-form' }], skippedOverflow: 0, stoppedBy: null, refused: null, bytesRead: 10 }

  it('refuses a domain with no current proof before reading anything', async () => {
    const response = await crawl({ domain: 'rosies-bakery.com' })
    expect(response.status).toBe(403)
    expect((await response.json()).reason).toBe('ownership')
    expect(mockCrawl).not.toHaveBeenCalled()
    expect(mockConsumeRateLimit).not.toHaveBeenCalled()
  })

  it('reads a proved site within the plan’s page count and the door’s, and audits what it read', async () => {
    mockProven.mockResolvedValue(true)
    mockCrawl.mockResolvedValue(INVENTORY)
    const response = await crawl({ domain: 'www.rosies-bakery.com', maxPages: 500 })
    expect(response.status).toBe(200)
    expect(mockProven.mock.calls[0].slice(0, 2)).toEqual(['org-1', 'rosies-bakery.com'])
    expect(mockConsumeRateLimit.mock.calls[0][0]).toBe('site-import-crawl:org-1')
    expect(mockCrawl.mock.calls[0][0]).toMatchObject({ domain: 'rosies-bakery.com', maxPages: SITE_IMPORT_DOOR_MAX_PAGES })
    expect(mockAddAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'site-import.crawl', after: expect.objectContaining({ loginPagesRefused: 1 }) }),
    )
    await crawl({ domain: 'rosies-bakery.com', maxPages: 3 })
    expect(mockCrawl.mock.calls[1][0]).toMatchObject({ maxPages: 3 })
  })

  it('429 past the daily window', async () => {
    mockProven.mockResolvedValue(true)
    mockConsumeRateLimit.mockResolvedValue({ allowed: false })
    expect((await crawl({ domain: 'rosies-bakery.com' })).status).toBe(429)
    expect(mockCrawl).not.toHaveBeenCalled()
  })
})

/*
 * What Create site's choice card is told (AGL-3976), in the doors' own order:
 * nothing while the flag is off, then the role, then the plan.
 */
describe('the offer Create site reads for its Bring my site card', () => {
  const offer = (role: string | null, org: Record<string, unknown> = PAID_ORG, staff = false) =>
    siteImportOfferFor({ orgId: 'org-1', staff, org, member: role ? ({ uid: 'uid-1', role } as never) : null })

  it('is nothing while the flag is off, so the card is not drawn', async () => {
    mockFlagOn.mockResolvedValue(false)
    expect(await offer('owner')).toBeNull()
    // Staff preview it, as they preview the doors.
    expect(await offer('owner', PAID_ORG, true)).toBe('ready')
  })

  it('names the role, then the plan, as the doors refuse them, and is ready for a paid owner or admin', async () => {
    expect(await offer('editor')).toBe('role')
    expect(await offer('owner', { plan: 'free' })).toBe('plan')
    expect(await offer('admin')).toBe('ready')
    expect(await offer('owner')).toBe('ready')
  })

  it('never fails the read it rides: an unreadable flag is the flag off', async () => {
    mockFlagOn.mockRejectedValue(new Error('remote config down'))
    expect(await offer('owner')).toBeNull()
  })
})
