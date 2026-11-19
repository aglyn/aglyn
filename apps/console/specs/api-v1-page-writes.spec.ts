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
 * ADDING, CHANGING AND REMOVING A SITE'S PAGES OVER THE PUBLIC API (AGL-4235).
 *
 * `POST /v1/sites/{siteId}/pages`, `PATCH …/pages/{pageId}` and
 * `DELETE …/pages/{pageId}` through the real router, against an in-memory
 * data layer.
 */

import { siteKeyRefusal } from '@aglyn/aglyn/app-utils/host-permissions'
import { STARTER_TEMPLATES, starterTemplateDocId } from '@aglyn/aglyn/app-utils/starter-templates'
import { decodeStoredNodes, encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import {
  type PluginSiteCacheRequest,
  type PluginSiteCacheResult,
  registerPluginSiteCache,
} from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import type { ApiScope } from '@aglyn/tenant-data-admin/server/api-keys'
import type { ApiV1Context } from '@aglyn/tenant-data-admin/server/api-v1-kit'
import { settingsFirestoreDouble } from '@aglyn/tenant-data-admin/testing/settings-firestore-double'
import { dispatchResource } from '../utils/api-v1-resources'

const ORIGIN = 'https://app.example.com'
const SITE = 'site-1'
const MEMBER = 'user-member'
const HOST = `hosts/${SITE}`
const page = (id: string) => `${HOST}/screens/${id}`
const ALL: ApiScope[] = ['pages:read', 'pages:write', 'sites:publish']
const ROUTES = { company: 'company', about: 'company/about', pricing: 'pricing' }

const dropCache = jest.fn<Promise<PluginSiteCacheResult>, [PluginSiteCacheRequest]>(async () => ({ dropped: 1, skipped: 0, complete: true }))
beforeAll(() => registerPluginSiteCache({ drop: dropCache }, { pluginId: 'api-v1-page-writes-spec' }))

let double: ReturnType<typeof settingsFirestoreDouble>
beforeEach(() => {
  dropCache.mockClear()
  double = settingsFirestoreDouble({
    [HOST]: {
      displayName: 'Bakery',
      memberRoles: { [MEMBER]: 'admin' },
      screens: { ...ROUTES },
    },
    [page('company')]: { displayName: 'Company', kind: 'page', slug: 'company', order: 0 },
    [page('about')]: { displayName: 'About', kind: 'page', slug: 'about', parentId: 'company', order: 0, publishedAt: 'then' },
    [page('careers')]: { displayName: 'Careers', kind: 'page', slug: 'careers', parentId: 'company', order: 1 },
    [page('draft')]: { displayName: 'Draft', kind: 'page', slug: 'draft', order: 1 },
    [page('team')]: { displayName: 'Team', kind: 'group', order: 2 },
    [page('pricing')]: { displayName: 'Pricing', kind: 'page', slug: 'pricing', order: 3 },
    [page('gone')]: { displayName: 'Gone', kind: 'page', deletedAt: new Date('2026-11-01T00:00:00Z') },
    [page('newsletter')]: { displayName: 'Newsletter', kind: 'email' },
    [page('not-found')]: { displayName: 'Not found', kind: 'error' },
    [page('post')]: { displayName: 'Post template', kind: 'template' },
    [`${HOST}/templates/landing`]: {
      kind: 'page',
      displayName: 'Landing',
      description: 'A landing page',
      slug: 'landing',
      seo: { title: 'Welcome' },
      nodes: encodeStoredNodes({ _: { $id: '_', componentId: 'div', nodes: [], props: { text: 'Hi {{business}} in {{city}}' } } }),
      placeholders: [{ name: 'business', defaultValue: 'Acme' }, { name: 'city' }],
      source: { type: 'authored' },
    },
    [`${HOST}/templates/card`]: { kind: 'component', displayName: 'Card', source: { type: 'authored' } },
  })
})

function context(overrides: Partial<ApiV1Context> = {}): ApiV1Context {
  return {
    orgId: 'org-1',
    keyId: 'grant_1',
    keyName: 'Assistant',
    credential: 'connected_app',
    uid: MEMBER,
    scopes: ALL,
    org: { plan: 'pro', hosts: { [SITE]: true } } as ApiV1Context['org'],
    firestore: double.firestore,
    headers: { 'X-RateLimit-Limit': '120' },
    ...overrides,
  }
}

const apiKey = (overrides: Partial<ApiV1Context> = {}) => context({ credential: 'api_key', uid: undefined, keyName: 'Sync', ...overrides })

const call = (ctx: ApiV1Context, path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  dispatchResource(
    new Request(`${ORIGIN}/api/v1/sites/${SITE}/${path}`, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      headers: { 'content-type': 'application/json', ...headers },
    }),
    ctx,
    ['sites', SITE, ...path.split('?')[0].split('/')],
  )

/** The person may edit the site's content but not publish it. */
const editorOnly = () => {
  double.read(HOST)!['memberPermissions'] = { [MEMBER]: { 'site.edit': true, 'site.publish': false } }
}

const routes = () => double.read(HOST)?.['screens']
const created = () => [...double.docs.keys()].filter((path) => /^hosts\/site-1\/screens\/[^/]+$/.test(path) && !Object.keys(seeded).includes(path))
const seeded: Record<string, true> = {}
beforeEach(() => {
  for (const key of Object.keys(seeded)) delete seeded[key]
  for (const path of double.docs.keys()) seeded[path] = true
})

describe('every page write (AGL-4235)', () => {
  it('needs pages:write', async () => {
    for (const [path, method, body] of [
      ['pages', 'POST', { name: 'New' }],
      ['pages/draft', 'PATCH', { name: 'X' }],
      ['pages/draft', 'DELETE', undefined],
    ] as const) {
      const response = await call(context({ scopes: ['pages:read', 'sites:publish'] }), path, method, body)
      expect({ path, method, status: response.status }).toEqual({ path, method, status: 403 })
      expect((await response.json()).error).toMatchObject({ type: 'insufficient_scope', code: 'pages:write' })
    }
    expect(double.writes).toEqual([])
  })
})

describe('POST /v1/sites/{siteId}/pages (AGL-4235)', () => {
  it('creates a blank page, unpublished, with no routing entry', async () => {
    const response = await call(context(), 'pages', 'POST', { name: 'Our menu', description: 'What we bake' })
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body).toMatchObject({ object: 'page', name: 'Our menu', kind: 'page', published: false, path: null, parentId: null })
    const stored = double.read(page(body.id))
    expect(stored).toEqual(expect.objectContaining({ displayName: 'Our menu', description: 'What we bake', slug: 'our-menu', createdBy: MEMBER }))
    expect(stored).not.toHaveProperty('publishedAt')
    expect(routes()).toEqual(ROUTES)
    expect(double.outbox()).toEqual([])
    const row = [...double.docs.entries()].find(([path]) => path.startsWith(`${HOST}/activity/`))?.[1]
    expect(row).toMatchObject({ actorId: MEMBER, connectedAppName: 'Assistant', action: 'Created screen' })
  })

  it('creates from a page template with its placeholders filled, defaults standing in, and publishes nothing', async () => {
    const response = await call(context(), 'pages', 'POST', { name: 'Welcome', templateId: 'landing', placeholders: { city: 'Austin' } })
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body).toMatchObject({ published: false, path: null, seo: { title: 'Welcome' } })
    const stored = double.read(page(body.id)) as Record<string, unknown>
    expect(stored).toEqual(expect.objectContaining({ description: 'A landing page', slug: 'landing' }))
    const version = double.read(`${page(body.id)}/versions/${stored['versionId']}`) as Record<string, unknown>
    expect(decodeStoredNodes<Record<string, { props: { text: string } }>>(version['nodes'])?.['_'].props.text).toBe('Hi Acme in Austin')
    expect(routes()).toEqual(ROUTES)
  })

  it('creates from a built-in starter page, without copying the starter into the site', async () => {
    const [starter] = STARTER_TEMPLATES
    const templateId = starterTemplateDocId(starter.id, starter.screens[0].key)
    const response = await call(apiKey(), 'pages', 'POST', { name: 'Start', templateId })
    expect(response.status).toBe(201)
    expect([...double.docs.keys()].filter((path) => path.startsWith(`${HOST}/templates/starter-`))).toEqual([])
    expect(routes()).toEqual(ROUTES)
  })

  it('refuses a template that is not a page template of the site, and a placeholder it does not ask for', async () => {
    for (const templateId of ['card', 'nothing']) {
      const response = await call(context(), 'pages', 'POST', { name: 'X', templateId })
      expect(response.status).toBe(404)
      expect((await response.json()).error.message).toBe('No such template')
    }
    const response = await call(context(), 'pages', 'POST', { name: 'X', templateId: 'landing', placeholders: { phone: '1' } })
    expect(response.status).toBe(400)
    expect((await response.json()).error.fields).toEqual({ 'placeholders.phone': 'This template has no such placeholder' })
    expect(created()).toEqual([])
  })

  it('names an unknown member, a missing name, a bad slug and placeholders without a template, in one 400', async () => {
    const response = await call(context(), 'pages', 'POST', { slug: 'a/b', placeholders: {}, published: true })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatchObject({
      code: 'validation_failed',
      fields: {
        published: 'Not writable on a page',
        name: 'Required',
        slug: expect.stringContaining('/'),
        placeholders: 'Only with templateId',
      },
    })
    const reserved = await call(context(), 'pages', 'POST', { name: 'Search', slug: 'search' })
    expect(reserved.status).toBe(400)
    expect(Object.keys((await reserved.json()).error.fields)).toEqual(['slug'])
    expect(double.writes).toEqual([])
  })

  it('refuses a connected app whose person may not edit the site; an API key passes', async () => {
    double.read(HOST)!['memberRoles'] = { [MEMBER]: 'viewer' }
    const refused = await call(context(), 'pages', 'POST', { name: 'X' })
    expect(refused.status).toBe(403)
    expect((await refused.json()).error).toEqual({ type: 'forbidden', code: 'site_permission_required', message: siteKeyRefusal('site.edit') })
    expect((await call(apiKey(), 'pages', 'POST', { name: 'X' })).status).toBe(201)
  })

  it('needs no sites:publish, because the page is not published', async () => {
    expect((await call(context({ scopes: ['pages:write'] }), 'pages', 'POST', { name: 'X' })).status).toBe(201)
  })

  it('refuses past the plan’s page allowance with a stable code', async () => {
    const full = context({ org: { plan: 'free', hosts: { [SITE]: true }, entitlements: { screensPerHost: 3 } } as ApiV1Context['org'] })
    const response = await call(full, 'pages', 'POST', { name: 'One more' })
    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatchObject({ type: 'plan_required', code: 'page_quota' })
    expect(created()).toEqual([])
  })

  it('replays the same Idempotency-Key with the page it made, and makes no second', async () => {
    const key = { 'Idempotency-Key': 'create-once' }
    const first = await call(context(), 'pages', 'POST', { name: 'Once' }, key)
    expect(first.status).toBe(201)
    const again = await call(context(), 'pages', 'POST', { name: 'Once' }, key)
    expect(again.status).toBe(200)
    expect((await again.json()).id).toBe((await first.json()).id)
    expect(created()).toHaveLength(1)
  })
})

