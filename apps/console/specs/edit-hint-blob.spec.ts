/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and this suite needs `Request`/`Response`.
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
 * `/api/edit-hint/blob` (AGL-1842): mints the seconds-lived BOUNCE half of
 * the `.aglyn.app` hint for a verified console session. Minting is REAL —
 * the returned blob is re-verified with the real verifier — and the suite
 * pins that the blob is bounce-kind only: presenting it as a cookie must
 * fail, which is what keeps a logged URL from becoming a week of presence.
 *
 * A refused credential is a 401 and a verification that BROKE is a 500
 * (AGL-2785). The two halves are paired on purpose: a route that answered 401
 * for everything would pass the first half while hiding an outage.
 */

process.env['TOKEN_SIGNING_SECRET'] = 'blob-spec-secret'

let mockDecoded: Record<string, unknown> | null
/** What the wrapped `verifyIdToken` throws for any token but the good one. */
let mockVerifyError: unknown

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => null),
    headers: Object.fromEntries(request.headers.entries()),
  }),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  ...jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/edit-hint-token',
  ),
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Email not verified' }, { status: 403 }),
  isImpersonationSession: () => false,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async (token: string) => {
          if (token !== 'good-id-token' || !mockDecoded) {
            throw mockVerifyError
          }
          return mockDecoded
        },
      }),
    }),
  },
}))

import { verifyEditHintToken } from '@aglyn/tenant-data-admin'
import { POST } from '../app/api/edit-hint/blob/route'

/** Thrown the way firebase-admin throws: an `Error` carrying a string `code`. */
const authError = (code: string, message: string) =>
  Object.assign(new Error(message), { code })

function blobRequest(authorization?: string, method = 'POST'): Request {
  return new Request('https://app.aglyn.com/api/edit-hint/blob', {
    method,
    headers: authorization ? { authorization } : {},
  })
}

beforeEach(() => {
  mockDecoded = { uid: 'uid-editor', email_verified: true }
  mockVerifyError = authError(
    'auth/argument-error',
    'Firebase ID token has invalid signature.',
  )
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('/api/edit-hint/blob (AGL-1842)', () => {
  it('mints a bounce-kind blob for a verified session — and ONLY bounce-kind', async () => {
    const response = await POST(blobRequest('Bearer good-id-token'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const payload = await response.json()
    expect(verifyEditHintToken('bounce', payload.blob)?.uid).toBe('uid-editor')
    // The kind wall: this URL-borne credential must never verify as the
    // week-long cookie.
    expect(verifyEditHintToken('cookie', payload.blob)).toBeNull()
  })

  it('401s without a bearer token', async () => {
    expect((await POST(blobRequest())).status).toBe(401)
  })

  it('405s anything but POST', async () => {
    expect(
      (await POST(blobRequest('Bearer good-id-token', 'GET'))).status,
    ).toBe(405)
  })

  it('refuses an unverified email like every edit-access surface', async () => {
    mockDecoded = { uid: 'uid-editor', email_verified: false }
    const response = await POST(blobRequest('Bearer good-id-token'))
    expect(response.status).toBe(403)
  })
})

describe('/api/edit-hint/blob — a refused credential is not a server fault (AGL-2785)', () => {
  it('401s the token of an account deleted while the mint was in flight', async () => {
    // The production throw: the revocation check inside the wrapped
    // `verifyIdToken` found no user record behind a well-formed, unexpired
    // token. Built from the real class so the code cannot drift from the one
    // the wrapper raises.
    const { IdTokenRevokedError } = jest.requireActual(
      '../../../libs/tenant/data/admin/src/lib/server/token-revocation',
    )
    mockVerifyError = new IdTokenRevokedError('The user record no longer exists.')
    const response = await POST(blobRequest('Bearer deleted-account-token'))
    expect(response.status).toBe(401)
    // The body a missing header gets — nothing says WHICH check refused.
    expect(await response.json()).toEqual({ error: 'Unauthenticated' })
  })

  it.each([
    ['a forged signature', 'auth/argument-error', 'Firebase ID token has invalid signature.'],
    ['an expired token', 'auth/id-token-expired', 'Firebase ID token has expired.'],
    ['a disabled account', 'auth/user-disabled', 'The user record is disabled.'],
  ])('401s %s', async (_label, code, message) => {
    mockVerifyError = authError(code, message)
    expect((await POST(blobRequest('Bearer refused-token'))).status).toBe(401)
  })

  it('keeps the 500 when the cert fetch failed, so an outage still pages', async () => {
    // firebase-admin reports its own public-key endpoint being unreachable
    // under the same code as a forged token; only the message tells them apart.
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    mockVerifyError = authError(
      'auth/argument-error',
      'Error fetching public keys for Google certs: connect ETIMEDOUT',
    )
    expect((await POST(blobRequest('Bearer any-token'))).status).toBe(500)
  })

  it('keeps the 500 for a failure that carries no auth code at all', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    mockVerifyError = new Error('ECONNRESET')
    expect((await POST(blobRequest('Bearer any-token'))).status).toBe(500)
  })
})
