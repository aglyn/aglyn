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
 * SAVING A CONTENT ENTRY DROPS THE CACHES OF THE PAGES THAT SHOW IT.
 *
 * Every other publish surface has announced itself since AGL-1150; entries
 * never did, and the omission is invisible in the way that arc's omissions
 * always are. The write lands, the console shows it immediately from its own
 * listener, and the site keeps serving the old post — for ten minutes on the
 * entry's own page, and for an hour anywhere the collection is rendered
 * through the compose-time source held under `tenant-data:{hostId}`. Nothing
 * anywhere says so, so it reads as somebody's browser cache.
 *
 * An entry is unlike every target above it in one way that decides the design:
 * it has no screen. `/blog/my-post` is served by the catch-all's collection
 * fallback whether or not a template screen exists, so a routing-map lookup
 * finds nothing to drop. The answer therefore has two halves — addresses
 * derived from the collection's slug, and screens that render the collection
 * somewhere else — and both are needed.
 *
 * Split the way the two halves fail:
 *
 * - WHICH pages is a wrong-answer failure, so the walk is tested as data. The
 *   interesting cases are the indirect ones — a rail in a layout's chrome, a
 *   collection block inside a reusable component — because those are the pages
 *   the change was most visibly supposed to reach.
 * - THAT each entry action calls it is a wiring failure, which renders
 *   perfectly, so it is asserted against the source — the shape
 *   `form-publish-revalidates.spec.ts` uses next door.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nodesRenderCollection } from '@aglyn/aglyn/server'
import { screenIdsUsingCollectionDeep } from '../utils/server/scan-artifact-usage'

const SLUG = 'blog'

