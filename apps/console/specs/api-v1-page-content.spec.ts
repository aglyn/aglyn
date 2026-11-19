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
 * WHAT IS ON A PAGE, OVER THE PUBLIC API (AGL-4235).
 *
 * `GET /v1/sites/{siteId}/pages/{pageId}/content` and
 * `POST …/content/edits` through the real router, answered by the page
 * editor the build registers (the generated server declarations), against an
 * in-memory data layer. The editor's own rules are its spec's; this holds
 * the door: scopes, the person's permission, the pages it answers for, the
 * body's shape, replay safety and the editor link.
 */

import { siteKeyRefusal } from '@aglyn/aglyn/app-utils/host-permissions'
import { decodeStoredNodes, encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { resetPluginDeclarationsRepairForTests } from '@aglyn/aglyn/plugin-manager/plugin-declarations-repair'
import { resolvePluginPageContent } from '@aglyn/aglyn/plugin-manager/plugin-page-content'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import type { ApiV1Context } from '@aglyn/tenant-data-admin/server/api-v1-kit'
import { settingsFirestoreDouble } from '@aglyn/tenant-data-admin/testing/settings-firestore-double'
import { registerPluginServerDeclarations } from '../constants/plugins.declarations.server.generated'
import { dispatchResource } from '../utils/api-v1-resources'

const ORIGIN = 'https://app.example.com'
const SITE = 'site-1'
const MEMBER = 'user-member'
const HOST = `hosts/${SITE}`
const ROOT = CANVAS_ROOT_ELEMENT_ID
const page = (id: string) => `${HOST}/screens/${id}`
const DRAFT = `${page('home')}/versions/v1/draft/current`

const NODES = {
  [ROOT]: { $id: ROOT, componentId: 'div', props: {}, nodes: ['hero'] },
  hero: { $id: 'hero', componentId: 'section', parentId: ROOT, props: { element: 'section' }, nodes: ['title'] },
  title: { $id: 'title', componentId: 'muiTypography', parentId: 'hero', props: { variant: 'h1', children: 'Fresh bread daily' }, nodes: [] },
}
const packed = (nodes: Record<string, unknown>) => Buffer.from(encodeStoredNodes(nodes) as Uint8Array)

let double: ReturnType<typeof settingsFirestoreDouble>
beforeAll(async () => {
  await registerPluginServerDeclarations()
})
beforeEach(() => {
  double = settingsFirestoreDouble({
    [HOST]: { orgId: 'org-1', displayName: 'Bakery', subdomain: 'bakery', memberRoles: { [MEMBER]: 'admin' }, screens: { home: '/' } },
    [page('home')]: { displayName: 'Home', versionId: 'v1' },
    [`${page('home')}/versions/v1`]: { displayName: 'Initial version', nodes: packed(NODES) },
    [page('group')]: { displayName: 'Company', kind: 'group' },
    [page('newsletter')]: { displayName: 'Newsletter', kind: 'email', versionId: 'v1' },
    [page('gone')]: { displayName: 'Gone', versionId: 'v1', deletedAt: new Date('2026-11-01T00:00:00Z') },
  })
})

function context(overrides: Partial<ApiV1Context> = {}): ApiV1Context {
  return {
    orgId: 'org-1',
    keyId: 'grant_1',
    keyName: 'Assistant',
    credential: 'connected_app',
    uid: MEMBER,
    scopes: ['pages:read', 'pages:write'],
    org: { plan: 'starter', slug: 'acme', hosts: { [SITE]: true } } as ApiV1Context['org'],
    firestore: double.firestore,
    headers: { 'X-RateLimit-Limit': '120' },
    ...overrides,
  }
}

const apiKey = (overrides: Partial<ApiV1Context> = {}) => context({ credential: 'api_key', uid: undefined, ...overrides })

const call = (ctx: ApiV1Context, path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
  dispatchResource(
    new Request(`${ORIGIN}/api/v1/sites/${SITE}/${path}`, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      headers: { 'content-type': 'application/json', ...headers },
    }),
    ctx,
    ['sites', SITE, ...path.split('?')[0].split('/')],
  )

const RENAME = { edits: [{ op: 'rename', elementId: 'hero', name: 'Hero' }] }
const draftTree = () => decodeStoredNodes<Record<string, Record<string, unknown>>>(double.read(DRAFT)?.['nodes']) ?? {}

describe('GET /v1/sites/{siteId}/pages/{pageId}/content (AGL-4235)', () => {
  it('needs pages:read', async () => {
    const response = await call(context({ scopes: ['pages:write'] }), 'pages/home/content')
    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatchObject({ type: 'insufficient_scope', code: 'pages:read' })
  })

  it('answers the page’s elements, what each kind takes, and a link into the editor', async () => {
    const response = await call(apiKey({ scopes: ['pages:read'] }), 'pages/home/content')
    expect(response.status).toBe(200)
    expect(response.headers.get('X-RateLimit-Limit')).toBe('120')
    const body = await response.json()
    expect(body).toMatchObject({
      object: 'page_content',
      page: 'home',
      versionId: 'v1',
      base: 'saved',
      rootId: ROOT,
      total: 3,
      editorUrl: expect.stringMatching(/\/acme\/hosts\/bakery\/screens\/home\/versions\/v1\/besigner$/),
    })
    expect(body.elements.map((element: { id: string }) => element.id)).toEqual([ROOT, 'hero', 'title'])
    expect(body.kinds['muiTypography'].props['children']).toMatchObject({ role: 'text' })
    expect(typeof body.revision).toBe('string')
  })

  it('reads one element with elementId, and answers 404 for one that is not there', async () => {
    const body = await (await call(context(), 'pages/home/content?elementId=title')).json()
    expect(body.elements.map((element: { id: string }) => element.id)).toEqual(['title'])
    const missing = await call(context(), 'pages/home/content?elementId=nope')
    expect(missing.status).toBe(404)
  })

  it('answers 404 for a folder, an email design and a deleted page', async () => {
    for (const id of ['group', 'newsletter', 'gone', 'missing']) {
      const response = await call(context(), `pages/${id}/content`)
      expect({ id, status: response.status }).toEqual({ id, status: 404 })
    }
  })

  it('answers only GET on the content, and nothing below it but edits', async () => {
    expect((await call(context(), 'pages/home/content', 'PATCH', {})).status).toBe(405)
    expect((await call(context(), 'pages/home/content/other')).status).toBe(404)
  })
})

describe('POST /v1/sites/{siteId}/pages/{pageId}/content/edits (AGL-4235)', () => {
  it('needs pages:write', async () => {
    const response = await call(context({ scopes: ['pages:read'] }), 'pages/home/content/edits', 'POST', RENAME)
    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatchObject({ type: 'insufficient_scope', code: 'pages:write' })
  })

  it('refuses a connected app whose person may not edit the site', async () => {
    double.read(HOST)!['memberRoles'] = { [MEMBER]: 'viewer' }
    const response = await call(context(), 'pages/home/content/edits', 'POST', RENAME)
    expect(response.status).toBe(403)
    expect((await response.json()).error).toEqual({ type: 'forbidden', code: 'site_permission_required', message: siteKeyRefusal('site.edit') })
    expect(double.read(DRAFT)).toBeUndefined()
  })

  it('takes an API key, saves the edits as the page’s draft, and links to the draft in the editor', async () => {
    const response = await call(apiKey(), 'pages/home/content/edits', 'POST', {
      edits: [
        { op: 'updateProps', elementId: 'title', props: { children: 'Bread, baked at dawn' } },
        { op: 'insert', parentId: 'hero', element: { kind: 'muiButton', props: { children: 'Order' } } },
      ],
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ object: 'page_content_edit', page: 'home', versionId: 'v1', applied: 2 })
    expect(body.editorUrl).toMatch(/\/acme\/hosts\/bakery\/screens\/home\/versions\/v1\/besigner\?draft=open$/)
    expect(body.created).toEqual([{ index: 1, id: expect.any(String), ids: [expect.any(String)] }])
    const tree = draftTree()
    expect(tree['title']['props']).toMatchObject({ children: 'Bread, baked at dawn' })
    expect(tree[body.created[0].id]).toMatchObject({ componentId: 'muiButton' })
    expect(double.read(DRAFT)).toMatchObject({ updatedByUid: 'api', updatedByLabel: 'API key Assistant' })
    // The version and the page are untouched; the read now finds the draft.
    expect(decodeStoredNodes(double.read(`${page('home')}/versions/v1`)?.['nodes'])).toEqual(NODES)
    expect(double.read(page('home'))).toEqual({ displayName: 'Home', versionId: 'v1' })
    const read = await (await call(apiKey(), 'pages/home/content')).json()
    expect(read).toMatchObject({ base: 'draft', revision: body.revision })
    expect(read.editorUrl).toMatch(/\?draft=open$/)
  })

  it('answers 404 for a folder, an email design and a deleted page', async () => {
    for (const id of ['group', 'newsletter', 'gone']) {
      const response = await call(context(), `pages/${id}/content/edits`, 'POST', RENAME)
      expect({ id, status: response.status }).toEqual({ id, status: 404 })
    }
  })

  it('names a member the body does not take, and a malformed edit, as a 400', async () => {
    const unknown = await call(context(), 'pages/home/content/edits', 'POST', { ...RENAME, publish: true })
    expect(unknown.status).toBe(400)
    expect((await unknown.json()).error).toMatchObject({ code: 'validation_failed', fields: { publish: 'is not a member of this request' } })
    const malformed = await call(context(), 'pages/home/content/edits', 'POST', {
      edits: [{ op: 'rename', elementId: 'hero', name: 'X', colour: 'red' }, { op: 'setSeo' }, { op: 'move', elementId: 'hero', parentId: ROOT }],
    })
    expect(malformed.status).toBe(400)
    expect((await malformed.json()).error.fields).toEqual({
      'edits[0].colour': 'is not a member of a rename edit',
      'edits[1].op': expect.stringContaining('updateProps'),
      'edits[2].index': 'is required',
    })
    expect(double.read(DRAFT)).toBeUndefined()
  })

  it('answers what the editor refuses as a 422, naming each problem', async () => {
    const response = await call(context(), 'pages/home/content/edits', 'POST', {
      edits: [{ op: 'updateProps', elementId: 'title', props: { colour: 'red' } }],
    })
    expect(response.status).toBe(422)
    expect((await response.json()).error).toMatchObject({
      type: 'unprocessable_entity',
      code: 'edit_refused',
      fields: { 'edits[0].props.colour': 'is not a property of Typography' },
    })
  })

  it('answers a stale revision with a 409 and saves nothing', async () => {
    const response = await call(context(), 'pages/home/content/edits', 'POST', { ...RENAME, ifRevision: 's_old' })
    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatchObject({ code: 'stale' })
    expect(double.read(DRAFT)).toBeUndefined()
  })

  it('replays the first answer for a repeated Idempotency-Key, without editing twice', async () => {
    const insert = { edits: [{ op: 'insert', parentId: 'hero', element: { kind: 'muiButton', props: { children: 'Order' } } }] }
    const first = await call(apiKey(), 'pages/home/content/edits', 'POST', insert, { 'Idempotency-Key': 'key-1' })
    const second = await call(apiKey(), 'pages/home/content/edits', 'POST', insert, { 'Idempotency-Key': 'key-1' })
    expect([first.status, second.status]).toEqual([200, 200])
    const [one, two] = [await first.json(), await second.json()]
    expect(two).toEqual(one)
    expect(draftTree()['hero']['nodes']).toEqual(['title', one.created[0].id])
  })

  it('answers Not available yet when no plugin edits pages', async () => {
    resetPluginServicesForTests()
    resetPluginDeclarationsRepairForTests()
    expect(resolvePluginPageContent()).toBeNull()
    for (const [path, method, body] of [
      ['pages/home/content', 'GET', undefined],
      ['pages/home/content/edits', 'POST', RENAME],
    ] as const) {
      const response = await call(context(), path, method, body)
      expect({ path, status: response.status }).toEqual({ path, status: 501 })
      expect((await response.json()).error).toMatchObject({ type: 'not_implemented', message: 'Not available yet' })
    }
    await registerPluginServerDeclarations()
  })
})
