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
 * A SITE'S SEARCH LISTING OVER THE PUBLIC API (AGL-4235).
 *
 * `GET` and `PATCH /v1/sites/{siteId}/seo` through the real router, against
 * an in-memory data layer: the scopes, the person's `site.edit`, Setup →
 * SEO's own limits, the card's clear rule, and the cache drop a settings
 * save owes.
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

const dropCache = jest.fn<Promise<PluginSiteCacheResult>, [PluginSiteCacheRequest]>(async () => ({ dropped: 1, skipped: 0, complete: true }))
beforeAll(() => registerPluginSiteCache({ drop: dropCache }, { pluginId: 'api-v1-site-seo-spec' }))

let double: ReturnType<typeof settingsFirestoreDouble>
beforeEach(() => {
  dropCache.mockClear()
  double = settingsFirestoreDouble({
    [HOST]: {
      displayName: 'Bakery',
      subdomain: 'bakery',
      memberRoles: { [MEMBER]: 'admin' },
      seo: { title: 'Bakery', description: 'Fresh bread', separator: '|', titlePattern: '{{page.name}}', image: 'https://cdn.example.com/a.png', discourageSearchEngines: false },
    },
  })
})

function context(overrides: Partial<ApiV1Context> = {}): ApiV1Context {
  return {
    orgId: 'org-1',
    keyId: 'grant_1',
    keyName: 'Assistant',
    credential: 'connected_app',
    uid: MEMBER,
    scopes: ['seo:read', 'seo:write'],
    org: { plan: 'pro', hosts: { [SITE]: true } } as ApiV1Context['org'],
    firestore: double.firestore,
    headers: { 'X-RateLimit-Limit': '120' },
    ...overrides,
  }
}

const call = (ctx: ApiV1Context, method = 'GET', body?: unknown) =>
  dispatchResource(
    new Request(`${ORIGIN}/api/v1/sites/${SITE}/seo`, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
    }),
    ctx,
    ['sites', SITE, 'seo'],
  )

const stored = () => double.read(HOST)?.['seo'] as Record<string, unknown>

describe('GET /v1/sites/{siteId}/seo (AGL-4235)', () => {
  it('needs seo:read', async () => {
    const response = await call(context({ scopes: ['seo:write'] }))
    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatchObject({ type: 'insufficient_scope', code: 'seo:read' })
  })

  it('returns the four fields and, read-only, the social image', async () => {
    const response = await call(context({ scopes: ['seo:read'] }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      object: 'site_seo',
      site: SITE,
      title: 'Bakery',
      description: 'Fresh bread',
      separator: '|',
      titlePattern: '{{page.name}}',
      image: 'https://cdn.example.com/a.png',
      imageAlt: null,
    })
  })

  it('answers any other method with 405', async () => {
    expect((await call(context(), 'POST', {})).status).toBe(405)
  })
})

describe('PATCH /v1/sites/{siteId}/seo (AGL-4235)', () => {
  it('needs seo:write', async () => {
    const response = await call(context({ scopes: ['seo:read'] }), 'PATCH', { title: 'X' })
    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatchObject({ type: 'insufficient_scope', code: 'seo:write' })
    expect(double.writes).toEqual([])
  })

  it('refuses a connected app whose person may not edit the site', async () => {
    double.read(HOST)!['memberRoles'] = { [MEMBER]: 'viewer' }
    const response = await call(context(), 'PATCH', { title: 'X' })
    expect(response.status).toBe(403)
    expect((await response.json()).error).toEqual({ type: 'forbidden', code: 'site_permission_required', message: siteKeyRefusal('site.edit') })
    expect(double.writes).toEqual([])
  })

  it('lets an API key write: there is no person behind it to ask', async () => {
    double.read(HOST)!['memberRoles'] = {}
    const response = await call(context({ credential: 'api_key', uid: undefined }), 'PATCH', { title: 'Bakery & Co' })
    expect(response.status).toBe(200)
    expect(stored()['title']).toBe('Bakery & Co')
  })

  it('names an unknown member in a 400, and writes nothing', async () => {
    const response = await call(context(), 'PATCH', { title: 'X', discourageSearchEngines: true })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatchObject({
      code: 'validation_failed',
      fields: { discourageSearchEngines: 'Not writable on a site’s search listing' },
    })
    expect(double.writes).toEqual([])
  })

  it('holds the title to 60 and the description to 155, at the boundary', async () => {
    expect((await call(context(), 'PATCH', { title: 't'.repeat(60), description: 'd'.repeat(155) })).status).toBe(200)
    expect(stored()).toMatchObject({ title: 't'.repeat(60), description: 'd'.repeat(155) })

    const over = await call(context(), 'PATCH', { title: 't'.repeat(61), description: 'd'.repeat(156) })
    expect(over.status).toBe(400)
    expect((await over.json()).error.fields).toEqual({
      title: 'Must be 60 characters or fewer',
      description: 'Must be 155 characters or fewer',
    })
  })

  it('clears the title pattern with "" or null by removing it, never storing it blank', async () => {
    for (const cleared of ['', null]) {
      stored()['titlePattern'] = '{{page.name}}'
      const response = await call(context(), 'PATCH', { titlePattern: cleared })
      expect(response.status).toBe(200)
      expect(stored()).not.toHaveProperty('titlePattern')
      expect((await response.json()).titlePattern).toBeNull()
    }
  })

  it('refuses emptying the title, description or separator, which Setup → SEO requires', async () => {
    const response = await call(context(), 'PATCH', { title: '', separator: null })
    expect(response.status).toBe(400)
    expect((await response.json()).error.fields).toEqual({
      title: 'Required: it cannot be emptied',
      separator: 'Required: it cannot be emptied',
    })
    expect(stored()).toMatchObject({ title: 'Bakery', separator: '|' })
  })

  it('records a site-wide outbox entry with the write, drops the site’s pages, and releases the entry', async () => {
    const response = await call(context(), 'PATCH', { description: 'Sourdough daily' })
    expect(response.status).toBe(200)
    const entry = double.writes.find((write) => write.op === 'set' && write.path.startsWith('publishOutbox/'))
    expect(entry?.data).toMatchObject({ hostId: SITE, paths: ['/'], entireHost: true, attempts: 0 })
    expect(dropCache).toHaveBeenCalledWith(expect.objectContaining({ hostIds: [SITE] }))
    expect(double.writes.at(-1)).toEqual({ op: 'delete', path: entry?.path })
    // Nothing else on `seo` moved.
    expect(stored()).toMatchObject({ discourageSearchEngines: false, image: 'https://cdn.example.com/a.png' })
  })

  it('writes and announces nothing when nothing differs', async () => {
    const response = await call(context(), 'PATCH', { title: 'Bakery' })
    expect(response.status).toBe(200)
    expect(double.writes).toEqual([])
    expect(dropCache).not.toHaveBeenCalled()
  })
})
