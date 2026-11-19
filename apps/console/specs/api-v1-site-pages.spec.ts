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
 * A SITE'S PAGES AND EACH PAGE'S SEARCH LISTING OVER THE PUBLIC API
 * (AGL-4235).
 *
 * `GET /v1/sites/{siteId}/pages`, `GET …/pages/{pageId}` and
 * `PATCH …/pages/{pageId}/seo` through the real router, against an
 * in-memory data layer.
 */

import { siteKeyRefusal } from '@aglyn/aglyn/app-utils/host-permissions'
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

const dropCache = jest.fn<Promise<PluginSiteCacheResult>, [PluginSiteCacheRequest]>(async () => ({ dropped: 1, skipped: 0, complete: true }))
beforeAll(() => registerPluginSiteCache({ drop: dropCache }, { pluginId: 'api-v1-site-pages-spec' }))

let double: ReturnType<typeof settingsFirestoreDouble>
beforeEach(() => {
  dropCache.mockClear()
  double = settingsFirestoreDouble({
    [HOST]: {
      displayName: 'Bakery',
      subdomain: 'bakery',
      memberRoles: { [MEMBER]: 'admin' },
      screens: { home: '/', about: 'company/about' },
    },
    [page('about')]: {
      displayName: 'About',
      kind: 'page',
      parentId: 'company',
      order: 2,
      seo: { title: 'About us', breadcrumb: 'About', imageWidth: 1200 },
    },
    [page('draft')]: { displayName: 'Draft', kind: 'page' },
    [page('gone')]: { displayName: 'Gone', kind: 'page', deletedAt: new Date('2026-11-01T00:00:00Z') },
    [page('group')]: { displayName: 'Company', kind: 'group' },
    [page('home')]: { displayName: 'Home' },
    [page('newsletter')]: { displayName: 'Newsletter', kind: 'email' },
    [page('not-found')]: { displayName: 'Not found', kind: 'error' },
    [page('post')]: { displayName: 'Post template', kind: 'template' },
  })
})

function context(overrides: Partial<ApiV1Context> = {}): ApiV1Context {
  return {
    orgId: 'org-1',
    keyId: 'grant_1',
    keyName: 'Assistant',
    credential: 'connected_app',
    uid: MEMBER,
    scopes: ['pages:read', 'seo:write'],
    org: { plan: 'pro', hosts: { [SITE]: true } } as ApiV1Context['org'],
    firestore: double.firestore,
    headers: { 'X-RateLimit-Limit': '120' },
    ...overrides,
  }
}

const call = (ctx: ApiV1Context, path: string, method = 'GET', body?: unknown) =>
  dispatchResource(
    new Request(`${ORIGIN}/api/v1/sites/${SITE}/${path}`, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
    }),
    ctx,
    ['sites', SITE, ...path.split('?')[0].split('/')],
  )

describe('GET /v1/sites/{siteId}/pages (AGL-4235)', () => {
  it('needs pages:read', async () => {
    const response = await call(context({ scopes: ['seo:write'] }), 'pages')
    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatchObject({ type: 'insufficient_scope', code: 'pages:read' })
  })

  it('lists the pages and the folders they sit in, hiding deleted pages and the kinds that are not pages', async () => {
    const response = await call(context({ scopes: ['pages:read'] }), 'pages')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.map((one: { id: string }) => one.id)).toEqual(['about', 'draft', 'group', 'home'])
    expect(body.has_more).toBe(false)
  })

  it('lists a folder as kind group, with no address (AGL-4235)', async () => {
    const { data } = await (await call(context(), 'pages')).json()
    expect(data.find((one: { id: string }) => one.id === 'group')).toMatchObject({
      id: 'group',
      object: 'page',
      name: 'Company',
      kind: 'group',
      path: null,
      published: false,
    })
  })

  it('reports published and path from the routing map', async () => {
    const { data } = await (await call(context(), 'pages')).json()
    const byId = Object.fromEntries(data.map((one: { id: string }) => [one.id, one]))
    expect(byId['about']).toEqual({
      id: 'about',
      object: 'page',
      name: 'About',
      kind: 'page',
      parentId: 'company',
      order: 2,
      path: '/company/about',
      published: true,
      seo: { title: 'About us', description: null, breadcrumb: 'About', image: null, imageAlt: null },
      created: null,
      updated: null,
    })
    expect(byId['home']).toMatchObject({ path: '/', published: true, kind: 'page' })
    expect(byId['draft']).toMatchObject({ path: null, published: false })
  })

  it('pages like every list', async () => {
    const first = await (await call(context(), 'pages?limit=1')).json()
    expect(first.data).toHaveLength(1)
    expect(first.has_more).toBe(true)
  })
})

describe('GET /v1/sites/{siteId}/pages/{pageId} (AGL-4235)', () => {
  it('returns one page, and no page content', async () => {
    const response = await call(context(), 'pages/about')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ id: 'about', path: '/company/about' })
    expect(body).not.toHaveProperty('nodes')
  })

  it('returns a folder, as kind group with no address (AGL-4235)', async () => {
    const response = await call(context(), 'pages/group')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: 'group', kind: 'group', path: null, published: false })
  })

  it('answers a deleted page, or one that is not a page or a folder, as No such page', async () => {
    for (const id of ['gone', 'newsletter', 'not-found', 'post', 'nothing']) {
      const response = await call(context(), `pages/${id}`)
      expect(response.status).toBe(404)
      expect((await response.json()).error.message).toBe('No such page')
    }
  })
})

