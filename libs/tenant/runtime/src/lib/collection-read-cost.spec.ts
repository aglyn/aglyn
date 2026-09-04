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
 * What a collection LISTING costs in Firestore document reads.
 *
 * ## Why a cost suite, and why it can exist at all
 *
 * A collection is not one address. `/blog`, `/blog/page/2` through `/page/10`,
 * a `/blog/category/{slug}` for every category, `/blog/rss.xml` and any
 * "Latest posts" rail elsewhere on the site are all rendered from the SAME
 * bounded read of the same entries. Every one of them regenerates on its own
 * ISR window, and the publish path deliberately drops all of them at once, so
 * a saving here is multiplied by the number of addresses rather than by the
 * number of visitors.
 *
 * None of that is visible in behaviour. A loader that reads the collection
 * twice returns exactly what one that reads it once returns, which is why the
 * regression this guards against shipped in the first place and why the
 * assertions below are COUNTS. A phase timer would not have caught it either:
 * the second read is fast and correct, it is simply paid for.
 *
 * The counters sit on the query objects rather than on a spy of the loader, so
 * they measure the WIRE — the `.get()` calls that become billed document reads
 * — and not the shape of the call graph above it.
 */

/** Every `.get()` that reached the fake Firestore, by what it addressed. */
const reads = { collections: 0, entries: 0, authors: 0 }

let entryDocs: Array<Record<string, unknown>> = []
const collectionDoc: { fields: Record<string, unknown> | null } = {
  fields: null,
}

const snapshotFor = (id: string, value: Record<string, unknown>) => ({
  id,
  data: () => ({ ...value }),
  get: (key: string) => value[key],
  exists: true,
  ref: {
    update: async () => undefined,
    collection: (name: string) => entriesCollection(name),
  },
})

const entriesCollection = (name: string) => {
  if (name !== 'entries') throw new Error(`unexpected subcollection ${name}`)
  // `where('slug', '==', …)` is honoured rather than ignored: the entry
  // route's whole claim is that it reads ONE document, and a fake that hands
  // back the listing would let a loader that fetched the list pass it.
  let wantedSlug: string | undefined
  const query = {
    where: (field: string, _op: string, value: unknown) => {
      if (field === 'slug') wantedSlug = String(value)
      return query
    },
    limit: () => query,
    get: async () => {
      reads.entries += 1
      const matching =
        wantedSlug === undefined
          ? entryDocs
          : entryDocs.filter((value) => value['slug'] === wantedSlug)
      return {
        docs: matching.map((value) =>
          snapshotFor(String(value['$id'] ?? 'entry'), value),
        ),
      }
    },
  }
  return query
}

const firestore = {
  collection: (name: string) => {
    if (name !== 'hosts') throw new Error(`unexpected root ${name}`)
    return {
      doc: () => ({
        collection: (sub: string) => {
          if (sub === 'authors') {
            return { doc: (id: string) => ({ id }) }
          }
          if (sub !== 'collections') {
            throw new Error(`unexpected subcollection ${sub}`)
          }
          const query = {
            where: () => query,
            limit: () => query,
            get: async () => {
              reads.collections += 1
              return {
                docs:
                  collectionDoc.fields === null
                    ? []
                    : [snapshotFor('collection-1', collectionDoc.fields)],
              }
            },
          }
          return query
        },
      }),
    }
  },
  getAll: async (...refs: unknown[]) => {
    reads.authors += refs.length
    return []
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => firestore }) },
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: 'business' } }),
}))

/**
 * A REAL cache, not the pass-through the schedule suite uses.
 *
 * Pass-through is right there — that suite is asserting the publish gate and
 * a cache would let one case answer the next one's data. Here the cache IS
 * the subject: the whole claim is that a second address costs nothing, and a
 * pass-through stub would make a loader that never shares anything pass.
 *
 * Keyed on `key.join('|')` and honouring `store`, which is the one behaviour
 * of `withRenderCache` these cases actually depend on.
 */
const cacheStore = new Map<string, unknown>()
let cacheEnabled = true

jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  __esModule: true,
  PUBLISHED_SITE_DATA_TTL_SECONDS: 3600,
  tenantDataTag: (hostId: string) => `tenant-data:${hostId}`,
  withRenderCache: async (options: {
    key: readonly string[]
    read: () => Promise<unknown>
    store?: (value: unknown) => boolean
  }) => {
    if (!cacheEnabled) return options.read()
    const key = options.key.join('|')
    if (cacheStore.has(key)) return cacheStore.get(key)
    const value = await options.read()
    if (!options.store || options.store(value)) cacheStore.set(key, value)
    return value
  },
}))

import { COLLECTION_LIST_PAGE_SIZE } from '@aglyn/aglyn/server'
import {
  getCollectionContent,
  getPublishedCollectionSource,
} from './get-collection-content'

const HOST = 'host-1'
const nowSeconds = () => Math.floor(Date.now() / 1000)

const publishedEntry = (index: number) => ({
  $id: `entry-${index}`,
  title: `Post ${index}`,
  slug: `post-${index}`,
  status: 'published',
  publishedAt: { seconds: nowSeconds() - index * 3600 },
})

beforeEach(() => {
  reads.collections = 0
  reads.entries = 0
  reads.authors = 0
  cacheStore.clear()
  cacheEnabled = true
  entryDocs = Array.from({ length: 25 }, (_, index) => publishedEntry(index))
  collectionDoc.fields = {
    displayName: 'Blog',
    slug: 'blog',
    kind: 'content',
    categories: [{ id: 'guides', name: 'Guides' }],
  }
})

const listPage = (page: number, categorySlug?: string) =>
  getCollectionContent({
    hostId: HOST,
    collectionSlug: 'blog',
    page,
    perPage: COLLECTION_LIST_PAGE_SIZE,
    ...(categorySlug ? { categorySlug } : {}),
  })

