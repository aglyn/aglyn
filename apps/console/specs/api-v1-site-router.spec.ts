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
 * EVERYTHING THAT NAMES A SITE IS DECIDED AT THE ONE SITE ROUTER (AGL-4235).
 *
 * `/api/v1` asked the workspace's lock and the person's, and never had a site
 * to give the verdict, so a site that was locked or taken down kept answering
 * every `/v1/sites/{siteId}/…` endpoint. And a connected app acts for a
 * person, who may be on some of the workspace's sites and not others.
 *
 * These go through the real router (`dispatchResource`) with the real lock
 * verdict (`lockdownRefusal` deciding from the method) and the real
 * permission reads (`holdsSiteKey`), against a data layer holding the site.
 */

import { siteKeyRefusal } from '@aglyn/aglyn/app-utils/host-permissions'
import { registerApiV1SiteResource } from '@aglyn/tenant-data-admin/server/api-v1-resources'
import {
  type ApiV1Context,
  holdsSiteMembership,
  requireSitePermission,
} from '@aglyn/tenant-data-admin/server/api-v1-kit'
import { dispatchResource } from '../utils/api-v1-resources'

const ORIGIN = 'https://app.example.com'
const SITE = 'site-1'
const MEMBER = 'user-member'
const RATE_HEADERS = { 'X-RateLimit-Limit': '120', 'X-RateLimit-Remaining': '119' }

const mockDocs = new Map<string, Record<string, unknown>>()

