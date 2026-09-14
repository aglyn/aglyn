/**
 * @jest-environment node
 */
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
 * The gate ladder (AGL-2903): every rung forced red once, in order, and the
 * ORDER itself asserted — a rung that refuses must leave every rung below
 * it unconsulted, because each lower rung discloses something (the plan,
 * the lockdown state, the quota) that a caller refused above it has no
 * business learning. The helpers are the real doors' helpers, mocked at
 * their module seams so the composition is what is under test.
 */

const mockVerifyIdToken = jest.fn()
const mockGetOrgForUser = jest.fn()
const mockHasAiPermission = jest.fn()
const mockFlagOn = jest.fn()
const mockLockdownRefusal = jest.fn()
const mockFeatureLockdownRefusal = jest.fn()
const mockCheckRateLimit = jest.fn()
const mockReserve = jest.fn()
const mockCheckEntitlement = jest.fn()
const mockGetUser = jest.fn()
const mockFirestore = { kind: 'firestore' }

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => {
  const admin = {
    app: () => ({
      auth: () => ({
        verifyIdToken: (token: string) => mockVerifyIdToken(token),
        getUser: (uid: string) => mockGetUser(uid),
      }),
      firestore: () => mockFirestore,
    }),
  }
  return {
    __esModule: true,
    firebaseAdmin: admin,
    // `authForPool`, which reads the account record, takes the default export.
    default: admin,
    emailUnverifiedResponse: () =>
      Response.json(
        { error: 'Verify your email to continue', reason: 'email-unverified' },
        { status: 403 },
      ),
    isImpersonationSession: (decoded: { impersonatedBy?: unknown }) =>
      typeof decoded.impersonatedBy === 'string',
  }
})
jest.mock('@aglyn/tenant-data-admin/server/id-token-refusal', () => ({
  __esModule: true,
  isRefusedIdToken: (error: unknown) =>
    (error as { refused?: boolean } | null)?.refused === true,
}))
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  getOrgForUser: (...args: unknown[]) => mockGetOrgForUser(...args),
  memberHasAiPermission: (...args: unknown[]) => mockHasAiPermission(...args),
  aiPermissionRefusal: (permission: string) =>
    Response.json(
      { error: `Your role does not include ${permission}`, reason: 'permission', permission },
      { status: 403 },
    ),
}))
jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  __esModule: true,
  isServerReleaseFlagOnForOrg: (...args: unknown[]) => mockFlagOn(...args),
}))
jest.mock('@aglyn/tenant-data-admin/server/lockdown', () => ({
  __esModule: true,
  lockdownRefusal: (...args: unknown[]) => mockLockdownRefusal(...args),
  featureLockdownRefusal: (...args: unknown[]) =>
    mockFeatureLockdownRefusal(...args),
}))
jest.mock('@aglyn/tenant-data-admin/server/api-http', () => ({
  __esModule: true,
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  rateLimitHeaders: () => ({ 'X-RateLimit-Limit': '5' }),
}))
jest.mock('../usage/assist-usage', () => ({
  __esModule: true,
  reserveAssistMessage: (...args: unknown[]) => mockReserve(...args),
  publicAssistQuota: (reservation: { used: number; limit: number }) => ({
    used: reservation.used,
    limit: reservation.limit,
  }),
}))
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  checkEntitlement: (...args: unknown[]) => mockCheckEntitlement(...args),
}))
jest.mock('@aglyn/aglyn/app-utils/assist-credits', () => ({
  __esModule: true,
  assistRefusedByHardCap: (
    org: { assistOverage?: string },
    refusedBy: string | null,
  ) => refusedBy === 'band' && org.assistOverage === 'off',
  assistHardCapRefusalText: () => 'Overage is switched off for this workspace',
  assistFreeTasteRefusalText: (refusedBy: string | null) =>
    refusedBy === 'account' || refusedBy === 'platform'
      ? `the taste's ${refusedBy} sentence`
      : null,
}))

// The plugin's own declarations (AGL-2939): the add-on the entitlement fold
// reads and the levers the lockdown catalog lists, registered as the entry
// would have registered them.
import '../declarations'
import { aiGateLadder, type AiGateConfig } from './ai-gate'
import { resetAccountAgeCache } from './ai-abuse-guards'

