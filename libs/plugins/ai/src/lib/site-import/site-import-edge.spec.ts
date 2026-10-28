/**
 * @jest-environment node
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
 * The edge secret goes to hosts this platform serves and to nobody else
 * (AGL-4085). Every crawl case runs UNDER the real `fetchPublicTextDetailed`
 * with `fetch` stubbed, so what is asserted is the header each request was
 * actually sent with, hop by hop. Only the address check is stubbed, to call
 * every recorded host public, and the platform-served check, which has its
 * own spec beside it in tenant-data-admin.
 */

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const mockResolvePublicIp = jest.fn(async (_host: string) => '93.184.216.34')
const mockIsPlatformServedDomain = jest.fn(async (_host: string) => false)

jest.mock('@aglyn/tenant-data-admin/server/serve-plugin-fetch', () => ({
  __esModule: true,
  resolvePublicIp: (host: string) => mockResolvePublicIp(host),
  createPinnedDispatcher: () => ({ close: async () => undefined }),
}))
jest.mock('@aglyn/tenant-data-admin/server/platform-served-domain', () => ({
  __esModule: true,
  isPlatformServedDomain: (host: string) => mockIsPlatformServedDomain(host),
}))

import { fetchPublicTextDetailed } from '../jobs/ai-theme-brand-inputs'
import { AGLYN_BOT_USER_AGENT, crawlSiteForImport, readSiteVerificationMeta } from './site-import-crawl'
import {
  SITE_IMPORT_EDGE_HEADER,
  siteImportEdgeHeaders,
  siteImportEdgeHeadersFor,
  siteImportEdgeToken,
} from './site-import-edge'

/** A stand-in, never a real value: the real one lives only in the console's env and the rule. */
const TOKEN = 'spec-only-edge-token-not-a-real-secret-0000'
const ENV = { SITE_IMPORT_EDGE_TOKEN: TOKEN }

/** The site we serve, and two we do not. */
const SERVED = 'hosted-here.example'
const FOREIGN = 'rosies-bakery.example'
const ELSEWHERE = 'checkout.elsewhere.example'
const servedOnly = async (host: string) => host === SERVED

const html = (body: string) => ({
  status: 200,
  headers: { 'content-type': 'text/html; charset=utf-8' },
  body: `<!doctype html><html lang="en"><head><title>Page</title></head><body>${body}</body></html>`,
})
const redirect = (location: string) => ({ status: 302, headers: { location }, body: null })

type Recorded = { status: number; headers: Record<string, string>; body: string | null }

/** Both sites, page for page, and a third host the served site's /checkout redirects to. */
function recordingsFor(domain: string): Record<string, Recorded> {
  return {
    [`https://${domain}/robots.txt`]: {
      status: 200,
      headers: { 'content-type': 'text/plain' },
      body: 'User-agent: *\nAllow: /\n',
    },
    [`https://${domain}/sitemap.xml`]: {
      status: 200,
      headers: { 'content-type': 'application/xml' },
      body: `<urlset><url><loc>https://${domain}/about</loc></url><url><loc>https://${domain}/checkout</loc></url><url><loc>https://${domain}/moved</loc></url></urlset>`,
    },
    [`https://${domain}/`]: html(`<main><h1>Home</h1><p>Welcome home.</p><a href="/about">About</a></main>`),
    [`https://${domain}/about`]: html(`<main><h1>About</h1><p>About us.</p></main>`),
    // A redirect off the site: the crawl refuses it unfollowed.
    [`https://${domain}/checkout`]: redirect(`https://${ELSEWHERE}/pay`),
    // A redirect to the site's www name: followed, and that name is decided on its own.
    [`https://${domain}/moved`]: redirect(`https://www.${domain}/about-us`),
    [`https://www.${domain}/about-us`]: html(`<main><h1>About us</h1><p>Moved here.</p></main>`),
    [`https://${ELSEWHERE}/pay`]: html(`<main><h1>Pay</h1></main>`),
  }
}