describe('PATCH /v1/sites/{siteId}/pages/{pageId}/seo (AGL-4235)', () => {
  const seoOf = (id: string) => double.read(page(id))?.['seo'] as Record<string, unknown> | undefined

  it('needs seo:write', async () => {
    const response = await call(context({ scopes: ['pages:read', 'seo:read'] }), 'pages/about/seo', 'PATCH', { title: 'X' })
    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatchObject({ type: 'insufficient_scope', code: 'seo:write' })
    expect(double.writes).toEqual([])
  })

  it('refuses a connected app whose person may not edit the site', async () => {
    double.read(HOST)!['memberRoles'] = { [MEMBER]: 'viewer' }
    const response = await call(context(), 'pages/about/seo', 'PATCH', { title: 'X' })
    expect(response.status).toBe(403)
    expect((await response.json()).error).toEqual({ type: 'forbidden', code: 'site_permission_required', message: siteKeyRefusal('site.edit') })
    expect(double.writes).toEqual([])
  })

  it('lets an API key write', async () => {
    double.read(HOST)!['memberRoles'] = {}
    const response = await call(context({ credential: 'api_key', uid: undefined }), 'pages/about/seo', 'PATCH', { title: 'Our story' })
    expect(response.status).toBe(200)
    expect(seoOf('about')?.['title']).toBe('Our story')
  })

  it('names an unknown member in a 400', async () => {
    const response = await call(context(), 'pages/about/seo', 'PATCH', { title: 'X', image: 'https://cdn.example.com/b.png' })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatchObject({
      code: 'validation_failed',
      fields: { image: 'Not writable on a page’s search listing' },
    })
    expect(double.writes).toEqual([])
  })

  it('holds the title to 60 and the description to 155, hard, at the boundary', async () => {
    expect((await call(context(), 'pages/about/seo', 'PATCH', { title: 't'.repeat(60), description: 'd'.repeat(155) })).status).toBe(200)
    const over = await call(context(), 'pages/about/seo', 'PATCH', { title: 't'.repeat(61), description: 'd'.repeat(156) })
    expect(over.status).toBe(400)
    expect((await over.json()).error.fields).toEqual({
      title: 'Must be 60 characters or fewer',
      description: 'Must be 155 characters or fewer',
    })
  })

  it('clears with "" and with null by removing the member, never storing it blank', async () => {
    expect((await call(context(), 'pages/about/seo', 'PATCH', { title: '' })).status).toBe(200)
    expect(seoOf('about')).not.toHaveProperty('title')
    expect((await call(context(), 'pages/about/seo', 'PATCH', { breadcrumb: null })).status).toBe(200)
    expect(seoOf('about')).not.toHaveProperty('breadcrumb')
  })

  it('carries untouched keys forward and never invents the image keys', async () => {
    const response = await call(context(), 'pages/draft/seo', 'PATCH', { description: 'Coming soon' })
    expect(response.status).toBe(200)
    expect(seoOf('draft')).toEqual({ description: 'Coming soon' })

    await call(context(), 'pages/about/seo', 'PATCH', { description: 'Who we are' })
    expect(seoOf('about')).toEqual({ title: 'About us', breadcrumb: 'About', imageWidth: 1200, description: 'Who we are' })
  })

  it('records an outbox entry for a published page and drops only its address', async () => {
    const response = await call(context(), 'pages/about/seo', 'PATCH', { description: 'Who we are' })
    expect(response.status).toBe(200)
    expect((await response.json())).toMatchObject({ id: 'about', path: '/company/about', seo: { description: 'Who we are' } })
    const entry = double.writes.find((write) => write.op === 'set' && write.path.startsWith('publishOutbox/'))
    expect(entry?.data).toMatchObject({ hostId: SITE, paths: ['/company/about'], attempts: 0 })
    expect(entry?.data).not.toHaveProperty('entireHost')
    expect(dropCache).toHaveBeenCalledWith(expect.objectContaining({ hostIds: [SITE], paths: { [SITE]: ['/company/about'] } }))
  })

  it('owes no announce for a page with no public address', async () => {
    expect((await call(context(), 'pages/draft/seo', 'PATCH', { title: 'Draft' })).status).toBe(200)
    expect(double.outbox()).toEqual([])
    expect(dropCache).not.toHaveBeenCalled()
  })

  it('answers a page that is gone or not a page as No such page, writing nothing', async () => {
    // A folder is listed with the pages, and still has no search listing.
    for (const id of ['gone', 'newsletter', 'group', 'nothing']) {
      const response = await call(context(), `pages/${id}/seo`, 'PATCH', { title: 'X' })
      expect(response.status).toBe(404)
    }
    expect(double.writes).toEqual([])
  })

  it('answers only PATCH on a page’s search listing', async () => {
    expect((await call(context(), 'pages/about/seo')).status).toBe(405)
    expect((await call(context(), 'pages/about', 'PUT', {})).status).toBe(405)
  })

  it('hands a page’s content to its own module, which is not built yet (AGL-4235)', async () => {
    for (const [path, method] of [
      ['pages/about/content', 'GET'],
      ['pages/about/content/edits', 'POST'],
    ] as const) {
      const response = await call(context(), path, method, method === 'GET' ? undefined : {})
      expect({ path, method, status: response.status }).toEqual({ path, method, status: 501 })
      expect((await response.json()).error).toMatchObject({ type: 'not_implemented', message: 'Not available yet' })
    }
    expect(double.writes).toEqual([])
  })

  it('hands the page writes to their own module, which asks its own scope (AGL-4235)', async () => {
    for (const [path, method] of [
      ['pages', 'POST'],
      ['pages/about', 'PATCH'],
      ['pages/about', 'DELETE'],
    ] as const) {
      const response = await call(context(), path, method, method === 'DELETE' ? undefined : {})
      expect({ path, method, status: response.status }).toEqual({ path, method, status: 403 })
      expect((await response.json()).error).toMatchObject({ type: 'insufficient_scope', code: 'pages:write' })
    }
    expect(double.writes).toEqual([])
  })
})
