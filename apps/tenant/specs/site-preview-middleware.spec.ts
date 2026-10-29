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
 * A TEAM VIEW OF A SITE IN PREVIEW MUST NOT REACH A SHARED CACHE (AGL-4086).
 *
 * While a site is in preview, the public is answered from the cached
 * catch-all, whose loader renders the 503 page or the "Coming soon" notice. A
 * request carrying a team cookie — the site-preview cookie an enter link
 * plants, or the console sign-in's edit hint — is sent to the uncached preview
 * route, which verifies it in Node. These cases drive the real middleware with
 * the verdict route stubbed, one site per verdict (the middleware memoizes
 * verdicts per host).
 *
 *  - in preview + a cookie → the preview route, `no-store` at every layer;
 *  - in preview, no cookie → the catch-all, untouched: the cached 30 s answer;
 *  - public + a cookie → the catch-all, untouched: a team member's view of a
 *    public site keeps its cache;
 *  - a page in preview → only that address goes around the cache;
 *  - the edge checks PRESENCE only: a forged cookie is routed the same way,
 *    and the route's verifier is what refuses it.
 */

import { NextRequest } from 'next/server'
import {
  SITE_PREVIEW_COOKIE,
  SITE_PREVIEW_EDIT_HINT_COOKIE,
} from '@aglyn/aglyn/app-utils/site-preview'
import { middleware } from '../middleware'

/** The verdict each site answers with, keyed by the site's subdomain. */
const VERDICTS: Record<string, Record<string, unknown>> = {
  'preview-site': { locked: false, preview: true, previewPaths: [] },
  'public-site': { locked: false, preview: false, previewPaths: [] },
  'page-site': { locked: false, preview: false, previewPaths: ['/launch'] },
  'forged-site': { locked: false, preview: true, previewPaths: [] },
  'legacy-site': { locked: false },
}

const originalFetch = global.fetch
beforeAll(() => {
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    const verdict = VERDICTS[url.searchParams.get('host') ?? ''] ?? { locked: false }
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

describe('a site in preview, asked for by its team (AGL-4086)', () => {
  it('sends the site-preview cookie to the uncached preview route', async () => {
    const response = await run('preview-site', '/about', PREVIEW_COOKIE)
    expect(rewriteTarget(response)).toMatch(/^\/preview-site\/(light|dark)\/aglyn-preview\/about$/)
  })

  it('sends the edit hint there too, and the home page with it', async () => {
    const response = await run('preview-site', '/', HINT_COOKIE)
    expect(rewriteTarget(response)).toMatch(/^\/preview-site\/(light|dark)\/aglyn-preview\/?$/)
  })

  it('marks the team view uncacheable at every layer that reads a header', async () => {
    const response = await run('preview-site', '/about', PREVIEW_COOKIE)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('cache-control')).toContain('private')
    expect(response.headers.get('cdn-cache-control')).toBe('no-store')
    expect(response.headers.get('vercel-cdn-cache-control')).toBe('no-store')
  })

  it('routes a FORGED cookie the same way — the check is in Node, not here', async () => {
    const response = await run('forged-site', '/', `${SITE_PREVIEW_COOKIE}=obviously-not-signed`)
    expect(rewriteTarget(response)).toContain('/aglyn-preview')
  })
})

describe('the public is answered from the cache (AGL-4086)', () => {
  it('a site in preview, no cookie: the catch-all, with no cache-control of its own', async () => {
    const response = await run('preview-site', '/about')
    expect(rewriteTarget(response)).toMatch(/^\/preview-site\/(light|dark)\/about$/)
    expect(response.headers.get('content-security-policy')).toBeTruthy()
    expect(response.headers.get('cache-control')).toBeNull()
  })

  it('an unrelated cookie is not a team cookie', async () => {
    const response = await run('preview-site', '/about', 'aglyn_editor=1; theme=dark')
    expect(rewriteTarget(response)).not.toContain('aglyn-preview')
  })

  it('a PUBLIC site keeps its cache for a team member too', async () => {
    const response = await run('public-site', '/about', PREVIEW_COOKIE)
    expect(rewriteTarget(response)).not.toContain('aglyn-preview')
    expect(response.headers.get('cache-control')).toBeNull()
  })

  it('a verdict from an older deployment with no preview field is a public site', async () => {
    const response = await run('legacy-site', '/', PREVIEW_COOKIE)
    expect(rewriteTarget(response)).not.toContain('aglyn-preview')
  })
})

describe('one page in preview (AGL-4086)', () => {
  it('sends only that address around the cache', async () => {
    const page = await run('page-site', '/launch', HINT_COOKIE)
    expect(rewriteTarget(page)).toContain('/aglyn-preview/launch')
    const pageSlash = await run('page-site', '/launch/', HINT_COOKIE)
    expect(rewriteTarget(pageSlash)).toContain('/aglyn-preview/')
    const other = await run('page-site', '/about', HINT_COOKIE)
    expect(rewriteTarget(other)).not.toContain('aglyn-preview')
  })
})
