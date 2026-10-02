/**
 * @jest-environment node
 *
 * Pragma first: behind the license header it is ignored, and
 * `NextRequest`/`NextResponse` need real web globals.
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
 * A NEW FREE SITE'S LINKS TO OTHER DOMAINS GO THROUGH A "YOU'RE LEAVING"
 * NOTICE (AGL-3452).
 *
 * The 2026-10-01 phishing pages (`juenes.aglyn.app/juenes`,
 * `review.aglyn.app/reviewfile`) were one button each, straight to an outside
 * credential harvester. This suite holds the tenant's three parts of the fix:
 *
 *  1. the loader hands a page in its window the config, and turns a redirect
 *     to another domain into a redirect to the notice;
 *  2. the middleware serves `/_aglyn/leaving` from the notice route, for the
 *     site the request's own host resolved to;
 *  3. the route shows a signed destination behind a Continue link, refuses a
 *     forged one, and answers with headers that keep it out of caches,
 *     indexes and frames.
 */

const mockGetHost = jest.fn()
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  CNAME_HOST_PREFIX: 'cname--',
  getHost: (...args: unknown[]) => mockGetHost(...args),
  default: (...args: unknown[]) => mockGetHost(...args),
}))

const mockOrg = jest.fn()
jest.mock('../utils/get-org-billing', () => ({
  __esModule: true,
  getOrgBilling: (...args: unknown[]) => mockOrg(...args),
  default: (...args: unknown[]) => mockOrg(...args),
}))

const mockRefusal = jest.fn()
const mockGetSiteLockdown = jest.fn()
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  visitorContentRefusal: (...args: unknown[]) => mockRefusal(...args),
  getSiteLockdown: (...args: unknown[]) => mockGetSiteLockdown(...args),
}))

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { LEAVING_NOTICE_PATH } from '@aglyn/aglyn/app-utils/leaving-notice'
import { signLeavingDestination } from '@aglyn/tenant-data-admin/server/leaving-notice'
import { NextRequest } from 'next/server'
import { GET } from '../app/api/leaving/route'
import { config, middleware } from '../middleware'
import { applyLeavingNotice } from '../utils/leaving-notice'
import type { LoadResult } from '../app/[host]/[scheme]/[[...slug]]/types'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 1, 12)
const HOST = {
  $id: 'host-juenes',
  subdomain: 'juenes',
  cname: null,
  displayName: 'Secure Document Access Portal',
}
const HARVESTER = 'https://secure-docs.example.net/login?next=%2Fview'

const youngFree = { plan: 'free', createdAt: NOW - 6 * DAY }
const youngPaid = { plan: 'pro', billingStatus: 'active', createdAt: NOW - 6 * DAY }
const oldFree = { plan: 'free', createdAt: NOW - 30 * DAY }

const ORIGINAL_SECRET = process.env['TOKEN_SIGNING_SECRET']
beforeEach(() => {
  process.env['TOKEN_SIGNING_SECRET'] = 'test-signing-secret'
  mockGetHost.mockResolvedValue({ host: HOST, error: null })
  mockOrg.mockResolvedValue({ org: youngFree, error: null })
  mockRefusal.mockResolvedValue(null)
  mockGetSiteLockdown.mockResolvedValue(null)
})
afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env['TOKEN_SIGNING_SECRET']
  else process.env['TOKEN_SIGNING_SECRET'] = ORIGINAL_SECRET
})

const pageResult = (): LoadResult => ({
  props: {
    data: { host: HOST as never },
    nodes: {
      root: { props: {} },
      button: { props: { href: HARVESTER, children: 'Open the document' } },
    } as never,
  },
  revalidate: 60,
})