describe('PATCH /v1/sites/{siteId}/pages/{pageId} (AGL-4235)', () => {
  it('renames an unpublished page and announces nothing', async () => {
    const response = await call(context({ scopes: ['pages:write'] }), 'pages/draft', 'PATCH', { name: 'Coming soon', description: null })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: 'draft', name: 'Coming soon', published: false })
    expect(double.read(page('draft'))).toEqual(expect.objectContaining({ displayName: 'Coming soon', description: '' }))
    expect(double.outbox()).toEqual([])
    expect(dropCache).not.toHaveBeenCalled()
  })

  it('renames a published page and announces it at its address', async () => {
    const response = await call(context(), 'pages/pricing', 'PATCH', { name: 'Prices' })
    expect(response.status).toBe(200)
    const entry = double.writes.find((write) => write.op === 'set' && write.path.startsWith('publishOutbox/'))
    expect(entry?.data).toMatchObject({ hostId: SITE, paths: ['/pricing'], attempts: 0 })
    expect(dropCache).toHaveBeenCalledWith(expect.objectContaining({ paths: { [SITE]: ['/pricing'] } }))
  })

  it('lets a person who may edit but not publish rename an unpublished page, and nothing that needs publishing', async () => {
    editorOnly()
    expect((await call(context(), 'pages/draft', 'PATCH', { name: 'Renamed' })).status).toBe(200)
    const before = double.writes.length
    for (const body of [{ slug: 'soon' }, { parentId: 'team' }, { index: 0 }, { name: 'Y', slug: 'soon' }]) {
      const response = await call(context(), 'pages/draft', 'PATCH', body)
      expect({ body, status: response.status }).toEqual({ body, status: 403 })
      expect((await response.json()).error).toMatchObject({ code: 'site_permission_required', message: siteKeyRefusal('site.publish') })
    }
    expect((await call(context(), 'pages/draft', 'DELETE')).status).toBe(403)
    expect(double.writes).toHaveLength(before)
    // An API key has no person to ask.
    expect((await call(apiKey(), 'pages/draft', 'PATCH', { slug: 'soon' })).status).toBe(200)
  })

  it('needs sites:publish for every kind of change to a published page, and for none to an unpublished one', async () => {
    const unpublishing = context({ scopes: ['pages:read', 'pages:write'] })
    for (const body of [{ name: 'X' }, { description: 'X' }, { slug: 'prices' }, { parentId: 'team' }, { index: 0 }]) {
      const response = await call(unpublishing, 'pages/pricing', 'PATCH', body)
      expect({ body, status: response.status }).toEqual({ body, status: 403 })
      expect((await response.json()).error).toMatchObject({ type: 'insufficient_scope', code: 'sites:publish' })
    }
    expect((await call(unpublishing, 'pages/pricing', 'DELETE')).status).toBe(403)
    expect(double.writes).toEqual([])
    for (const body of [{ name: 'X' }, { description: 'X' }, { slug: 'later' }, { parentId: 'team' }, { index: 0 }]) {
      expect({ body, status: (await call(unpublishing, 'pages/draft', 'PATCH', body)).status }).toEqual({ body, status: 200 })
    }
  })

  it('needs sites:publish for an unpublished page’s change that re-addresses a published page below it', async () => {
    // `company` loses its route; its live child `about` still composes under it.
    double.read(HOST)!['screens'] = { about: 'company/about' }
    const response = await call(context({ scopes: ['pages:write'] }), 'pages/company', 'PATCH', { slug: 'us' })
    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatchObject({ code: 'sites:publish' })
    expect(double.writes).toEqual([])
    expect((await call(context(), 'pages/company', 'PATCH', { slug: 'us' })).status).toBe(200)
    expect(routes()).toEqual({ about: 'us/about' })
  })

  it('re-addresses a published page with its live descendants, leaving publishedAt alone', async () => {
    const response = await call(context(), 'pages/company', 'PATCH', { slug: 'About Us' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: 'company', path: '/about-us', published: true })
    expect(routes()).toEqual({ company: 'about-us', about: 'about-us/about', pricing: 'pricing' })
    expect(double.read(page('about'))?.['publishedAt']).toBe('then')
    expect(double.read(page('company'))).not.toHaveProperty('publishedAt')
    expect(dropCache).toHaveBeenCalledWith(
      expect.objectContaining({ paths: { [SITE]: expect.arrayContaining(['/company', '/about-us', '/company/about', '/about-us/about']) } }),
    )
  })

  it('stores an unpublished page’s slug, and holds it to the slug rules', async () => {
    expect((await call(context(), 'pages/draft', 'PATCH', { slug: 'Coming Soon' })).status).toBe(200)
    expect(double.read(page('draft'))?.['slug']).toBe('coming-soon')
    expect(routes()).toEqual(ROUTES)
    const before = double.writes.length
    for (const [slug, status] of [['a/b', 400], ['search', 400], ['', 400], ['pricing', 409]] as const) {
      const response = await call(context(), 'pages/draft', 'PATCH', { slug })
      expect({ slug, status: response.status }).toEqual({ slug, status })
      expect((await response.json()).error.fields).toHaveProperty('slug')
    }
    expect(double.writes).toHaveLength(before)
  })

  it('refuses the whole change when any address in it is taken or reserved, writing nothing', async () => {
    const taken = await call(context(), 'pages/company', 'PATCH', { name: 'Renamed', slug: 'pricing' })
    expect(taken.status).toBe(409)
    expect((await taken.json()).error).toMatchObject({ type: 'conflict', code: 'address_taken' })
    // The page's own new address is free; its live child's is reserved: the
    // home page's children sit at the top level, and \`search\` is not servable there.
    double.read(HOST)!['screens'] = { ...ROUTES, docs: 'docs', search: 'docs/search' }
    double.docs.set(page('docs'), { kind: 'page', displayName: 'Docs', slug: 'docs' })
    double.docs.set(page('search'), { kind: 'page', displayName: 'Search', slug: 'search', parentId: 'docs' })
    const writes = double.writes.length
    const reserved = await call(context(), 'pages/docs', 'PATCH', { name: 'Home', slug: '/' })
    expect(reserved.status).toBe(400)
    expect((await reserved.json()).error.fields).toHaveProperty('slug')
    expect(double.writes).toHaveLength(writes)
    expect(double.read(page('docs'))?.['displayName']).toBe('Docs')
    expect(routes()).toEqual({ ...ROUTES, docs: 'docs', search: 'docs/search' })
    expect(double.read(page('company'))?.['displayName']).toBe('Company')
  })

  it('moves and reorders, and refuses a move into the page’s own descendant', async () => {
    expect((await call(context(), 'pages/pricing', 'PATCH', { parentId: 'team', index: 0 })).status).toBe(200)
    expect(double.read(page('pricing'))).toEqual(expect.objectContaining({ parentId: 'team', order: 0 }))
    expect(routes()).toEqual(ROUTES)
    const reorder = await call(context(), 'pages/careers', 'PATCH', { index: 0 })
    expect(await reorder.json()).toMatchObject({ order: 0, parentId: 'company' })
    expect(double.read(page('about'))?.['order']).toBe(1)
    const before = double.writes.length
    const cycle = await call(context(), 'pages/company', 'PATCH', { parentId: 'about' })
    expect(cycle.status).toBe(400)
    expect((await cycle.json()).error.fields).toEqual({ parentId: 'A page cannot move inside itself' })
    expect(double.writes).toHaveLength(before)
  })

  it('names an unknown member, and an empty body, in a 400', async () => {
    const unknown = await call(context(), 'pages/draft', 'PATCH', { name: 'X', kind: 'email' })
    expect(unknown.status).toBe(400)
    expect((await unknown.json()).error.fields).toEqual({ kind: 'Not writable on a page' })
    const empty = await call(context(), 'pages/draft', 'PATCH', {})
    expect(empty.status).toBe(400)
    expect(double.writes).toEqual([])
  })

  it('renames a folder, and gives it no address', async () => {
    expect((await call(context(), 'pages/team', 'PATCH', { name: 'People' })).status).toBe(200)
    expect(double.read(page('team'))?.['displayName']).toBe('People')
    expect((await call(context(), 'pages/team', 'PATCH', { slug: 'people' })).status).toBe(400)
  })

  it('answers an email design, an error page, an entry template, a deleted page or no page as No such page', async () => {
    for (const id of ['newsletter', 'not-found', 'post', 'gone', 'nothing']) {
      const response = await call(context(), `pages/${id}`, 'PATCH', { name: 'X' })
      expect({ id, status: response.status }).toEqual({ id, status: 404 })
      expect((await response.json()).error.message).toBe('No such page')
    }
    expect(double.writes).toEqual([])
  })
})