const CONFIG: AiGateConfig = {
  feature: 'aiAssist',
  releaseFlag: 'release_assist',
  lockdownFeature: 'ai-generate',
  rateLimit: { key: 'ai-generate', limit: 5, windowMs: 60_000 },
}

const ORG = { plan: 'pro', name: 'Pros' }

function request(
  init: { method?: string; token?: string | null; ip?: string } = {},
): Request {
  const token = init.token === undefined ? 'user-token' : init.token
  return new Request('https://app.aglyn.com/api/ai/generate', {
    method: init.method ?? 'POST',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      // No platform edge is detected in a unit test, so the trusted hop is
      // the rightmost one — which is the only one there is.
      ...(init.ip ? { 'x-forwarded-for': init.ip } : {}),
    },
  })
}

/** An Auth record created `hoursAgo` hours before `NOW`. */
const NOW = new Date('2026-09-14T12:00:00Z')
const createdHoursAgo = (hoursAgo: number) => ({
  metadata: {
    creationTime: new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1000).toUTCString(),
  },
})

async function climb(
  overrides: { request?: Request; orgId?: string } = {},
): Promise<Response | Record<string, unknown>> {
  return aiGateLadder(
    {
      request: overrides.request ?? request(),
      orgId: overrides.orgId ?? 'org-1',
      now: NOW,
    },
    CONFIG,
  ) as Promise<Response | Record<string, unknown>>
}

const ALLOWED_RATE = { allowed: true, limit: 5, remaining: 4, resetMs: 0 }
const RESERVED = {
  allowed: true,
  period: 'month',
  used: 1,
  limit: 1000,
  remaining: 999,
  dayKey: '2026-09-14',
  monthKey: '2026-09',
  refusedBy: null,
  budgetUsd: 40,
}

