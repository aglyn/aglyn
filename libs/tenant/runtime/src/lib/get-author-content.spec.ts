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
 * One page per person, across every collection (AGL-2518).
 *
 * The reshape of AGL-2517, which modelled an author as a FILTER on one
 * collection and so gave a writer as many partial archives as the site has
 * sections. The cases that matter here are the ones a per-collection archive
 * could not express at all: entries merged out of several collections, sorted
 * against each other, each still linking back to the section it came from.
 */

/** Author documents this host holds, by id. */
let authorDocs: Array<{ id: string; data: Record<string, unknown> }> = []
/** Collection documents, and the live entries each one's cached source holds. */
let collectionDocs: Array<Record<string, unknown>> = []
let sourceEntries: Record<string, Array<Record<string, unknown>>> = {}
/** Which collection slugs `getPublishedCollectionSource` was asked for. */
const requestedSources: string[] = []

const firestore = {
  collection: (name: string) => {
    if (name !== 'hosts') throw new Error(`unexpected collection ${name}`)
    return {
      doc: () => ({
        collection: (sub: string) => {
          if (sub === 'authors') {
            return {
              limit: () => ({
                get: async () => ({
                  docs: authorDocs.map((doc) => ({
                    id: doc.id,
                    data: () => ({ ...doc.data }),
                  })),
                }),
              }),
            }
          }
          if (sub === 'collections') {
            return {
              limit: () => ({
                get: async () => ({
                  docs: collectionDocs.map((value) => ({
                    data: () => ({ ...value }),
                    get: (key: string) => value[key],
                  })),
                }),
              }),
            }
          }
          throw new Error(`unexpected subcollection ${sub}`)
        },
      }),
    }
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => firestore }) },
}))

// Not under test; reads run straight through so a stored value can never make
// an assertion pass by accident.
jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  __esModule: true,
  PUBLISHED_SITE_DATA_TTL_SECONDS: 60,
  tenantDataTag: (hostId: string) => `tenant-data:${hostId}`,
  withRenderCache: async (options: { read: () => unknown }) => options.read(),
}))

/*
  The per-collection source is mocked rather than faked at the Firestore level
  because it is the SEAM this feature is built on: the author page reads the
  same cached source every collection listing already uses, so on a warm site
  it costs no new reads. Mocking it is what lets the spec assert that — see
  the read-cost case at the end.
*/
jest.mock('./get-collection-content', () => ({
  __esModule: true,
  getPublishedCollectionSource: async (options: { collectionSlug: string }) => {
    requestedSources.push(options.collectionSlug)
    return {
      collection: { slug: options.collectionSlug },
      entries: sourceEntries[options.collectionSlug] ?? [],
      categories: [],
      reachedBound: false,
    }
  },
}))

import * as Aglyn from '@aglyn/aglyn/server'
import buildAuthorPageNodes from './author-page-nodes'
import { getAuthorContent, listAuthorPageSlugs } from './get-author-content'

const HOST = 'host-1'

const entry = (
  id: string,
  fields: Record<string, unknown>,
): Record<string, unknown> => ({
  $id: id,
  title: id,
  slug: id,
  publishedAt: { seconds: 1_700_000_000 },
  ...fields,
})

beforeEach(() => {
  requestedSources.length = 0
  authorDocs = [
    { id: 'a1', data: { name: 'Zach Gover', slug: 'zg', bio: 'Builds things.' } },
  ]
  collectionDocs = [
    { slug: 'blog', displayName: 'Blog', kind: 'content' },
    { slug: 'changelog', displayName: 'Changelog', kind: 'content' },
    // Commerce's catalogs share this path (AGL-954) and own no entries.
    { slug: 'shop', displayName: 'Shop', kind: 'catalog' },
  ]
  sourceEntries = {
    blog: [
      entry('post-a', { authorId: 'a1', publishedAt: { seconds: 300 } }),
      entry('post-b', { authorName: 'Someone Else' }),
    ],
    changelog: [
      entry('note-a', { authorId: 'a1', publishedAt: { seconds: 400 } }),
    ],
  }
})

