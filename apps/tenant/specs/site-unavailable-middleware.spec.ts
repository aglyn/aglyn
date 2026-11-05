/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and `NextRequest`/`NextResponse` need real web globals.
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
 * THE SITE'S 503 PAGE GOES OUT AS A 503 (AGL-4110).
 *
 * Maintenance mode and preview serve the site's 503 page, or the built-in
 * notice, at every address, and every address said `200 OK`. A crawler reads
 * that as "this notice is the page", so a live site left in maintenance could
 * be re-indexed as one notice and drop out of search. These cases drive the
 * real middleware with the verdict route and the page read stubbed, one site
 * per verdict (the middleware memoizes verdicts per host):
 *
 *  - maintenance: 503 + `Retry-After` for the public, not the team, with
 *    the page in the body;
 *  - preview: the same for the public; the team's cookie goes to the uncached
 *    preview route and gets the site with a 200;
 *  - the page read: the plain rewrite to the catch-all, as it has always been;
 *  - a read that fails: the page with a 200, never a visitor-facing error;
 *  - a site in neither mode: untouched — no status, no header, no cache rule;
 *  - robots.txt and the sitemap: answered by their own routes, as before.
 *
 * A body in the response is the fix. A status on the rewrite passed every
 * check here and against `next start`, and on Vercel it replaced the page with
 * the platform's own error, which jest cannot see. See the note in
 * `middleware.ts`.
 */

import { NextRequest } from 'next/server'
import {
  SITE_PREVIEW_COOKIE,
  SITE_PREVIEW_EDIT_HINT_COOKIE,
} from '@aglyn/aglyn/app-utils/site-preview'
import {
  SITE_NOTICE_REQUEST_HEADER,
  SITE_UNAVAILABLE_RETRY_AFTER_SECONDS,
} from '@aglyn/aglyn/app-utils/site-unavailable'
import { middleware } from '../middleware'

/** The verdict each site answers with, keyed by the site's subdomain. */
const VERDICTS: Record<string, Record<string, unknown>> = {
  'maint-site': { locked: false, preview: false, previewPaths: [], maintenance: true },
  'maint-team-site': {
    locked: false,
    preview: false,
    previewPaths: [],
    maintenance: true,
  },
  'both-site': { locked: false, preview: true, previewPaths: [], maintenance: true },
  'maint-entry-site': {
    locked: false,
    preview: false,
    previewPaths: [],
    maintenance: true,
  },
  'maint-seo-site': {
    locked: false,
    preview: false,
    previewPaths: [],
    maintenance: true,
  },
  'preview-site': { locked: false, preview: true, previewPaths: [], maintenance: false },
  'preview-team-site': {
    locked: false,
    preview: true,
    previewPaths: [],
    maintenance: false,
  },
  'preview-hint-site': {
    locked: false,
    preview: true,
    previewPaths: [],
    maintenance: false,
  },
  'preview-seo-site': {
    locked: false,
    preview: true,
    previewPaths: [],
    maintenance: false,
  },
  'read-refused-site': {
    locked: false,
    preview: true,
    previewPaths: [],
    maintenance: false,
  },
  'read-moved-site': {
    locked: false,
    preview: false,
    previewPaths: [],
    maintenance: true,
  },
  'read-down-site': {
    locked: false,
    preview: true,
    previewPaths: [],
    maintenance: false,
  },
  'read-self-site': {
    locked: false,
    preview: false,
    previewPaths: [],
    maintenance: true,
  },
  'page-site': {
    locked: false,
    preview: false,
    previewPaths: ['/launch'],
    maintenance: false,
  },
  'public-site': { locked: false, preview: false, previewPaths: [], maintenance: false },
  'public-team-site': {
    locked: false,
    preview: false,
    previewPaths: [],
    maintenance: false,
  },
  // A verdict from a deployment older than this field: a public site.
  'legacy-site': { locked: false },
}

/** Sites whose verdict route is unreachable. */
const UNREACHABLE = new Set(['outage-site'])

/** The page the middleware reads back, as the catch-all would answer it. */
const NOTICE_HTML = '<!doctype html><title>Notice</title><h1>The site’s notice</h1>'

/** How the page read goes for a site, when it does not simply answer. */
const READS: Record<string, () => Response> = {
  // What a firewall challenge answers with.
  'read-refused-site': () => new Response('checkpoint', { status: 429 }),
  'read-moved-site': () =>
    new Response(null, { status: 307, headers: { location: '/elsewhere' } }),
  'read-down-site': () => {
    throw new TypeError('fetch failed')
  },
}

/** Every page read the middleware made, in order. */
const pageReads: { url: string; headers: Headers; redirect?: RequestRedirect }[] = []

