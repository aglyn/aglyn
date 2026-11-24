/**
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

import { decodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { SERVER_TIMESTAMP, settingsFirestoreDouble } from '../testing/settings-firestore-double'
import { blankPageNodes, createPageDraft, type CreatePageDraftInput } from './page-create'

const HOST = 'hosts/host-1'
const actor = { uid: 'u1', email: 'owner@example.com' }
/** A plan with room for one page. */
const ONE_PAGE = { plan: 'free', entitlements: { screensPerHost: 1 } } as never
const ROOMY = { plan: 'free', entitlements: { screensPerHost: 50 } } as never

function site(screens: Record<string, Record<string, unknown>> = {}, host: Record<string, unknown> = {}) {
  return settingsFirestoreDouble({
    [HOST]: host,
    ...Object.fromEntries(Object.entries(screens).map(([id, data]) => [`${HOST}/screens/${id}`, data])),
  })
}

const create = (double: ReturnType<typeof site>, input: Partial<CreatePageDraftInput> = {}) =>
  createPageDraft(double.firestore, { hostId: 'host-1', org: ROOMY, actor, displayName: 'About us', ...input })

describe('createPageDraft (AGL-4235)', () => {
  it('writes the page as the resources route does, its blank first version, and the activity row; publishes nothing', async () => {
    const double = site({}, { screens: {} })
    const result = await create(double, { pageId: 'p1', versionId: 'v1', description: 'Who we are' })
    expect(result).toEqual(expect.objectContaining({ ok: true, pageId: 'p1', versionId: 'v1', replayed: false }))
    const page = double.read(`${HOST}/screens/p1`)
    expect(page).toEqual(
      expect.objectContaining({
        displayName: 'About us',
        description: 'Who we are',
        slug: 'about-us',
        versionId: 'v1',
        deletedAt: null,
        createdBy: 'u1',
        createdAt: expect.anything(),
        updatedAt: expect.anything(),
      }),
    )
    expect(page).not.toHaveProperty('publishedAt')
    expect(page).not.toHaveProperty('parentId')
    expect(double.read(HOST)).toEqual({ screens: {} })
    const version = double.read(`${HOST}/screens/p1/versions/v1`) as Record<string, unknown>
    expect(version['screenId']).toBe('p1')
    expect(decodeStoredNodes(version['nodes'])).toEqual(blankPageNodes())
    const rows = [...double.docs.entries()].filter(([path]) => path.startsWith(`${HOST}/activity/`)).map(([, row]) => row)
    expect(rows).toEqual([
      expect.objectContaining({
        actorId: 'u1',
        action: 'Created screen',
        target: { type: 'screen', id: 'p1', name: 'About us' },
        createdAt: SERVER_TIMESTAMP,
      }),
    ])
    expect(double.outbox()).toEqual([])
  })

  it('stores the nodes it is given, compressed', async () => {
    const nodes = { _: { $id: '_', componentId: 'div', nodes: ['h'] }, h: { $id: 'h', componentId: 'h1', nodes: [] } }
    const double = site()
    await create(double, { pageId: 'p1', versionId: 'v1', nodes, rootId: '_' })
    const version = double.read(`${HOST}/screens/p1/versions/v1`) as Record<string, unknown>
    expect(Buffer.isBuffer(version['nodes'])).toBe(true)
    expect(decodeStoredNodes(version['nodes'])).toEqual(nodes)
    expect(version['rootId']).toBe('_')
  })

  it('gives the page an address no live page keeps and the routing map does not serve', async () => {
    const double = site(
      { a: { kind: 'page', slug: 'about-us' }, gone: { kind: 'page', slug: 'about-us-3', deletedAt: 1 } },
      { screens: { b: 'about-us-2' } },
    )
    await create(double, { pageId: 'p1', slug: 'About Us' })
    expect(double.read(`${HOST}/screens/p1`)?.['slug']).toBe('about-us-3')
  })

  it('refuses a path separator and a reserved address in the console’s words, and a page with no name', async () => {
    for (const [input, error] of [
      [{ slug: 'a/b' }, /./],
      [{ slug: 'api' }, /./],
      [{ displayName: '  ' }, /name/],
    ] as const) {
      const double = site()
      const result = await create(double, input as Partial<CreatePageDraftInput>)
      expect(result).toEqual({ ok: false, status: 400, error: expect.stringMatching(error) })
      expect(double.writes).toEqual([])
    }
  })

  it('meets the plan’s page allowance, counted as the resources route counts it', async () => {
    const full = site({ home: { kind: 'page' } }, { screens: { home: '/' } })
    expect(await create(full, { org: ONE_PAGE })).toEqual({
      ok: false,
      status: 403,
      error: 'Your plan includes 1 page — upgrade in Billing for more',
    })
    expect(full.writes).toEqual([])
    // An email design is not a page, so it spends none of the allowance.
    const room = site({ mail: { kind: 'email' } }, { screens: {} })
    expect(await create(room, { org: ONE_PAGE })).toEqual(expect.objectContaining({ ok: true }))
  })

  it('answers a replay with the page it made, and refuses an id another create holds', async () => {
    const double = site()
    await create(double, { pageId: 'p1', versionId: 'v1' })
    const writes = double.writes.length
    expect(await create(double, { pageId: 'p1', versionId: 'v1' })).toEqual(
      expect.objectContaining({ ok: true, pageId: 'p1', replayed: true }),
    )
    expect(double.writes.length).toBe(writes)
    expect(await create(double, { pageId: 'p1', versionId: 'v2' })).toEqual({ ok: false, status: 409, error: 'That id already exists' })
  })
})