const RECORDINGS: Record<string, Recorded> = { ...recordingsFor(SERVED), ...recordingsFor(FOREIGN) }

type Call = { url: string; headers: Record<string, string> }
let calls: Call[] = []
let fetchSpy: jest.SpyInstance

beforeEach(() => {
  calls = []
  mockResolvePublicIp.mockClear()
  mockIsPlatformServedDomain.mockReset()
  mockIsPlatformServedDomain.mockImplementation(servedOnly)
  fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    calls.push({ url, headers: { ...(((init as RequestInit | undefined)?.headers ?? {}) as Record<string, string>) } })
    const recorded = RECORDINGS[url]
    if (!recorded) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/html' } })
    return new Response(recorded.body, { status: recorded.status, headers: recorded.headers })
  })
})

afterEach(() => {
  fetchSpy.mockRestore()
  delete process.env['SITE_IMPORT_EDGE_TOKEN']
})

const secretCalls = () => calls.filter((call) => SITE_IMPORT_EDGE_HEADER in call.headers)
const hostOf = (url: string) => new URL(url).hostname

describe('the secret', () => {
  it('is read only from the server variable, and only when it is shaped like a secret', () => {
    expect(siteImportEdgeToken({})).toBeNull()
    expect(siteImportEdgeToken({ SITE_IMPORT_EDGE_TOKEN: '' })).toBeNull()
    expect(siteImportEdgeToken({ SITE_IMPORT_EDGE_TOKEN: 'short' })).toBeNull()
    expect(siteImportEdgeToken({ SITE_IMPORT_EDGE_TOKEN: `${'a'.repeat(40)}\r\nx-evil: 1` })).toBeNull()
    expect(siteImportEdgeToken({ SITE_IMPORT_EDGE_TOKEN: `${'a'.repeat(40)} spaced` })).toBeNull()
    expect(siteImportEdgeToken({ SITE_IMPORT_EDGE_TOKEN: `  ${TOKEN}  ` })).toBe(TOKEN)
  })

  it('unset, nothing is asked of the platform and nothing is sent', async () => {
    const served = jest.fn(servedOnly)
    await expect(siteImportEdgeHeaders(SERVED, { env: {}, served })).resolves.toEqual({})
    const headersFor = await siteImportEdgeHeadersFor([`https://${SERVED}`], { env: {}, served })
    expect(headersFor(new URL(`https://${SERVED}/`))).toEqual({})
    expect(served).not.toHaveBeenCalled()
  })

  it('goes to a host the platform serves, and to no other', async () => {
    await expect(siteImportEdgeHeaders(SERVED, { env: ENV, served: servedOnly })).resolves.toEqual({
      [SITE_IMPORT_EDGE_HEADER]: TOKEN,
    })
    await expect(siteImportEdgeHeaders(FOREIGN, { env: ENV, served: servedOnly })).resolves.toEqual({})
  })

  it('a platform check that fails is a no', async () => {
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const served = async () => {
        throw new Error('deadline exceeded')
      }
      await expect(siteImportEdgeHeaders(SERVED, { env: ENV, served })).resolves.toEqual({})
    } finally {
      quiet.mockRestore()
    }
  })

  it('is decided once per origin, and given only to https on the default port of a served origin', async () => {
    const served = jest.fn(servedOnly)
    const headersFor = await siteImportEdgeHeadersFor(
      [`https://${SERVED}`, `https://www.${SERVED}`, `https://${SERVED}`],
      { env: ENV, served },
    )
    expect(served.mock.calls.map(([host]) => host)).toEqual([SERVED, `www.${SERVED}`])
    expect(headersFor(new URL(`https://${SERVED}/any/path?q=1`))).toEqual({ [SITE_IMPORT_EDGE_HEADER]: TOKEN })
    for (const other of [
      `http://${SERVED}/`,
      `https://${SERVED}:8443/`,
      `https://user:pass@${SERVED}/`,
      `https://www.${SERVED}/`,
      `https://${FOREIGN}/`,
      `https://${SERVED}.${FOREIGN}/`,
    ]) {
      expect(headersFor(new URL(other))).toEqual({})
    }
  })
})