const originalFetch = global.fetch
beforeAll(() => {
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (!url.pathname.startsWith('/api/')) {
      pageReads.push({
        url: url.href,
        headers: new Headers(init?.headers),
        redirect: init?.redirect,
      })
      const read = READS[url.hostname.split('.')[0]]
      if (read) return read()
      return new Response(NOTICE_HTML, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          // `fetch` decoded the body and still reports how it arrived.
          'content-encoding': 'br',
        },
      })
    }
    const host = url.searchParams.get('host') ?? ''
    if (UNREACHABLE.has(host)) throw new TypeError('fetch failed')
    const verdict = VERDICTS[host] ?? { locked: false }
    return new Response(JSON.stringify(verdict), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof global.fetch
})
afterAll(() => {
  global.fetch = originalFetch
})

/** Drive the real middleware for a path on `{site}.localhost:4500`. */
async function run(
  site: string,
  path: string,
  cookie?: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const host = `${site}.localhost:4500`
  const req = new NextRequest(
    new Request(`http://${host}${path}`, {
      headers: { host, ...(cookie ? { cookie } : {}), ...headers },
    }),
  )
  const response = (await middleware(req, {} as never)) as Response
  expect(response).toBeTruthy()
  return response
}

function rewriteTarget(response: Response): string {
  const raw = response.headers.get('x-middleware-rewrite')
  expect(raw).toBeTruthy()
  const url = new URL(raw as string, 'http://localhost:4500')
  return `${url.pathname}${url.search}`
}

const PREVIEW_COOKIE = `${SITE_PREVIEW_COOKIE}=aglyn-site-preview-v1.payload.sig`
const HINT_COOKIE = `${SITE_PREVIEW_EDIT_HINT_COOKIE}=aglyn-edit-hint-v1.payload.sig`
const RETRY_AFTER = String(SITE_UNAVAILABLE_RETRY_AFTER_SECONDS)

/** The middleware reading the page for its 503, as it comes back through. */
function runNoticeRead(site: string, path: string, cookie?: string) {
  return run(site, path, cookie, { [SITE_NOTICE_REQUEST_HEADER]: '1' })
}

/** The site's 503 answer: the status, the header, and the page in the body. */
async function expectUnavailable(response: Response) {
  expect(response.status).toBe(503)
  expect(response.headers.get('retry-after')).toBe(RETRY_AFTER)
  // A rewrite here is the bug: on Vercel it loses the page.
  expect(response.headers.get('x-middleware-rewrite')).toBeNull()
  expect(await response.text()).toBe(NOTICE_HTML)
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
  // The body is decoded text, so the encoding it arrived in must not follow it.
  expect(response.headers.get('content-encoding')).toBeNull()
}

/** A request this fix does not touch: no status of its own, no header. */
function expectUntouched(response: Response) {
  expect(response.status).toBe(200)
  expect(response.headers.get('retry-after')).toBeNull()
}

