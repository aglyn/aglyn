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
 * `/api/site-preview/enter` (AGL-4086): the landing half of the console's
 * "open the site" link for a site in preview, on its own domain.
 *
 * Signing is REAL end to end: the blob is minted with the real minter and the
 * planted cookie re-verified with the real verifier. Only the host lookup is a
 * double, so each case changes which site the REQUEST's host resolves to.
 */

process.env['TOKEN_SIGNING_SECRET'] = 'site-preview-enter-spec-secret'

const mockGetHost = jest.fn()
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockGetHost(...args),
  getHost: (...args: unknown[]) => mockGetHost(...args),
  CNAME_HOST_PREFIX: 'cname--',
}))

import { SITE_PREVIEW_COOKIE } from '@aglyn/aglyn/app-utils/site-preview'
import {
  mintSitePreviewToken,
  verifySitePreviewToken,
} from '@aglyn/tenant-data-admin/server/site-preview-token'
import { GET } from '../app/api/site-preview/enter/route'

const HOST_ID = 'host-1'

/** `cname--acme.example` and `acme` both resolve to HOST_ID; nothing else does. */
beforeEach(() => {
  mockGetHost.mockReset()
  mockGetHost.mockImplementation(async ({ host }: { host: string }) =>
    host === 'cname--acme.example' || host === 'acme'
      ? { host: { $id: HOST_ID }, error: null }
      : { host: null, error: null },
  )
})

function enter(options: {
  blob?: string
  returnTo?: string
  host?: string
  protocol?: 'https' | 'http'
}): Request {
  const host = options.host ?? 'acme.example'
  const url = new URL(`${options.protocol ?? 'https'}://${host}/api/site-preview/enter`)
  if (options.blob !== undefined) url.searchParams.set('blob', options.blob)
  if (options.returnTo !== undefined) url.searchParams.set('return', options.returnTo)
  return new Request(url, { headers: { host } })
}

const freshBlob = (hostId = HOST_ID) => mintSitePreviewToken('enter', hostId).token

function plantedCookie(response: Response): string | undefined {
  return response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${SITE_PREVIEW_COOKIE}=`))
}

describe('/api/site-preview/enter (AGL-4086)', () => {
  it('plants a 12-hour, host-only, HttpOnly cookie and lands on the page', async () => {
    const response = await GET(enter({ blob: freshBlob(), returnTo: '/menu?x=1' }))
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/menu?x=1')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')

    const cookie = plantedCookie(response) ?? ''
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain(`Max-Age=${12 * 60 * 60}`)
    // On this host alone: no Domain attribute to widen it.
    expect(cookie).not.toMatch(/Domain=/i)
    // The planted value is a COOKIE-kind token for this site, and not an
    // enter blob any more (the kind wall).
    const value = cookie.split(';')[0].slice(SITE_PREVIEW_COOKIE.length + 1)
    expect(verifySitePreviewToken('cookie', value, HOST_ID)?.hostId).toBe(HOST_ID)
    expect(verifySitePreviewToken('enter', value, HOST_ID)).toBeNull()
  })

  it('works on a platform subdomain too', async () => {
    const response = await GET(enter({ blob: freshBlob(), host: 'acme.aglyn.app' }))
    expect(plantedCookie(response)).toBeTruthy()
  })

  it('REFUSES an off-site return: the redirect is always a path here', async () => {
    for (const returnTo of [
      'https://evil.example/phish',
      '//evil.example/phish',
      '/\\evil.example',
      'javascript:alert(1)',
      'menu',
    ]) {
      const response = await GET(enter({ blob: freshBlob(), returnTo }))
      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).toBe('/')
    }
  })

  it('plants nothing for a stale blob, and still lands on the page', async () => {
    const stale = mintSitePreviewToken('enter', HOST_ID, Date.now() - 3 * 60 * 1000).token
    const response = await GET(enter({ blob: stale, returnTo: '/menu' }))
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/menu')
    expect(plantedCookie(response)).toBeUndefined()
  })

  it('plants nothing for a cookie-kind token passed off as a blob', async () => {
    const cookieKind = mintSitePreviewToken('cookie', HOST_ID).token
    expect(plantedCookie(await GET(enter({ blob: cookieKind })))).toBeUndefined()
  })

  it('plants nothing on the WRONG host: a blob for this site on another domain', async () => {
    const response = await GET(enter({ blob: freshBlob(), host: 'other.example' }))
    expect(plantedCookie(response)).toBeUndefined()
    // And a blob minted for another site plants nothing here.
    const foreign = await GET(enter({ blob: freshBlob('host-2') }))
    expect(plantedCookie(foreign)).toBeUndefined()
  })

  it('plants nothing for a forged blob or none at all', async () => {
    expect(plantedCookie(await GET(enter({ blob: 'aglyn-site-preview-v1.e30.forged' })))).toBeUndefined()
    expect(plantedCookie(await GET(enter({})))).toBeUndefined()
  })

  it('leaves Secure off over plain http, where a browser would refuse the cookie', async () => {
    const response = await GET(enter({ blob: freshBlob(), protocol: 'http' }))
    expect(plantedCookie(response)).not.toContain('Secure')
  })
})