describe('the crawl', () => {
  it('sends the edge header only to platform-served hosts: every request to the site we serve carries it with AglynBot', async () => {
    const headersFor = await siteImportEdgeHeadersFor([`https://${SERVED}`, `https://www.${SERVED}`], {
      env: ENV,
      served: servedOnly,
    })
    const inventory = await crawlSiteForImport({ domain: SERVED, maxPages: 10 }, { headersFor })
    expect(inventory.pages.map((page) => page.path)).toEqual(['/', '/about', '/about-us'])
    const toServed = calls.filter((call) => hostOf(call.url) === SERVED)
    expect(toServed.length).toBeGreaterThanOrEqual(4)
    for (const call of toServed) {
      expect(call.headers[SITE_IMPORT_EDGE_HEADER]).toBe(TOKEN)
      expect(call.headers['User-Agent']).toBe(AGLYN_BOT_USER_AGENT)
    }
  })

  it('never sends it to a foreign site, even with the secret configured', async () => {
    const headersFor = await siteImportEdgeHeadersFor([`https://${FOREIGN}`, `https://www.${FOREIGN}`], {
      env: ENV,
      served: servedOnly,
    })
    const inventory = await crawlSiteForImport({ domain: FOREIGN, maxPages: 10 }, { headersFor })
    expect(inventory.pages.length).toBeGreaterThan(0)
    expect(calls.length).toBeGreaterThan(3)
    expect(secretCalls()).toEqual([])
  })

  it('never sends it off the site: a redirect to another host is refused unfollowed, and the www twin is its own decision', async () => {
    const headersFor = await siteImportEdgeHeadersFor([`https://${SERVED}`, `https://www.${SERVED}`], {
      env: ENV,
      served: servedOnly,
    })
    const inventory = await crawlSiteForImport({ domain: SERVED, maxPages: 10 }, { headersFor })
    expect(calls.some((call) => hostOf(call.url) === ELSEWHERE)).toBe(false)
    expect(inventory.skipped).toContainEqual(
      expect.objectContaining({ reason: 'off-origin-redirect', location: `https://${ELSEWHERE}/pay` }),
    )
    // `www.` is not a host record here, so its hop went out without the secret.
    const toWww = calls.filter((call) => hostOf(call.url) === `www.${SERVED}`)
    expect(toWww.length).toBe(1)
    expect(SITE_IMPORT_EDGE_HEADER in toWww[0].headers).toBe(false)
    expect(secretCalls().every((call) => hostOf(call.url) === SERVED)).toBe(true)
  })

  it("holds the line even against a caller's own headersFor that would hand the secret to anyone", async () => {
    const leaky = () => ({ [SITE_IMPORT_EDGE_HEADER]: TOKEN })
    await crawlSiteForImport({ domain: SERVED, maxPages: 10 }, { headersFor: leaky })
    expect(secretCalls().length).toBeGreaterThan(0)
    expect(secretCalls().every((call) => [SERVED, `www.${SERVED}`].includes(hostOf(call.url)))).toBe(true)
    expect(calls.some((call) => hostOf(call.url) === ELSEWHERE)).toBe(false)
  })

  it('by default asks the platform once a secret is set, and sends it only where the platform says it serves', async () => {
    process.env['SITE_IMPORT_EDGE_TOKEN'] = TOKEN
    await crawlSiteForImport({ domain: SERVED, maxPages: 10 })
    expect(mockIsPlatformServedDomain.mock.calls.map(([host]) => host)).toEqual([SERVED, `www.${SERVED}`])
    expect(secretCalls().length).toBeGreaterThan(0)
    expect(secretCalls().every((call) => hostOf(call.url) === SERVED)).toBe(true)

    calls = []
    await crawlSiteForImport({ domain: FOREIGN, maxPages: 10 })
    expect(calls.length).toBeGreaterThan(3)
    expect(secretCalls()).toEqual([])
  })

  it('by default, with no secret set, asks nothing and sends nothing', async () => {
    await crawlSiteForImport({ domain: SERVED, maxPages: 10 })
    expect(mockIsPlatformServedDomain).not.toHaveBeenCalled()
    expect(calls.length).toBeGreaterThan(3)
    expect(secretCalls()).toEqual([])
  })

  it('the verification read takes the same rule: the secret for a served home page, none for a foreign one', async () => {
    process.env['SITE_IMPORT_EDGE_TOKEN'] = TOKEN
    await readSiteVerificationMeta(SERVED, 'aglyn-site-verification')
    await readSiteVerificationMeta(FOREIGN, 'aglyn-site-verification')
    expect(calls.map((call) => [hostOf(call.url), SITE_IMPORT_EDGE_HEADER in call.headers])).toEqual([
      [SERVED, true],
      [FOREIGN, false],
    ])
  })
})

