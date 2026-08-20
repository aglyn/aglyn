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
 * WHICH SLUGS THE PLATFORM CANNOT SERVE, AND WHICH ONES IT ONLY LOOKED LIKE IT
 * COULDN'T (AGL-2076).
 *
 * The issue was filed as "a screen whose slug is `404` is unreachable". It is,
 * and re-measuring production on 2026-08-19 (fresh `x-vercel-cache: MISS`, so
 * no stale negative) found a second, wider case nobody had looked for:
 *
 * ```
 * /404      404  x-matched-path: /404                  <- static shell, not a page
 * /500      500  x-matched-path: /500                  <- static shell, not a page
 * /search   200  x-matched-path: /[host]/search        <- platform search page
 * /401      200  x-matched-path: /[host]/[[...slug]]   <- a real screen, fine
 * /index    200  x-matched-path: /[host]/[[...slug]]   <- fine, NOT reserved
 * /api-docs 404  x-matched-path: /[host]/[[...slug]]   <- host param is "api-docs"
 * ```
 *
 * `/404` and `/500` carry `content-disposition: inline; filename="404"`,
 * `accept-ranges` and an `etag`, so they are STATIC FILES off Vercel's
 * filesystem — Next emits `pages/404.html` and `pages/500.html` even for an
 * app-router-only build, and the deployed filesystem answers them ahead of the
 * catch-all. The middleware's own CSP headers are on those responses, so the
 * middleware ran and its rewrite still lost; there is no rewrite this app can
 * write that wins against them.
 *
 * The last row is the wider case. The middleware matcher excludes
 * `api|_next|_static|fonts|examples` as bare PREFIXES with no segment
 * boundary, so `/api-docs`, `/apiary`, `/fontsize` and `/examples-gallery` are
 * excluded too: no host rewrite happens, `/api-docs` is matched as `[host]` =
 * `api-docs` with an empty slug, and every such page on every customer site is
 * dead. `fonts` and `examples` are not even real — `apps/tenant/public` holds
 * `_static/`, `favicon.ico` and `robots.txt` and has never held either — so
 * they were costing customers a slug to protect nothing.
 *
 * So the fix is two-sided and this suite asserts both sides: the paths that
 * genuinely cannot be served are REFUSED at authoring time by a rule shared
 * with the console, and the paths that only looked reserved are given back.
 */

import { NextRequest } from 'next/server'
import { reservedScreenRouteSegment } from '@aglyn/aglyn/server'
import { config, middleware } from '../middleware'

const TENANT_DEMO_HOST = 'localhost:4500'

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

/**
 * Does the middleware RUN for this path?
 *
 * Models Next's compilation of the first matcher entry: the manifest for a
 * real build wraps the entry's source verbatim as
 * `(?:\/((?!…).*))(\.json|\.rsc|…)?[\/#\?]?$`, so testing the source with the
 * same anchors answers the same question the deployed edge answers. Read out
 * of `dist/apps/tenant/.next/server/middleware-manifest.json` rather than
 * assumed.
 */
const matcherRuns = (pathname: string): boolean =>
  new RegExp(`^${config.matcher[0]}[/#?]?$`).test(pathname)

/** Where the middleware rewrote to, or null when it did not rewrite. */
const rewrittenTo = (response: unknown): string | null =>
  (response as Response | null)?.headers?.get('x-middleware-rewrite') ?? null

/** Drive the real middleware for a path on the demo host. */
async function rewriteFor(pathname: string): Promise<string | null> {
  process.env.AGLYN_TENANT_DEMO = TENANT_DEMO_HOST
  const req = new NextRequest(
    new Request(`http://${TENANT_DEMO_HOST}${pathname}`, {
      headers: { host: TENANT_DEMO_HOST },
    }),
  )
  return rewrittenTo(await middleware(req, {} as never))
}

describe('the middleware matcher only reserves whole path segments', () => {
  // The three that must stay out: real API routes, Next's internals, and the
  // one public directory this app actually ships.
  it.each([
    '/api',
    '/api/host/abc',
    '/_next/static/chunk.js',
    '/_static/images/a.png',
  ])('keeps %s off the host rewrite', (pathname) => {
    expect(matcherRuns(pathname)).toBe(false)
  })

  // A file-shaped path is excluded by the `[\w-]+\.\w+` clause, which is a
  // separate rule and must survive the segment-boundary change.
  it('still keeps a root public file off the host rewrite', () => {
    expect(matcherRuns('/favicon.ico')).toBe(false)
  })

  // The regression. Every one of these is an ordinary page slug an author can
  // type today, and every one of them is currently swallowed by an unbounded
  // prefix.
  it.each([
    '/api-docs',
    '/apiary',
    '/fonts',
    '/fontsize',
    '/examples',
    '/examples-gallery',
    '/_nextdoor',
    '/_staticky',
  ])('lets %s reach the host rewrite', (pathname) => {
    expect(matcherRuns(pathname)).toBe(true)
  })

  /**
   * A companion, NOT a second proof of the matcher: `middleware()` never
   * consults `config.matcher` — the platform does — so this case passed
   * before the fix as well. What it holds down is the other half of the
   * sentence: once the matcher lets `/api-docs` through, the rewrite it gets
   * is the ordinary host rewrite and not something that re-loses the segment.
   */
  it('composes the ordinary host rewrite for /api-docs', async () => {
    await expect(rewriteFor('/api-docs')).resolves.toContain(
      `/${TENANT_DEMO_HOST}/api-docs`,
    )
  })
})

describe('reservedScreenRouteSegment', () => {
  /**
   * Named individually rather than looped over an exported list: a list
   * compared against itself passes whatever is in it, and the point of these
   * six is that each was MEASURED against production, not reasoned about.
   */
  it.each([
    ['404', 'Vercel serves its own static 404.html at this path'],
    ['500', 'Vercel serves its own static 500.html at this path'],
    ['search', 'app/[host]/search wins over the catch-all'],
    ['api', 'excluded from the middleware matcher — API routes live there'],
    ['_next', "excluded from the middleware matcher — Next's internals"],
    ['_static', 'excluded from the middleware matcher — the public directory'],
  ])('refuses %s (%s)', (path) => {
    expect(reservedScreenRouteSegment(path)).toBe(path)
  })

  it('refuses a CHILD of a reserved segment, which is unreachable too', () => {
    expect(reservedScreenRouteSegment('api/docs')).toBe('api')
  })

  it.each([
    '/',
    'about',
    'index',
    'api-docs',
    'fonts',
    'examples',
    '401',
    '503',
    'blog/404',
  ])('allows %s', (path) => {
    expect(reservedScreenRouteSegment(path)).toBeUndefined()
  })

  it('answers for empty input without throwing', () => {
    expect(reservedScreenRouteSegment(undefined)).toBeUndefined()
    expect(reservedScreenRouteSegment('')).toBeUndefined()
  })
})