beforeEach(() => {
  // RESET, not clear: a `…Once` value queued by a test whose ladder never
  // reached that rung would otherwise bleed into the next test's run.
  jest.resetAllMocks()
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
  mockGetOrgForUser.mockResolvedValue({ orgId: 'org-1', org: ORG, member: {} })
  mockHasAiPermission.mockResolvedValue(true)
  mockFlagOn.mockResolvedValue(true)
  mockCheckEntitlement.mockReturnValue(true)
  mockLockdownRefusal.mockResolvedValue(null)
  mockFeatureLockdownRefusal.mockResolvedValue(null)
  mockCheckRateLimit.mockReturnValue(ALLOWED_RATE)
  mockReserve.mockResolvedValue(RESERVED)
  mockGetUser.mockResolvedValue(createdHoursAgo(24 * 30))
  resetAccountAgeCache()
  delete process.env.AI_FREE_MIN_ACCOUNT_AGE_HOURS
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

/** Nothing below the refusing rung may have been consulted. */
function expectNothingBelowRan(
  from:
    | 'auth'
    | 'org'
    | 'permission'
    | 'flag'
    | 'entitlement'
    | 'lockdown'
    | 'rate'
    | 'reservation',
): void {
  const order = [
    'auth',
    'org',
    'permission',
    'flag',
    'entitlement',
    'lockdown',
    'rate',
    'reservation',
  ]
  const below = order.slice(order.indexOf(from) + 1)
  const probes: Record<string, jest.Mock[]> = {
    auth: [mockVerifyIdToken],
    org: [mockGetOrgForUser],
    permission: [mockHasAiPermission],
    flag: [mockFlagOn],
    entitlement: [mockCheckEntitlement],
    lockdown: [mockLockdownRefusal, mockFeatureLockdownRefusal],
    rate: [mockCheckRateLimit],
    reservation: [mockReserve],
  }
  for (const rung of below) {
    for (const probe of probes[rung]) expect(probe).not.toHaveBeenCalled()
  }
}

describe('the ladder, one rung red at a time', () => {
  it('405 for anything but POST, before the token is read', async () => {
    const response = (await climb({ request: request({ method: 'GET' }) })) as Response
    expect(response.status).toBe(405)
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
  })

  it('401 with no bearer token', async () => {
    const response = (await climb({ request: request({ token: null }) })) as Response
    expect(response.status).toBe(401)
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
  })

  it('401 for a credential the verifier REFUSED — and a verifier fault propagates instead (AGL-1993)', async () => {
    mockVerifyIdToken.mockRejectedValueOnce({ refused: true, code: 'auth/id-token-expired' })
    expect(((await climb()) as Response).status).toBe(401)
    expectNothingBelowRan('auth')

    mockVerifyIdToken.mockRejectedValueOnce(new Error('cert endpoint unreachable'))
    await expect(climb()).rejects.toThrow('cert endpoint unreachable')
  })

  it('403 email-unverified, unless the session is an impersonation', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'user-1', email_verified: false })
    const response = (await climb()) as Response
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ reason: 'email-unverified' })
    expectNothingBelowRan('auth')

    mockVerifyIdToken.mockResolvedValueOnce({
      uid: 'user-1',
      email_verified: false,
      impersonatedBy: 'staff-1',
    })
    expect((await climb()) as Response).not.toBeInstanceOf(Response)
  })

  it('400 when the body named no org — after the token, before membership', async () => {
    const response = (await climb({ orgId: '  ' })) as Response
    expect(response.status).toBe(400)
    expect(mockVerifyIdToken).toHaveBeenCalled()
    expectNothingBelowRan('auth')
  })

  it('403 for a non-member, and for a member of a DIFFERENT org', async () => {
    mockGetOrgForUser.mockResolvedValueOnce(null)
    expect(((await climb()) as Response).status).toBe(403)
    expectNothingBelowRan('org')

    mockGetOrgForUser.mockResolvedValueOnce({ orgId: 'org-other', org: ORG, member: {} })
    expect(((await climb()) as Response).status).toBe(403)
    // Scoped to the named org: the resolver was asked about THAT org.
    expect(mockGetOrgForUser).toHaveBeenLastCalledWith('user-1', 'org-1')
  })

  it('403 when the role lacks the door’s permission — after membership, before the flag (AGL-2927)', async () => {
    const member = { $id: 'user-1', role: 'viewer', allHosts: true }
    mockGetOrgForUser.mockResolvedValue({ orgId: 'org-1', org: ORG, member })
    mockHasAiPermission.mockResolvedValueOnce(false)
    const response = (await aiGateLadder(
      { request: request(), orgId: 'org-1', hostId: 'host-1' },
      { ...CONFIG, permission: 'ai.generate' },
    )) as Response
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      reason: 'permission',
      permission: 'ai.generate',
    })
    // Resolved for the NAMED org, on the site the body named, for the key
    // the door sells under — and nothing about the workspace was disclosed.
    expect(mockHasAiPermission).toHaveBeenCalledWith(
      'org-1',
      'host-1',
      member,
      'ai.generate',
    )
    expectNothingBelowRan('permission')
  })

  it('a door that names no permission skips the rung; a staff claim passes it', async () => {
    expect(await climb()).not.toBeInstanceOf(Response)
    expect(mockHasAiPermission).not.toHaveBeenCalled()

    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'staff-1', email_verified: true, staff: true })
    mockHasAiPermission.mockResolvedValue(false)
    expect(
      await aiGateLadder(
        { request: request(), orgId: 'org-1' },
        { ...CONFIG, permission: 'ai.use' },
      ),
    ).not.toBeInstanceOf(Response)
    expect(mockHasAiPermission).not.toHaveBeenCalled()
  })

  it('404 when the release flag is off — a released-off feature does not exist', async () => {
    mockFlagOn.mockResolvedValueOnce(false)
    const response = (await climb()) as Response
    expect(response.status).toBe(404)
    expect(mockFlagOn).toHaveBeenCalledWith('release_assist', 'org-1')
    // The plan and the lockdown state are not disclosed below a 404.
    expectNothingBelowRan('flag')
  })

  it('…but a verified staff claim previews through the flag', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'staff-1', email_verified: true, staff: true })
    mockFlagOn.mockResolvedValue(false)
    expect(await climb()).not.toBeInstanceOf(Response)
    expect(mockFlagOn).not.toHaveBeenCalled()
  })

  it('403 without the entitlement, naming the reason', async () => {
    mockCheckEntitlement.mockReturnValueOnce(false)
    const response = (await climb()) as Response
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ reason: 'entitlement' })
    expect(mockCheckEntitlement).toHaveBeenCalledWith(ORG, 'aiAssist')
    expectNothingBelowRan('entitlement')
  })

  it('423 from the scope verdict, then from the feature switch under the configured key', async () => {
    const locked = Response.json({ error: 'locked', scope: 'org' }, { status: 423 })
    mockLockdownRefusal.mockResolvedValueOnce(locked)
    expect(await climb()).toBe(locked)
    expect(mockFeatureLockdownRefusal).not.toHaveBeenCalled()
    expectNothingBelowRan('lockdown')

    const featureLocked = Response.json(
      { error: 'locked', scope: 'feature', feature: 'ai-generate' },
      { status: 423 },
    )
    mockFeatureLockdownRefusal.mockResolvedValueOnce(featureLocked)
    expect(await climb()).toBe(featureLocked)
    // The org rides along (AGL-2927), so the workspace-scoped pause on the
    // same key — the staff org page's spend stop — is a rung here too.
    expect(mockFeatureLockdownRefusal).toHaveBeenCalledWith({
      feature: 'ai-generate',
      staff: false,
      orgId: 'org-1',
    })
  })

  it('429 from the per-uid rate limit, with the headers, and NO reservation taken', async () => {
    mockCheckRateLimit.mockReturnValueOnce({ ...ALLOWED_RATE, allowed: false, remaining: 0 })
    const response = (await climb()) as Response
    expect(response.status).toBe(429)
    expect(response.headers.get('X-RateLimit-Limit')).toBe('5')
    await expect(response.json()).resolves.toMatchObject({ reason: 'rate' })
    expect(mockCheckRateLimit).toHaveBeenCalledWith('ai-generate:user-1', {
      limit: 5,
      windowMs: 60_000,
    })
    expectNothingBelowRan('rate')
  })

  it('429 from the per-ADDRESS window after the per-uid one, keyed on the trusted hop, and NO reservation taken (AGL-2925)', async () => {
    // The uid window admits; the address window refuses. Both are the same
    // limiter under different keys, so the second call is what proves the
    // address rung exists at all.
    mockCheckRateLimit
      .mockReturnValueOnce(ALLOWED_RATE)
      .mockReturnValueOnce({ ...ALLOWED_RATE, allowed: false, remaining: 0 })
    const response = (await climb({ request: request({ ip: '203.0.113.9' }) })) as Response
    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toMatchObject({ reason: 'rate' })
    expect(mockCheckRateLimit).toHaveBeenNthCalledWith(2, 'ai-ip:203.0.113.9', {
      limit: 60,
      windowMs: 60_000,
    })
    expect(mockReserve).not.toHaveBeenCalled()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('consults NO address window when no address is readable — one bucket for everyone is a self-inflicted outage', async () => {
    expect((await climb()) as Response).not.toBeInstanceOf(Response)
    expect(mockCheckRateLimit).toHaveBeenCalledTimes(1)
    expect(mockCheckRateLimit).toHaveBeenCalledWith('ai-generate:user-1', expect.anything())
  })

  it('403 account-age for a FREE workspace whose caller is younger than a day; a day passes; paid and staff never read the record (AGL-2925)', async () => {
    const free = { orgId: 'org-1', org: { plan: 'free', ownerUid: 'user-1' }, member: {} }
    mockGetOrgForUser.mockResolvedValue(free)
    mockGetUser.mockResolvedValue(createdHoursAgo(3))
    const response = (await climb()) as Response
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      reason: 'account-age',
      error: expect.stringMatching(/24 hours/),
    })
    expect(mockGetUser).toHaveBeenCalledWith('user-1')
    // Refused BEFORE the reservation, so no counter moved for a day-zero
    // account — and after the rate limits, so a burst is bounded first.
    expect(mockReserve).not.toHaveBeenCalled()
    expect(mockCheckRateLimit).toHaveBeenCalled()

    // At the minimum, exactly: admitted.
    resetAccountAgeCache()
    mockGetUser.mockResolvedValue(createdHoursAgo(24))
    expect((await climb()) as Response).not.toBeInstanceOf(Response)

    // The knob: tightened to two days, the same day-old account is refused;
    // zero switches the rung off for an invite-only deployment.
    resetAccountAgeCache()
    process.env.AI_FREE_MIN_ACCOUNT_AGE_HOURS = '48'
    expect(((await climb()) as Response).status).toBe(403)
    resetAccountAgeCache()
    process.env.AI_FREE_MIN_ACCOUNT_AGE_HOURS = '0'
    mockGetUser.mockClear()
    expect((await climb()) as Response).not.toBeInstanceOf(Response)
    expect(mockGetUser).not.toHaveBeenCalled()
    delete process.env.AI_FREE_MIN_ACCOUNT_AGE_HOURS

    // A PAID workspace: the record is never read, however young the account.
    resetAccountAgeCache()
    mockGetUser.mockClear()
    mockGetUser.mockResolvedValue(createdHoursAgo(0))
    mockGetOrgForUser.mockResolvedValue({ orgId: 'org-1', org: ORG, member: {} })
    expect((await climb()) as Response).not.toBeInstanceOf(Response)
    expect(mockGetUser).not.toHaveBeenCalled()

    // Staff on a Free workspace: exempt — they verify the fix mid-incident.
    mockGetOrgForUser.mockResolvedValue(free)
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'user-1', email_verified: true, staff: true })
    expect((await climb()) as Response).not.toBeInstanceOf(Response)
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('the account-age read is cached per instance, and a read that fails refuses CLOSED with 503', async () => {
    const free = { orgId: 'org-1', org: { plan: 'free', ownerUid: 'user-1' }, member: {} }
    mockGetOrgForUser.mockResolvedValue(free)
    mockGetUser.mockResolvedValue(createdHoursAgo(48))
    await climb()
    await climb()
    expect(mockGetUser).toHaveBeenCalledTimes(1)

    resetAccountAgeCache()
    mockReserve.mockClear()
    mockGetUser.mockRejectedValueOnce(new Error('auth unreachable'))
    const response = (await climb()) as Response
    expect(response.status).toBe(503)
    expect(mockReserve).not.toHaveBeenCalled()
  })

  it('the taste’s own refusals keep the 429 and get their own sentence (AGL-2925)', async () => {
    mockReserve.mockResolvedValueOnce({ ...RESERVED, allowed: false, refusedBy: 'account' })
    let response = (await climb()) as Response
    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toMatchObject({
      reason: 'quota',
      error: "the taste's account sentence",
    })
    mockReserve.mockResolvedValueOnce({ ...RESERVED, allowed: false, refusedBy: 'platform' })
    response = (await climb()) as Response
    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toMatchObject({
      error: "the taste's platform sentence",
    })
  })

  it('503 when the reservation cannot be taken — FAIL CLOSED', async () => {
    mockReserve.mockRejectedValueOnce(new Error('firestore down'))
    const response = (await climb()) as Response
    expect(response.status).toBe(503)
  })

  it('429 for a spend ceiling or message cap, 402 for the org’s own overage wall (AGL-2653)', async () => {
    mockReserve.mockResolvedValueOnce({
      ...RESERVED,
      allowed: false,
      refusedBy: 'budget',
      budgetUsd: null,
    })
    let response = (await climb()) as Response
    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toMatchObject({
      reason: 'quota',
      quota: { used: 1, limit: 1000 },
      error: expect.stringMatching(/spending limit/),
    })

    mockGetOrgForUser.mockResolvedValueOnce({
      orgId: 'org-1',
      org: { ...ORG, assistOverage: 'off' },
      member: {},
    })
    mockReserve.mockResolvedValueOnce({ ...RESERVED, allowed: false, refusedBy: 'band' })
    response = (await climb()) as Response
    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Overage is switched off for this workspace',
    })
  })
})

describe('the top of the ladder', () => {
  it('hands back the context a door needs: uid, org, reservation, firestore', async () => {
    const context = await climb()
    expect(context).toMatchObject({
      uid: 'user-1',
      staff: false,
      orgId: 'org-1',
      org: ORG,
      reservation: RESERVED,
      rate: ALLOWED_RATE,
    })
    expect((context as { firestore: unknown }).firestore).toBe(mockFirestore)
    // The reservation was taken as ENTITLED against the org document, so
    // the plan's own band binds rather than only the operator backstop.
    expect(mockReserve).toHaveBeenCalledWith(
      mockFirestore,
      'org-1',
      true,
      expect.any(Date),
      ORG,
    )
  })
})
