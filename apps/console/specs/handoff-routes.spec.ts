/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and these routes need `Request`/`Response`.
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
 * AGL-1902 — the three HTTP legs of the cross-domain console session handoff.
 *
 * The mechanism's own properties are proved in
 * `libs/tenant/data/admin/.../auth-handoff.spec.ts` and, for concurrency,
 * against the Firestore emulator. What is left, and what is here, is the part
 * the routes own: §7.10 (a cross-site POST to `/redeem` is refused on `Origin`
 * alone), the verifier cookie's duplicate-tolerant read, the membership
 * resolution the `authorize` route wires up, and the fragment the return URL
 * is built with.
 */

const mockRedeem = jest.fn()
const mockAuthorize = jest.fn()
const mockStart = jest.fn()
const mockResolveDomain = jest.fn()
const mockClaim = jest.fn()
const mockMembership = jest.fn()
const mockVerifyIdToken = jest.fn()
const mockCreateCustomToken = jest.fn(async () => 'custom-token')

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  HANDOFF_VERIFIER_COOKIE: '__aglyn_handoff',
  HANDOFF_PENDING_TTL_MS: 900_000,
  redeemConsoleHandoff: (...a: unknown[]) => mockRedeem(...a),
  authorizeConsoleHandoff: (...a: unknown[]) => mockAuthorize(...a),
  startConsoleHandoff: (...a: unknown[]) => mockStart(...a),
  resolveConsoleDomain: (...a: unknown[]) => mockResolveDomain(...a),
  getConsoleDomainClaim: (...a: unknown[]) => mockClaim(...a),
  resolveOrgMembership: (...a: unknown[]) => mockMembership(...a),
  isImpersonationSession: () => false,
  safeContinuePath: (v: string | null) =>
    typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') ? v : '/',
  authForPool: () => ({
    createCustomToken: (...a: unknown[]) => mockCreateCustomToken(...(a as [])),
  }),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...a: unknown[]) => mockVerifyIdToken(...a),
      }),
    }),
  },
}))

import { POST as authorizePost } from '../app/api/auth/handoff/authorize/route'
import { POST as redeemPost } from '../app/api/auth/handoff/redeem/route'
import { GET as startGet } from '../app/auth/handoff/start/route'

const HOST = 'console.acme-agency.com'

function redeemRequest(over: {
  origin?: string | null
  site?: string | null
  cookie?: string
  body?: unknown
} = {}) {
  const headers: Record<string, string> = {
    host: HOST,
    'content-type': 'application/json',
    'x-forwarded-proto': 'https',
  }
  if (over.origin !== null) headers.origin = over.origin ?? `https://${HOST}`
  if (over.site) headers['sec-fetch-site'] = over.site
  if (over.cookie) headers.cookie = over.cookie
  return new Request(`https://${HOST}/api/auth/handoff/redeem`, {
    method: 'POST',
    headers,
    body: JSON.stringify(over.body ?? { handoff: 'rid-1', secret: 'S' }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRedeem.mockResolvedValue({
    ok: true,
    uid: 'u1',
    tenantId: null,
    continuePath: '/acme',
  })
  mockCreateCustomToken.mockResolvedValue('custom-token')
})

describe('§7.10 — a cross-site POST to /redeem is refused on Origin alone', () => {
  it('refuses a foreign Origin before anything is consumed', async () => {
    const response = await redeemPost(
      redeemRequest({ origin: 'https://evil.example' }),
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ reason: 'origin-mismatch' })
    // The gate must genuinely reject, not warn: nothing reached the consume,
    // so a forged cross-site POST cannot even burn a live handoff.
    expect(mockRedeem).not.toHaveBeenCalled()
  })

  it('refuses a MISSING Origin', async () => {
    // Every browser sends `Origin` on a fetch POST, so absence means the
    // caller is not one. Absence refuses rather than passing through.
    const response = await redeemPost(redeemRequest({ origin: null }))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ reason: 'no-origin' })
    expect(mockRedeem).not.toHaveBeenCalled()
  })

  it('refuses a cross-site Sec-Fetch-Site even when Origin agrees', async () => {
    const response = await redeemPost(redeemRequest({ site: 'cross-site' }))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ reason: 'cross-site' })
    expect(mockRedeem).not.toHaveBeenCalled()
  })

  it('refuses an http Origin on a non-local host', async () => {
    // `http://x` and `https://x` are different origins, and accepting the
    // first would let a network attacker on a plaintext sibling drive this.
    const response = await redeemPost(
      redeemRequest({ origin: `http://${HOST}` }),
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ reason: 'insecure-origin' })
  })

  it('ACCEPTS a same-origin POST — the positive control', async () => {
    const response = await redeemPost(
      redeemRequest({ site: 'same-origin', cookie: '__aglyn_handoff=V' }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      token: 'custom-token',
      continuePath: '/acme',
    })
  })
})

