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
 * AGL-4235: `POST /v1/sites/{siteId}/publish` given `{ "pages": [...] }`
 * makes those pages' drafts live, then refreshes the site as it always did.
 *
 * What each block proves, and what would make it lie:
 *
 * - **The gate is wired, and in its order.** A refusal is asserted with the
 *   store unchanged AND the budget unspent: a 403 that already spent the
 *   hour, or wrote a page, is the bug wearing a status code.
 * - **One refused page refuses the list.** The other page in the request had
 *   a draft that WOULD go live; asserting it is still a draft is what shows
 *   nothing was written, rather than that the refused one was skipped.
 * - **A success shows what went live.** The version's stored tree is read
 *   back, and the refresh is asserted to have run after it.
 */

const mockRateCalls: string[] = []
let mockRateRefuse = false
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/tenant-data-admin'),
  consumeRateLimit: async (key: string, options?: { limit?: number; windowMs?: number }) => {
    mockRateCalls.push(key)
    return {
      allowed: !mockRateRefuse,
      limit: options?.limit ?? 10,
      remaining: mockRateRefuse ? 0 : 9,
      resetMs: Date.now() + (options?.windowMs ?? 60_000),
      degraded: false,
      contended: false,
    }
  },
}))

const mockRevalidate: Array<{ hostId: string; paths: string[] }> = []
jest.mock('../utils/server/tenant-revalidate', () => ({
  __esModule: true,
  postTenantRevalidate: async (options: { hostId: string; paths: string[] }) => {
    mockRevalidate.push({ hostId: options.hostId, paths: options.paths })
    return { reason: 'ok', revalidated: options.paths, pathsDropped: 0 }
  },
}))

import { siteKeyRefusal } from '@aglyn/aglyn/app-utils/host-permissions'
import { decodeStoredNodes, encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import {
  type PluginSiteCacheRequest,
  type PluginSiteCacheResult,
  registerPluginSiteCache,
} from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import type { ApiV1Context } from '@aglyn/tenant-data-admin/server/api-v1-kit'
import { settingsFirestoreDouble } from '@aglyn/tenant-data-admin/testing/settings-firestore-double'
import { dispatchResource } from '../utils/api-v1-resources'

const ORIGIN = 'https://app.example.com'
const SITE = 'site-1'
const MEMBER = 'user-member'
const HOST = `hosts/${SITE}`
const page = (id: string) => `${HOST}/screens/${id}`
const version = (id: string) => `${page(id)}/versions/v1`
const draft = (id: string) => `${version(id)}/draft/current`

const SAVED = { seconds: 100, nanoseconds: 0 }
const SAVED_STAMP = 'ts:100.0'
const tree = (text: string) => ({
  '_@_': { componentId: 'root', props: {}, nodes: ['t'] },
  t: { componentId: 'text', props: { text } },
})
const packed = (nodes: unknown) => Buffer.from(encodeStoredNodes(nodes) as Uint8Array)
const storedTree = (path: string) => decodeStoredNodes(double.read(path)?.['nodes'] as never)

const dropCache = jest.fn<Promise<PluginSiteCacheResult>, [PluginSiteCacheRequest]>(async () => ({ dropped: 1, skipped: 0, complete: true }))
beforeAll(() => registerPluginSiteCache({ drop: dropCache }, { pluginId: 'api-v1-site-publish-pages-spec' }))

let double: ReturnType<typeof settingsFirestoreDouble>
beforeEach(() => {
  dropCache.mockClear()
  mockRateCalls.length = 0
  mockRateRefuse = false
  mockRevalidate.length = 0
  double = settingsFirestoreDouble({
    [HOST]: {
      displayName: 'Bakery',
      subdomain: 'bakery',
      orgId: 'org-1',
      memberRoles: { [MEMBER]: 'admin' },
      screens: { home: '/', about: 'about' },
    },
    [page('home')]: { displayName: 'Home', slug: '/', versionId: 'v1' },
    [version('home')]: { nodes: packed(tree('Home')), updatedAt: SAVED },
    [page('about')]: { displayName: 'About', slug: 'about', versionId: 'v1' },
    [version('about')]: { nodes: packed(tree('Old about')), updatedAt: SAVED },
    [draft('about')]: { nodes: packed(tree('New about')), baseStamp: SAVED_STAMP },
    [page('menu')]: { displayName: 'Menu', slug: 'menu', versionId: 'v1' },
    [version('menu')]: { nodes: packed(tree('Empty menu')), updatedAt: SAVED },
    [draft('menu')]: { nodes: packed(tree('Our menu')), baseStamp: SAVED_STAMP },
    [page('newsletter')]: { displayName: 'Newsletter', kind: 'email', versionId: 'v1' },
  })
})

function context(overrides: Partial<ApiV1Context> = {}): ApiV1Context {
  return {
    orgId: 'org-1',
    keyId: 'grant_1',
    keyName: 'Assistant',
    credential: 'connected_app',
    uid: MEMBER,
    scopes: ['sites:read', 'sites:publish'],
    org: { plan: 'pro', hosts: { [SITE]: true } } as ApiV1Context['org'],
    firestore: double.firestore,
    headers: { 'X-RateLimit-Limit': '120' },
    ...overrides,
  }
}

const apiKey = () => context({ credential: 'api_key', uid: undefined, keyName: 'Zapier' })

const publish = (ctx: ApiV1Context, body?: unknown) =>
  dispatchResource(
    new Request(`${ORIGIN}/api/v1/sites/${SITE}/publish`, {
      method: 'POST',
      ...(body !== undefined
        ? { body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } }
        : {}),
    }),
    ctx,
    ['sites', SITE, 'publish'],
  )

