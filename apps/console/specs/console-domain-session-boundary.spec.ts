/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, this runs on jsdom, and `Request` is not a constructor
 * there.
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
 * The session route's custom-console-domain boundary (AGL-1099c).
 *
 * `/api/*` sits outside the middleware matcher, so the host gate in
 * `middleware.ts` never sees this route. A hostname the middleware would refuse
 * to render a console for can still call it — which is exactly why
 * `rejectUnknownWorkspaceHost` exists, and exactly what it does NOT cover:
 * it returns `null` for every host that is not `*.aglyn.com`, so a custom
 * console domain sails past it. That was correct only while nothing routed on
 * one.
 *
 * These drive the real exported handler. A test that asserted the guard
 * function exists would pass whether or not anything called it, which is the
 * failure mode this whole phase is guarding against.
 */

const mockResolveConsoleDomain = jest.fn()
const mockOrgSlugGet = jest.fn(async () => ({ exists: true }))

jest.mock('@aglyn/tenant-data-admin', () => ({
  // AGL-1993. Matches the real function under this env: the SSO domain
  // policy is unconfigured in tests, so it governs nothing and returns null.
  ssoDomainRefusal: () => null,
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => {
          throw new Error('no token')
        },
        verifySessionCookie: async () => {
          throw Object.assign(new Error('bad'), { code: 'auth/argument-error' })
        },
        createCustomToken: async () => 'custom-token',
        tenantManager: () => ({ authForTenant: () => ({}) }),
      }),
    }),
    firestore: () => ({ doc: () => ({ get: () => mockOrgSlugGet() }) }),
  },
  isImpersonationSession: () => false,
  seedUserProfile: jest.fn(async () => undefined),
  emailUnverifiedResponse: () =>
    Response.json({ reason: 'email-unverified' }, { status: 403 }),
  resolveConsoleDomain: (host: string) => mockResolveConsoleDomain(host),
}))

jest.mock('next/server', () => ({
  __esModule: true,
  after: (fn: () => unknown) => void fn,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  /*
   * AGL-2190. `render-system-email` builds its default brand tokens at
   * MODULE scope, so a missing `brandMergeTokens` in this closed-world
   * mock is not a failed assertion — the whole suite fails to LOAD, three
   * requires deep from the route under test.
   *
   * Real shape and a real profile: the tokens are substituted into system
   * emails, and an empty object would leave `{{brand.productName}}` in the
   * body of every one of them with nothing here to notice.
   */
  AGLYN_BRANDING_PROFILE: {
    productName: 'Aglyn',
    fromName: 'Aglyn',
    supportUrl: 'https://aglyn.com/support',
  },
  brandMergeTokens: (branding: Record<string, string>) => ({
    'brand.productName': branding.productName,
    'brand.fromName': branding.fromName,
    'brand.supportUrl': branding.supportUrl,
  }),
  resolveIdpDisplayName: () => null,
  resolveIdpPhotoUrl: () => null,
  resolveIdpPhone: () => null,
}))

import { DELETE, GET, POST } from '../app/api/auth/session/route'

const ACTIVE = {
  known: true,
  servable: true,
  orgSlug: 'acme',
  reason: 'active',
  degraded: false,
}
const SUSPENDED = {
  known: true,
  servable: false,
  orgSlug: 'acme',
  reason: 'not-entitled',
  degraded: false,
}
const UNKNOWN = {
  known: false,
  servable: false,
  orgSlug: null,
  reason: 'unknown',
  degraded: false,
}
const DEGRADED = {
  known: false,
  servable: false,
  orgSlug: null,
  reason: 'degraded',
  degraded: true,
}

