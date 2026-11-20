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

import { STARTER_TEMPLATES, starterTemplateDocId } from '@aglyn/aglyn/app-utils/starter-templates'
import { encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { settingsFirestoreDouble } from '../testing/settings-firestore-double'
import { listPageTemplates, pageTemplateDraft, readPageTemplate } from './page-templates'

const HOST = 'hosts/host-1'
const tree = { _: { $id: '_', componentId: 'div', nodes: [] , props: { text: 'Hi {{business}}' } } }
const [firstStarter, secondStarter] = STARTER_TEMPLATES
const firstPage = firstStarter.screens[0]
const firstPageId = starterTemplateDocId(firstStarter.id, firstPage.key)
const starterPageCount = STARTER_TEMPLATES.reduce((count, starter) => count + starter.screens.length, 0)

function site(templates: Record<string, Record<string, unknown>> = {}) {
  return settingsFirestoreDouble({
    [HOST]: {},
    ...Object.fromEntries(Object.entries(templates).map(([id, data]) => [`${HOST}/templates/${id}`, data])),
  })
}

const library = {
  landing: {
    kind: 'page',
    displayName: 'Landing',
    description: 'A landing page',
    category: 'Marketing',
    slug: 'landing',
    seo: { title: 'Welcome' },
    nodes: encodeStoredNodes(tree),
    placeholders: [{ name: 'business', label: 'Business', defaultValue: 'Acme' }, { name: 'prop.city' }],
    source: { type: 'authored' },
  },
  card: { kind: 'component', displayName: 'Card', source: { type: 'authored' } },
  old: { kind: 'page', displayName: 'Old', source: { type: 'authored' }, deletedAt: new Date() },
}

describe('listPageTemplates (AGL-4235)', () => {
  it('lists the site’s own page templates, then every built-in starter page from the definitions', async () => {
    const double = site(library)
    const { templates, nextCursor } = await listPageTemplates(double.firestore, 'host-1', { limit: '100' })
    expect(templates[0]).toEqual(
      expect.objectContaining({
        id: 'landing',
        name: 'Landing',
        source: 'site',
        placeholders: [{ name: 'business', label: 'Business', defaultValue: 'Acme' }],
      }),
    )
    expect(templates.map((template) => template.id)).not.toEqual(expect.arrayContaining(['card']))
    expect(templates.map((template) => template.id)).not.toEqual(expect.arrayContaining(['old']))
    expect(templates.slice(1).every((template) => template.source === 'built_in')).toBe(true)
    expect(templates).toHaveLength(1 + starterPageCount)
    expect(templates[1]).toEqual(expect.objectContaining({ id: firstPageId, name: firstPage.displayName, category: firstStarter.category }))
    expect(nextCursor).toBeNull()
    expect(double.writes).toEqual([])
  })

  it('pages through the library and then the starters', async () => {
    const double = site(library)
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const page = await listPageTemplates(double.firestore, 'host-1', { limit: '2', cursor })
      expect(page.templates.length).toBeLessThanOrEqual(2)
      seen.push(...page.templates.map((template) => template.id))
      cursor = page.nextCursor
    } while (cursor)
    expect(seen).toHaveLength(1 + starterPageCount)
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('reads a starter the site copied in from its copies, leaving out the ones it deleted', async () => {
    const copied = (key: string, extra: Record<string, unknown> = {}) => ({
      kind: 'page',
      displayName: `Edited ${key}`,
      source: { type: 'starter', starterId: secondStarter.id, starterOrder: 0 },
      ...extra,
    })
    const [kept, ...rest] = secondStarter.screens
    const double = site({
      [starterTemplateDocId(secondStarter.id, kept.key)]: copied(kept.key),
      ...Object.fromEntries(rest.map((screen) => [starterTemplateDocId(secondStarter.id, screen.key), copied(screen.key, { deletedAt: new Date() })])),
    })
    const { templates } = await listPageTemplates(double.firestore, 'host-1', { limit: '100' })
    const second = templates.filter((template) => template.id.startsWith(`starter-${secondStarter.id}-`))
    expect(second).toEqual([expect.objectContaining({ name: `Edited ${kept.key}`, source: 'built_in' })])
    expect(templates).toHaveLength(starterPageCount - rest.length)
  })
})

describe('readPageTemplate (AGL-4235)', () => {
  it('reads a library page template, a starter page, and nothing else', async () => {
    const double = site(library)
    expect(await readPageTemplate(double.firestore, 'host-1', 'landing')).toEqual(expect.objectContaining({ id: 'landing', source: 'site' }))
    expect(await readPageTemplate(double.firestore, 'host-1', firstPageId)).toEqual(
      expect.objectContaining({ id: firstPageId, source: 'built_in', nodes: firstPage.nodes }),
    )
    for (const id of ['card', 'old', 'nothing', 'starter-nothing-home']) {
      expect(await readPageTemplate(double.firestore, 'host-1', id)).toBeNull()
    }
  })
})

describe('pageTemplateDraft (AGL-4235)', () => {
  it('fills the placeholders in, defaults standing in, and carries the description, listing and slug', async () => {
    const template = (await readPageTemplate(site(library).firestore, 'host-1', 'landing'))!
    const draft = pageTemplateDraft(template, {})
    expect(draft).toEqual({
      ok: true,
      nodes: { _: expect.objectContaining({ props: { text: 'Hi Acme' } }) },
      description: 'A landing page',
      seo: { title: 'Welcome' },
      slug: 'landing',
    })
    expect(pageTemplateDraft(template, { business: 'Bakery' })).toEqual(
      expect.objectContaining({ nodes: { _: expect.objectContaining({ props: { text: 'Hi Bakery' } }) } }),
    )
  })

  it('names a placeholder the template does not ask for, a property binding included', async () => {
    const template = (await readPageTemplate(site(library).firestore, 'host-1', 'landing'))!
    expect(pageTemplateDraft(template, { phone: '1', 'prop.city': 'x' })).toEqual({
      ok: false,
      fields: { 'placeholders.phone': 'This template has no such placeholder', 'placeholders.prop.city': 'This template has no such placeholder' },
    })
  })
})
