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

import { setRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  PLUGIN_PAGE_CONTENT,
  registerPluginPageContent,
  resolvePluginPageContent,
  type PageContentService,
} from './plugin-page-content'
import { resetPluginServicesForTests } from './plugin-services'

const service = (revision = 'r1'): PageContentService => ({
  read: async ({ pageId }) =>
    pageId === 'missing'
      ? { ok: false, status: 404, code: 'page_not_found', message: 'No such page.' }
      : {
          ok: true,
          pageId,
          versionId: 'v1',
          base: 'draft',
          revision,
          rootId: 'root',
          total: 1,
          elements: [{ id: 'root', kind: 'section', parentId: null, children: [], props: {} }],
          kinds: { section: { label: 'Section', acceptsChildren: true, props: {} } },
        },
  editDraft: async ({ pageId, edits }) => ({
    ok: true,
    pageId,
    versionId: 'v1',
    revision: `${revision}+`,
    applied: edits.length,
    created: [],
  }),
})

const input = { firestore: {}, orgId: 'o1', hostId: 'h1' }

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('page content (AGL-4235)', () => {
  it('is a single-implementation core contract', () => {
    expect(PLUGIN_PAGE_CONTENT.id).toBe('core.page-content')
  })

  it('is null with no plugin registered, so a caller answers that it is not available', () => {
    expect(resolvePluginPageContent()).toBeNull()
  })

  it('reads and edits through the plugin that registered', async () => {
    registerPluginPageContent(service(), { pluginId: 'editor' })
    await expect(resolvePluginPageContent()?.read({ ...input, pageId: 'p1' })).resolves.toMatchObject({
      ok: true,
      pageId: 'p1',
      base: 'draft',
      revision: 'r1',
    })
    await expect(resolvePluginPageContent()?.read({ ...input, pageId: 'missing' })).resolves.toMatchObject({
      ok: false,
      status: 404,
    })
    await expect(
      resolvePluginPageContent()?.editDraft({
        ...input,
        pageId: 'p1',
        edits: [{ op: 'rename', elementId: 'root', name: 'Hero' }],
        actor: { uid: null, label: 'API key' },
        editId: 'e1',
        mediaScopes: [],
      }),
    ).resolves.toEqual({ ok: true, pageId: 'p1', versionId: 'v1', revision: 'r1+', applied: 1, created: [] })
  })

  it('refuses a second plugin, and the first keeps answering', () => {
    const first = service()
    registerPluginPageContent(first, { pluginId: 'editor' })
    expect(() => registerPluginPageContent(service(), { pluginId: 'other' })).toThrow(/single-implementation/)
    expect(resolvePluginPageContent()).toBe(first)
  })

  it('lets the same plugin register again, replacing itself', () => {
    registerPluginPageContent(service(), { pluginId: 'editor' })
    const again = service('r2')
    registerPluginPageContent(again, { pluginId: 'editor' })
    expect(resolvePluginPageContent()).toBe(again)
  })
})