describe('the verifier cookie', () => {
  it('passes EVERY value of the name, not one', async () => {
    // A sibling host under the customer's own apex can set
    // `Domain=.acme-agency.com; __aglyn_handoff=planted`, which shadows our
    // host-only cookie with no way to tell them apart (AGL-1259). Picking one
    // would let the attacker's choice decide whether a real sign-in works.
    await redeemPost(
      redeemRequest({
        site: 'same-origin',
        cookie: '__aglyn_handoff=planted; __session=x; __aglyn_handoff=real',
      }),
    )

    expect(mockRedeem).toHaveBeenCalledWith(
      expect.objectContaining({ verifiers: ['planted', 'real'] }),
    )
  })

  it('names the request’s OWN host as the redemption host', async () => {
    await redeemPost(redeemRequest({ site: 'same-origin', cookie: '__aglyn_handoff=V' }))

    expect(mockRedeem).toHaveBeenCalledWith(
      expect.objectContaining({ requestHost: HOST }),
    )
  })

  it('is cleared on a refusal as well as on success', async () => {
    mockRedeem.mockResolvedValue({ ok: false, reason: 'expired' })

    const response = await redeemPost(
      redeemRequest({ site: 'same-origin', cookie: '__aglyn_handoff=V' }),
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toContain('__aglyn_handoff=;')
  })
})

describe('the authorize leg', () => {
  const authorizeRequest = (token = 'id-token') =>
    new Request('https://app.aglyn.com/api/auth/handoff/authorize', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ handoff: 'rid-1' }),
    })

  beforeEach(() => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u1',
      email_verified: true,
      firebase: { tenant: undefined },
    })
    mockAuthorize.mockResolvedValue({
      ok: true,
      secret: 'S3cret',
      targetHost: HOST,
      continuePath: '/acme',
    })
  })

  it('refuses an unauthenticated caller', async () => {
    const response = await authorizePost(
      new Request('https://app.aglyn.com/api/auth/handoff/authorize', {
        method: 'POST',
        body: JSON.stringify({ handoff: 'rid-1' }),
      }),
    )

    expect(response.status).toBe(401)
    expect(mockAuthorize).not.toHaveBeenCalled()
  })

  it('passes checkRevoked when verifying the caller', async () => {
    await authorizePost(authorizeRequest())

    expect(mockVerifyIdToken).toHaveBeenCalledWith('id-token', true)
  })

  it('puts the secret in the FRAGMENT, never the query string', async () => {
    // The one channel we own and cannot audit is our own edge access logs and
    // their drains. A fragment is never transmitted to any server.
    const response = await authorizePost(authorizeRequest())
    const { url } = await response.json()

    expect(url).toBe(`https://${HOST}/auth/handoff#rid-1.S3cret`)
    expect(url.split('#')[0]).not.toContain('S3cret')
    expect(url).not.toContain('?')
  })

  it('resolves membership through the CLAIM’s orgId, not the slug', async () => {
    mockClaim.mockResolvedValue({ orgId: 'org-1', status: 'active' })
    mockMembership.mockResolvedValue({ orgId: 'org-1', member: {} })
    mockAuthorize.mockImplementation(async (options: { isMember: (c: unknown) => Promise<boolean> }) => {
      const allowed = await options.isMember({ targetHost: HOST, orgSlug: 'acme' })
      return allowed
        ? { ok: true, secret: 'S', targetHost: HOST, continuePath: '/' }
        : { ok: false, reason: 'not-a-member', orgSlug: 'acme' }
    })

    const response = await authorizePost(authorizeRequest())

    expect(response.status).toBe(200)
    expect(mockClaim).toHaveBeenCalledWith(HOST)
    expect(mockMembership).toHaveBeenCalledWith('u1', 'org-1')
  })

  it('refuses when the claim resolves to no org', async () => {
    mockClaim.mockResolvedValue(null)
    mockAuthorize.mockImplementation(async (options: { isMember: (c: unknown) => Promise<boolean> }) => {
      const allowed = await options.isMember({ targetHost: HOST, orgSlug: 'acme' })
      return allowed
        ? { ok: true, secret: 'S', targetHost: HOST, continuePath: '/' }
        : { ok: false, reason: 'not-a-member', orgSlug: 'acme' }
    })

    const response = await authorizePost(authorizeRequest())

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ reason: 'not-a-member' })
    expect(mockMembership).not.toHaveBeenCalled()
  })

  it('answers 403 for a non-member and 409 for an inactive domain', async () => {
    mockAuthorize.mockResolvedValue({
      ok: false,
      reason: 'not-a-member',
      orgSlug: 'acme',
    })
    expect((await authorizePost(authorizeRequest())).status).toBe(403)

    mockAuthorize.mockResolvedValue({
      ok: false,
      reason: 'domain-inactive',
      orgSlug: 'acme',
    })
    expect((await authorizePost(authorizeRequest())).status).toBe(409)
  })
})