describe('an author page collects every collection (AGL-2518)', () => {
  it('merges their entries out of all of them', async () => {
    const content = await getAuthorContent({ hostId: HOST, authorSlug: 'zg' })
    expect(content.entries.map((item) => item.$id)).toEqual([
      // Newest first, sorted ACROSS collections rather than three lists
      // stacked — the point of the page is one body of work.
      'note-a',
      'post-a',
    ])
    expect(content.totalEntries).toBe(2)
    expect(content.known).toBe(true)
    expect(content.name).toBe('Zach Gover')
  })

  it('stamps each entry with the collection it came out of', async () => {
    // One page, several collections, so a card cannot build `entry.url` from
    // a single routed slug — a changelog note listed under a blog route would
    // link to a page that does not exist.
    const content = await getAuthorContent({ hostId: HOST, authorSlug: 'zg' })
    expect(
      content.entries.map((item) => [item.$id, item.collectionSlug, item.collectionName]),
    ).toEqual([
      ['note-a', 'changelog', 'Changelog'],
      ['post-a', 'blog', 'Blog'],
    ])
  })

  it('does not mutate the cached source it read from', async () => {
    // `source.entries` is shared with every other page rendering that
    // collection; writing this page's collection slug onto it would leak
    // context into theirs.
    await getAuthorContent({ hostId: HOST, authorSlug: 'zg' })
    for (const list of Object.values(sourceEntries)) {
      for (const item of list) {
        expect(item['collectionSlug']).toBeUndefined()
      }
    }
  })

  it('skips catalog collections, which own no entries', async () => {
    await getAuthorContent({ hostId: HOST, authorSlug: 'zg' })
    expect(requestedSources.sort()).toEqual(['blog', 'changelog'])
  })

  it('leaves other people’s posts out', async () => {
    const content = await getAuthorContent({ hostId: HOST, authorSlug: 'zg' })
    expect(content.entries.map((item) => item.$id)).not.toContain('post-b')
  })

  it('finds them by name and by record id too, not only by slug', async () => {
    for (const segment of ['zach-gover', 'a1']) {
      const content = await getAuthorContent({
        hostId: HOST,
        authorSlug: segment,
      })
      expect([segment, content.totalEntries]).toEqual([segment, 2])
    }
  })

  it('collects a legacy byline that was never a record', async () => {
    // Posts written before custom authors still appear under whoever wrote
    // them, which is the whole reason the matcher accepts four spellings.
    const content = await getAuthorContent({
      hostId: HOST,
      authorSlug: 'someone-else',
    })
    expect(content.entries.map((item) => item.$id)).toEqual(['post-b'])
    expect(content.known).toBe(true)
    expect(content.name).toBe('Someone Else')
    // No record behind it, so nothing to print but the name.
    expect(content.author).toBeNull()
  })
})

