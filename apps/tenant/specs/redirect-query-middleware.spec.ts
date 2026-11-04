/**
 * @jest-environment node
 */
/**
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
 * Site redirects keep the visitor's query string.
 *
 * The middleware asks `/api/redirect-verdict` only for a request that carries a
 * query, and answers a matching rule with the visitor's parameters merged into
 * the destination. Everything else falls through to the page, whose loader
 * still applies the rule without the query, as it always has.
 */

const TENANT_DEMO_HOST = 'localhost:4500'

let lockdownVerdict: Record<string, unknown>
let redirectAnswer: Record<string, unknown> | 'throw'
let fetchedUrls: string[]

const originalFetch = global.fetch

beforeAll(() => {
  global.fetch = (async (input: unknown) => {
    const url = String(input)
    fetchedUrls.push(url)
    if (url.includes('/api/redirect-verdict')) {
      if (redirectAnswer === 'throw') throw new Error('edge fetch failed')
      return Response.json(redirectAnswer)
    }
    return Response.json(lockdownVerdict)
  }) as typeof global.fetch
})
afterAll(() => {
  global.fetch = originalFetch
  delete process.env.AGLYN_TENANT_DEMO
})

// What Next's own Node server loads first: the adapter needs the global
// `AsyncLocalStorage` it installs.
import 'next/dist/server/node-environment-baseline'
import { adapter } from 'next/dist/server/web/adapter'
import { NextRequest } from 'next/server'
import { middleware } from '../middleware'

async function request(host: string, pathAndQuery: string) {
  process.env.AGLYN_TENANT_DEMO = host
  const req = new NextRequest(
    new Request(`http://${TENANT_DEMO_HOST}${pathAndQuery}`, {
      headers: { host: TENANT_DEMO_HOST },
    }),
  )
  return (await middleware(req, {} as never)) as Response
}

const asked = () => fetchedUrls.filter((u) => u.includes('/api/redirect-verdict'))

beforeEach(() => {
  jest.restoreAllMocks()
  jest.spyOn(console, 'debug').mockImplementation(() => undefined)
  fetchedUrls = []
  lockdownVerdict = { locked: false, attribution: false, overQuota: false }
  redirectAnswer = { destination: null }
})

describe('a redirect keeps the visitor’s query string', () => {
  it('merges the visitor’s parameters into the rule’s destination', async () => {
    redirectAnswer = {
      destination:
        'https://app.aglyn.com/signup?utm_source=event&utm_medium=qr&utm_campaign=booth-left',
      statusCode: 302,
    }
    const response = await request('qr-site', '/booth-left?ref=flyer&utm_campaign=other')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'https://app.aglyn.com/signup?utm_source=event&utm_medium=qr&utm_campaign=booth-left&ref=flyer',
    )
    expect(asked()[0]).toContain('path=%2Fbooth-left')
  })

  it('keeps the rule’s status and an on-site destination', async () => {
    redirectAnswer = { destination: '/pricing', statusCode: 301 }
    const response = await request('moved-site', '/plans?plan=pro')
    expect(response.status).toBe(301)
    // Absolute against the request (AGL-4153); Next's adapter makes a
    // same-host `Location` relative again, see the block below.
    expect(response.headers.get('location')).toBe(
      `http://${TENANT_DEMO_HOST}/pricing?plan=pro`,
    )
  })

  it('CONTROL — no query asks nothing and rewrites to the page as before', async () => {
    const response = await request('plain-site', '/booth-left')
    expect(asked()).toHaveLength(0)
    expect(response.headers.get('x-middleware-rewrite')).toContain('/booth-left')
  })

  it('a path with no rule is rewritten to its page, query intact', async () => {
    const response = await request('ad-site', '/landing?utm_source=google')
    expect(asked()).toHaveLength(1)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-rewrite')).toContain(
      '/landing?utm_source=google',
    )
  })

  it('remembers the answer instead of asking on every request', async () => {
    await request('busy-site', '/landing?utm_source=a')
    await request('busy-site', '/landing?utm_source=b')
    expect(asked()).toHaveLength(1)
  })

  it('an unreachable verdict falls through to the page', async () => {
    redirectAnswer = 'throw'
    const response = await request('flaky-site', '/booth?ref=x')
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-rewrite')).toContain('/booth')
  })

  it('a locked site serves its notice and redirects nowhere', async () => {
    lockdownVerdict = { locked: true, mode: 'full', attribution: false }
    redirectAnswer = { destination: 'https://example.com/', statusCode: 302 }
    const response = await request('locked-site', '/booth?ref=x')
    expect(asked()).toHaveLength(0)
    expect(response.headers.get('x-middleware-rewrite')).toContain('/api/locked')
  })
})

/**
 * AGL-4153: the response above is not what a visitor gets. Next runs the
 * middleware through its adapter, which parses `Location` with no base URL, so
 * a relative one (`/pricing?plan=pro`) threw there and every on-site redirect
 * with a query string failed as a 500 `MIDDLEWARE_INVOCATION_FAILED`. Calling
 * `middleware()` directly never reached that step, which is how the bug
 * shipped; these run the same adapter production does.
 */
describe('a redirect with a query survives Next’s middleware adapter', () => {
  async function throughAdapter(host: string, pathAndQuery: string) {
    process.env.AGLYN_TENANT_DEMO = host
    const { response } = await adapter({
      handler: middleware as never,
      page: '/middleware',
      request: {
        url: `http://${TENANT_DEMO_HOST}${pathAndQuery}`,
        headers: { host: TENANT_DEMO_HOST },
        method: 'GET',
        nextConfig: {},
      },
    } as never)
    return response
  }

  it('an on-site destination redirects with the visitor’s query merged in', async () => {
    redirectAnswer = {
      destination: '/solutions/agencies?utm_source=site',
      statusCode: 308,
    }
    const response = await throughAdapter(
      'agency-site',
      '/about-us?gclid=abc&utm_source=ads',
    )
    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toBe(
      '/solutions/agencies?utm_source=site&gclid=abc',
    )
  })

  it('an absolute destination behaves as before', async () => {
    redirectAnswer = {
      destination: 'https://app.aglyn.com/signup?utm_campaign=booth-left',
      statusCode: 302,
    }
    const response = await throughAdapter('booth-site', '/booth-left?x=1')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'https://app.aglyn.com/signup?utm_campaign=booth-left&x=1',
    )
  })

  it('CONTROL — an on-site rule with no query is left to the page', async () => {
    redirectAnswer = { destination: '/solutions/agencies', statusCode: 308 }
    const response = await throughAdapter('quiet-site', '/about-us')
    expect(asked()).toHaveLength(0)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-rewrite')).toContain('/about-us')
  })
})
