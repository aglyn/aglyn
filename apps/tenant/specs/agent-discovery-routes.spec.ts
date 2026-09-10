/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and the route handlers need real `Request`/`Response`.
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
 * `/llms.txt` and `/openapi.json`, at the route boundary (AGL-2716).
 *
 * The BUILDERS are unit-tested against the two published formats in
 * `libs/aglyn` — this is about the four decisions the routes make around them,
 * every one of which is a way to publish something wrong:
 *
 *  - which ORIGIN the file advertises (the site's own, never the domain the
 *    request happened to arrive on — a cache keys on the URL, so a
 *    header-derived origin lets one cached body name the wrong domain to
 *    everybody);
 *  - whether a search-discouraged site publishes at all;
 *  - whether a LOCKED site publishes through its own takedown;
 *  - what a caller gets when the site cannot be resolved.
 */

/*
  `mock`-prefixed, which is not style: `babel-plugin-jest-hoist` lifts every
  `jest.mock` factory above the imports and refuses any out-of-scope reference
  it cannot prove is a mock — the prefix is the proof.
*/
/*
  MODULE, not a script. Every declaration here is `require`d rather than
  `import`ed — the routes have to be loaded AFTER `jest.mock` — and a file with
  no top-level `import`/`export` is a global script whose consts share one
  namespace with every other script in the project. Two existing specs already
  collide over `SITE` that way; this marker keeps this file out of it.
*/
export {}

const mockHost: {
  record: Record<string, unknown> | null
  error: unknown
} = { record: null, error: null }

let mockLockdownRefusal: Response | null = null

jest.mock('../utils/get-host', () => ({
  __esModule: true,
  default: async () => ({ host: mockHost.record, error: mockHost.error }),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => ({}) }) },
  visitorContentRefusal: async () => mockLockdownRefusal,
}))

jest.mock('../app/api/_agent-site-facts', () => ({
  __esModule: true,
  readAgentSiteFacts: async () => ({
    collections: [{ slug: 'blog', name: 'Field notes', entryCount: 7 }],
    pages: [{ path: '/pricing' }, { path: '/about' }],
    hasSearch: true,
  }),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GET: llmsGet } = require('../app/api/llms/route')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GET: openapiGet } = require('../app/api/openapi/route')

const DEMO_SITE = {
  $id: 'host-demo',
  displayName: 'Demo Site',
  cname: 'demo.example.com',
  seo: {
    title: 'Demo Site',
    description: 'A site for demonstrating things.',
    entity: { name: 'Demo LLC', email: 'hi@demo.example.com' },
  },
}

function request(path: string, query = '?host=demo'): Request {
  return new Request(`https://demo.aglyn.app${path}${query}`, {
    headers: { host: 'demo.aglyn.app' },
  })
}

beforeEach(() => {
  mockHost.record = JSON.parse(JSON.stringify(DEMO_SITE))
  mockHost.error = null
  mockLockdownRefusal = null
})

describe('GET /llms.txt', () => {
  it('publishes the site in the llmstxt.org shape', async () => {
    const response = await llmsGet(request('/api/llms'))
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(body.split('\n')[0]).toBe('# Demo Site')
    expect(body).toContain('> A site for demonstrating things.')
    expect(body).toContain('## When to use this site')
    expect(body).toContain('[Field notes](https://demo.example.com/blog)')
    expect(body).toContain('7 published entries')
  })

  it('serves it as markdown, which is what the file IS', async () => {
    const response = await llmsGet(request('/api/llms'))
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
  })

  it('advertises the DEMO_SITE origin, not the domain the request arrived on', async () => {
    /*
      A cache keys on the URL and never the `Host` header. A site reachable on
      both its custom domain and `.aglyn.app` would otherwise have one cached
      body naming whichever name primed the cache — for everybody.
    */
    const body = await (await llmsGet(request('/api/llms'))).text()
    expect(body).toContain('https://demo.example.com/')
    expect(body).not.toContain('demo.aglyn.app')
  })

  it('names both markdown conventions', async () => {
    const body = await (await llmsGet(request('/api/llms'))).text()
    expect(body).toContain('Accept: text/markdown')
    expect(body).toContain('append `.md` to any path')
  })

  it('leads with the author’s guidance when they wrote any', async () => {
    ;(mockHost.record as any).seo.agent = { whenToUse: 'Ask us about widget torque.' }
    const body = await (await llmsGet(request('/api/llms'))).text()
    expect(body).toContain('Ask us about widget torque.')
  })

  it('404s a search-discouraged site rather than serving an empty guide', async () => {
    // An empty file is a file that EXISTS and says the site has nothing, which
    // an agent may cache as a fact about the site rather than its settings.
    ;(mockHost.record as any).seo.discourageSearchEngines = true
    expect((await llmsGet(request('/api/llms'))).status).toBe(404)
  })

  it('refuses while the site is locked down', async () => {
    // The middleware runs the verdict before it rewrites here, but its matcher
    // excludes `/api` — so a direct call arrives without ever having passed it.
    mockLockdownRefusal = new Response('locked', { status: 423 })
    expect((await llmsGet(request('/api/llms'))).status).toBe(423)
  })

  it('404s an unresolvable site, and 400s a request naming none', async () => {
    mockHost.record = null
    expect((await llmsGet(request('/api/llms'))).status).toBe(404)
    expect((await llmsGet(request('/api/llms', ''))).status).toBe(400)
  })
})

describe('GET /openapi.json', () => {
  it('publishes a valid OpenAPI 3.1 document for THIS site', async () => {
    const response = await openapiGet(request('/api/openapi'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
    const document = JSON.parse(await response.text())
    expect(document.openapi).toBe('3.1.0')
    expect(document.servers).toEqual([
      { url: 'https://demo.example.com', description: 'Demo Site' },
    ])
    expect(document.info.contact.email).toBe('hi@demo.example.com')
  })

  it('describes the collections this site really has', async () => {
    const document = JSON.parse(await (await openapiGet(request('/api/openapi'))).text())
    expect(
      document.paths['/{collectionSlug}/rss.xml'].get.parameters[0].schema.enum,
    ).toEqual(['blog'])
  })

  it('is readable cross-origin — an agent in a browser is the common case', async () => {
    const response = await openapiGet(request('/api/openapi'))
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('404s a search-discouraged site', async () => {
    ;(mockHost.record as any).seo.discourageSearchEngines = true
    expect((await openapiGet(request('/api/openapi'))).status).toBe(404)
  })

  it('refuses while the site is locked down', async () => {
    mockLockdownRefusal = new Response('locked', { status: 423 })
    expect((await openapiGet(request('/api/openapi'))).status).toBe(423)
  })

  it('404s an unresolvable site, and 400s a request naming none', async () => {
    mockHost.record = null
    expect((await openapiGet(request('/api/openapi'))).status).toBe(404)
    expect((await openapiGet(request('/api/openapi', ''))).status).toBe(400)
  })
})