describe('the start leg', () => {
  const startRequest = (search = '') =>
    new Request(`https://${HOST}/auth/handoff/start${search}`, {
      headers: { host: HOST, 'x-forwarded-proto': 'https' },
    })

  it('sets a HOST-ONLY verifier cookie and bounces to the auth host', async () => {
    mockResolveDomain.mockResolvedValue({
      known: true,
      servable: true,
      orgSlug: 'acme',
      reason: 'active',
      degraded: false,
    })
    mockStart.mockResolvedValue({
      requestId: 'rid-1',
      verifier: 'V',
      expiresAtMs: 1,
    })

    const response = await startGet(startRequest('?continue=/acme/sites'))
    const cookie = response.headers.get('set-cookie') ?? ''

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toContain('https://app.aglyn.com/signin')
    expect(response.headers.get('location')).toContain(
      encodeURIComponent('/auth/handoff/continue?handoff=rid-1'),
    )
    expect(cookie).toContain('__aglyn_handoff=V')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    // NO `Domain`: a `Domain=.acme-agency.com` cookie would be readable by
    // every sibling host the customer runs — the shadowing this design
    // defends against everywhere else.
    expect(cookie).not.toContain('Domain=')
  })

  it('names the request’s OWN host as the target, never a parameter', async () => {
    mockResolveDomain.mockResolvedValue({
      known: true,
      servable: true,
      orgSlug: 'acme',
      reason: 'active',
      degraded: false,
    })
    mockStart.mockResolvedValue({ requestId: 'r', verifier: 'V', expiresAtMs: 1 })

    await startGet(startRequest('?continue=/x&targetHost=evil.example'))

    expect(mockStart).toHaveBeenCalledWith(
      expect.objectContaining({ targetHost: HOST }),
    )
  })

  it('sets NO cookie and starts nothing when the domain is not servable', async () => {
    mockResolveDomain.mockResolvedValue({
      known: true,
      servable: false,
      orgSlug: 'acme',
      reason: 'not-entitled',
      degraded: false,
    })

    const response = await startGet(startRequest())

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('acme.aglyn.com')
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('refuses to carry an off-origin continue path', async () => {
    mockResolveDomain.mockResolvedValue({
      known: true,
      servable: true,
      orgSlug: 'acme',
      reason: 'active',
      degraded: false,
    })
    mockStart.mockResolvedValue({ requestId: 'r', verifier: 'V', expiresAtMs: 1 })

    await startGet(startRequest('?continue=//evil.example/steal'))

    expect(mockStart).toHaveBeenCalledWith(
      expect.objectContaining({ continuePath: '/' }),
    )
  })
})