describe('1 · the loader decides, once, for every exit', () => {
  it('a young FREE site’s page carries the config, with the button’s destination signed', () => {
    const result = applyLeavingNotice(pageResult(), { host: HOST, org: youngFree }, NOW)
    const notice = 'props' in result ? result.props.leavingNotice : undefined
    expect(notice?.until).toBe(NOW - 6 * DAY + 14 * DAY)
    expect(notice?.hosts).toContain('juenes.aglyn.app')
    expect(notice?.sigs[HARVESTER]).toBe(
      signLeavingDestination(HOST.$id, HARVESTER),
    )
  })

  it('a young PAID site’s page is untouched', () => {
    const result = applyLeavingNotice(pageResult(), { host: HOST, org: youngPaid }, NOW)
    expect('props' in result && result.props.leavingNotice).toBeFalsy()
  })

  it('an OLD free site’s page is untouched', () => {
    const result = applyLeavingNotice(pageResult(), { host: HOST, org: oldFree }, NOW)
    expect('props' in result && result.props.leavingNotice).toBeFalsy()
  })

  it('a redirect rule to another domain becomes a signed, temporary redirect to the notice', () => {
    const result = applyLeavingNotice(
      { redirect: { destination: HARVESTER, statusCode: 308 }, revalidate: 30 },
      { host: HOST, org: youngFree },
      NOW,
    )
    expect('redirect' in result).toBe(true)
    if (!('redirect' in result)) return
    // 307: a browser keeps a permanent redirect after the window closes.
    expect(result.redirect.statusCode).toBe(307)
    const location = new URL(result.redirect.destination, 'https://juenes.aglyn.app')
    expect(location.pathname).toBe(LEAVING_NOTICE_PATH)
    expect(location.searchParams.get('to')).toBe(HARVESTER)
    expect(location.searchParams.get('sig')).toBe(
      signLeavingDestination(HOST.$id, HARVESTER),
    )
  })

  it('a redirect within the site, or on a paid site, is untouched', () => {
    const inside = { redirect: { destination: '/new-page', statusCode: 308 } }
    expect(applyLeavingNotice(inside, { host: HOST, org: youngFree }, NOW)).toBe(inside)
    const outside = { redirect: { destination: HARVESTER, statusCode: 308 } }
    expect(applyLeavingNotice(outside, { host: HOST, org: youngPaid }, NOW)).toBe(outside)
  })
})

