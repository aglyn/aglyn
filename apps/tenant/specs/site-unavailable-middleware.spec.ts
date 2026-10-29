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
 * real middleware with the verdict route stubbed, one site per verdict (the
 * middleware memoizes verdicts per host), and read the status and headers it
 * rewrites with — which is the whole of the fix, since the body is the cached
 * catch-all's, unchanged:
 *
 *  - maintenance: 503 + `Retry-After` for everyone, the team included;
 *  - preview: 503 + `Retry-After` for the public; the team's cookie goes to
 *    the uncached preview route and gets the site with a 200;
 *  - a site in neither mode: untouched — no status, no header, no cache rule;
 *  - robots.txt and the sitemap: answered by their own routes, as before.
 *
 * The status the RENDER keeps — a cached 200 page answering 503 once this
 * asks for it, and 200 again once it stops — is measured against
 * `next start`, not here: jest has no Next server. See the note on the
 * rewrite in `middleware.ts`.
 */

import { NextRequest } from 'next/server'
import {
  SITE_PREVIEW_COOKIE,
  SITE_PREVIEW_EDIT_HINT_COOKIE,
} from '@aglyn/aglyn/app-utils/site-preview'
import { SITE_UNAVAILABLE_RETRY_AFTER_SECONDS } from '@aglyn/aglyn/app-utils/site-unavailable'
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

const originalFetch = global.fetch
beforeAll(() => {
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
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
async function run(site: string, path: string, cookie?: string): Promise<Response> {
  const host = `${site}.localhost:4500`
  const req = new NextRequest(
    new Request(`http://${host}${path}`, {
      headers: { host, ...(cookie ? { cookie } : {}) },
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

/** The site's 503 answer: the status, the header, and the same body as ever. */
function expectUnavailable(response: Response) {
  expect(response.status).toBe(503)
  expect(response.headers.get('retry-after')).toBe(RETRY_AFTER)
}

/** A request this fix does not touch: no status of its own, no header. */
function expectUntouched(response: Response) {
  expect(response.status).toBe(200)
  expect(response.headers.get('retry-after')).toBeNull()
}

describe('maintenance mode answers 503 at every address (AGL-4110)', () => {
  it('a visitor: 503 + Retry-After, from the same cached catch-all as before', async () => {
    for (const path of ['/', '/about', '/blog/hello']) {
      const response = await run('maint-site', path)
      expectUnavailable(response)
      // The body is unchanged: the ISR catch-all, whose loader renders the 503
      // page, with no cache rule of this fix's own on top of it.
      expect(rewriteTarget(response)).toMatch(
        new RegExp(`^/maint-site/(light|dark)${path === '/' ? '/?' : path}$`),
      )
      expect(response.headers.get('cache-control')).toBeNull()
      expect(response.headers.get('content-security-policy')).toBeTruthy()
    }
  })

  it('the team as well: maintenance is the switch that means nobody', async () => {
    expectUnavailable(await run('maint-team-site', '/about', HINT_COOKIE))
  })

  it('a site in BOTH modes: the team goes around the cache and still gets 503', async () => {
    const response = await run('both-site', '/about', PREVIEW_COOKIE)
    expect(rewriteTarget(response)).toContain('/aglyn-preview/about')
    expectUnavailable(response)
    // Their view is still never written to a shared cache.
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
      expectUnavailable(response)
      expect(rewriteTarget(response)).not.toContain('aglyn-preview')
      expect(response.headers.get('cache-control')).toBeNull()
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