describe('narrowing before paging (AGL-2518)', () => {
  it('counts pages over the AUTHOR’s work, not the site’s', async () => {
    // The rule the category route states: counting first and filtering after
    // advertises pages that render empty.
    const content = await getAuthorContent({
      hostId: HOST,
      authorSlug: 'zg',
      perPage: 1,
    })
    expect(content.totalPages).toBe(2)
    expect(content.totalEntries).toBe(2)
  })

  it('hands over the WHOLE narrowed set, not this page’s slice', async () => {
    /*
      The window belongs to the Collection entries block, which receives
      `page`/`perPage` and slices for itself — exactly as it does on a routed
      collection listing, where `getCollectionContent` also passes the full
      filtered set.

      Slicing here as well double-windows: the block takes
      `slice(perPage, 2*perPage)` of an array that is already only `perPage`
      long, and every page after the first renders zero cards under a working
      pager. This assertion is the one that fails if that comes back.
    */
    for (const page of [1, 2]) {
      const content = await getAuthorContent({
        hostId: HOST,
        authorSlug: 'zg',
        page,
        perPage: 1,
      })
      expect([page, content.entries.map((item) => item.$id)]).toEqual([
        page,
        ['note-a', 'post-a'],
      ])
    }
  })

  it('the block then windows it, and page 2 is not empty', async () => {
    // The end-to-end of the case above, through the real expansion: a
    // unit-level assertion on `entries` cannot show that the rendered page
    // has cards on it.
    const content = await getAuthorContent({
      hostId: HOST,
      authorSlug: 'zg',
      page: 2,
      perPage: 1,
    })
    const nodes = buildAuthorPageNodes({
      slug: content.slug,
      name: content.name,
      author: content.author,
      hasEntries: content.entries.length > 0,
      page: content.page,
      perPage: content.perPage,
      totalPages: content.totalPages,
    })
    const expanded = Aglyn.expandCollectionEntries(
      nodes as never,
      {
        __author__: {
          slug: '__author__',
          entries: content.entries as never,
          categories: content.categories,
          page: content.page,
        },
      },
      '__author__',
    )
    const rendered = Object.values(expanded as Record<string, any>).filter(
      (node) => String(node?.$id ?? '').startsWith('centry__'),
    )
    expect(rendered.length).toBeGreaterThan(0)
    // …and it is the SECOND entry, not a repeat of page 1's.
    const titles = rendered
      .map((node) => String(node?.props?.children ?? ''))
      .filter((text) => text === 'post-a' || text === 'note-a')
    expect(titles).toEqual(['post-a'])
  })
})

describe('an author the page cannot resolve (AGL-2518)', () => {
  it('is not known, so the route can 404 rather than render nobody', async () => {
    const content = await getAuthorContent({
      hostId: HOST,
      authorSlug: 'nobody-at-all',
    })
    expect(content.known).toBe(false)
    expect(content.entries).toEqual([])
  })

  it('IS known with a record and no posts', async () => {
    /*
      The reversal of AGL-2517's read. That version took the record off the
      first matching entry to avoid a second Firestore read, so an author who
      had not published yet had no name, no bio and no links — their page
      rendered as an empty archive of nobody. A masthead entry for a real
      person is a real page.
    */
    sourceEntries = { blog: [], changelog: [] }
    const content = await getAuthorContent({ hostId: HOST, authorSlug: 'zg' })
    expect(content.known).toBe(true)
    expect(content.author?.bio).toBe('Builds things.')
    expect(content.entries).toEqual([])
    expect(content.totalPages).toBe(1)
  })

  it('is nothing at all for an empty slug', async () => {
    const content = await getAuthorContent({ hostId: HOST, authorSlug: '  ' })
    expect(content.known).toBe(false)
  })
})

describe('the sitemap’s view of the roster (AGL-2518)', () => {
  it('lists one address per author', async () => {
    authorDocs = [
      { id: 'a1', data: { name: 'Zach Gover', slug: 'zg' } },
      { id: 'a2', data: { name: 'Ada Lovelace' } },
    ]
    expect(await listAuthorPageSlugs({ hostId: HOST })).toEqual([
      { slug: 'zg', name: 'Zach Gover' },
      { slug: 'ada-lovelace', name: 'Ada Lovelace' },
    ])
  })

  it('drops an author who addresses nothing', async () => {
    // A count of author DOCUMENTS would advertise a sitemap file holding more
    // URLs than the sweep can produce — the index and the sweep have to agree
    // about the set, not merely about its size.
    authorDocs = [
      { id: 'a1', data: { name: 'Zach Gover' } },
      // No name at all: `normalizeContentAuthor` refuses it outright, because
      // a nameless byline is not a byline.
      { id: 'a2', data: { bio: 'Anonymous' } },
    ]
    expect(await listAuthorPageSlugs({ hostId: HOST })).toEqual([
      { slug: 'zach-gover', name: 'Zach Gover' },
    ])
  })

  it('never lists one address twice', async () => {
    // Two records deriving the same segment would otherwise submit a
    // duplicate URL, and the second one is unreachable anyway.
    authorDocs = [
      { id: 'a1', data: { name: 'Zach Gover' } },
      { id: 'a2', data: { name: 'zach gover' } },
    ]
    expect(await listAuthorPageSlugs({ hostId: HOST })).toHaveLength(1)
  })
})