describe('a blank page starts inside the site’s layout (AGL-4241)', () => {
  /** A new site: Home routed at `/`, bound to its header-and-footer layout on the screen. */
  function newSite(extra: Record<string, Record<string, unknown>> = {}, host: Record<string, unknown> = {}) {
    return settingsFirestoreDouble({
      [HOST]: { screens: { home: '/' }, ...host },
      [`${HOST}/screens/home`]: { kind: 'page', slug: '/', versionId: 'hv', layoutId: 'site-layout' },
      [`${HOST}/screens/home/versions/hv`]: { screenId: 'home' },
      [`${HOST}/layouts/site-layout`]: { displayName: 'Site header and footer' },
      [`${HOST}/layouts/other`]: { displayName: 'Landing' },
      ...extra,
    })
  }
  const versionOf = (double: ReturnType<typeof site>) =>
    double.read(`${HOST}/screens/p1/versions/v1`) as Record<string, unknown>

  it('binds the layout the home page uses, on the first version', async () => {
    const double = newSite()
    await create(double, { pageId: 'p1', versionId: 'v1' })
    expect(versionOf(double)['layoutId']).toBe('site-layout')
    expect(double.read(`${HOST}/screens/p1`)).not.toHaveProperty('layoutId')
  })

  it('takes the Built-in page layout setting first', async () => {
    const double = newSite({}, { builtInPageLayoutId: 'other' })
    await create(double, { pageId: 'p1', versionId: 'v1' })
    expect(versionOf(double)['layoutId']).toBe('other')
  })

  it('binds nothing on a site with no layout, or several and none named', async () => {
    const bare = site({}, { screens: {} })
    await create(bare, { pageId: 'p1', versionId: 'v1' })
    expect(versionOf(bare)).not.toHaveProperty('layoutId')
    const unnamed = newSite({ [`${HOST}/screens/home/versions/hv`]: { screenId: 'home', layoutId: null } })
    await create(unnamed, { pageId: 'p1', versionId: 'v1' })
    expect(versionOf(unnamed)).not.toHaveProperty('layoutId')
  })

  it('leaves a page made from a template’s nodes as it was', async () => {
    const double = newSite()
    await create(double, { pageId: 'p1', versionId: 'v1', nodes: blankPageNodes() })
    expect(versionOf(double)).not.toHaveProperty('layoutId')
  })
})
