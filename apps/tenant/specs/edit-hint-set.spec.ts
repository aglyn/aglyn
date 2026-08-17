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
 * `/api/edit-hint/set` (AGL-1842): the bounce landing that plants the
 * `.aglyn.app` hint cookies. Signing is REAL end to end — the spec mints
 * with the real minter and re-verifies the planted cookie with the real
 * verifier — so these assertions pin cryptographic behaviour, not mocks.
 *
 * The redirect allowlist is fault-injected on purpose: an off-list `return`
 * must be refused OUTRIGHT (400, no Location, no cookies) — an open
 * redirect on an `aglyn.app` URL is a phishing primitive. A bad SIGNATURE,
 * by contrast, must still forward (without cookies): the blob lives for
 * seconds and an editor racing its expiry belongs back on the console, not
 * on an error page.
 */

process.env['TOKEN_SIGNING_SECRET'] = 'bounce-spec-secret'

// The route only needs the hint-token module; mapping the barrel onto the
// real file keeps the crypto REAL while sparing the suite the rest of the
// admin lib's import graph (firebase-admin and friends).
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  ...jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/edit-hint-token',
  ),
}))

import {
  EDIT_HINT_COOKIE,
  mintEditHintToken,
  verifyEditHintToken,
} from '@aglyn/tenant-data-admin'
import { GET } from '../app/api/edit-hint/set/route'

const RETURN_URL = 'https://app.aglyn.com/acme/hosts/northwind-coffee'

function bounceRequest(options?: {
  sig?: string
  returnUrl?: string
  host?: string
}): Request {
  const url = new URL('https://console.aglyn.app/api/edit-hint/set')
  if (options?.sig !== undefined) url.searchParams.set('sig', options.sig)
  if (options?.returnUrl !== undefined) {
    url.searchParams.set('return', options.returnUrl)
  }
  return new Request(url, {
    headers: { host: options?.host ?? 'console.aglyn.app' },
  })
}

const freshSig = () => mintEditHintToken('bounce', 'uid-editor').token

describe('/api/edit-hint/set (AGL-1842)', () => {
  it('plants both cookies on .aglyn.app and bounces back to the console', async () => {
    const response = await GET(
      bounceRequest({ sig: freshSig(), returnUrl: RETURN_URL }),
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe(RETURN_URL)
    expect(response.headers.get('Cache-Control')).toBe('no-store')

    const cookies = response.headers.getSetCookie()
    expect(cookies).toHaveLength(2)

    const hint = cookies.find((cookie) =>
      cookie.startsWith(`${EDIT_HINT_COOKIE}=`),
    )
    expect(hint).toContain('Domain=.aglyn.app')
    expect(hint).toContain('HttpOnly')
    expect(hint).toContain('Secure')
    expect(hint).toContain('SameSite=Lax')
    // The planted value is a COOKIE-kind hint the real verifier accepts for
    // the bounced uid — and NOT re-acceptable as a bounce (kind wall).
    const value = (hint ?? '').split(';')[0].slice(EDIT_HINT_COOKIE.length + 1)
    expect(verifyEditHintToken('cookie', value)?.uid).toBe('uid-editor')
    expect(verifyEditHintToken('bounce', value)).toBeNull()

    // The stub's arming marker: same name/value the console plants on
    // .aglyn.com, JS-visible on purpose (document.cookie is its consumer).
    const marker = cookies.find((cookie) => cookie.startsWith('aglyn_editor=1'))
    expect(marker).toContain('Domain=.aglyn.app')
    expect(marker).not.toContain('HttpOnly')
  })

  it('REFUSES an off-list return outright — no redirect, no cookies', async () => {
    const response = await GET(
      bounceRequest({ sig: freshSig(), returnUrl: 'https://evil.example/phish' }),
    )
    expect(response.status).toBe(400)
    expect(response.headers.get('Location')).toBeNull()
    expect(response.headers.getSetCookie()).toHaveLength(0)
  })

  it('refuses a return whose HOSTNAME merely contains a console origin', async () => {
    const response = await GET(
      bounceRequest({
        sig: freshSig(),
        returnUrl: 'https://app.aglyn.com.evil.example/',
      }),
    )
    expect(response.status).toBe(400)
    expect(response.headers.getSetCookie()).toHaveLength(0)
  })

  it('refuses a missing or unparsable return', async () => {
    expect((await GET(bounceRequest({ sig: freshSig() }))).status).toBe(400)
    expect(
      (
        await GET(bounceRequest({ sig: freshSig(), returnUrl: 'not a url' }))
      ).status,
    ).toBe(400)
  })

  it('forwards WITHOUT cookies on a tampered signature', async () => {
    const response = await GET(
      bounceRequest({
        sig: `${freshSig().slice(0, -4)}AAAA`,
        returnUrl: RETURN_URL,
      }),
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe(RETURN_URL)
    expect(response.headers.getSetCookie()).toHaveLength(0)
  })

  it('forwards WITHOUT cookies on an expired blob', async () => {
    const stale = mintEditHintToken(
      'bounce',
      'uid-editor',
      Date.now() - 10 * 60 * 1000,
    ).token
    const response = await GET(
      bounceRequest({ sig: stale, returnUrl: RETURN_URL }),
    )
    expect(response.status).toBe(302)
    expect(response.headers.getSetCookie()).toHaveLength(0)
  })

  it('refuses a COOKIE-kind token presented as the bounce sig — the kind wall', async () => {
    const cookieKind = mintEditHintToken('cookie', 'uid-editor').token
    const response = await GET(
      bounceRequest({ sig: cookieKind, returnUrl: RETURN_URL }),
    )
    expect(response.status).toBe(302)
    expect(response.headers.getSetCookie()).toHaveLength(0)
  })

  it('plants nothing when the bounce lands on a foreign domain', async () => {
    const response = await GET(
      bounceRequest({
        sig: freshSig(),
        returnUrl: RETURN_URL,
        host: 'customer.example.com',
      }),
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe(RETURN_URL)
    expect(response.headers.getSetCookie()).toHaveLength(0)
  })
})