describe('the fetch seam', () => {
  it('asks for headers again on every hop, so a redirect another caller follows off the host carries nothing', async () => {
    const headersFor = await siteImportEdgeHeadersFor([`https://${SERVED}`], { env: ENV, served: servedOnly })
    const result = await fetchPublicTextDetailed(`https://${SERVED}/checkout`, {
      maxBytes: 64 * 1024,
      accept: /text\/html/i,
      userAgent: AGLYN_BOT_USER_AGENT,
      headersFor,
    })
    expect(result.ok).toBe(true)
    expect(calls.map((call) => [hostOf(call.url), SITE_IMPORT_EDGE_HEADER in call.headers])).toEqual([
      [SERVED, true],
      [ELSEWHERE, false],
    ])
  })

  it('never lets the extra headers replace Accept or the user agent', async () => {
    const headersFor = () => ({ Accept: 'x/evil', 'User-Agent': 'Mozilla/5.0' })
    await fetchPublicTextDetailed(`https://${SERVED}/`, {
      maxBytes: 64 * 1024,
      accept: /text\/html/i,
      acceptHeader: 'text/html',
      userAgent: AGLYN_BOT_USER_AGENT,
      headersFor,
    })
    expect(calls[0].headers['Accept']).toBe('text/html')
    expect(calls[0].headers['User-Agent']).toBe(AGLYN_BOT_USER_AGENT)
  })
})

/**
 * A guard over the seam: the header name and the secret's variable appear in
 * shipped code in exactly one module, the one that asks whether the platform
 * serves the host. A second module sending either would be a second place
 * the secret could leave by, with no such question asked. Enumerated with
 * `git ls-files`, comments included on purpose: a comment naming them is
 * where a copy starts.
 */
describe('the one place the secret is handled', () => {
  const REPO_ROOT = resolve(__dirname, '../../../../../..')
  const OWNER = 'libs/plugins/ai/src/lib/site-import/site-import-edge.ts'
  const SHIPPED = /^(apps|libs|cloud)\/.*\.(ts|tsx|js|jsx|mjs|cjs)$/
  const NOT_SHIPPED = /\.spec\.|\.test\.|\.e2e\.|\/specs\/|\/fixtures\/|\.stories\./

  it('names the header and the variable in site-import-edge.ts alone', () => {
    const named = execFileSync(
      'git',
      ['grep', '-l', '--untracked', '-F', '-e', SITE_IMPORT_EDGE_HEADER, '-e', 'SITE_IMPORT_EDGE_TOKEN', '--', 'apps', 'libs', 'cloud'],
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
      .split('\n')
      .filter(Boolean)
    // A positive control: the search reads real files, and finds the owner.
    expect(named).toContain(OWNER)
    expect(named.filter((file) => SHIPPED.test(file) && !NOT_SHIPPED.test(file))).toEqual([OWNER])
  })
})
