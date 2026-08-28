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

import { hasOrgPermission as mockHasOrgPermission } from '@aglyn/aglyn'

/**
 * AGL-1968 — `/api/hosts/create` is rate limited.
 *
 * `*.aglyn.app` is ONE global namespace shared by every customer, so a
 * subdomain someone squats is gone for everybody. The AGL-2063 transaction
 * bounds how many sites an org may HOLD; nothing bounded how fast it could
 * try, and on open-signup day that is a name-grab at whatever rate Vercel
 * will serve.
 *
 * Same durable limiter as every other consequence endpoint
 * (`consumeRateLimit`, AGL-794) — never a second implementation. Keyed per
 * uid AND per IP, because either alone is trivially sidestepped: one account
 * scripted, or many accounts behind one address.
 *
 * WHAT THIS CATCHES, and what it deliberately does not. Not "does the route
 * mention a limiter" — an import satisfies that. The limiter is DRIVEN: the
 * exact keys and windows are asserted, both refusal arms are driven
 * separately, and each asserts the site was not created. A route that called
 * the limiter and ignored `.allowed` passes every "was it called" check and
 * dies here.
 */

const mockVerifyIdToken = jest.fn()
const mockLockdownRefusal = jest.fn()
const mockConsumeRateLimit = jest.fn()
const mockRegisterOrgHost = jest.fn()
const mockResolveOrgMembership = jest.fn()
const mockCheckQuota = jest.fn()
/** Every `tx.set` the create transaction performs, in order. */
const mockTxSets: string[] = []
/**
 * What the TRANSACTION's uniqueness re-read finds — empty unless a test stages
 * a competitor that committed inside the race window (AGL-2465).
 */
let mockRivalHosts: Array<{ id: string }> = []

const ORG = { $id: 'org-1', slug: 'acme', plan: 'business' }

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    firestore: {
      FieldValue: {
        serverTimestamp: () => 'ts',
        delete: () => 'delete',
      },
    },
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: (name: string) => ({
          // The subdomain-uniqueness probe, and the per-org site census. The
          // probe always reports the name FREE: it runs outside any
          // transaction, and `mockRivalHosts` below is what the transaction's
          // own re-read sees. That split is the race window (AGL-2465) —
          // pre-check clear, competitor committed before this create's commit.
          where: () => ({
            limit: () => ({ get: async () => ({ empty: true, docs: [] }) }),
            count: () => ({
              get: async () => ({ data: () => ({ count: 0 }) }),
            }),
          }),
          doc: (id: string) => ({
            path: `${name}/${id}`,
            get: async () => ({
              exists: true,
              data: () => ORG,
              get: (field: string) => (ORG as Record<string, unknown>)[field],
            }),
          }),
        }),
        runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            /**
             * Overloaded like the real `Transaction.get`: a document reference
             * or a QUERY. `claimHostForOrg` re-reads subdomain uniqueness in
             * the transaction (AGL-2465); a query has no `path`.
             */
            get: async (target: { path?: string }) => {
              if (!target?.path) return { docs: mockRivalHosts }
              const ref = target as { path: string }
              return {
                exists: true,
                data: () => ORG,
                get: (field: string) =>
                  field === 'hosts' ? {} : (ORG as Record<string, unknown>)[field],
                ref,
              }
            },
            set: (ref: { path: string }) => {
              mockTxSets.push(ref.path)
            },
          }),
      }),
    }),
  },
  consumeRateLimit: (...args: unknown[]) => mockConsumeRateLimit(...args),
  emailUnverifiedResponse: () =>
    Response.json(
      { error: 'Verify your email to continue', reason: 'email-unverified' },
      { status: 403 },
    ),
  ensureOrgForUser: async () => ({ orgId: 'org-1', member: { role: 'owner' } }),
  isImpersonationSession: (decoded: Record<string, unknown>) =>
    typeof decoded['impersonatedBy'] === 'string',
  lockdownRefusal: (...args: unknown[]) => mockLockdownRefusal(...args),
  registerOrgHost: (...args: unknown[]) => mockRegisterOrgHost(...args),
  /**
   * Models the REAL function (AGL-2350): it delegates to the same granular
   * resolver production calls, so a member's role, custom role and overrides
   * decide the answer rather than a convenient constant. `null` custom role
   * because this spec stores no `orgs/{id}/roles` docs and its members carry
   * no `roleId`.
   */
  memberHasOrgPermission: async (
    _orgId: string,
    member: Record<string, unknown> | null | undefined,
    permission: string,
  ) => mockHasOrgPermission(member as never, permission as never, null),
  resolveOrgMembership: (...args: unknown[]) => mockResolveOrgMembership(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
      host: 'app.aglyn.com',
      'x-forwarded-for': request.headers.get('x-forwarded-for') ?? undefined,
    },
  }),
  resolveIdpDisplayName: () => 'New Person',
  canManageOrg: (role: string) => role === 'owner' || role === 'admin',
  checkQuota: (...args: unknown[]) => mockCheckQuota(...args),
  createResourceUid: () => 'host-new',
  isBlockedSubdomain: () => false,
  SUBDOMAIN_PATTERN: /^[a-z0-9-]{3,30}$/,
  suggestSubdomains: () => [],
}))