describe('maintenance mode answers 503 at every address (AGL-4110)', () => {
  it('a visitor: 503 + Retry-After, with the page in the body', async () => {
    for (const path of ['/', '/about', '/blog/hello']) {
      const response = await run('maint-site', path)
      await expectUnavailable(response)
      // No cache rule of this fix's own, and the site's own policy on top.
      expect(response.headers.get('cache-control')).toBeNull()
      expect(response.headers.get('content-security-policy')).toBeTruthy()
    }
  })

  it('the page is read from the same cached catch-all as before', async () => {
    for (const path of ['/', '/about', '/blog/hello']) {
      const response = await runNoticeRead('maint-site', path)
      expect(rewriteTarget(response)).toMatch(
        new RegExp(`^/maint-site/(light|dark)${path === '/' ? '/?' : path}$`),
      )
      expectUntouched(response)
    }
  })

  it('not the team: their cookie goes around the cache to the site, with no 503', async () => {
    const response = await run('maint-team-site', '/about', HINT_COOKIE)
    expect(response.status).not.toBe(503)
    expect(rewriteTarget(response)).toContain('/aglyn-preview/about')
    // Their view is never written to a shared cache.
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('their search goes to the search route, which verifies them itself', async () => {
    const response = await run('maint-team-site', '/search?q=menu', HINT_COOKIE)
    expect(response.status).not.toBe(503)
    expect(rewriteTarget(response)).toMatch(/^\/maint-team-site\/(light|dark)\/search/)
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('a site in BOTH modes: the team still goes around the cache, with no 503', async () => {
    const response = await run('both-site', '/about', PREVIEW_COOKIE)
    expect(response.status).not.toBe(503)
    expect(rewriteTarget(response)).toContain('/aglyn-preview/about')
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('an entry preview link is left to its route, which redirects to a 503 address', async () => {
    const response = await run('maint-entry-site', '/blog/draft?aglyn_preview=tok')
    expect(rewriteTarget(response)).toContain('/aglyn-preview/blog/draft')
    expectUntouched(response)
  })

  it('robots.txt and the sitemap answer as they always did: open, from their routes', async () => {
    for (const [path, route] of [
      ['/robots.txt', '/api/robots'],
      ['/sitemap.xml', '/api/sitemap'],
    ]) {
      const response = await run('maint-seo-site', path)
      expect(rewriteTarget(response)).toContain(route)
      expectUntouched(response)
    }
  })
})

describe('preview answers 503 to the public, and the site to its team (AGL-4110)', () => {
  it('a visitor: 503 + Retry-After at every address', async () => {
    for (const path of ['/', '/about']) {
      const response = await run('preview-site', path)
      await expectUnavailable(response)
      expect(response.headers.get('cache-control')).toBeNull()
      const read = await runNoticeRead('preview-site', path)
      expect(rewriteTarget(read)).not.toContain('aglyn-preview')
    }
  })

  it('the site-preview cookie: the uncached team route, with a 200', async () => {
    const response = await run('preview-team-site', '/about', PREVIEW_COOKIE)
    expect(rewriteTarget(response)).toContain('/aglyn-preview/about')
    expectUntouched(response)
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('the console sign-in hint, which is how staff and members arrive: a 200', async () => {
    const response = await run('preview-hint-site', '/', HINT_COOKIE)
    expect(rewriteTarget(response)).toContain('/aglyn-preview')
    expectUntouched(response)
  })

  it('robots.txt and the sitemap are their own routes, closed by them as before', async () => {
    for (const [path, route] of [
      ['/robots.txt', '/api/robots'],
      ['/sitemap.xml', '/api/sitemap'],
    ]) {
      const response = await run('preview-seo-site', path)
      expect(rewriteTarget(response)).toContain(route)
      expectUntouched(response)
    }
  })

  it('one page in preview is a 404 the render decides, not a 503', async () => {
    expectUntouched(await run('page-site', '/launch'))
    expectUntouched(await run('page-site', '/about'))
  })
})

describe('reading the page for the 503 (AGL-4110)', () => {
  beforeEach(() => {
    pageReads.length = 0
  })

  it('asks the same address, marked, carrying what the route is chosen by', async () => {
    await run('read-self-site', '/about?a=1', 'visitor=1', {
      'sec-ch-prefers-color-scheme': 'dark',
    })
    expect(pageReads).toHaveLength(1)
    const [read] = pageReads
    expect(read.url).toBe('http://read-self-site.localhost:4500/about?a=1')
    expect(read.headers.get(SITE_NOTICE_REQUEST_HEADER)).toBe('1')
    expect(read.headers.get('cookie')).toBe('visitor=1')
    expect(read.headers.get('sec-ch-prefers-color-scheme')).toBe('dark')
    // A redirect is the render's answer, and the visitor must get it, not us.
    expect(read.redirect).toBe('manual')
  })

  it('the read itself makes no read, so it cannot loop', async () => {
    await runNoticeRead('read-self-site', '/about')
    expect(pageReads).toHaveLength(0)
  })

  it('a site that is available reads nothing', async () => {
    await run('public-site', '/about')
    expect(pageReads).toHaveLength(0)
  })

  it.each([
    ['refused, as a firewall challenge is', 'read-refused-site'],
    ['answered with a redirect', 'read-moved-site'],
    ['unreachable', 'read-down-site'],
  ])('a read that is %s serves the page as a 200, never an error', async (_, site) => {
    const response = await run(site, '/about')
    expect(pageReads).toHaveLength(1)
    expect(rewriteTarget(response)).toMatch(
      new RegExp(`^/${site}/(light|dark)/about$`),
    )
    expectUntouched(response)
  })
})

describe('a site in neither mode is untouched (AGL-4110)', () => {
  it('a visitor: no status, no Retry-After, no cache rule', async () => {
    const response = await run('public-site', '/about')
    expectUntouched(response)
    expect(response.headers.get('cache-control')).toBeNull()
  })

  it('a team member keeps the public cache too', async () => {
    const response = await run('public-team-site', '/about', HINT_COOKIE)
    expectUntouched(response)
    expect(rewriteTarget(response)).not.toContain('aglyn-preview')
  })

  it('a verdict from an older deployment, with no maintenance field, is a public site', async () => {
    expectUntouched(await run('legacy-site', '/about'))
  })

  it('an unreachable verdict serves as it always did, never a 503', async () => {
    expectUntouched(await run('outage-site', '/about'))
  })
})
