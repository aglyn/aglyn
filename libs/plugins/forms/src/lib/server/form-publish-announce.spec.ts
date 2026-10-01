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

/**
 * PUBLISHING A FORM DROPS THE CACHES OF THE PAGES THAT PLACE IT.
 *
 * A form publish had nothing to announce for as long as a placed form rendered
 * the fields the PAGE held: the entity's tree was written and read by nothing.
 * The moment a placed form resolves its entity, that inverts — one publish
 * changes the form on every page at once — and with no announcement those
 * pages keep serving the old fields until the hour-long `tenant-data:{hostId}`
 * document cache lapses, while the besigner says the live sites already serve
 * the new design.
 *
 * Two properties, split the way they fail:
 *
 * - WHICH pages (the walk) is a wrong-answer failure, so it is tested as data.
 *   The interesting cases are the indirect ones: a form in a layout's chrome,
 *   and a form inside a reusable component that a screen places. Both are
 *   invisible to a scan that only looks at screens, and both fail silently —
 *   the pages that ARE dropped update instantly, so the ones that were missed
 *   look like someone's browser cache.
 * - THAT the publish announces is a wiring failure, which renders perfectly,
 *   so it is asserted against the source. There is one publish path — the
 *   besigner and the form's version history both post to the promote route,
 *   as `besignerDocuments` declares — so there is one place to wire.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { screenIdsUsingFormDeep } from './form-publish-announce'

const FORM_ID = 'contact-form'

/** A node map placing the form. */
const placing = (formId = FORM_ID) => ({
  root: { $id: 'root', componentId: 'div', nodes: ['f'] },
  f: {
    $id: 'f',
    componentId: 'form',
    parentId: 'root',
    props: { formId },
    nodes: [],
  },
})

/** A node map placing an instance of `refId`. */
const instancing = (refId: string) => ({
  root: { $id: 'root', componentId: 'div', nodes: ['i'] },
  i: {
    $id: 'i',
    componentId: 'reusableInstance',
    parentId: 'root',
    props: { refId },
    nodes: [],
  },
})

describe('which pages a form publish invalidates', () => {
  it('finds a screen that places the form directly', () => {
    const ids = screenIdsUsingFormDeep(FORM_ID, {
      screens: [
        { id: 'contact', nodes: placing() },
        { id: 'about', nodes: placing('other-form') },
      ],
      layouts: [],
      components: [],
    })
    expect(ids).toEqual(['contact'])
  })

  it('finds every screen under a LAYOUT that places it', () => {
    const ids = screenIdsUsingFormDeep(FORM_ID, {
      screens: [
        { id: 'home', layoutId: 'marketing' },
        { id: 'pricing', layoutId: 'marketing' },
        { id: 'docs', layoutId: 'other' },
      ],
      layouts: [{ id: 'marketing', nodes: placing() }],
      components: [],
    })
    expect(ids.sort()).toEqual(['home', 'pricing'])
  })

  it('finds a screen that reaches it through a reusable component', () => {
    // The usual case: the signup form lives in a shared footer, and no screen
    // mentions the form at all.
    const ids = screenIdsUsingFormDeep(FORM_ID, {
      screens: [{ id: 'home', nodes: instancing('footer') }],
      layouts: [],
      components: [{ id: 'footer', nodes: placing() }],
    })
    expect(ids).toEqual(['home'])
  })

  it('follows component nesting, and a component held by a layout', () => {
    const ids = screenIdsUsingFormDeep(FORM_ID, {
      screens: [
        { id: 'deep', nodes: instancing('outer') },
        { id: 'chromed', layoutId: 'shell' },
      ],
      layouts: [{ id: 'shell', nodes: instancing('footer') }],
      components: [
        { id: 'footer', nodes: placing() },
        { id: 'outer', nodes: instancing('footer') },
      ],
    })
    expect(ids.sort()).toEqual(['chromed', 'deep'])
  })

  it('reports each screen once, however many ways it reaches the form', () => {
    const ids = screenIdsUsingFormDeep(FORM_ID, {
      screens: [{ id: 'home', nodes: { ...placing(), ...instancing('footer') } }],
      layouts: [],
      components: [{ id: 'footer', nodes: placing() }],
    })
    expect(ids).toEqual(['home'])
  })

  it('skips deleted documents and answers nothing for no form', () => {
    expect(
      screenIdsUsingFormDeep(FORM_ID, {
        screens: [{ id: 'gone', nodes: placing(), deletedAt: new Date() }],
        layouts: [],
        components: [],
      }),
    ).toEqual([])
    expect(
      screenIdsUsingFormDeep('', { screens: [], layouts: [], components: [] }),
    ).toEqual([])
  })
})

const readBeside = (file: string) => readFileSync(join(__dirname, file), 'utf8')

describe('the publish announces', () => {
  it('the promote route announces after its write', () => {
    // Fired, never awaited: the write already landed, and the scan reads
    // every screen, layout and component on the site.
    const source = readBeside('form-promote-route.ts')
    const wroteAt = source.indexOf('await formRef.update({')
    const announcedAt = source.indexOf(
      'void announceFormPublish({ firestore, hostId, formId })',
    )
    expect(wroteAt).toBeGreaterThan(-1)
    expect(announcedAt).toBeGreaterThan(wroteAt)
  })

  it('drops exactly the placing pages through the platform site cache', () => {
    // The plugin knows which pages; the app knows how to drop one on every
    // address the site answers at — so the drop is narrowed by `paths`.
    const source = readBeside('form-publish-announce.ts')
    expect(source).toContain('screenIdsUsingFormDeep(formId, sources.candidates)')
    expect(source).toMatch(/dropPluginSiteCache\(\{\s*hostIds: \[hostId\],\s*paths: \{ \[hostId\]: paths \},/)
  })

  it('drops the whole site when the scan could not read all of it', () => {
    // A prefix of the site would report a publish and leave placed pages
    // stale with nothing recording that they were skipped.
    const source = readBeside('form-publish-announce.ts')
    const truncatedAt = source.indexOf('if (sources.truncated) {')
    expect(truncatedAt).toBeGreaterThan(-1)
    expect(source.slice(truncatedAt, truncatedAt + 200)).toContain(
      'dropPluginSiteCache({ hostIds: [hostId], reason })',
    )
  })
})