describe('2 · the middleware serves the notice for the request’s own site', () => {
  const originalFetch = global.fetch
  let verdict: Record<string, unknown> = { locked: false }
  beforeAll(() => {
    // `hostVerdict` asks for the lockdown verdict before any rewrite.
    global.fetch = (async () =>
      new Response(JSON.stringify(verdict), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof global.fetch
  })
  afterAll(() => {
    global.fetch = originalFetch
    delete process.env.AGLYN_TENANT_DEMO
  })

  const rewrite = async (
    search: string,
    headers: Record<string, string> = {},
    site = 'juenes',
  ) => {
    process.env.AGLYN_TENANT_DEMO = site
    const response = (await middleware(
      new NextRequest(
        new Request(`http://localhost:4500${LEAVING_NOTICE_PATH}${search}`, {
          headers: { host: 'localhost:4500', ...headers },
        }),
      ),
      {} as never,
    )) as Response
    return {
      to: response.headers.get('x-middleware-rewrite'),
      host: response.headers.get('x-middleware-request-x-aglyn-tenant-host'),
    }
  }

  it('runs for the path at all', () => {
    expect(
      new RegExp(`^${config.matcher[0]}[/#?]?$`).test(LEAVING_NOTICE_PATH),
    ).toBe(true)
  })

  it('rewrites to the route, with the visitor’s query and the resolved host', async () => {
    verdict = { locked: false }
    const result = await rewrite('?to=https%3A%2F%2Fa.example%2F&sig=x')
    expect(result.to).toMatch(/\/api\/leaving\?to=https%3A%2F%2Fa\.example%2F&sig=x$/)
    expect(result.host).toBe('juenes')
  })

  it('overwrites a tenant-host header the client sent', async () => {
    verdict = { locked: false }
    const result = await rewrite('?to=x', { 'x-aglyn-tenant-host': 'someone-else' })
    expect(result.host).toBe('juenes')
  })

  it('serves a locked site’s lockdown notice instead', async () => {
    // Another site, because the middleware memoizes a verdict per host.
    verdict = { locked: true, mode: 'full' }
    const result = await rewrite('?to=x', {}, 'locked-site')
    expect(result.to).toMatch(/\/api\/locked\?/)
  })
})

describe('3 · the notice route', () => {
  const request = (
    query: Record<string, string>,
    headers: Record<string, string> = {},
  ) => {
    const url = new URL(`https://juenes.aglyn.app${LEAVING_NOTICE_PATH}`)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    return new Request(url, {
      headers: {
        host: 'juenes.aglyn.app',
        'x-aglyn-tenant-host': 'juenes',
        ...headers,
      },
    })
  }
  const signed = () => ({
    to: HARVESTER,
    sig: signLeavingDestination(HOST.$id, HARVESTER),
  })

  it('shows a signed destination in plain text, behind a Continue link and a Go back link', async () => {
    const response = await GET(
      request(signed(), { referer: 'https://juenes.aglyn.app/juenes?ref=mail' }),
    )
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toContain('You’re leaving juenes.aglyn.app')
    expect(body).toContain('<p class="host">secure-docs.example.net</p>')
    // The full address, escaped, as text — and as the Continue link's target.
    expect(body).toContain(`<code>${HARVESTER}</code>`)
    expect(body).toMatch(
      /<a class="button primary" href="https:\/\/secure-docs\.example\.net\/login\?next=%2Fview" rel="noopener">Continue to secure-docs\.example\.net<\/a>/,
    )
    expect(body).toContain('<a class="button" href="/juenes?ref=mail">Go back</a>')
    expect(body).toContain(`${PLATFORM_BRAND_NAME} doesn’t operate or control that website`)
    expect(body).toContain(
      `Neither ${PLATFORM_BRAND_NAME} nor juenes.aglyn.app will ever ask for your`,
    )
    // The existing abuse intake, pointed at the page that linked out.
    expect(body).toContain(
      `href="/api/report-abuse?url=${encodeURIComponent('https://juenes.aglyn.app/juenes?ref=mail')}"`,
    )
    expect(body).toContain('Report abuse')
    // No script anywhere: Continue works with JavaScript off.
    expect(body).not.toMatch(/<script|onclick=/i)
  })

  it('answers with headers that keep it out of caches, indexes and frames', async () => {
    const response = await GET(request(signed()))
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'none'",
    )
    expect(response.headers.get('referrer-policy')).toBe(
      'strict-origin-when-cross-origin',
    )
    expect(response.headers.get('location')).toBeNull()
    expect(await response.text()).toContain('<meta name="robots" content="noindex, nofollow">')
  })

  it('REFUSES a forged destination: no Continue, and no address printed', async () => {
    const forged = 'https://another-harvester.example/steal'
    const response = await GET(
      request({ to: forged, sig: signLeavingDestination(HOST.$id, HARVESTER) }),
    )
    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    const body = await response.text()
    expect(body).toContain('This link can’t be opened')
    expect(body).not.toContain('another-harvester')
    expect(body).not.toContain('Continue')
    expect(body).toContain('Report abuse')
  })

  it('refuses an unsigned destination, and another site’s signature', async () => {
    expect((await GET(request({ to: HARVESTER }))).status).toBe(400)
    const theirs = signLeavingDestination('host-review', HARVESTER)
    expect((await GET(request({ to: HARVESTER, sig: theirs }))).status).toBe(400)
  })

  it('refuses a mailto: or a site path as a destination', async () => {
    expect((await GET(request({ to: 'mailto:a@example.org', sig: 'x' }))).status).toBe(400)
    expect((await GET(request({ to: '/about', sig: 'x' }))).status).toBe(400)
  })

  it('answers nothing for a request that did not come through a site', async () => {
    const bare = new Request(
      `https://juenes.aglyn.app/api/leaving?to=${encodeURIComponent(HARVESTER)}`,
    )
    const response = await GET(bare)
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain('secure-docs')
  })

  it('stands down for a locked site', async () => {
    mockRefusal.mockResolvedValue(
      Response.json({ error: 'This site is unavailable' }, { status: 503 }),
    )
    const response = await GET(request(signed()))
    expect(response.status).toBe(503)
  })

  it('sends Go back home when the referrer is another site, or the notice itself', async () => {
    const elsewhere = await GET(
      request(signed(), { referer: 'https://evil.example/page' }),
    )
    expect(await elsewhere.text()).toContain('<a class="button" href="/">Go back</a>')
    const itself = await GET(
      request(signed(), {
        referer: `https://juenes.aglyn.app${LEAVING_NOTICE_PATH}?to=x`,
      }),
    )
    expect(await itself.text()).toContain('<a class="button" href="/">Go back</a>')
  })
})