import { POST } from '../app/api/hosts/create/route'

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
    new Request('https://app.aglyn.com/api/hosts/create', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'x-forwarded-for': '198.51.100.66, 203.0.113.9',
      },
      body: JSON.stringify({
        displayName: 'Squat Site',
        subdomain: 'squat-site',
        orgId: 'org-1',
      }),
    }),
  )

beforeEach(() => {
  jest.clearAllMocks()
  mockTxSets.length = 0
  mockRivalHosts = []
  mockLockdownRefusal.mockResolvedValue(null)
  mockConsumeRateLimit.mockResolvedValue(allowed(20))
  mockResolveOrgMembership.mockResolvedValue({
    orgId: 'org-1',
    member: { role: 'owner' },
  })
  mockCheckQuota.mockReturnValue({ allowed: true, limit: 25 })
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-squatter',
    email: 'squatter@example.com',
    email_verified: true,
  })
})

describe('AGL-1968 · /api/hosts/create is rate limited', () => {
  it('keys the durable limiter per uid AND per IP, hourly windows', async () => {
    const response = await post()
    expect(response.status).toBe(200)
    expect(mockConsumeRateLimit).toHaveBeenCalledWith('host-create:u-squatter', {
      limit: 20,
      windowMs: HOUR_MS,
    })
    // The trusted hop, not the first: `198.51.100.66` is the value a caller
    // typed into their own request, and an appending proxy leaves it to the
    // LEFT of the address it observed. Keying on it would hand every request a
    // fresh bucket.
    expect(mockConsumeRateLimit).toHaveBeenCalledWith(
      'host-create-ip:203.0.113.9',
      { limit: 60, windowMs: HOUR_MS },
    )
  })

  it('a scripted account past the per-uid limit gets 429, and claims NO name (the defect)', async () => {
    mockConsumeRateLimit.mockImplementation(async (key: string) =>
      key.startsWith('host-create:') ? denied(20) : allowed(60),
    )
    const response = await post()
    // Red before the fix: the route had no limiter at all, so this was 200
    // and the subdomain was gone from the global namespace for good.
    expect(response.status).toBe(429)
    const retryAfter = Number(response.headers.get('Retry-After'))
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(Math.ceil(HOUR_MS / 1000))
    const payload = await response.json()
    expect(typeof payload.error).toBe('string')
    expect(payload.error.length).toBeGreaterThan(10)
    // The name is the thing being protected: nothing may be written.
    expect(mockTxSets).toEqual([])
    expect(mockRegisterOrgHost).not.toHaveBeenCalled()
  })

  it('a bot farm rotating accounts behind one IP hits the per-IP limit', async () => {
    mockConsumeRateLimit.mockImplementation(async (key: string) =>
      key.startsWith('host-create-ip:') ? denied(60) : allowed(20),
    )
    const response = await post()
    expect(response.status).toBe(429)
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(mockTxSets).toEqual([])
    expect(mockRegisterOrgHost).not.toHaveBeenCalled()
  })

  it('under the limit the create proceeds untouched — the control', async () => {
    const response = await post()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hostId: 'host-new',
      subdomain: 'squat-site',
      orgId: 'org-1',
    })
    // Both halves of the AGL-2063 claim still happen.
    expect(mockTxSets).toEqual(['hosts/host-new', 'orgs/org-1'])
    expect(mockRegisterOrgHost).toHaveBeenCalledWith(
      'org-1',
      'host-new',
      'squat-site',
    )
  })

  it('limiter backend down → fails SOFT: a degraded allow still creates', async () => {
    // The shape consumeRateLimit returns when Firestore is unreachable and
    // the in-memory fallback is under its cap (AGL-794: soft, not open). A
    // limiter outage must not stop people making sites.
    mockConsumeRateLimit.mockResolvedValue({ ...allowed(20), degraded: true })
    const response = await post()
    expect(response.status).toBe(200)
    expect(mockRegisterOrgHost).toHaveBeenCalled()
  })

  it('lockdown 423 wins: a locked request is 423, never 429, and burns no token', async () => {
    mockLockdownRefusal.mockResolvedValue(
      Response.json({ error: 'locked', scope: 'platform' }, { status: 423 }),
    )
    mockConsumeRateLimit.mockResolvedValue(denied(20))
    const response = await post()
    expect(response.status).toBe(423)
    expect(mockConsumeRateLimit).not.toHaveBeenCalled()
    expect(mockTxSets).toEqual([])
  })

  it('the two keys are DIFFERENT — one key for both would halve the real budget', async () => {
    await post()
    const keys = mockConsumeRateLimit.mock.calls.map((call) => call[0])
    expect(new Set(keys).size).toBe(2)
    // And the uid key must carry the uid, not a constant: a route that keyed
    // every caller the same would rate-limit the whole platform as one user.
    expect(keys).toContain('host-create:u-squatter')
  })
})