function snapshotOf(path: string) {
  const data = mockDocs.get(path)
  return {
    id: path.slice(path.lastIndexOf('/') + 1),
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

/** Only what the router and the platform's site handlers read here. */
function firestore(): FirebaseFirestore.Firestore {
  const collection = (path: string): unknown => ({
    path,
    doc: (id: string) => doc(`${path}/${id}`),
    where: () => collection(path),
    orderBy: () => collection(path),
    limit: () => collection(path),
    startAfter: () => collection(path),
    get: async () => ({ docs: [], empty: true, size: 0 }),
  })
  const doc = (path: string): unknown => ({
    path,
    id: path.slice(path.lastIndexOf('/') + 1),
    collection: (name: string) => collection(`${path}/${name}`),
    get: async () => snapshotOf(path),
  })
  return { collection } as unknown as FirebaseFirestore.Firestore
}

function context(overrides: Partial<ApiV1Context> = {}): ApiV1Context {
  return {
    orgId: 'org-1',
    keyId: 'grant_1',
    keyName: 'Assistant',
    credential: 'connected_app',
    uid: MEMBER,
    scopes: ['sites:read', 'sites:publish', 'media:read', 'media:write'],
    org: { plan: 'pro', hosts: { [SITE]: true } } as ApiV1Context['org'],
    firestore: firestore(),
    headers: { ...RATE_HEADERS },
    ...overrides,
  }
}

const call = (ctx: ApiV1Context, path: string, method = 'GET', body?: unknown) =>
  dispatchResource(
    new Request(`${ORIGIN}/api/v1/${path}`, {
      method,
      ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
    }),
    ctx,
    path.split('/'),
  )

function seedSite(fields: Record<string, unknown> = {}) {
  mockDocs.set(`hosts/${SITE}`, {
    displayName: 'Bakery',
    subdomain: 'bakery',
    memberRoles: { [MEMBER]: 'admin' },
    ...fields,
  })
}

/** What a plugin's site resource was handed, for the context assertions. */
let probed: ApiV1Context | null = null
beforeAll(() => {
  registerApiV1SiteResource(
    'probe',
    {
      handle: async (_request, ctx) => {
        probed = ctx
        return Response.json({ ok: true }, { headers: ctx.headers })
      },
    },
    { pluginId: 'site-router-spec' },
  )
})

beforeEach(() => {
  mockDocs.clear()
  probed = null
  seedSite()
})

describe('the site router reads the site once and hands it on (AGL-4235)', () => {
  it('answers a site the workspace owns but no document exists for as No such site', async () => {
    mockDocs.delete(`hosts/${SITE}`)
    const response = await call(context(), `sites/${SITE}`)
    expect(response.status).toBe(404)
    expect((await response.json()).error.message).toBe('No such site')
  })

  it('serves the site itself from the read it made', async () => {
    const response = await call(context(), `sites/${SITE}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      id: SITE,
      object: 'site',
      displayName: 'Bakery',
      subdomain: 'bakery',
      domain: null,
    })
  })

  it('hands a plugin’s site resource the site it read, and the person', async () => {
    const response = await call(context(), `sites/${SITE}/probe`)
    expect(response.status).toBe(200)
    expect(probed?.site?.id).toBe(SITE)
    expect(probed?.site?.snapshot.get('subdomain')).toBe('bakery')
    expect(probed?.uid).toBe(MEMBER)
  })
})

describe('a site-level lock is honored by every site-scoped endpoint (AGL-4235)', () => {
  it('a read-only lock passes a GET and refuses a write, with the lock status and the rate-limit headers', async () => {
    seedSite({ suspendedAt: Date.now() - 1000, suspendedMode: 'read-only', suspendedReasonCode: 'manual' })
    const read = await call(context(), `sites/${SITE}/probe`)
    expect(read.status).toBe(200)
    expect(probed?.site?.id).toBe(SITE)

    probed = null
    const write = await call(context(), `sites/${SITE}/probe`, 'POST', {})
    expect(write.status).toBe(423)
    expect(await write.json()).toMatchObject({ error: 'locked', scope: 'host', mode: 'read-only' })
    expect(write.headers.get('X-RateLimit-Limit')).toBe('120')
    expect(write.headers.get('X-RateLimit-Remaining')).toBe('119')
    expect(probed).toBeNull()
  })

  it('a full lock refuses a read and a write alike', async () => {
    seedSite({ suspendedAt: Date.now() - 1000, suspendedReasonCode: 'manual' })
    for (const method of ['GET', 'POST']) {
      const response = await call(context(), `sites/${SITE}/probe`, method, method === 'POST' ? {} : undefined)
      expect(response.status).toBe(423)
      expect(response.headers.get('X-RateLimit-Limit')).toBe('120')
    }
    expect((await call(context(), `sites/${SITE}`)).status).toBe(423)
    expect(probed).toBeNull()
  })

  it('locks the site for an API key too', async () => {
    seedSite({ suspendedAt: Date.now() - 1000, suspendedReasonCode: 'manual' })
    const response = await call(context({ credential: 'api_key', uid: undefined }), `sites/${SITE}`)
    expect(response.status).toBe(423)
  })
})

describe('a connected app reaches only the sites its person is on (AGL-4235)', () => {
  it('answers a site its person is not a member of exactly as a site the workspace does not own', async () => {
    seedSite({ memberRoles: { 'someone-else': 'admin' } })
    for (const path of [`sites/${SITE}`, `sites/${SITE}/media`, `sites/${SITE}/probe`]) {
      const response = await call(context(), path)
      expect(response.status).toBe(404)
      expect((await response.json()).error.message).toBe('No such site')
    }
    expect(probed).toBeNull()
  })

  it('hides a locked site from a non-member too, rather than saying it is locked', async () => {
    seedSite({ memberRoles: {}, suspendedAt: Date.now() - 1000 })
    expect((await call(context(), `sites/${SITE}`)).status).toBe(404)
  })

  it('lets a member of any role through, a viewer included', async () => {
    seedSite({ memberRoles: { [MEMBER]: 'viewer' } })
    expect((await call(context(), `sites/${SITE}`)).status).toBe(200)
  })

  it('fails closed for a connected app with no person', async () => {
    expect((await call(context({ uid: undefined }), `sites/${SITE}`)).status).toBe(404)
  })

  it('does not ask an API key about membership: it is the workspace’s own credential', async () => {
    seedSite({ memberRoles: {} })
    const response = await call(context({ credential: 'api_key', uid: undefined }), `sites/${SITE}`)
    expect(response.status).toBe(200)
    expect(holdsSiteMembership({ credential: 'api_key' }, null)).toBe(true)
  })
})

describe('requireSitePermission (AGL-4235)', () => {
  const host = (role: string, stamped?: Record<string, boolean>) => ({
    memberRoles: { [MEMBER]: role },
    ...(stamped ? { memberPermissions: { [MEMBER]: stamped } } : {}),
  })

  it('passes a connected app whose person holds the key', () => {
    expect(requireSitePermission(context(), host('author'), 'site.edit')).toBeNull()
  })

  it('refuses one whose person does not, with the console’s sentence and the rate-limit headers', async () => {
    const refusal = requireSitePermission(context(), host('viewer'), 'site.edit') as Response
    expect(refusal.status).toBe(403)
    expect(await refusal.json()).toEqual({
      error: { type: 'forbidden', code: 'site_permission_required', message: siteKeyRefusal('site.edit') },
    })
    expect(refusal.headers.get('X-RateLimit-Limit')).toBe('120')
  })

  it('reads the site’s own stamp ahead of the role, as the rules do', () => {
    expect(requireSitePermission(context(), host('admin', { 'site.edit': false }), 'site.edit')?.status).toBe(403)
    expect(requireSitePermission(context(), host('viewer', { 'site.edit': true }), 'site.edit')).toBeNull()
  })

  it('refuses a connected app with no person', () => {
    expect(requireSitePermission(context({ uid: undefined }), host('admin'), 'site.edit')?.status).toBe(403)
  })

  it('passes an API key: there is no person behind it to ask', () => {
    expect(requireSitePermission(context({ credential: 'api_key', uid: undefined }), host('viewer'), 'site.edit')).toBeNull()
    expect(requireSitePermission(context({ credential: undefined, uid: undefined }), null, 'site.manage')).toBeNull()
  })
})

describe('the platform’s two site writes ask the person’s site permission (AGL-4235)', () => {
  it('refuses a viewer’s app a publish and an upload, before any work', async () => {
    seedSite({ memberRoles: { [MEMBER]: 'viewer' } })
    const publish = await call(context(), `sites/${SITE}/publish`, 'POST')
    expect(publish.status).toBe(403)
    expect((await publish.json()).error.code).toBe('site_permission_required')

    const upload = await call(context(), `sites/${SITE}/media`, 'POST', {
      fileName: 'a.png',
      contentType: 'image/png',
      data: 'iVBORw0KGgo=',
    })
    expect(upload.status).toBe(403)
    expect((await upload.json()).error.code).toBe('site_permission_required')
  })

  it('lets an author’s app publish: the roles that may write the site’s content', async () => {
    seedSite({ memberRoles: { [MEMBER]: 'author' } })
    const publish = await call(context(), `sites/${SITE}/publish`, 'POST')
    expect(publish.status).toBe(200)
    expect(await publish.json()).toMatchObject({ object: 'publish', site: SITE, reason: 'not_routed' })
  })

  it('does not ask an API key', async () => {
    seedSite({ memberRoles: {} })
    const publish = await call(context({ credential: 'api_key', uid: undefined }), `sites/${SITE}/publish`, 'POST')
    expect(publish.status).toBe(200)
  })
})
