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
 * `/api/edit-hint/clear` (AGL-1842 follow-on): the sign-out mirror of `set`.
 * The console's `/signout` page sends the browser through here once, and it
 * must expire BOTH `.aglyn.app` hint cookies with exactly the attributes
 * `set` planted them with (a clear that misses the Domain deletes nothing),
 * then go straight back to the console.
 *
 * The allowlist is the one `set` uses, and refuses the same way: an off-list
 * `return` is a flat 400 with no redirect and no cookie change, because an
 * open redirect on an `aglyn.app` URL is a phishing primitive.
 */

process.env['TOKEN_SIGNING_SECRET'] = 'clear-spec-secret'

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  ...jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/edit-hint-token',
  ),
}))

import { mintEditHintToken } from '@aglyn/tenant-data-admin'
import { GET as clear } from '../app/api/edit-hint/clear/route'
import { GET as set } from '../app/api/edit-hint/set/route'

const RETURN_URL = 'https://app.aglyn.com/signin'

function bounce(
  path: 'set' | 'clear',
  options?: { returnUrl?: string; host?: string; sig?: string },
): Request {
  const url = new URL(`https://console.aglyn.app/api/edit-hint/${path}`)
  if (options?.sig !== undefined) url.searchParams.set('sig', options.sig)
  if (options?.returnUrl !== undefined) {
    url.searchParams.set('return', options.returnUrl)
  }
  return new Request(url, {
    headers: { host: options?.host ?? 'console.aglyn.app' },
  })
}

/** `name; attributes` with the value and Max-Age taken out, for matching. */
function shapeOf(cookie: string): string {
  return cookie
    .split(';')
    .map((part) => part.trim())
    .filter((part) => !part.startsWith('Max-Age='))
    .map((part, index) => (index === 0 ? part.split('=')[0] : part))
    .sort()
    .join('; ')
}

describe('/api/edit-hint/clear (AGL-1842 follow-on)', () => {
  it('expires both hint cookies on .aglyn.app and goes back to the console', async () => {
    const response = await clear(bounce('clear', { returnUrl: RETURN_URL }))
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe(RETURN_URL)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const cookies = response.headers.getSetCookie()
    expect(cookies.map((cookie) => cookie.split('=')[0]).sort()).toEqual([
      'aglyn_edit_hint',
      'aglyn_editor',
    ])
    for (const cookie of cookies) {
      expect(cookie).toContain('Max-Age=0')
      expect(cookie).toContain('Domain=.aglyn.app')
      expect(cookie).toMatch(/^[a-z_]+=;/)
    }
  })

  it('matches what set planted, attribute for attribute, so the browser deletes it', async () => {
    const sig = mintEditHintToken('bounce', 'uid-editor', Date.now(), {
      did: 'device-browser-a-0001',
      iat: Date.now(),
    }).token
    const planted = (await set(bounce('set', { sig, returnUrl: RETURN_URL })))
      .headers.getSetCookie()
      .map(shapeOf)
      .sort()
    const cleared = (await clear(bounce('clear', { returnUrl: RETURN_URL })))
      .headers.getSetCookie()
      .map(shapeOf)
      .sort()
    expect(planted).toHaveLength(2)
    expect(cleared).toEqual(planted)
  })

  it('REFUSES an off-list return outright: no redirect, no cookie change', async () => {
    for (const target of [
      'https://evil.example/phish',
      'https://app.aglyn.com.evil.example/',
      'https://evil-aglyn.com/',
      'https://northwind-coffee.aglyn.app/',
      'not a url',
    ]) {
      const response = await clear(bounce('clear', { returnUrl: target }))
      expect([target, response.status]).toEqual([target, 400])
      expect(response.headers.get('Location')).toBeNull()
      expect(response.headers.getSetCookie()).toHaveLength(0)
    }
    const missing = await clear(bounce('clear'))
    expect(missing.status).toBe(400)
    expect(missing.headers.getSetCookie()).toHaveLength(0)
  })

  it('returns to a WORKSPACE subdomain of the console, as set does', async () => {
    const response = await clear(
      bounce('clear', { returnUrl: 'https://aglyn-org.aglyn.com/signin' }),
    )
    expect(response.status).toBe(302)
    expect(response.headers.getSetCookie()).toHaveLength(2)
  })

  it('writes nothing when the trip lands on a domain that is not ours', async () => {
    const response = await clear(
      bounce('clear', { returnUrl: RETURN_URL, host: 'customer.example.com' }),
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe(RETURN_URL)
    expect(response.headers.getSetCookie()).toHaveLength(0)
  })
})