/**
 * AGL-2465. The console create path has NO idempotency key — a double-submit
 * is two independent attempts, not a retry — so the only thing standing
 * between it and two sites on one subdomain is the uniqueness re-read inside
 * `claimHostForOrg`'s transaction. Before that read existed, both attempts
 * passed the out-of-transaction pre-check and both wrote a host carrying the
 * same `subdomain`, which every resolution path then answers with
 * `where('subdomain','==',…).limit(1)` — undefined which site serves the
 * address. The AGL-1848 shape, on the most expensive object to duplicate.
 */
describe('AGL-2465 · losing the subdomain race writes nothing', () => {
  it('a competitor that commits inside the window makes this a 409, not a second site', async () => {
    mockRivalHosts = [{ id: 'rival-host' }]
    const response = await post()

    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain('taken')
    // The verdict is the WRITE, not the status: no host document, and no org
    // directory claim, so no hostLimit slot is consumed either.
    expect(mockTxSets).toEqual([])
    expect(mockRegisterOrgHost).not.toHaveBeenCalled()
  })

  it('THE CONTROL: with no competitor the identical request creates the site', async () => {
    const response = await post()
    expect(response.status).toBe(200)
    expect(mockTxSets).toEqual(['hosts/host-new', 'orgs/org-1'])
    expect(mockRegisterOrgHost).toHaveBeenCalled()
  })

  it('a row for THIS host is not a conflict — only a different id is', async () => {
    // `createResourceUid` is stubbed to 'host-new', so this is the site's own
    // row. Matching on presence rather than on a different id would make every
    // create refuse itself.
    mockRivalHosts = [{ id: 'host-new' }]
    const response = await post()
    expect(response.status).toBe(200)
    expect(mockTxSets).toEqual(['hosts/host-new', 'orgs/org-1'])
  })

  it('the 409 is NOT the quota 403 — the quota said yes', async () => {
    mockRivalHosts = [{ id: 'rival-host' }]
    expect(mockCheckQuota).not.toHaveBeenCalled()
    const response = await post()
    expect(response.status).toBe(409)
    // The uniqueness read precedes the quota read inside the transaction, so
    // a collision does not even reach the quota — and cannot be reported as one.
    expect((await response.json()).error).not.toContain('Site limit')
  })
})
