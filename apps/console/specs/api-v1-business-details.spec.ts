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
 * A SITE'S BUSINESS DETAILS OVER THE PUBLIC API (AGL-4235).
 *
 * `GET` and `PATCH /v1/sites/{siteId}/business` through the real router,
 * against an in-memory data layer: the scopes, the person's `site.edit`, the
 * Business details card's own limits, and the two copies the native apps
 * read moving exactly as the card moves them.
 */

import {
  BUSINESS_NAME_MAX_LENGTH,
  BUSINESS_PHONE_MAX_LENGTH,
  SITE_SLOGAN_MAX_LENGTH,
} from '@aglyn/aglyn/app-utils/business-details'
import { resolveHostToken } from '@aglyn/aglyn/app-utils/host-tokens'
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
beforeAll(() => registerPluginSiteCache({ drop: dropCache }, { pluginId: 'api-v1-business-details-spec' }))

let double: ReturnType<typeof settingsFirestoreDouble>
beforeEach(() => {
  dropCache.mockClear()
  double = settingsFirestoreDouble({
    [HOST]: {
      displayName: 'Bakery',
      subdomain: 'bakery',
      memberRoles: { [MEMBER]: 'admin' },
      seo: { entity: { name: 'Bakery Co', email: 'hello@example.com', description: 'Kept as it is' } },
      business: {
        supportEmail: 'hello@example.com',
        address: '9 Old Rd\nAustin',
        socialLinks: [{ label: 'Instagram', url: 'https://instagram.com/bakery' }],
      },
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
    scopes: ['business:read', 'business:write'],
    org: { plan: 'pro', hosts: { [SITE]: true } } as ApiV1Context['org'],
    firestore: double.firestore,
    headers: { 'X-RateLimit-Limit': '120' },
    ...overrides,
  }
}

const call = (ctx: ApiV1Context, method = 'GET', body?: unknown) =>
  dispatchResource(
    new Request(`${ORIGIN}/api/v1/sites/${SITE}/business`, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
    }),
    ctx,
    ['sites', SITE, 'business'],
  )

const host = () => double.read(HOST) as Record<string, any>

describe('GET /v1/sites/{siteId}/business (AGL-4235)', () => {
  it('needs business:read', async () => {
    const response = await call(context({ scopes: ['business:write'] }))
    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatchObject({ type: 'insufficient_scope', code: 'business:read' })
  })

  it('shows what the card shows', async () => {
    const response = await call(context({ scopes: ['business:read'] }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      object: 'business_details',
      site: SITE,
      name: 'Bakery Co',
      slogan: null,
      phone: null,
      email: 'hello@example.com',
      address: { street: null, city: null, region: null, postalCode: null, country: null },
      socialLinks: [{ label: 'Instagram', url: 'https://instagram.com/bakery' }],
    })
  })
})

describe('PATCH /v1/sites/{siteId}/business (AGL-4235)', () => {
  it('needs business:write', async () => {
    const response = await call(context({ scopes: ['business:read'] }), 'PATCH', { phone: '1' })
    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatchObject({ type: 'insufficient_scope', code: 'business:write' })
    expect(double.writes).toEqual([])
  })

  it('refuses a connected app whose person may not edit the site', async () => {
    host()['memberRoles'] = { [MEMBER]: 'viewer' }
    const response = await call(context(), 'PATCH', { phone: '+1 512-555-0100' })
    expect(response.status).toBe(403)
    expect((await response.json()).error).toEqual({ type: 'forbidden', code: 'site_permission_required', message: siteKeyRefusal('site.edit') })
    expect(double.writes).toEqual([])
  })

  it('lets an API key write', async () => {
    host()['memberRoles'] = {}
    const response = await call(context({ credential: 'api_key', uid: undefined }), 'PATCH', { phone: '+1 512-555-0100' })
    expect(response.status).toBe(200)
    expect(host()['seo']['entity']['telephone']).toBe('+1 512-555-0100')
  })

  it('names an unknown member in a 400, and writes nothing', async () => {
    const response = await call(context(), 'PATCH', { phone: '1', fax: '2' })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatchObject({ code: 'validation_failed', fields: { fax: 'Not writable on business details' } })
    expect(double.writes).toEqual([])
  })

  it('holds each member to the card’s own limit, at the boundary', async () => {
    const ok = { name: 'n'.repeat(BUSINESS_NAME_MAX_LENGTH), slogan: 's'.repeat(SITE_SLOGAN_MAX_LENGTH), phone: '1'.repeat(BUSINESS_PHONE_MAX_LENGTH) }
    expect((await call(context(), 'PATCH', ok)).status).toBe(200)
    const over = await call(context(), 'PATCH', {
      name: 'n'.repeat(BUSINESS_NAME_MAX_LENGTH + 1),
      slogan: 's'.repeat(SITE_SLOGAN_MAX_LENGTH + 1),
      phone: '1'.repeat(BUSINESS_PHONE_MAX_LENGTH + 1),
    })
    expect(over.status).toBe(400)
    expect((await over.json()).error.fields).toEqual({
      name: `Must be ${BUSINESS_NAME_MAX_LENGTH} characters or fewer`,
      slogan: `Must be ${SITE_SLOGAN_MAX_LENGTH} characters or fewer`,
      phone: `Must be ${BUSINESS_PHONE_MAX_LENGTH} characters or fewer`,
    })
  })

  it('moves the email and its business.supportEmail copy together, as the card does', async () => {
    expect((await call(context(), 'PATCH', { email: 'orders@example.com' })).status).toBe(200)
    expect(host()['seo']['entity']['email']).toBe('orders@example.com')
    expect(host()['business']['supportEmail']).toBe('orders@example.com')
  })

  it('clears the email with "" or null by removing it and its copy, never storing them blank', async () => {
    for (const cleared of ['', null]) {
      host()['seo']['entity']['email'] = 'hello@example.com'
      host()['business']['supportEmail'] = 'hello@example.com'
      const response = await call(context(), 'PATCH', { email: cleared })
      expect(response.status).toBe(200)
      expect(host()['seo']['entity']).not.toHaveProperty('email')
      expect(host()['business']).not.toHaveProperty('supportEmail')
      expect((await response.json()).email).toBeNull()
    }
  })

  it('writes the address in parts and mirrors it, formatted, into business.address', async () => {
    const response = await call(context(), 'PATCH', { address: { street: '12 Bean St', city: 'Portland', region: 'OR', postalCode: '97201' } })
    expect(response.status).toBe(200)
    expect(host()['seo']['entity']['address']).toEqual({
      streetAddress: '12 Bean St',
      addressLocality: 'Portland',
      addressRegion: 'OR',
      postalCode: '97201',
    })
    expect(host()['business']['address']).toBe(resolveHostToken('address', { seo: { entity: { address: host()['seo']['entity']['address'] } } }))
    expect(host()['business']['address']).toContain('12 Bean St')
  })

  it('keeps the one-block address through a save that never touched the address', async () => {
    expect((await call(context(), 'PATCH', { slogan: 'Fresh daily' })).status).toBe(200)
    expect(host()['business']['address']).toBe('9 Old Rd\nAustin')
    // And a field the card does not edit is left as it was.
    expect(host()['seo']['entity']['description']).toBe('Kept as it is')
  })

  it('replaces the social links, and empties them with null', async () => {
    await call(context(), 'PATCH', { socialLinks: [{ label: 'X', url: 'https://x.com/bakery' }] })
    expect(host()['business']['socialLinks']).toEqual([{ label: 'X', url: 'https://x.com/bakery' }])
    await call(context(), 'PATCH', { socialLinks: null })
    expect(host()['business']['socialLinks']).toEqual([])
  })

  it('records a site-wide outbox entry with the write, and drops the site’s pages', async () => {
    expect((await call(context(), 'PATCH', { phone: '+1 512-555-0100' })).status).toBe(200)
    const entry = double.writes.find((write) => write.op === 'set' && write.path.startsWith('publishOutbox/'))
    expect(entry?.data).toMatchObject({ hostId: SITE, paths: ['/'], entireHost: true })
    expect(dropCache).toHaveBeenCalledWith(expect.objectContaining({ hostIds: [SITE] }))
  })
})
