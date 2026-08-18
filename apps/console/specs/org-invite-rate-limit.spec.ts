/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header
 * it is silently ignored and this runs on jsdom, where the route's
 * Response helpers are unavailable.
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
 * AGL-1907 — `/api/orgs/invites` bounds how fast mail leaves our domain.
 *
 * `create` and `resend` are the only two authenticated paths in the product
 * that send from `noreply@aglyn.com` to an address the caller types, and
 * before this they had no limiter of any kind. The manager-seat quota is not
 * one: `checkSeatQuota` runs only when `isOrgWideMember` is true, and a
 * site-scoped viewer invite (`allHosts:false`, empty `hostAccess`) makes it
 * false — so that shape was unbounded. `resend` never had a quota at all,
 * because the row already exists.
 *
 * On Sep 1 the signup door opens to anyone, which turns that into a same-day
 * spam cannon aimed at our own sending reputation.
 *
 * Same durable limiter as every other consequence endpoint (`consumeRateLimit`,
 * AGL-794) — never a second implementation — and it fails soft for the same
 * reason: a limiter outage must not stop a customer onboarding their team.
 *
 * The specs below drive BOTH directions on purpose. The red one (a script is
 * refused) is the point of the feature; the green one (a real admin
 * onboarding a team is not refused) is the one that would be a launch-morning
 * outage if it were wrong.
 */

const mockVerifyIdToken = jest.fn()
const mockLockdownRefusal = jest.fn()
const mockConsumeRateLimit = jest.fn()
const mockResolveOrgMembership = jest.fn()
const mockLogOrgActivity = jest.fn()
const mockSendEmail = jest.fn()
const mockInviteSet = jest.fn()

/** Pending-invite dedup lookup: empty unless a test says otherwise. */
const mockPendingInvites = jest.fn()
/** The invite doc `resend` reads. */
const mockInviteGet = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  consumeRateLimit: (...args: unknown[]) => mockConsumeRateLimit(...args),
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: true,
              data: () => ({ name: 'Acme', slug: 'acme', plan: 'free' }),
              get: (field: string) =>
                ({ name: 'Acme', slug: 'acme' })[field as 'name' | 'slug'],
            }),
            collection: (name: string) =>
              name === 'invites'
                ? {
                    where: () => ({
                      where: () => ({
                        limit: () => ({ get: () => mockPendingInvites() }),
                      }),
                      limit: () => ({ get: () => mockPendingInvites() }),
                      get: () => mockPendingInvites(),
                    }),
                    doc: () => ({
                      set: (...args: unknown[]) => mockInviteSet(...args),
                      get: () => mockInviteGet(),
                    }),
                  }
                : { get: async () => ({ docs: [] }) },
          }),
        }),
      }),
    }),
  },
  getOrgDoc: async () => ({ id: 'org-1', name: 'Acme' }),
  isImpersonationSession: () => false,
  lockdownRefusal: (...args: unknown[]) => mockLockdownRefusal(...args),
  logOrgActivity: (...args: unknown[]) => mockLogOrgActivity(...args),
  meterOrgEmail: jest.fn(async () => undefined),
  notifyOrgAdmins: jest.fn(async () => undefined),
  resolveOrgMembership: (...args: unknown[]) => mockResolveOrgMembership(...args),
  upsertOrgMember: jest.fn(async () => undefined),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: Object.fromEntries(request.headers.entries()),
  }),
  buildRoute: () => '/',
  Route: {},
  canManageOrg: () => true,
  checkSeatQuota: () => ({ allowed: true, limit: 99 }),
  countManagerSeats: () => 0,
  createResourceUid: () => 'invite-new',
  isOrgRole: (role: unknown) =>
    role === 'admin' || role === 'editor' || role === 'viewer',
  // The real predicate's answer for the shape these tests use: a viewer with
  // `allHosts:false` and no host access is NOT an org-wide member, so the
  // seat quota is skipped — which is exactly why a rate limit is needed.
  isOrgWideMember: ({ role, allHosts }: { role: string; allHosts: boolean }) =>
    allHosts === true || role === 'admin',
  resolveBrandingProfile: () => ({ productName: 'Aglyn', fromName: 'Aglyn' }),
  resolveIdpDisplayName: () => 'Admin Person',
  resolveIdpPhotoUrl: () => null,
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => true,
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

jest.mock('../app/api/_lib/render-system-email', () => ({
  __esModule: true,
  renderSystemEmail: async () => null,
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'ts' },
}))

import { POST } from '../app/api/orgs/invites/route'

const HOUR_MS = 60 * 60 * 1000

const allowed = (limit: number) => ({
  allowed: true,
  limit,
  remaining: limit - 1,
  resetMs: Date.now() + HOUR_MS,
  degraded: false,
})

const denied = (limit: number, resetInMs = 20 * 60 * 1000) => ({
  allowed: false,
  limit,
  remaining: 0,
  resetMs: Date.now() + resetInMs,
  degraded: false,
})