describe('DELETE /v1/sites/{siteId}/pages/{pageId} (AGL-4235)', () => {
  it('deletes softly, takes the address off the site, leaves the pages under it, and answers the same again', async () => {
    const response = await call(context(), 'pages/company', 'DELETE')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 'company', object: 'page', deleted: true })
    expect(double.read(page('company'))).toEqual(expect.objectContaining({ deletedAt: expect.anything() }))
    expect(routes()).toEqual({ about: 'company/about', pricing: 'pricing' })
    expect(double.read(page('about'))?.['parentId']).toBe('company')
    expect(dropCache).toHaveBeenCalledWith(expect.objectContaining({ paths: { [SITE]: ['/company'] } }))
    const writes = double.writes.length
    const again = await call(context(), 'pages/company', 'DELETE')
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ id: 'company', object: 'page', deleted: true })
    expect(double.writes).toHaveLength(writes)
  })

  it('deletes an unpublished page without sites:publish', async () => {
    expect((await call(context({ scopes: ['pages:write'] }), 'pages/draft', 'DELETE')).status).toBe(200)
  })

  it('does not delete a folder', async () => {
    const response = await call(context(), 'pages/team', 'DELETE')
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatchObject({ code: 'page_is_folder' })
    expect(double.writes).toEqual([])
  })

  it('answers a page that never existed, or is not a page, as No such page', async () => {
    for (const id of ['nothing', 'newsletter', 'not-found', 'post']) {
      expect({ id, status: (await call(context(), `pages/${id}`, 'DELETE')).status }).toEqual({ id, status: 404 })
    }
    expect(double.writes).toEqual([])
  })
})
