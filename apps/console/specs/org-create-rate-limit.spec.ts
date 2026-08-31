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
 * AGL-1534 — `/api/orgs/create` is rate limited.
 *
 * The AGL-1523 signup grace admits a brand-new unverified account to org
 * creation, which puts scripted org minting one account-creation away. The
 * grace already bounds the per-account blast radius to one org; this limiter
 * bounds the RATE — per uid (a stuck client, a scripted account) and per IP
 * (a bot farm rotating accounts behind one address).
 *
 * Same durable limiter as every other consequence endpoint
 * (`consumeRateLimit`, AGL-794) — never a second implementation. It fails
 * soft by design: a limiter outage must not block signups, because the
 * availability of the money path outranks the abuse margin.
 *
 * Pinned order: sanctions 451 and lockdown 423 still win over the 429, and
 * a refused request never burns a rate token.
 */

const mockVerifyIdToken = jest.fn()
const mockLockdownRefusal = jest.fn()
const mockCreateOrganization = jest.fn()
const mockGraceAllows = jest.fn()
const mockEnforceSanctions = jest.fn()
const mockConsumeRateLimit = jest.fn()
const mockRecordSignupRefusal = jest.fn()

/**
 * Stands in for `FreeWorkspaceCapError` — the class the route's catch arm
 * discriminates on (AGL-2265).
 *
 * Declared here rather than reached through `jest.requireActual`, because the
 * defining file imports `firebase-admin.ts`, which initializes the admin app
 * on load. Prefixed `Mock` so the hoisted `jest.mock` factory below may close
 * over it.
 */
class MockFreeWorkspaceCapError extends Error {
  limit: number
  held: number
  constructor(limit: number, held: number) {
    super(`Free workspace ceiling reached: ${held} of ${limit}`)
    this.name = 'FreeWorkspaceCapError'
    this.limit = limit
    this.held = held
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: () => ({
          where: () => ({
            limit: () => ({ get: async () => ({ size: 1 }) }),
          }),
        }),
      }),
    }),
  },
  consumeRateLimit: (...args: unknown[]) => mockConsumeRateLimit(...args),
  createOrganization: (...args: unknown[]) => mockCreateOrganization(...args),
  emailUnverifiedResponse: () =>
    Response.json(
      { error: 'Verify your email to continue', reason: 'email-unverified' },
      { status: 403 },
    ),
  isImpersonationSession: (decoded: Record<string, unknown>) =>
    typeof decoded['impersonatedBy'] === 'string',
  lockdownRefusal: (...args: unknown[]) => mockLockdownRefusal(...args),
  meterOrgEmail: jest.fn(async () => undefined),
  recordSignupRefusal: (...args: unknown[]) => mockRecordSignupRefusal(...args),
  OrgSlugTakenError: class OrgSlugTakenError extends Error {},
  /**
   * The AGL-2265 ceiling refusal, MODELED rather than stubbed.
   *
   * The route's catch arm BRANCHES on this return value — `const capped =
   * freeWorkspaceCapRefusalResponse(error); if (capped) return capped` — and
   * both lazy stubs read green while removing a guard. A constant `null`
   * sends a real ceiling refusal into the generic "Organization creation
   * failed" 500. A constant `Response` is worse: every unrelated fault in the
   * handler would answer 403, reporting a working ceiling over a crashing
   * route.
   *
   * So it discriminates on what the real one discriminates on — that error
   * class and nothing else — and answers with the same status and `code`.
   */
  freeWorkspaceCapRefusalResponse: (error: unknown) =>
    error instanceof MockFreeWorkspaceCapError
      ? Response.json(
          {
            error:
              `You already have ${error.held} free workspaces, which is the ` +
              `limit of ${error.limit}.`,
            code: 'free_workspace_limit',
            limit: error.limit,
            held: error.held,
          },
          { status: 403 },
        )
      : null,
  signupProvisioningGraceAllows: (...args: unknown[]) =>
    mockGraceAllows(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
      host: 'app.aglyn.com',
      'x-forwarded-for':
        request.headers.get('x-forwarded-for') ?? undefined,
    },
  }),
  generateOrgSlug: (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
  isValidOrgSlug: (slug: string) => /^[a-z0-9-]{3,30}$/.test(slug),
  resolveIdpDisplayName: () => 'New Person',
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => false,
  sendEmail: jest.fn(),
}))

jest.mock('../app/api/_lib/render-system-email', () => ({
  __esModule: true,
  renderSystemEmail: async () => null,
}))

jest.mock('../constants/sanctions-geo', () => ({
  __esModule: true,
  enforceSanctionsGeo: (...args: unknown[]) => mockEnforceSanctions(...args),
}))

import { POST } from '../app/api/orgs/create/route'

const HOUR_MS = 60 * 60 * 1000

const allowed = (limit: number) => ({
  allowed: true,
  limit,
  remaining: limit - 1,
  resetMs: Date.now() + HOUR_MS,
  degraded: false,
})

