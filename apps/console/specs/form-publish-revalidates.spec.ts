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
 * - THAT it is called from each publish path is a wiring failure, which
 *   renders perfectly, so it is asserted against the source — the shape
 *   `component-publish-revalidates.spec.ts` uses next door.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { screenIdsUsingFormDeep } from '../utils/server/scan-artifact-usage'

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

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')

const FORM_BESIGNER =
  'apps/console/app/(editor)/[orgSlug]/hosts/[host]/forms/[formId]/versions/[versionId]/besigner/page.tsx'
const PROMOTE_ROUTE = 'apps/console/app/api/hosts/forms/promote/route.ts'
const ROUTE = 'apps/console/app/api/screens/revalidate/route.ts'
const HELPER = 'apps/console/utils/revalidate-live-pages.ts'

describe('both publish paths announce', () => {
  it('the besigner publish drops the pages that place the form', () => {
    const source = readRepo(FORM_BESIGNER)
    expect(source).toMatch(
      /revalidateLivePages\(\{ user, hostId, formId: formId as string \}\)/,
    )
    // Fired, never awaited: the publish already landed, and the scan reads
    // every screen, layout and component on the site.
    expect(source).toMatch(/void revalidateLivePages\(/)
  })

  it('the promote route announces server-side', () => {
    // It holds the revalidate secret already, so it calls the tenant itself
    // rather than asking the browser for a second authenticated hop.
    const source = readRepo(PROMOTE_ROUTE)
    expect(source).toMatch(
      /void announceFormPublish\(\{ firestore, hostId, formId \}\)/,
    )
  })

  it('the console route accepts a formId and scans for it', () => {
    const source = readRepo(ROUTE)
    expect(source).toMatch(/const formId = String\(/)
    expect(source).toMatch(/screenIdsUsingForm\(firestore, hostId, formId\)/)
    // The 400 has to name the new key, or a caller sending one gets told the
    // field it just sent is not a field.
    expect(source).toMatch(/componentId, formId or redirectPath/)
  })

  it('the client helper forwards it', () => {
    const source = readRepo(HELPER)
    expect(source).toMatch(/formId\?: string/)
    expect(source).toMatch(/\.\.\.\(formId \? \{ formId \} : \{\}\)/)
  })
})
