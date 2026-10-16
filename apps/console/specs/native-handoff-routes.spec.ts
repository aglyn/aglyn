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
 * AGL-3816 — the two legs of the native apps' console hand-off. The store's
 * own properties (single use, the verifier, the window, the return address)
 * are proved in `libs/tenant/data/admin/.../native-handoff.spec.ts`; what the
 * routes own is here: who may mint a code (a verified, unlocked, non-support
 * sign-in), what it may be delivered to, the URL it is delivered in, and that
 * redemption mints the custom token in the account's own pool and refuses a
 * disabled account.
 */

const mockVerifyIdToken = jest.fn()
const mockAuthorize = jest.fn()
const mockRedeem = jest.fn()
const mockLockdown = jest.fn()
const mockRateLimit = jest.fn()
const mockGetUser = jest.fn()
const mockCreateCustomToken = jest.fn()
const mockPool = jest.fn()
const mockMintAppCheck = jest.fn()
const mockAudit = jest.fn()
let mockImpersonating = false

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...a: unknown[]) => mockVerifyIdToken(...a) }),
      firestore: () => ({}),
    }),
  },
  isImpersonationSession: () => mockImpersonating,
  lockdownRefusal: (...a: unknown[]) => mockLockdown(...a),
  consumeRateLimit: (...a: unknown[]) => mockRateLimit(...a),
  authForPool: (tenantId: string | null) => {
    mockPool(tenantId)
    return {
      getUser: (...a: unknown[]) => mockGetUser(...a),
      createCustomToken: (...a: unknown[]) => mockCreateCustomToken(...a),
    }
  },
}))

jest.mock('@aglyn/tenant-data-admin/server/native-handoff', () => {
  const actual = jest.requireActual('../../../libs/tenant/data/admin/src/lib/server/native-handoff')
  return {
    __esModule: true,
    isNativeHandoffRedirect: actual.isNativeHandoffRedirect,
    isPkceChallenge: actual.isPkceChallenge,
    isPkceVerifier: actual.isPkceVerifier,
    isLoopbackRedirect: actual.isLoopbackRedirect,
    authorizeNativeHandoff: (...a: unknown[]) => mockAuthorize(...a),
    redeemNativeHandoff: (...a: unknown[]) => mockRedeem(...a),
    mintNativeAppCheckToken: (...a: unknown[]) => mockMintAppCheck(...a),
  }
})

jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({
  __esModule: true,
  addAdminAudit: (...a: unknown[]) => mockAudit(...a),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'SERVER_TIME' },
}))

jest.mock('../../../libs/tenant/data/admin/src/lib/server/firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({}) },
}))

import { POST as authorizePost } from '../app/api/auth/native-handoff/authorize/route'
import { POST as redeemPost } from '../app/api/auth/native-handoff/redeem/route'
import { POST as appCheckPost } from '../app/api/auth/native-app-check/route'

const CHALLENGE = 'c'.repeat(43)
const CODE = 'k'.repeat(43)
const VERIFIER = 'v'.repeat(43)

function authorizeRequest(body: unknown, bearer: string | null = 'id-token') {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (bearer) headers.authorization = `Bearer ${bearer}`
  return new Request('https://app.aglyn.com/api/auth/native-handoff/authorize', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

function redeemRequest(body: unknown) {
  return new Request('https://app.aglyn.com/api/auth/native-handoff/redeem', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify(body),
  })
}

const valid = { challenge: CHALLENGE, redirectUri: 'aglyn://auth/handoff', state: 'state-123' }

beforeEach(() => {
  jest.clearAllMocks()
  mockImpersonating = false
  mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email_verified: true, firebase: { tenant: 'aglyn-org-1' } })
  mockLockdown.mockResolvedValue(null)
  mockRateLimit.mockResolvedValue({ allowed: true })
  mockAuthorize.mockResolvedValue({ code: CODE, expiresAtMs: 0 })
  mockRedeem.mockResolvedValue({ ok: true, uid: 'u1', tenantId: 'aglyn-org-1' })
  mockGetUser.mockResolvedValue({ uid: 'u1', disabled: false })
  mockCreateCustomToken.mockResolvedValue('custom-token')
  mockMintAppCheck.mockResolvedValue({ token: 'app-check-token', expiresAtMs: 123 })
  mockAudit.mockResolvedValue(undefined)
})