const denied = (limit: number, resetInMs = 15 * 60 * 1000) => ({
  allowed: false,
  limit,
  remaining: 0,
  resetMs: Date.now() + resetInMs,
  degraded: false,
})

const post = () =>
  POST(
    new Request('https://app.aglyn.com/api/orgs/create', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'x-forwarded-for': '198.51.100.66, 203.0.113.9',
      },
      body: JSON.stringify({ name: 'E2E Smoke Workspace' }),
    }),
  )

beforeEach(() => {
  jest.clearAllMocks()
  mockEnforceSanctions.mockReturnValue(null)
  mockLockdownRefusal.mockResolvedValue(null)
  mockCreateOrganization.mockResolvedValue('org-new')
  mockGraceAllows.mockResolvedValue(true)
  mockConsumeRateLimit.mockResolvedValue(allowed(3))
  // The scripted shape this issue is about: a token minted seconds after
  // account creation, admitted through the AGL-1523 grace.
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-fresh',
    email: 'new@example.com',
    email_verified: false,
    auth_time: Math.floor(Date.now() / 1000),
  })
})

describe('AGL-1534 · /api/orgs/create is rate limited', () => {
  it('keys the durable limiter per uid AND per IP, hourly windows', async () => {
    const response = await post()
    expect(response.status).toBe(200)
    expect(mockConsumeRateLimit).toHaveBeenCalledWith('org-create:u-fresh', {
      limit: 3,
      windowMs: HOUR_MS,
    })
    // The trusted hop, not the first: `198.51.100.66` is the value a caller
    // typed into their own request, and an appending proxy leaves it to the
    // LEFT of the address it observed. Keying on it would hand every request a
    // fresh bucket.
    expect(mockConsumeRateLimit).toHaveBeenCalledWith(
      'org-create-ip:203.0.113.9',
      { limit: 10, windowMs: HOUR_MS },
    )
  })

  it('a burst past the per-uid limit gets 429 + Retry-After, no org (the defect)', async () => {
    mockConsumeRateLimit.mockImplementation(async (key: string) =>
      key.startsWith('org-create:') ? denied(3) : allowed(10),
    )
    const response = await post()
    // Red before the fix: the route had no limiter at all, so this was 200.
    expect(response.status).toBe(429)
    const retryAfter = Number(response.headers.get('Retry-After'))
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(Math.ceil(HOUR_MS / 1000))
    // A human message: provisionSignUpOrg forwards the body's `error` copy to
    // the workspace picker through the AGL-1523 failure marker, so this
    // string is what a person actually reads.
    const payload = await response.json()
    expect(typeof payload.error).toBe('string')
    expect(payload.error.length).toBeGreaterThan(10)
    expect(mockCreateOrganization).not.toHaveBeenCalled()
  })

  it('a bot farm rotating accounts behind one IP hits the per-IP limit', async () => {
    mockConsumeRateLimit.mockImplementation(async (key: string) =>
      key.startsWith('org-create-ip:') ? denied(10) : allowed(3),
    )
    const response = await post()
    expect(response.status).toBe(429)
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(mockCreateOrganization).not.toHaveBeenCalled()
  })

  it('under the limit the create proceeds untouched', async () => {
    const response = await post()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ orgId: 'org-new' })
  })

  it('limiter backend down → fails SOFT: degraded allow still creates', async () => {
    // The shape consumeRateLimit returns when Firestore is unreachable and
    // the in-memory fallback is under its cap (AGL-794: soft, not open).
    mockConsumeRateLimit.mockResolvedValue({ ...allowed(3), degraded: true })
    const response = await post()
    expect(response.status).toBe(200)
    expect(mockCreateOrganization).toHaveBeenCalled()
  })

  it('sanctions 451 wins: refused before the limiter burns a token', async () => {
    mockEnforceSanctions.mockReturnValue(
      Response.json({ error: 'unavailable' }, { status: 451 }),
    )
    const response = await post()
    expect(response.status).toBe(451)
    expect(mockConsumeRateLimit).not.toHaveBeenCalled()
    expect(mockCreateOrganization).not.toHaveBeenCalled()
  })

  it('lockdown 423 wins: a locked request is 423, never 429, no token burnt', async () => {
    mockLockdownRefusal.mockResolvedValue(
      Response.json({ error: 'locked', scope: 'platform' }, { status: 423 }),
    )
    mockConsumeRateLimit.mockResolvedValue(denied(3))
    const response = await post()
    expect(response.status).toBe(423)
    expect(mockConsumeRateLimit).not.toHaveBeenCalled()
    expect(mockCreateOrganization).not.toHaveBeenCalled()
  })

  it('the AGL-479/AGL-1523 email gate is unchanged: 403 outside grace, no token burnt', async () => {
    mockGraceAllows.mockResolvedValue(false)
    const response = await post()
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ reason: 'email-unverified' })
    expect(mockConsumeRateLimit).not.toHaveBeenCalled()
  })
})

