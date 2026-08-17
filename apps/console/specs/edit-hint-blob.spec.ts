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
 */

process.env['TOKEN_SIGNING_SECRET'] = 'blob-spec-secret'

let mockDecoded: Record<string, unknown> | null

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
            throw new Error('bad token')
          }
          return mockDecoded
        },
      }),
    }),
  },
}))

import { verifyEditHintToken } from '@aglyn/tenant-data-admin'
import { POST } from '../app/api/edit-hint/blob/route'

function blobRequest(authorization?: string, method = 'POST'): Request {
  return new Request('https://app.aglyn.com/api/edit-hint/blob', {
    method,
    headers: authorization ? { authorization } : {},
  })
}

describe('/api/edit-hint/blob (AGL-1842)', () => {
  beforeEach(() => {
    mockDecoded = { uid: 'uid-editor', email_verified: true }
  })

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

  it('refuses an invalid bearer token', async () => {
    expect((await POST(blobRequest('Bearer forged'))).status).toBe(500)
  })

  it('refuses an unverified email like every edit-access surface', async () => {
    mockDecoded = { uid: 'uid-editor', email_verified: false }
    const response = await POST(blobRequest('Bearer good-id-token'))
    expect(response.status).toBe(403)
  })
})