/** Nothing stored changed: both drafts are drafts, both versions as they were. */
function expectNothingWritten() {
  expect(double.writes).toEqual([])
  expect(storedTree(version('about'))).toEqual(tree('Old about'))
  expect(double.read(draft('about'))).toBeDefined()
  expect(double.read(draft('menu'))).toBeDefined()
}

describe('POST /v1/sites/{siteId}/publish with pages: who may (AGL-4235)', () => {
  it('needs sites:publish', async () => {
    const response = await publish(context({ scopes: ['sites:read'] }), { pages: ['about'] })
    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatchObject({ type: 'insufficient_scope', code: 'sites:publish' })
    expectNothingWritten()
    expect(mockRateCalls).toEqual([])
  })

  it('refuses a connected app whose person may edit the site but not publish it', async () => {
    double.read(HOST)!['memberRoles'] = { [MEMBER]: 'author' }
    const response = await publish(context(), { pages: ['about'] })
    expect(response.status).toBe(403)
    expect((await response.json()).error).toEqual({
      type: 'forbidden',
      code: 'site_permission_required',
      message: siteKeyRefusal('site.publish'),
    })
    expectNothingWritten()
    expect(mockRateCalls).toEqual([])
    // The same person may still refresh what was saved, as before.
    expect((await publish(context())).status).toBe(200)
  })

  it('lets an API key through: it has no person to ask about', async () => {
    const response = await publish(apiKey(), { pages: ['about'] })
    expect(response.status).toBe(200)
    expect(storedTree(version('about'))).toEqual(tree('New about'))
    const activity = [...double.docs.entries()].filter(([path]) => path.startsWith(`${HOST}/activity/`)).map(([, row]) => row)
    expect(activity).toEqual([expect.objectContaining({ action: 'Published the screen', actorId: 'api', apiKeyName: 'Zapier' })])
  })
})

describe('POST /v1/sites/{siteId}/publish with pages: the body (AGL-4235)', () => {
  it('names an unknown member beside pages', async () => {
    const response = await publish(context(), { pages: ['about'], force: true })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatchObject({ code: 'validation_failed', fields: { force: expect.any(String) } })
    expectNothingWritten()
  })

  it('refuses more than 25 pages, none, and a page named twice', async () => {
    for (const pages of [Array.from({ length: 26 }, (_, n) => `p${n}`), [], ['about', 'about'], 'about', [7]]) {
      const response = await publish(context(), { pages })
      expect({ pages, status: response.status }).toEqual({ pages, status: 400 })
      expect((await response.json()).error.fields).toHaveProperty('pages')
    }
    expectNothingWritten()
    expect(mockRateCalls).toEqual([])
  })

  it('refuses a body that is not JSON', async () => {
    expect((await publish(context(), '{not json')).status).toBe(400)
  })
})

describe('POST /v1/sites/{siteId}/publish with pages: all or nothing (AGL-4235)', () => {
  it('writes nothing when one page among several is refused, and lists every page', async () => {
    const response = await publish(context(), { pages: ['about', 'newsletter', 'menu'] })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toMatchObject({ type: 'bad_request', code: 'not_a_page' })
    expect(body.results).toEqual([
      { page: 'about', status: 'not_attempted' },
      { page: 'newsletter', status: 'refused', code: 'not_a_page', message: expect.any(String) },
      { page: 'menu', status: 'not_attempted' },
    ])
    expectNothingWritten()
    expect(mockRateCalls).toEqual([])
    expect(mockRevalidate).toEqual([])
  })

  it('answers 429 with the budget spent, and writes nothing', async () => {
    mockRateRefuse = true
    const response = await publish(context(), { pages: ['about'] })
    expect(response.status).toBe(429)
    expectNothingWritten()
    expect(mockRevalidate).toEqual([])
  })
})

describe('POST /v1/sites/{siteId}/publish with pages: success (AGL-4235)', () => {
  it('puts each page’s draft live, lists it in promoted, and still refreshes the site', async () => {
    const response = await publish(context(), { pages: ['about', 'menu', 'home'] })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ object: 'publish', site: SITE, published: true })
    expect(body.promoted).toEqual([
      { page: 'about', status: 'published', path: '/about' },
      { page: 'menu', status: 'published', path: '/menu' },
      { page: 'home', status: 'unchanged', path: '/' },
    ])
    expect(storedTree(version('about'))).toEqual(tree('New about'))
    expect(storedTree(version('menu'))).toEqual(tree('Our menu'))
    expect(double.read(draft('about'))).toBeUndefined()
    // `menu` had no address: it has one now, and the refresh read the map the publish left.
    expect((double.read(HOST)?.['screens'] as Record<string, string>)['menu']).toBe('menu')
    expect(mockRevalidate).toEqual([{ hostId: SITE, paths: expect.arrayContaining(['/', '/about', '/menu']) }])
    expect(mockRateCalls).toEqual([`apiv1-publish:${SITE}`])
  })

  it('without a body behaves as it always did: a refresh, nothing written, no promoted list', async () => {
    const response = await publish(context())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).not.toHaveProperty('promoted')
    expect(double.writes).toEqual([])
    expect(mockRevalidate).toEqual([{ hostId: SITE, paths: expect.arrayContaining(['/', '/about']) }])
    // An empty object, or one without `pages`, is the same request.
    for (const empty of [{}, { note: 'x' }]) {
      const again = await publish(context(), empty)
      expect(again.status).toBe(200)
      expect(await again.json()).not.toHaveProperty('promoted')
    }
    expect(double.writes).toEqual([])
  })
})
