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
 * MARKDOWN CONTENT NEGOTIATION, AT THE EDGE (AGL-2716, acceptmarkdown.com).
 *
 * A `page.tsx` can only return a React tree, so the decision of which
 * representation to serve has to happen in the middleware — and everything
 * that can go wrong with it goes wrong here rather than in the handler:
 *
 *  - a browser answered with raw Markdown, because the `Accept` test was a
 *    substring match and Chrome's document header ends in the full wildcard;
 *  - an agent answered with HTML, because the header was ignored;
 *  - a locked site publishing through its own takedown, because the check ran
 *    before the lock's.
 *
 * `hostVerdict` memoizes per isolate for 30 seconds, so every case uses a
 * DISTINCT tenant host — otherwise the second case reads the first case's
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
  delete process.env.AGLYN_TENANT_DEMO
})

import { NextRequest } from 'next/server'
import { middleware } from '../middleware'

beforeEach(() => {
  jest.restoreAllMocks()
  jest.spyOn(console, 'debug').mockImplementation(() => undefined)
})

/** Where the middleware rewrote a request to, or '' when it did not rewrite. */
async function rewriteOf(
  host: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<string> {
  process.env.AGLYN_TENANT_DEMO = host
  const req = new NextRequest(
    new Request(`http://${TENANT_DEMO_HOST}${path}`, {
      headers: { host: TENANT_DEMO_HOST, ...headers },
    }),
  )
  const response = (await middleware(req, {} as never)) as Response
  return response.headers.get('x-middleware-rewrite') ?? ''
}

describe('Accept: text/markdown routes to the markdown handler', () => {
  it('sends a markdown request to /api/markdown with the page path', async () => {
    const rewrite = await rewriteOf('md-basic', '/pricing', {
      accept: 'text/markdown',
    })
    expect(rewrite).toContain('/api/markdown')
    expect(rewrite).toContain('path=%2Fpricing')
    expect(rewrite).toContain('host=md-basic')
  })

  it('leaves a REAL Chrome document request on the page path', async () => {
    /*
      The header the acceptmarkdown.com guide names as the one a substring test
      gets wrong. If this ever rewrites, every visitor to every site on the
      platform is downloading raw Markdown.
    */
    const rewrite = await rewriteOf('md-chrome', '/pricing', {
      accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,' +
        'image/webp,*/*;q=0.8',
    })
    expect(rewrite).not.toContain('/api/markdown')
    expect(rewrite).toContain('/md-chrome/light/pricing')
  })

  it('leaves a header-less request on the page path', async () => {
    const rewrite = await rewriteOf('md-none', '/pricing')
    expect(rewrite).not.toContain('/api/markdown')
  })

  it('leaves a wildcard-only request on the page path', async () => {
    const rewrite = await rewriteOf('md-star', '/pricing', { accept: '*/*' })
    expect(rewrite).not.toContain('/api/markdown')
  })

  it('honors a q=0 refusal of markdown', async () => {
    const rewrite = await rewriteOf('md-refused', '/pricing', {
      accept: 'text/markdown;q=0, text/html',
    })
    expect(rewrite).not.toContain('/api/markdown')
  })

  it('carries the path as a HEADER, which is what a rewrite can deliver', async () => {
    /*
      A route handler behind a rewrite sees the ORIGINAL request URL, so the
      `path` set on the rewrite target never reaches it (AGL-1501). MEASURED
      before the header existed: `GET /home` with `Accept: text/markdown`
      answered a Markdown 404 for a page that serves 200 as HTML — the query
      was right, the handler could not see it, and every assertion written
      against the rewrite URL alone passed.
    */
    process.env.AGLYN_TENANT_DEMO = 'md-header'
    const response = (await middleware(
      new NextRequest(
        new Request(`http://${TENANT_DEMO_HOST}/pricing`, {
          headers: { host: TENANT_DEMO_HOST, accept: 'text/markdown' },
        }),
      ),
      {} as never,
    )) as Response
    const forwarded = response.headers.get('x-middleware-override-headers') ?? ''
    expect(forwarded).toContain('x-aglyn-markdown-path')
    expect(
      response.headers.get('x-middleware-request-x-aglyn-markdown-path'),
    ).toBe('/pricing')
  })

  it('carries the page’s own query through', async () => {
    // A paginated list keeps its page number.
    const rewrite = await rewriteOf('md-query', '/blog?page=3', {
      accept: 'text/markdown',
    })
    expect(rewrite).toContain('page=3')
    expect(rewrite).toContain('path=%2Fblog')
  })
})

describe('the .md suffix routes to the markdown handler', () => {
  it('strips the suffix — /pricing.md and /pricing are one page', async () => {
    const rewrite = await rewriteOf('md-suffix', '/pricing.md')
    expect(rewrite).toContain('/api/markdown')
    expect(rewrite).toContain('path=%2Fpricing')
    expect(rewrite).not.toContain('path=%2Fpricing.md')
  })

  it('reaches a NESTED page, which the catch-all matcher already admits', async () => {
    const rewrite = await rewriteOf('md-nested', '/blog/hello-world.md')
    expect(rewrite).toContain('path=%2Fblog%2Fhello-world')
  })

  it('maps /index.md to the home page', async () => {
    // The root has no filename to hang a suffix on, so it takes the
    // directory-index convention — and `page.tsx` advertises exactly this URL
    // in `<link rel="alternate" type="text/markdown">`.
    const rewrite = await rewriteOf('md-index', '/index.md')
    expect(rewrite).toContain('path=%2F&')
  })

  it('does NOT strip a trailing /index.md from a nested path', async () => {
    // `/blog/index.md` still addresses a page called `index` under `/blog`.
    const rewrite = await rewriteOf('md-nested-index', '/blog/index.md')
    expect(rewrite).toContain('path=%2Fblog%2Findex')
  })

  it('marks the suffix form, so only it is told noindex', async () => {
    // A `noindex` on the NEGOTIATED response would be a statement about the
    // page's own URL — a deindex instruction for any crawler that ever sends
    // `Accept: text/markdown`.
    expect(await rewriteOf('md-flag-suffix', '/pricing.md')).toContain('md=1')
    expect(
      await rewriteOf('md-flag-negotiated', '/pricing', {
        accept: 'text/markdown',
      }),
    ).not.toContain('md=1')
  })
})

describe('406 Not Acceptable', () => {
  /** The middleware's response, whatever kind it is. */
  async function respond(host: string, path: string, accept?: string) {
    process.env.AGLYN_TENANT_DEMO = host
    return (await middleware(
      new NextRequest(
        new Request(`http://${TENANT_DEMO_HOST}${path}`, {
          headers: {
            host: TENANT_DEMO_HOST,
            ...(accept ? { accept } : {}),
          },
        }),
      ),
      {} as never,
    )) as Response
  }

  it('refuses a request that accepts neither representation', async () => {
    const response = await respond('na-pdf', '/pricing', 'application/pdf')
    expect(response.status).toBe(406)
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(response.headers.get('Vary')).toBe('Accept')
    const body = await response.text()
    expect(body).toContain('- text/html')
    expect(body).toContain('- text/markdown')
    expect(body).toContain('You requested: application/pdf')
  })

  it('never caches the refusal — it depends on a request header', async () => {
    const response = await respond('na-cache', '/pricing', 'application/pdf')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('refuses a header that refuses everything', async () => {
    expect((await respond('na-zero', '/pricing', '*/*;q=0')).status).toBe(406)
  })

  it.each([
    ['no Accept at all', undefined],
    ['the full wildcard', '*/*'],
    ['html', 'text/html'],
    ['markdown', 'text/markdown'],
    ['a real Chrome header', 'text/html,application/xhtml+xml,*/*;q=0.8'],
    ['markdown refused, html offered', 'text/markdown;q=0, text/html'],
  ])('does NOT refuse %s', async (label, accept) => {
    // The guide's own warning is that implementations 406 far too eagerly, and
    // a 406 on an ordinary page request is an outage for whoever sent it.
    const response = await respond(`na-ok-${String(accept)}`, '/pricing', accept)
    expect(response.status).not.toBe(406)
  })
})

describe('the search page is deliberately not negotiable', () => {
  it('serves HTML even when markdown is asked for', async () => {
    /*
      The results are computed in the BROWSER — the server render is the empty
      shell — so a Markdown variant would be a heading with no results under
      it, which answers the question wrongly rather than not at all. Serving
      HTML is the honest answer, and `/openapi.json` describes the search
      operation as HTML-only so nothing advertises a variant that does not
      exist.
    */
    const rewrite = await rewriteOf('md-search', '/search?q=widgets', {
      accept: 'text/markdown',
    })
    expect(rewrite).not.toContain('/api/markdown')
    expect(rewrite).toContain('/md-search/light/search')
  })
})

describe('negotiation never overtakes the checks in front of it', () => {
  it('does not intercept robots.txt, which has no markdown variant', async () => {
    const rewrite = await rewriteOf('md-robots', '/robots.txt', {
      accept: 'text/markdown',
    })
    expect(rewrite).toContain('/api/robots')
  })

  it('does not intercept the sitemap', async () => {
    const rewrite = await rewriteOf('md-sitemap', '/sitemap.xml', {
      accept: 'text/markdown',
    })
    expect(rewrite).toContain('/api/sitemap')
  })

  it('routes /llms.txt to its own handler', async () => {
    expect(await rewriteOf('md-llms', '/llms.txt')).toContain('/api/llms')
  })

  it('routes /openapi.json to its own handler', async () => {
    expect(await rewriteOf('md-openapi', '/openapi.json')).toContain(
      '/api/openapi',
    )
  })

  it('serves the lock notice to a markdown request on a locked host', async () => {
    /*
      Order is the whole assertion. A takedown 503s the pages; a Markdown
      request that ran ahead of the lock would keep publishing the same content
      in a different media type.
    */
    const locked = global.fetch
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          locked: true,
          blocked: true,
          attribution: true,
          overQuota: false,
          contained: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof global.fetch
    try {
      const rewrite = await rewriteOf('md-locked', '/pricing', {
        accept: 'text/markdown',
      })
      expect(rewrite).toContain('/api/locked')
      expect(rewrite).not.toContain('/api/markdown')
    } finally {
      global.fetch = locked
    }
  })
})