describe('authorize', () => {
  it('mints a code for a verified sign-in and delivers it to the app’s own address with its state', async () => {
    const response = await authorizePost(authorizeRequest(valid))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      ok: true,
      url: `aglyn://auth/handoff?code=${CODE}&state=state-123`,
    })
    expect(mockAuthorize).toHaveBeenCalledWith({
      uid: 'u1',
      tenantId: 'aglyn-org-1',
      challenge: CHALLENGE,
      redirectUri: 'aglyn://auth/handoff',
    })
  })

  it('accepts the desktop loopback listener', async () => {
    const response = await authorizePost(
      authorizeRequest({ ...valid, redirectUri: 'http://127.0.0.1:53682/handoff' }),
    )
    expect(response.status).toBe(200)
  })

  it.each([
    ['another site', { ...valid, redirectUri: 'https://evil.example/handoff' }],
    ['a plain challenge', { ...valid, challenge: 'plain' }],
    ['no state', { ...valid, state: '' }],
  ])('refuses %s before verifying anything', async (_label, body) => {
    const response = await authorizePost(authorizeRequest(body))
    expect(response.status).toBe(400)
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
    expect(mockAuthorize).not.toHaveBeenCalled()
  })

  it('needs a bearer token', async () => {
    const response = await authorizePost(authorizeRequest(valid, null))
    expect(response.status).toBe(401)
  })

  it('refuses an unconfirmed address and a support session', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'u1', email_verified: false })
    const unverified = await authorizePost(authorizeRequest(valid))
    expect(unverified.status).toBe(403)
    expect((await unverified.json()).reason).toBe('email-unverified')
    mockImpersonating = true
    const support = await authorizePost(authorizeRequest(valid))
    expect(support.status).toBe(403)
    expect((await support.json()).reason).toBe('impersonation')
    expect(mockAuthorize).not.toHaveBeenCalled()
  })

  it('answers a lockdown with its notice and mints nothing', async () => {
    mockLockdown.mockResolvedValueOnce(Response.json({ error: 'locked' }, { status: 423 }))
    const response = await authorizePost(authorizeRequest(valid))
    expect(response.status).toBe(423)
    expect(mockLockdown).toHaveBeenCalledWith(expect.objectContaining({ intent: 'read', uid: 'u1', staff: false }))
    expect(mockAuthorize).not.toHaveBeenCalled()
  })
})

describe('redeem', () => {
  it('mints the custom token in the pool the account lives in', async () => {
    const response = await redeemPost(redeemRequest({ code: CODE, verifier: VERIFIER, redirectUri: 'aglyn://auth/handoff' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, token: 'custom-token', tenantId: 'aglyn-org-1' })
    expect(mockRedeem).toHaveBeenCalledWith({ code: CODE, verifier: VERIFIER, redirectUri: 'aglyn://auth/handoff' })
    expect(mockPool).toHaveBeenCalledWith('aglyn-org-1')
    expect(mockCreateCustomToken).toHaveBeenCalledWith('u1')
  })

  it('hands the desktop its first App Check token, which the custom-token exchange needs', async () => {
    const response = await redeemPost(
      redeemRequest({ code: CODE, verifier: VERIFIER, redirectUri: 'http://127.0.0.1:53682/handoff' }),
    )
    expect(await response.json()).toEqual({
      ok: true, token: 'custom-token', tenantId: 'aglyn-org-1', appCheckToken: 'app-check-token', appCheckExpiresAtMs: 123,
    })
    expect(mockAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorUid: 'u1', action: 'user.nativeAppSignIn', after: { tenantId: 'aglyn-org-1', app: 'desktop', appCheckIssued: true },
    }))
  })

  it('mints no App Check token for the phone apps, which attest themselves', async () => {
    const response = await redeemPost(redeemRequest({ code: CODE, verifier: VERIFIER, redirectUri: 'aglyn-pos://auth/handoff' }))
    const body = await response.json()
    expect(body.appCheckToken).toBeUndefined()
    expect(mockMintAppCheck).not.toHaveBeenCalled()
    expect(mockAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'user.nativeAppSignIn', after: expect.objectContaining({ app: 'aglyn-pos' }),
    }))
  })

  it('says a spent or expired code has to be started again', async () => {
    mockRedeem.mockResolvedValueOnce({ ok: false, reason: 'verifier' })
    const response = await redeemPost(redeemRequest({ code: CODE, verifier: VERIFIER, redirectUri: 'aglyn://auth/handoff' }))
    expect(response.status).toBe(410)
    expect((await response.json()).reason).toBe('verifier')
    expect(mockCreateCustomToken).not.toHaveBeenCalled()
  })

  it('refuses a disabled account', async () => {
    mockGetUser.mockResolvedValueOnce({ uid: 'u1', disabled: true })
    const response = await redeemPost(redeemRequest({ code: CODE, verifier: VERIFIER, redirectUri: 'aglyn://auth/handoff' }))
    expect(response.status).toBe(403)
    expect(mockCreateCustomToken).not.toHaveBeenCalled()
  })

  it.each([
    ['a short code', { code: 'x', verifier: VERIFIER, redirectUri: 'aglyn://auth/handoff' }],
    ['a short verifier', { code: CODE, verifier: 'x', redirectUri: 'aglyn://auth/handoff' }],
    ['another address', { code: CODE, verifier: VERIFIER, redirectUri: 'https://evil.example/handoff' }],
  ])('refuses %s before consuming anything', async (_label, body) => {
    const response = await redeemPost(redeemRequest(body))
    expect(response.status).toBe(400)
    expect(mockRedeem).not.toHaveBeenCalled()
  })

  it('is rate limited per address', async () => {
    mockRateLimit.mockResolvedValueOnce({ allowed: false })
    const response = await redeemPost(redeemRequest({ code: CODE, verifier: VERIFIER, redirectUri: 'aglyn://auth/handoff' }))
    expect(response.status).toBe(429)
    expect(mockRedeem).not.toHaveBeenCalled()
  })
})

