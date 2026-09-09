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
 * THE PAGE RESPONSE ASKS FOR THE VISITOR'S DEVICE SCHEME.
 *
 * A published page decides light or dark before its first render — the theme
 * is single-mode and swapped between schemes, and node styles are merged
 * against `palette.mode` as the tree renders, so there is no stylesheet that
 * could make the decision later. An explicit choice rides a cookie. "Device
 * default", which is what most visitors are on, lives in
 * `prefers-color-scheme`, and the only way that reaches a server is the
 * `Sec-CH-Prefers-Color-Scheme` client hint — which a browser sends solely
 * where the origin asked for it.
 *
 * These headers are the ask, and each of the three earns its place:
 * `Accept-CH` alone leaves the FIRST navigation hint-less, `Critical-CH` is
 * what makes the browser retry it immediately, and `Vary` is what keeps a
 * cache from handing one visitor's document to a browser in the other scheme.
 *
 * `hostVerdict` memoizes per isolate for 30 seconds, so every case below uses
 * a DISTINCT tenant host — otherwise the second case reads the first case's
 * answer and the suite passes on a middleware that only ever fetched once.
 */

const TENANT_DEMO_HOST = 'localhost:4500'

const originalFetch = global.fetch

beforeAll(() => {
  global.fetch = (async () =>
    new Response(
      JSON.stringify({
        locked: false,
        attribution: true,
        overQuota: false,
        contained: false,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof global.fetch
})
afterAll(() => {
  global.fetch = originalFetch
  // `process.env` is shared by every suite in a jest WORKER, so a demo host
  // left behind here would resolve some other spec's tenant host.
  delete process.env.AGLYN_TENANT_DEMO
})

import { COLOR_SCHEME_HINT_HEADER } from '@aglyn/shared-ui-theme/util/color-scheme-hint'
import { NextRequest } from 'next/server'
import { middleware } from '../middleware'

beforeEach(() => {
  jest.restoreAllMocks()
  jest.spyOn(console, 'debug').mockImplementation(() => undefined)
})

/** The response the middleware returns for an ordinary page request. */
async function pageResponse(host: string): Promise<Response> {
  process.env.AGLYN_TENANT_DEMO = host
  const req = new NextRequest(
    new Request(`http://${TENANT_DEMO_HOST}/some/page`, {
      headers: { host: TENANT_DEMO_HOST },
    }),
  )
  return (await middleware(req, {} as never)) as Response
}

/**
 * Spelled out rather than read from the constant the middleware itself uses.
 * The name is one browsers implement, not one this repo chooses: an assertion
 * written against the middleware's own constant would survive a rename that
 * silently stopped every browser sending the hint.
 */
const HINT = 'Sec-CH-Prefers-Color-Scheme'

describe('the tenant page response negotiates the color-scheme hint', () => {
  it('advertises the SAME token the middleware reads the request by', () => {
    // The middleware names the hint locally for the `Accept-CH` it emits, so
    // the edge bundle's import list stays app-local, and reads the request by
    // the library constant — two definitions, free to drift apart. A drift
    // here breaks nothing loudly: browsers would keep sending a hint the
    // resolver no longer looks for, and every device default would quietly go
    // back to resolving light.
    expect(COLOR_SCHEME_HINT_HEADER).toBe(HINT)
  })

  it('CONTROL — the response measured here is the page, not a notice', async () => {
    // Every assertion below reads headers off whatever the middleware
    // returned. A locked or redirected response carries none of them, so
    // without this the suite could report a clean pass on a middleware that
    // never reached the page path at all.
    //
    // `light` is the scheme segment (AGL-2708), named rather than wildcarded:
    // this request carries neither a cookie nor a hint, and light is what the
    // pair of nulls has to resolve to.
    const response = await pageResponse('hint-control')
    expect(response.headers.get('x-middleware-rewrite')).toContain(
      '/hint-control/light/some/page',
    )
  })

  it('advertises the hint, so the browser has something to send', async () => {
    expect((await pageResponse('hint-accept')).headers.get('Accept-CH')).toBe(
      HINT,
    )
  })

  it('marks it critical, so the FIRST navigation carries it', async () => {
    // `Accept-CH` on its own only reaches the second request to an origin, and
    // the first load is the one where a wrong scheme is most visible.
    expect(
      (await pageResponse('hint-critical')).headers.get('Critical-CH'),
    ).toBe(HINT)
  })

  it('varies on it, so no cache serves dark markup to a light browser', async () => {
    expect((await pageResponse('hint-vary')).headers.get('Vary')).toContain(
      HINT,
    )
  })

  it('varies on named fields only, and never on `*`', async () => {
    // `Vary: *` makes every response uncacheable by anything, which is the
    // opposite of what splitting by scheme is for: two cacheable documents,
    // not none. The list is also left open — Next appends `RSC`,
    // `Next-Router-State-Tree` and friends to this same header for app-router
    // responses — so what is asserted is the contribution, not the field.
    //
    // `Accept` joined the hint in AGL-2716: the same URL serves HTML and
    // Markdown by negotiation, so a cache that did not split on it would hand
    // one representation to a client that asked for the other. Asserted as an
    // exact list rather than a `toContain`, because the failure this test
    // exists to catch is a field appearing that NOBODY decided to split the
    // cache on — every entry here costs cache hit rate.
    const vary = (await pageResponse('hint-vary-list')).headers.get('Vary')
    expect(vary?.split(',').map((token) => token.trim())).toEqual([
      HINT,
      'Accept',
    ])
  })

  it('varies on Accept, so no cache answers an agent with HTML', async () => {
    const vary = (await pageResponse('accept-vary')).headers.get('Vary')
    expect(vary).toContain('Accept')
  })
})