describe('every listing address of one collection shares ONE read', () => {
  it('reads the entries once across page 1, the deeper pages and a category', async () => {
    await listPage(1)
    await listPage(2)
    await listPage(3)
    await listPage(1, 'guides')
    // Four addresses. Before this was shared each one issued its own
    // collection lookup AND its own bounded entries read, so a 25-entry blog
    // cost 4 × (1 + 25) document reads to render 4 × 10 cards.
    expect(reads.entries).toBe(1)
    expect(reads.collections).toBe(1)
  })

  it('answers the RSS feed and a compose-time rail from that same read', async () => {
    await listPage(1)
    // The feed takes the whole collection, unpaginated.
    await getCollectionContent({ hostId: HOST, collectionSlug: 'blog' })
    // A "Latest posts" block on some other screen.
    await getPublishedCollectionSource({ hostId: HOST, collectionSlug: 'blog' })
    expect(reads.entries).toBe(1)
  })

  it('still returns the right page window off the shared read', async () => {
    const first = await listPage(1)
    const second = await listPage(2)
    // The window is applied by the entries block, so the loader hands over
    // the whole live set on both — what must not differ is the PAGINATION it
    // stamped, which is what the pager and the 404-past-the-end test read.
    expect(first.pagination).toEqual({
      page: 1,
      perPage: 10,
      totalEntries: 25,
      totalPages: 3,
    })
    expect(second.pagination?.page).toBe(2)
    expect(second.entries).toHaveLength(25)
  })

  it('keeps the category route describing the FILTERED set', async () => {
    entryDocs = [
      { ...publishedEntry(1), categoryId: 'guides' },
      { ...publishedEntry(2), categoryId: 'guides' },
      publishedEntry(3),
    ]
    const filtered = await listPage(1, 'guides')
    expect(filtered.category).toEqual({
      slug: 'guides',
      id: 'guides',
      name: 'Guides',
      known: true,
    })
    expect(filtered.entries.map((entry) => entry.$id)).toEqual([
      'entry-1',
      'entry-2',
    ])
    expect(filtered.pagination?.totalEntries).toBe(2)
  })

  it('carries the collection document a template route renders through', async () => {
    collectionDoc.fields = {
      ...(collectionDoc.fields as Record<string, unknown>),
      listScreenId: 'blogListTmpl',
      entryScreenId: 'blogEntryTmpl',
    }
    const content = await listPage(1)
    // Read off the CACHED source now rather than off a second lookup, so a
    // template that stops resolving is a silently unstyled listing.
    expect(content.collection).toMatchObject({
      $id: 'collection-1',
      displayName: 'Blog',
      slug: 'blog',
      listScreenId: 'blogListTmpl',
      entryScreenId: 'blogEntryTmpl',
    })
  })
})

describe('a collection still waiting on a schedule is served, never stored', () => {
  /**
   * NOTHING promotes a content entry on a beat — `publish-schedule-job.ts` is
   * screens-only — so `flipDueEntry` during a render is the entire mechanism.
   * A cache that stored these collections would not merely serve stale
   * entries; it would suppress the renders that publish them, and the post
   * would land on the TTL instead of on its time.
   */
  it('re-reads a collection holding a not-yet-due scheduled entry', async () => {
    entryDocs = [
      publishedEntry(1),
      {
        $id: 'entry-later',
        title: 'Later',
        slug: 'later',
        status: 'scheduled',
        publishAt: { seconds: nowSeconds() + 3600 },
      },
    ]
    await listPage(1)
    await listPage(2)
    expect(reads.entries).toBe(2)
  })

  it('caches again once that schedule has been terminally refused', async () => {
    entryDocs = [
      publishedEntry(1),
      {
        $id: 'entry-later',
        title: 'Later',
        slug: 'later',
        status: 'scheduled',
        publishAt: { seconds: nowSeconds() + 3600 },
        // What `flipDueEntry` writes for a plan that cannot schedule. Left
        // uncacheable forever, an unentitled org would pay the uncached read
        // on every listing render for the life of the entry.
        scheduleStatus: 'skipped-unentitled',
      },
    ]
    await listPage(1)
    await listPage(2)
    expect(reads.entries).toBe(1)
  })

  it('caches a collection whose schedule has already come due', async () => {
    entryDocs = [
      publishedEntry(1),
      {
        $id: 'entry-due',
        title: 'Due',
        slug: 'due',
        status: 'scheduled',
        publishAt: { seconds: nowSeconds() - 3600 },
      },
    ]
    const first = await listPage(1)
    await listPage(2)
    // Due means published as of this render, so there is nothing left for a
    // later render to notice.
    expect(first.entries.map((entry) => entry.$id)).toContain('entry-due')
    expect(reads.entries).toBe(1)
  })

  it('does not cache a slug that resolved to no collection', async () => {
    collectionDoc.fields = null
    expect((await listPage(1)).collection).toBeNull()
    collectionDoc.fields = {
      displayName: 'Blog',
      slug: 'blog',
      kind: 'content',
      categories: [],
    }
    // A collection created a moment later must not be invisible for an hour.
    expect((await listPage(1)).collection).not.toBeNull()
  })
})

describe('the entry route is untouched by any of this', () => {
  it('reads ONE entry document by slug, not the bounded list', async () => {
    cacheEnabled = false
    const content = await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'blog',
      entrySlug: 'post-3',
    })
    expect(content.entry?.$id).toBe('entry-3')
    // One collection lookup and one slug query. The listing read must never
    // be pulled in to serve an article.
    expect(reads.collections).toBe(1)
    expect(reads.entries).toBe(1)
  })
})