/**
 * A `consumeRateLimit` double that actually COUNTS.
 *
 * A double that always answers `allowed` makes "a ten-person burst is not
 * refused" pass no matter what the route asks for — it would stay green with
 * the caps set to 1. This models the real contract instead (fixed window,
 * `allowed: count <= limit`, per key), so the green direction is exercising
 * the arithmetic the deployed limiter will do, and a cap accidentally lowered
 * below a legitimate burst turns this suite red.
 */
function countingLimiter() {
  const counts = new Map<string, number>()
  return {
    counts,
    consume: async (key: string, options: { limit: number }) => {
      const next = (counts.get(key) ?? 0) + 1
      counts.set(key, next)
      return {
        allowed: next <= options.limit,
        limit: options.limit,
        remaining: Math.max(0, options.limit - next),
        resetMs: Date.now() + HOUR_MS,
        degraded: false,
      }
    },
  }
}

const post = (body: Record<string, unknown>) =>
  POST(
    new Request('https://app.aglyn.com/api/orgs/invites', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({ orgId: 'org-1', ...body }),
    }),
  )

/** The exact shape that skipped the seat quota entirely. */
const siteScopedInvite = (email: string) => ({
  action: 'create',
  email,
  role: 'viewer',
  allHosts: false,
  hostAccess: {},
})

beforeEach(() => {
  jest.clearAllMocks()
  mockLockdownRefusal.mockResolvedValue(null)
  mockConsumeRateLimit.mockResolvedValue(allowed(30))
  mockResolveOrgMembership.mockResolvedValue({
    member: { role: 'admin' },
    isStaff: false,
  })
  mockPendingInvites.mockResolvedValue({ empty: true, docs: [] })
  mockInviteSet.mockResolvedValue(undefined)
  mockSendEmail.mockResolvedValue({ sent: true })
  mockInviteGet.mockResolvedValue({
    exists: true,
    data: () => ({ email: 'someone@example.com', role: 'viewer', acceptedAt: null }),
  })
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-admin',
    email: 'admin@acme.test',
    email_verified: true,
  })
})

describe('AGL-1907 · invite sending is rate limited', () => {
  it('keys the durable limiter per ACTOR and per ORG, hourly windows', async () => {
    await post(siteScopedInvite('new@example.com'))
    expect(mockConsumeRateLimit).toHaveBeenCalledWith('org-invite:u-admin', {
      limit: 30,
      windowMs: HOUR_MS,
    })
    // The org key is the one that binds a script: a farm can mint accounts,
    // but every invite it sends is still charged to one workspace.
    expect(mockConsumeRateLimit).toHaveBeenCalledWith('org-invite-org:org-1', {
      limit: 60,
      windowMs: HOUR_MS,
    })
  })

  it('consumes BOTH budgets on every attempt, never short-circuits', async () => {
    // If the org token were only taken when the actor was over, two admins
    // could take the org to 2x its limit between them.
    await post(siteScopedInvite('new@example.com'))
    expect(mockConsumeRateLimit).toHaveBeenCalledTimes(2)
  })
})

