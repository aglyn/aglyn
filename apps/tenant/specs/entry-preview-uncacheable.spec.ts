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
 * A PREVIEW MUST NOT BE ABLE TO REACH A SHARED CACHE (AGL-3205).
 *
 * The catch-all tenant render is ISR-cached at `revalidate = 3600` and Next
 * keys that cache on the PATHNAME — the query string is not part of it. So a
 * preview of an unpublished post rendered under the public route would be
 * written into the entry the NEXT ANONYMOUS VISITOR is served, and the post
 * would be public for an hour. That is not a degraded preview; it is a
 * publish nobody asked for.
 *
 * Three independent things keep it from happening, and each is asserted here
 * because any one of them silently failing leaves the other two looking fine:
 *
 *  1. the middleware sends a preview request to a DIFFERENT Next route, so it
 *     cannot share a cache entry with the public path even in principle;
 *  2. that route is `force-dynamic` with `revalidate = 0`, so it has no cache
 *     entry of its own either;
 *  3. the response carries explicit `no-store`, so the layers Next does not
 *     control — a CDN, a proxy — are told as well.
 *
 * And the fourth case, which is the one most worth keeping: WITHOUT the
 * parameter, every byte of this is unchanged. The public path is the product;
 * the preview is a guest on it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { reservedScreenRouteSegment } from '@aglyn/aglyn/server'
import { ENTRY_PREVIEW_PARAM } from '@aglyn/aglyn/app-utils/entry-preview-link'
import { middleware } from '../middleware'

const TENANT_DEMO_HOST = 'localhost:4500'
const POST = '/blog/shipping-the-export'