/** A node map holding a Collection entries block bound to `collectionSlug`. */
const railFor = (collectionSlug = SLUG) => ({
  root: { $id: 'root', componentId: 'div', nodes: ['rail'] },
  rail: {
    $id: 'rail',
    componentId: 'collectionEntries',
    parentId: 'root',
    props: { collectionSlug },
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

describe('nodesRenderCollection', () => {
  it('matches the three blocks that can be bound by name', () => {
    for (const componentId of [
      'collectionEntries',
      'collectionCategories',
      'collectionSearch',
    ]) {
      const nodes = {
        b: { $id: 'b', componentId, props: { collectionSlug: SLUG } },
      }
      expect(nodesRenderCollection(nodes as never, SLUG)).toBe(true)
    }
  })

  it('ignores a block bound to a DIFFERENT collection', () => {
    expect(nodesRenderCollection(railFor('changelog') as never, SLUG)).toBe(
      false,
    )
  })

  it('ignores an UNBOUND block', () => {
    // It inherits the routed collection, which means it renders nothing at all
    // off-route and renders the routed collection on-route — where the
    // collection's own addresses already reach it. Counting it would make
    // every entry save drop every page carrying a collection block.
    const nodes = {
      rail: { $id: 'rail', componentId: 'collectionEntries', props: {} },
    }
    expect(nodesRenderCollection(nodes as never, SLUG)).toBe(false)
  })

  it('ignores Related posts, which only ever renders on an entry page', () => {
    const nodes = {
      r: {
        $id: 'r',
        componentId: 'collectionRelated',
        props: { collectionSlug: SLUG },
      },
    }
    expect(nodesRenderCollection(nodes as never, SLUG)).toBe(false)
  })
})

describe('which screens an entry change invalidates', () => {
  it('finds a screen that renders the collection directly', () => {
    const ids = screenIdsUsingCollectionDeep(SLUG, {
      screens: [
        { id: 'home', nodes: railFor() },
        { id: 'about', nodes: railFor('changelog') },
      ],
      layouts: [],
      components: [],
    })
    expect(ids).toEqual(['home'])
  })

  it('finds every screen under a LAYOUT that renders it', () => {
    // Category pills in shared chrome: no screen mentions the collection, and
    // every page of the site prints a taxonomy that an entry save can change.
    const ids = screenIdsUsingCollectionDeep(SLUG, {
      screens: [
        { id: 'home', layoutId: 'marketing' },
        { id: 'pricing', layoutId: 'marketing' },
        { id: 'docs', layoutId: 'other' },
      ],
      layouts: [{ id: 'marketing', nodes: railFor() }],
      components: [],
    })
    expect(ids.sort()).toEqual(['home', 'pricing'])
  })

  it('finds a screen that reaches it through a reusable component', () => {
    const ids = screenIdsUsingCollectionDeep(SLUG, {
      screens: [{ id: 'home', nodes: instancing('footer') }],
      layouts: [],
      components: [{ id: 'footer', nodes: railFor() }],
    })
    expect(ids).toEqual(['home'])
  })

  it('skips deleted screens', () => {
    const ids = screenIdsUsingCollectionDeep(SLUG, {
      screens: [
        { id: 'home', nodes: railFor() },
        { id: 'retired', nodes: railFor(), deletedAt: 1 },
      ],
      layouts: [],
      components: [],
    })
    expect(ids).toEqual(['home'])
  })

  it('answers nothing for an empty slug rather than everything', () => {
    expect(
      screenIdsUsingCollectionDeep('', {
        screens: [{ id: 'home', nodes: railFor() }],
        layouts: [],
        components: [],
      }),
    ).toEqual([])
  })
})

const readRepo = (relative: string) =>
  readFileSync(join(__dirname, '..', relative), 'utf8')

const SCOPE = 'components/content/content-scope.context.tsx'
const DETAIL = 'components/content/entry-detail-page.component.tsx'
const ROUTE = 'app/api/screens/revalidate/route.ts'
const HELPER = 'utils/revalidate-live-pages.ts'

describe('every entry action announces itself', () => {
  it('has ONE definition of the announcement, in the shared scope', () => {
    // Both surfaces change entries — the list's row menu and the detail page —
    // and a per-caller copy is the omission-repeated-per-call-site shape the
    // helper exists to prevent.
    const source = readRepo(SCOPE)
    expect(source).toMatch(/const announceEntryChange = useCallback\(/)
    expect(source).toMatch(/collectionId: selected\.\$id/)
    // Fired, never awaited: the write already landed, and the scan reads every
    // screen, layout and component on the site.
    expect(source).toMatch(/void revalidateLivePages\(/)
  })

  it('fires on publish, unpublish, delete, schedule and re-date', () => {
    const source = readRepo(SCOPE)
    // Named one by one rather than counted. Every one of these is a change a
    // visitor can see, and a count would go on passing while one of them
    // quietly lost its call to a refactor.
    // Publish/unpublish and delete both act on the row's entry.
    expect(source.match(/announceEntryChange\(\[entry\.slug\]\)/g)).toHaveLength(
      2,
    )
    expect(source).toMatch(/announceEntryChange\(\[scheduler\.entry\.slug\]\)/)
    expect(source).toMatch(/announceEntryChange\(\[publishDate\.entry\.slug\]\)/)
    // A category's name IS its listing address, so renaming one moves a live
    // URL even though no entry was touched.
    expect(source).toMatch(/announceEntryChange\(\)/)
  })

  it('fires on save, with the PREVIOUS slug when the address moved', () => {
    // The new address has never been rendered; the old one is a cached page
    // that now belongs to no entry.
    const source = readRepo(DETAIL)
    expect(source).toMatch(
      /announceEntryChange\(\[effectiveSlug, stored\.slug\]\)/,
    )
  })

  it('the console route accepts a collectionId and scans for it', () => {
    const source = readRepo(ROUTE)
    expect(source).toMatch(/const collectionId = String\(/)
    expect(source).toMatch(/screenIdsUsingCollectionDeep\(collectionSlug/)
    // The 400 has to name the new key, or a caller sending one gets told the
    // field it just sent is not a field.
    expect(source).toMatch(/formId, collectionId or redirectPath/)
  })

  it('the route sends the collection ADDRESSES too, not just screens', () => {
    // The half no routing-map lookup can supply: the catch-all serves
    // /blog/my-post whether or not a template screen exists.
    const source = readRepo(ROUTE)
    expect(source).toMatch(/collectionListUrl\(\{ collectionSlug \}\)/)
    expect(source).toMatch(/`\/\$\{collectionSlug\}\/\$\{entrySlug\}`/)
    // Commerce shares hosts/{hostId}/collections; its pages are routed by the
    // store's templates, so content addresses must not be built from one.
    expect(source).toMatch(/hostCollectionKind\(data\) !== 'content'/)
  })

  it('the client helper forwards it', () => {
    const source = readRepo(HELPER)
    expect(source).toMatch(/collectionId\?: string/)
    expect(source).toMatch(/entrySlugs\?: string\[\]/)
    expect(source).toMatch(/\.\.\.\(collectionId \? \{ collectionId \} : \{\}\)/)
  })
})