describe('AGL-1907 · a refused signup is recorded, not just refused', () => {
  it('REFUSES and records: a per-uid 429 books the refusal as `uid`', async () => {
    mockConsumeRateLimit.mockImplementation(async (key: string) =>
      key.startsWith('org-create:') ? denied(3) : allowed(10),
    )
    const response = await post()
    expect(response.status).toBe(429)
    // Without this the AGL-1536 alarm reads CALM through a contained wave:
    // it counts orgs that were created, and a limiter that is biting makes
    // that number go down.
    expect(mockRecordSignupRefusal).toHaveBeenCalledTimes(1)
    expect(mockRecordSignupRefusal).toHaveBeenCalledWith('uid')
  })

  it('REFUSES and records: a per-IP 429 books the refusal as `ip`', async () => {
    // The reason split is the diagnosis — one address hammering vs. many
    // accounts — so booking the wrong one is a silent misdiagnosis.
    mockConsumeRateLimit.mockImplementation(async (key: string) =>
      key.startsWith('org-create-ip:') ? denied(10) : allowed(3),
    )
    const response = await post()
    expect(response.status).toBe(429)
    expect(mockRecordSignupRefusal).toHaveBeenCalledWith('ip')
  })

  it('ALLOWS: a legitimate create records NOTHING', async () => {
    // The green direction. A recorder that fired on success would bury the
    // signal under normal signups and make the alarm meaningless.
    const response = await post()
    expect(response.status).toBe(200)
    expect(mockRecordSignupRefusal).not.toHaveBeenCalled()
  })

  it('ALLOWS: a degraded (fail-soft) limiter still creates and records nothing', async () => {
    mockConsumeRateLimit.mockResolvedValue({ ...allowed(3), degraded: true })
    const response = await post()
    expect(response.status).toBe(200)
    expect(mockRecordSignupRefusal).not.toHaveBeenCalled()
  })

  it('records nothing for the refusals that are not rate limits', async () => {
    // 451 and 423 are different events with different responses; folding them
    // into the signup-pressure count would make it unreadable.
    mockEnforceSanctions.mockReturnValue(
      Response.json({ error: 'unavailable' }, { status: 451 }),
    )
    expect((await post()).status).toBe(451)
    expect(mockRecordSignupRefusal).not.toHaveBeenCalled()

    mockEnforceSanctions.mockReturnValue(null)
    mockLockdownRefusal.mockResolvedValue(
      Response.json({ error: 'locked' }, { status: 423 }),
    )
    expect((await post()).status).toBe(423)
    expect(mockRecordSignupRefusal).not.toHaveBeenCalled()
  })

  it('the recorder is never awaited — a slow breadcrumb cannot delay the 429', async () => {
    // Fire-and-forget by contract: the refusal IS the control.
    let settled = false
    mockRecordSignupRefusal.mockImplementation(() => {
      const pending = new Promise((resolve) => setTimeout(resolve, 50))
      void pending.then(() => {
        settled = true
      })
      return pending
    })
    mockConsumeRateLimit.mockImplementation(async (key: string) =>
      key.startsWith('org-create:') ? denied(3) : allowed(10),
    )
    const response = await post()
    expect(response.status).toBe(429)
    expect(settled).toBe(false)
  })
})

/**
 * The free-WORKSPACE ceiling, refused from this route (AGL-2265).
 *
 * `createOrganization` raises the ceiling as a thrown `FreeWorkspaceCapError`
 * rather than a return value, and the route turns it back into the ceiling's
 * own 403 in its catch block — one line, sitting next to the generic 500,
 * which is exactly where a guard goes quiet without anything going red.
 *
 * It had no coverage here at all: no spec for this route referenced the error
 * or its `free_workspace_limit` code, and the arm never fired because nothing
 * in the path threw. That is the fragile kind of passing — the first change
 * that introduces a throw turns a specific 403 into a generic 500 and nothing
 * notices. The same gap on `/api/hosts/create` was repaired first; this is
 * its sibling.
 */
describe('AGL-2265 · the free workspace ceiling refuses from here', () => {
  it('answers the ceiling’s own 403, not "Organization creation failed"', async () => {
    mockCreateOrganization.mockRejectedValueOnce(
      new MockFreeWorkspaceCapError(3, 3),
    )

    const response = await post()

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      code: 'free_workspace_limit',
      limit: 3,
      held: 3,
    })
  })

  it('does NOT launder an unrelated fault into a ceiling refusal', async () => {
    // The inverse fixture. Without it the assertion above is satisfied by a
    // catch block that answers 403 to everything, which would report a
    // working ceiling over a route that had stopped working at all.
    mockCreateOrganization.mockRejectedValueOnce(new Error('firestore is down'))
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await post()

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Organization creation failed',
    })
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })
})