const originalFetch = global.fetch
beforeAll(() => {
  // `hostVerdict` fetches the lockdown verdict before the rewrite; an
  // unlocked answer keeps every case below on the catch-all path.
  global.fetch = (async () =>
    new Response(JSON.stringify({ blocked: false, overQuota: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof global.fetch
})
afterAll(() => {
  global.fetch = originalFetch
  // `process.env` is shared by every suite in a jest WORKER, so a demo host
  // left behind here would resolve some other spec's tenant host.
  delete process.env.AGLYN_TENANT_DEMO
})

/** Drive the real middleware for a URL on the demo host. */
async function run(pathAndQuery: string): Promise<Response> {
  process.env.AGLYN_TENANT_DEMO = TENANT_DEMO_HOST
  const req = new NextRequest(
    new Request(`http://${TENANT_DEMO_HOST}${pathAndQuery}`, {
      headers: { host: TENANT_DEMO_HOST },
    }),
  )
  const response = (await middleware(req, {} as never)) as Response
  // A premise guard: every case below reads a header off this response, and a
  // middleware that returned nothing would make all of them vacuous.
  expect(response).toBeTruthy()
  return response
}

/** Where the middleware rewrote to, as a path + query. */
function rewriteTarget(response: Response): string {
  const raw = response.headers.get('x-middleware-rewrite')
  expect(raw).toBeTruthy()
  const url = new URL(raw as string, `http://${TENANT_DEMO_HOST}`)
  return `${url.pathname}${url.search}`
}

describe('a preview request is routed away from the cached catch-all', () => {
  it('rewrites it one segment deeper, keeping the public path and the token', async () => {
    const target = rewriteTarget(await run(`${POST}?${ENTRY_PREVIEW_PARAM}=tok`))
    // `/{host}/{scheme}/aglyn-preview/blog/shipping-the-export?aglyn_preview=tok`
    expect(target).toMatch(
      new RegExp(
        `^/[^/]+/[^/]+/aglyn-preview${POST}\\?${ENTRY_PREVIEW_PARAM}=tok$`,
      ),
    )
  })

  it('routes a FORGED token to the same place — the check is not here', async () => {
    // The middleware runs on the edge and verifies nothing. What stops a
    // forged token is the signature check on the other side, in Node, against
    // the resolved host. Asserting the routing is indifferent to the value is
    // what documents that division.
    const target = rewriteTarget(
      await run(`${POST}?${ENTRY_PREVIEW_PARAM}=obviously-not-signed`),
    )
    expect(target).toContain('/aglyn-preview/blog/shipping-the-export')
  })

  it('marks the preview response uncacheable at every layer that reads a header', async () => {
    const response = await run(`${POST}?${ENTRY_PREVIEW_PARAM}=tok`)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('cache-control')).toContain('private')
    expect(response.headers.get('cdn-cache-control')).toBe('no-store')
    expect(response.headers.get('vercel-cdn-cache-control')).toBe('no-store')
  })
})

describe('without the parameter, the public path is untouched', () => {
  it('rewrites to the catch-all exactly as it always did', async () => {
    const target = rewriteTarget(await run(POST))
    // The whole historical form, asserted character for character:
    // `/{tenantHost}/{scheme}{pathname}`, no extra segment and no query.
    expect(target).toMatch(
      new RegExp(`^/${TENANT_DEMO_HOST}/(light|dark)${POST}$`),
    )
  })

  it('differs from the preview rewrite by exactly one segment', async () => {
    // Stated as a difference rather than as two independent strings: what the
    // preview branch is allowed to change is the ROUTE, and nothing else about
    // the address — not the host, not the scheme, not the path.
    const publicTarget = rewriteTarget(await run(POST))
    const previewTarget = rewriteTarget(
      await run(`${POST}?${ENTRY_PREVIEW_PARAM}=tok`),
    )
    expect(previewTarget.replace('/aglyn-preview', '')).toBe(
      `${publicTarget}?${ENTRY_PREVIEW_PARAM}=tok`,
    )
  })

  it('sets NO cache-control of its own, so the route keeps its ISR window', async () => {
    const response = await run(POST)
    // NOT a vacuous absence: the same response is proven to carry the headers
    // this middleware really does set, so "no cache-control" means the branch
    // did not run rather than that nothing was inspected.
    expect(response.headers.get('content-security-policy')).toBeTruthy()
    expect(response.headers.get('x-middleware-rewrite')).toBeTruthy()
    expect(response.headers.get('cache-control')).toBeNull()
    expect(response.headers.get('cdn-cache-control')).toBeNull()
  })

  it('is unchanged by an unrelated query string', async () => {
    const target = rewriteTarget(await run(`${POST}?utm_source=x`))
    expect(target).not.toContain('aglyn-preview')
    expect(target).toContain('?utm_source=x')
  })

  it('is unchanged by an EMPTY preview parameter', async () => {
    // `?aglyn_preview=` carries no token, so it is not a preview request. An
    // empty string would otherwise route every such URL to an uncacheable
    // render of the public page.
    const response = await run(`${POST}?${ENTRY_PREVIEW_PARAM}=`)
    expect(rewriteTarget(response)).not.toContain('aglyn-preview')
    expect(response.headers.get('cache-control')).toBeNull()
  })
})

/**
 * Read as source text rather than imported, for the reason
 * `publish-pointer-tracks-page-window.spec.ts` gives about the same two files:
 * a route module cannot be imported outside a Next server context, and its
 * import graph reaches `next/cache` either way.
 */
const previewPage = () =>
  readFileSync(
    join(
      __dirname,
      '..',
      'app',
      '[host]',
      '[scheme]',
      'aglyn-preview',
      '[...slug]',
      'page.tsx',
    ),
    'utf8',
  )

const catchAllPage = () =>
  readFileSync(
    join(__dirname, '..', 'app', '[host]', '[scheme]', '[[...slug]]', 'page.tsx'),
    'utf8',
  )

describe('the preview route has no cache of its own', () => {
  it('is force-dynamic', () => {
    expect(previewPage()).toMatch(
      /^export const dynamic = 'force-dynamic'$/m,
    )
  })

  it('declares a zero revalidate beside it', () => {
    const match = previewPage().match(/^export const revalidate = (\d+)$/m)
    // A premise guard, not decoration: a renamed or computed declaration must
    // fail loudly rather than pass by finding nothing to compare.
    if (!match) throw new Error('no `export const revalidate` on the preview page')
    expect(Number(match[1])).toBe(0)
  })

  it('never opts the CATCH-ALL out of its ISR window to do it', () => {
    // The regression this whole design exists to avoid. A `searchParams`,
    // `headers()` or `cookies()` read in the catch-all makes every page of
    // every customer site dynamic (AGL-1152).
    const source = catchAllPage()
    const match = source.match(/^export const revalidate = (\d+)$/m)
    if (!match) throw new Error('no `export const revalidate` in the catch-all page')
    expect(Number(match[1])).toBeGreaterThan(0)
    expect(source).not.toMatch(/\bsearchParams\b/)
    expect(source).not.toMatch(/\bfrom 'next\/headers'/)
  })
})

describe('the preview route segment is refused as a screen slug', () => {
  it('names itself in the refusal', () => {
    // A static route folder wins over the optional catch-all beside it, so a
    // screen published under this segment would be answered by the preview
    // page and never render. Same mechanism as `/search` (AGL-2076).
    expect(reservedScreenRouteSegment('aglyn-preview')).toBe('aglyn-preview')
    expect(reservedScreenRouteSegment('aglyn-preview/anything')).toBe(
      'aglyn-preview',
    )
  })

  it('does not over-reach to a slug that merely starts with it', () => {
    expect(reservedScreenRouteSegment('aglyn-previews')).toBeUndefined()
    expect(reservedScreenRouteSegment('preview')).toBeUndefined()
  })
})