describe('AGL-1907 · the red direction: a script is refused', () => {
  it('REFUSES the shape that skipped the seat quota — 429, no send, no write', async () => {
    // The defect: `{role:'viewer', allHosts:false, hostAccess:{}}` makes
    // `isOrgWideMember` false, so `checkSeatQuota` never ran and this looped
    // over an address list unbounded. Before the fix this was a 200 + a sent
    // email every time.
    mockConsumeRateLimit.mockImplementation(async (key: string) =>
      key.startsWith('org-invite:') ? denied(30) : allowed(60),
    )
    const response = await post(siteScopedInvite('victim@example.com'))
    expect(response.status).toBe(429)
    expect(mockSendEmail).not.toHaveBeenCalled()
    // Refused BEFORE the write, so there is no orphan invite row that reads
    // to the admin as a silent failure.
    expect(mockInviteSet).not.toHaveBeenCalled()
  })

  it('REFUSES on the ORG budget even when the actor is under theirs', async () => {
    mockConsumeRateLimit.mockImplementation(async (key: string) =>
      key.startsWith('org-invite-org:') ? denied(60) : allowed(30),
    )
    const response = await post(siteScopedInvite('victim@example.com'))
    expect(response.status).toBe(429)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('REFUSES `resend`, which previously had no quota of any kind', async () => {
    // The row already exists, so not even the seat check applied — one
    // pending invite could be re-mailed to the same address without limit.
    mockConsumeRateLimit.mockImplementation(async (key: string) =>
      key.startsWith('org-invite:') ? denied(30) : allowed(60),
    )
    const response = await post({ action: 'resend', inviteId: 'invite-1' })
    expect(response.status).toBe(429)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('the 429 carries Retry-After and copy a person can act on', async () => {
    mockConsumeRateLimit.mockResolvedValue(denied(30))
    const response = await post(siteScopedInvite('victim@example.com'))
    const retryAfter = Number(response.headers.get('Retry-After'))
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(Math.ceil(HOUR_MS / 1000))
    const payload = await response.json()
    expect(typeof payload.error).toBe('string')
    // It must say nothing went out — an admin who thinks the invite sent
    // will not resend it, and their teammate never arrives.
    expect(payload.error).toMatch(/nothing was sent/i)
  })

  it('makes the refusal visible without a Firestore query', async () => {
    // The org activity feed is the surface a support conversation already
    // starts from, and staff read the same feed.
    mockConsumeRateLimit.mockResolvedValue(denied(30))
    await post(siteScopedInvite('victim@example.com'))
    expect(mockLogOrgActivity).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ uid: 'u-admin' }),
      expect.stringMatching(/paused/i),
    )
  })
})

describe('AGL-1907 · the green direction: real onboarding is not refused', () => {
  it('ALLOWS an invite under the limits — sends and writes as before', async () => {
    const response = await post(siteScopedInvite('teammate@acme.test'))
    expect(response.status).toBe(200)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockInviteSet).toHaveBeenCalledTimes(1)
  })

  it('ALLOWS a ten-person onboarding burst — against a limiter that COUNTS', async () => {
    // The failure this guards against is a launch-morning support ticket: an
    // admin adding their team must never see a 429. Driven through a double
    // that models the real fixed-window arithmetic, so lowering either cap
    // under ten turns this red instead of leaving it decoratively green.
    const limiter = countingLimiter()
    mockConsumeRateLimit.mockImplementation(limiter.consume)
    for (let i = 0; i < 10; i += 1) {
      const response = await post(siteScopedInvite(`teammate${i}@acme.test`))
      expect(response.status).toBe(200)
    }
    expect(mockSendEmail).toHaveBeenCalledTimes(10)
    expect(limiter.counts.get('org-invite:u-admin')).toBe(10)
    expect(limiter.counts.get('org-invite-org:org-1')).toBe(10)
  })

  it('ALLOWS all 30, then refuses the 31st — the cap is where it says it is', async () => {
    // Both edges of the actor budget in one pass, through the counting
    // double. This is what pins 30 as a real number rather than a comment.
    const limiter = countingLimiter()
    mockConsumeRateLimit.mockImplementation(limiter.consume)
    for (let i = 0; i < 30; i += 1) {
      expect(
        (await post(siteScopedInvite(`teammate${i}@acme.test`))).status,
      ).toBe(200)
    }
    const overflow = await post(siteScopedInvite('one-too-many@acme.test'))
    expect(overflow.status).toBe(429)
    expect(mockSendEmail).toHaveBeenCalledTimes(30)
  })

  it('ALLOWS a resend under the limits', async () => {
    const response = await post({ action: 'resend', inviteId: 'invite-1' })
    expect(response.status).toBe(200)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })

  it('ALLOWS when the limiter backend is down — fails SOFT, like AGL-794', async () => {
    // A limiter outage must not stop a customer onboarding their team. The
    // degraded flag says the cap held per-instance only; AGL-1693 alarms on it.
    mockConsumeRateLimit.mockResolvedValue({ ...allowed(30), degraded: true })
    const response = await post(siteScopedInvite('teammate@acme.test'))
    expect(response.status).toBe(200)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })
})

describe('AGL-1907 · the pinned refusal order is unchanged', () => {
  it('lockdown 423 still wins — refused before a token is burnt', async () => {
    mockLockdownRefusal.mockResolvedValue(
      Response.json({ error: 'locked' }, { status: 423 }),
    )
    const response = await post(siteScopedInvite('teammate@acme.test'))
    expect(response.status).toBe(423)
    expect(mockConsumeRateLimit).not.toHaveBeenCalled()
  })

  it('a 403 for the wrong role burns no token', async () => {
    mockResolveOrgMembership.mockResolvedValue({
      member: { role: 'viewer' },
      isStaff: false,
    })
    const aglynServer = jest.requireMock('@aglyn/aglyn/server')
    const original = aglynServer.canManageOrg
    aglynServer.canManageOrg = () => false
    try {
      const response = await post(siteScopedInvite('teammate@acme.test'))
      expect(response.status).toBe(403)
      expect(mockConsumeRateLimit).not.toHaveBeenCalled()
    } finally {
      aglynServer.canManageOrg = original
    }
  })

  it('a 400 for a malformed address burns no token', async () => {
    // A bot spraying garbage must not be able to drain the budget of the
    // admin whose session it stole — and a typo must not cost a real one.
    const response = await post({
      action: 'create',
      email: 'not-an-email',
      role: 'viewer',
      allHosts: false,
      hostAccess: {},
    })
    expect(response.status).toBe(400)
    expect(mockConsumeRateLimit).not.toHaveBeenCalled()
  })
})