describe('native-app-check', () => {
  function appCheckRequest(bearer: string | null = 'id-token', device: string | null = 'install-abc123') {
    const headers: Record<string, string> = {}
    if (bearer) headers.authorization = `Bearer ${bearer}`
    if (device) headers['x-aglyn-device'] = device
    return new Request('https://app.aglyn.com/api/auth/native-app-check', { method: 'POST', headers })
  }

  it('mints a token for a live session, rate limited per account and device, and audits it', async () => {
    const response = await appCheckPost(appCheckRequest())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ ok: true, token: 'app-check-token', expiresAtMs: 123 })
    expect(mockRateLimit).toHaveBeenCalledWith('native-app-check:u1:install-abc123', expect.objectContaining({ limit: 12 }))
    expect(mockAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorUid: 'u1', action: 'user.nativeAppCheck', after: { tenantId: 'aglyn-org-1', device: 'install-abc123' },
    }))
  })

  it('needs a session and a device id', async () => {
    expect((await appCheckPost(appCheckRequest(null))).status).toBe(401)
    expect((await appCheckPost(appCheckRequest('id-token', null))).status).toBe(400)
    expect(mockMintAppCheck).not.toHaveBeenCalled()
  })

  it('refuses a revoked token or a disabled account, so nothing outlives sign-out', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(Object.assign(new Error('revoked'), { code: 'auth/id-token-revoked' }))
    expect((await appCheckPost(appCheckRequest())).status).toBe(401)
    mockVerifyIdToken.mockRejectedValueOnce(Object.assign(new Error('disabled'), { code: 'auth/user-disabled' }))
    expect((await appCheckPost(appCheckRequest())).status).toBe(401)
    expect(mockMintAppCheck).not.toHaveBeenCalled()
  })

  it('refuses a support session and answers a lockdown', async () => {
    mockImpersonating = true
    expect((await appCheckPost(appCheckRequest())).status).toBe(403)
    mockImpersonating = false
    mockLockdown.mockResolvedValueOnce(Response.json({ error: 'locked' }, { status: 423 }))
    expect((await appCheckPost(appCheckRequest())).status).toBe(423)
    expect(mockMintAppCheck).not.toHaveBeenCalled()
  })

  it('is rate limited', async () => {
    mockRateLimit.mockResolvedValueOnce({ allowed: false })
    const response = await appCheckPost(appCheckRequest())
    expect(response.status).toBe(429)
    expect(mockMintAppCheck).not.toHaveBeenCalled()
  })
})
