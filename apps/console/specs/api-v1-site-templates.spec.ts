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
 * A SITE'S PAGE TEMPLATES OVER THE PUBLIC API (AGL-4235).
 *
 * `GET /v1/sites/{siteId}/templates` through the real router, against an
 * in-memory data layer.
 */

import { STARTER_TEMPLATES, starterTemplateDocId } from '@aglyn/aglyn/app-utils/starter-templates'
import type { ApiV1Context } from '@aglyn/tenant-data-admin/server/api-v1-kit'
import { settingsFirestoreDouble } from '@aglyn/tenant-data-admin/testing/settings-firestore-double'
import { dispatchResource } from '../utils/api-v1-resources'

const ORIGIN = 'https://app.example.com'
const SITE = 'site-1'
const MEMBER = 'user-member'
const HOST = `hosts/${SITE}`
const template = (id: string) => `${HOST}/templates/${id}`
const starterPages = STARTER_TEMPLATES.flatMap((starter) => starter.screens.map((screen) => starterTemplateDocId(starter.id, screen.key)))

let double: ReturnType<typeof settingsFirestoreDouble>
beforeEach(() => {
  double = settingsFirestoreDouble({
    [HOST]: { displayName: 'Bakery', memberRoles: { [MEMBER]: 'viewer' } },
    [template('landing')]: {
      kind: 'page',
      displayName: 'Landing',
      description: 'A landing page',
      category: 'Marketing',
      nodes: { _: { $id: '_', componentId: 'div', nodes: [] } },
      placeholders: [{ name: 'business', label: 'Business name', defaultValue: 'Acme' }, { name: 'prop.city' }, { name: 'city' }],
      source: { type: 'authored' },
    },
    [template('card')]: { kind: 'component', displayName: 'Card', source: { type: 'authored' } },
    [template('frame')]: { kind: 'layout', displayName: 'Frame', source: { type: 'authored' } },
    [template('old')]: { kind: 'page', displayName: 'Old', source: { type: 'authored' }, deletedAt: new Date('2026-11-01T00:00:00Z') },
  })
})

function context(overrides: Partial<ApiV1Context> = {}): ApiV1Context {
  return {
    orgId: 'org-1',
    keyId: 'grant_1',
    keyName: 'Assistant',
    credential: 'connected_app',
    uid: MEMBER,
    scopes: ['components:read'],
    org: { plan: 'pro', hosts: { [SITE]: true } } as ApiV1Context['org'],
    firestore: double.firestore,
    headers: { 'X-RateLimit-Limit': '120' },
    ...overrides,
  }
}

const call = (ctx: ApiV1Context, path: string, method = 'GET') =>
  dispatchResource(new Request(`${ORIGIN}/api/v1/sites/${SITE}/${path}`, { method }), ctx, ['sites', SITE, ...path.split('?')[0].split('/')])

describe('GET /v1/sites/{siteId}/templates (AGL-4235)', () => {
  it('needs components:read', async () => {
    const response = await call(context({ scopes: ['pages:read', 'pages:write'] }), 'templates')
    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatchObject({ type: 'insufficient_scope', code: 'components:read' })
  })

  it('lists only page templates, leaves deleted ones out, and never their content', async () => {
    const body = await (await call(context(), 'templates?limit=100')).json()
    const ids = body.data.map((one: { id: string }) => one.id)
    expect(ids).not.toEqual(expect.arrayContaining(['card']))
    expect(ids).not.toEqual(expect.arrayContaining(['frame']))
    expect(ids).not.toEqual(expect.arrayContaining(['old']))
    expect(body.data[0]).toEqual({
      id: 'landing',
      object: 'template',
      kind: 'page',
      name: 'Landing',
      description: 'A landing page',
      category: 'Marketing',
      placeholders: [
        { name: 'business', label: 'Business name', defaultValue: 'Acme' },
        { name: 'city', label: null, defaultValue: null },
      ],
      source: 'site',
    })
    for (const one of body.data) expect(one).not.toHaveProperty('nodes')
  })

  it('includes every built-in starter page, after the site’s own', async () => {
    const body = await (await call(context(), 'templates?limit=100')).json()
    const ids = body.data.map((one: { id: string }) => one.id)
    expect(ids).toEqual(['landing', ...starterPages])
    expect(body.data.slice(1).every((one: { source: string; kind: string }) => one.source === 'built_in' && one.kind === 'page')).toBe(true)
    expect(body.has_more).toBe(false)
  })

  it('pages like every list, a library page coming back short where it held something else', async () => {
    const first = await (await call(context(), 'templates?limit=1')).json()
    // The first document by id is the component template, which is left out.
    expect(first.data).toEqual([])
    expect(first.has_more).toBe(true)
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const page = await (await call(context(), cursor ? `templates?limit=1&cursor=${cursor}` : 'templates?limit=1')).json()
      expect(page.data.length).toBeLessThanOrEqual(1)
      seen.push(...page.data.map((one: { id: string }) => one.id))
      cursor = page.next_cursor
    } while (cursor)
    expect(seen).toEqual(['landing', ...starterPages])
  })

  it('answers only GET, and writes nothing', async () => {
    expect((await call(context(), 'templates', 'POST')).status).toBe(405)
    expect((await call(context(), 'templates/landing')).status).toBe(404)
    expect(double.writes).toEqual([])
  })
})