function requestOn(host: string, method: 'GET' | 'POST' | 'DELETE' = 'GET') {
  return new Request(`https://${host}/api/auth/session`, {
    method,
    headers: { host, 'x-forwarded-proto': 'https' },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockOrgSlugGet.mockResolvedValue({ exists: true })
  mockResolveConsoleDomain.mockResolvedValue(UNKNOWN)
})

describe('the custom-console-domain host gate', () => {
  it('421s a domain whose org lost the entitlement', async () => {
    mockResolveConsoleDomain.mockResolvedValue(SUSPENDED)
    const response = await GET(requestOn('console.acme-agency.com'))
    expect(response.status).toBe(421)
    expect(await response.json()).toEqual({
      error: 'console-domain-inactive',
      reason: 'not-entitled',
    })
  })

  it('421s a POST too — a mint is the thing worth refusing', async () => {
    mockResolveConsoleDomain.mockResolvedValue(SUSPENDED)
    const response = await POST(requestOn('console.acme-agency.com', 'POST'))
    expect(response.status).toBe(421)
  })

  it('lets a live custom domain through to the normal auth path', async () => {
    // 401, not 421: the host gate had no objection and the request failed for
    // the ordinary reason — no bearer token. Without this the 421 above could
    // be passing because the route refuses everything.
    mockResolveConsoleDomain.mockResolvedValue(ACTIVE)
    const response = await POST(requestOn('console.acme-agency.com', 'POST'))
    expect(response.status).toBe(401)
  })

  it('still lets a suspended domain SIGN OUT', async () => {
    // Ending a session on the host that holds it can never be the wrong
    // answer — and on a suspended domain it is the single most useful thing
    // left to do. DELETE is exempt for the same reason the workspace guard
    // exempts it.
    mockResolveConsoleDomain.mockResolvedValue(SUSPENDED)
    const response = await DELETE(requestOn('console.acme-agency.com', 'DELETE'))
    expect(response.status).toBe(200)
    expect(mockResolveConsoleDomain).not.toHaveBeenCalled()
  })

  it('does not touch an unclaimed host — localhost, previews, self-hosting', async () => {
    mockResolveConsoleDomain.mockResolvedValue(UNKNOWN)
    for (const host of ['localhost', 'aglyn-console.vercel.app']) {
      const response = await GET(requestOn(host))
      expect(response.status).not.toBe(421)
    }
  })

  it('fails OPEN on a lookup outage', async () => {
    // The Vercel domain allowlist is the boundary; this is defence in depth.
    // A Firestore blip locking every custom domain out of its own session
    // route would be a worse failure than the one it prevents.
    mockResolveConsoleDomain.mockResolvedValue(DEGRADED)
    expect((await GET(requestOn('console.acme-agency.com'))).status).not.toBe(421)

    mockResolveConsoleDomain.mockRejectedValue(new Error('firestore down'))
    expect((await GET(requestOn('console.acme-agency.com'))).status).not.toBe(421)
  })

  it('never asks about a workspace host — that is the other guard’s job', async () => {
    for (const host of ['app.aglyn.com', 'acme.aglyn.com', 'aglyn.com']) {
      await GET(requestOn(host))
    }
    expect(mockResolveConsoleDomain).not.toHaveBeenCalled()
  })
})

/**
 * `cookieAttributes` collapsed two independent questions into one ternary —
 * "should this cookie be parent-scoped?" and "is this connection HTTPS?" — and
 * they already disagreed in production (AGL-1353 D6, measured 2026-08-09):
 *
 * ```
 * DELETE https://aglyn-console-aglyn.vercel.app/api/auth/session
 *   set-cookie: __session=signed-out:…; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax
 *                                                ↑ no Domain, and no Secure
 * ```
 *
 * Harmless there only because `vercel.app` is HSTS-preloaded and on the Public
 * Suffix List. Neither of those transfers to `console.acme-agency.com`, and a
 * session cookie without `Secure` on a customer's own domain is a cookie their
 * network can read the first time anything reaches it over http.
 */
describe('session cookie attributes', () => {
  const cookiesOf = (response: Response) =>
    response.headers.getSetCookie?.() ??
    [response.headers.get('set-cookie') ?? ''].filter(Boolean)

  it('sets Secure with NO Domain on an https non-workspace host', async () => {
    const response = await DELETE(
      requestOn('console.acme-agency.com', 'DELETE'),
    )
    const session = cookiesOf(response).find((value) =>
      value.startsWith('__session='),
    )
    expect(session).toContain('Secure')
    // A `Domain` the browser will not accept is a cookie that silently does
    // not get set — `console.acme-agency.com` shares no parent with aglyn.com.
    expect(session).not.toContain('Domain=')
  })

  it('keeps Domain AND Secure on the workspace domain', async () => {
    const response = await DELETE(requestOn('acme.aglyn.com', 'DELETE'))
    const session = cookiesOf(response).find((value) =>
      value.startsWith('__session='),
    )
    expect(session).toContain('Domain=.aglyn.com')
    expect(session).toContain('Secure')
  })

  it('omits Secure on plain http, so localhost dev still works', async () => {
    const response = await DELETE(
      new Request('http://localhost:4200/api/auth/session', {
        method: 'DELETE',
        headers: { host: 'localhost:4200' },
      }),
    )
    const session = cookiesOf(response).find((value) =>
      value.startsWith('__session='),
    )
    expect(session).not.toContain('Secure')
    expect(session).not.toContain('Domain=')
  })
})
