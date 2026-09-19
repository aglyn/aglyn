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
 * A content collection is not a page until something in it is live
 * (AGL-3101).
 *
 * Creating a collection used to publish its listing at once. `/{slug}`
 * resolved for every content collection that existed, so a new `videos`
 * collection served an empty "Videos" page — with a feed and a markdown twin
 * beside it — the moment it was created, before a single entry had been
 * written.
 *
 * `getCollectionContent` now answers a listing only for a collection holding
 * at least one LIVE entry, by the notion of live every other read in this file
 * already uses: published, or scheduled with its time come on a plan that can
 * schedule. `collection: null` is the answer that makes the page, the feed and
 * the markdown twin 404, so that is what the first group asserts.
 *
 * The rest pins what the rule must not move: a live collection answers exactly
 * as it did, an EMPTY category of a live collection still renders, a read too
 * large to prove the collection empty still answers, and the compose-time
 * source a Collection entries block reads still hands over an empty list
 * rather than a missing collection.
 */

let entryDocs: Array<Record<string, unknown>> = []
const collectionDoc: { fields: Record<string, unknown> | null } = {
  fields: null,
}
let orgForHost: { orgId: string; org: Record<string, unknown> } | null = null

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

/**
 * Honors the `where` and `limit` the loader sends rather than ignoring them:
 * the bounded-read case below is only honest if the fake stops where the real
 * query stops.
 */
const entriesCollection = (name: string) => {
  if (name !== 'entries') throw new Error(`unexpected subcollection ${name}`)
  const filters: Array<(value: Record<string, unknown>) => boolean> = []
  let take = Number.POSITIVE_INFINITY
  const query = {
    where: (field: string, op: string, wanted: unknown) => {
      filters.push((value) =>
        op === 'in'
          ? (wanted as unknown[]).includes(value[field])
          : value[field] === wanted,
      )
      return query
    },
    limit: (count: number) => {
      take = count
      return query
    },
    get: async () => ({
      docs: entryDocs
        .filter((value) => filters.every((matches) => matches(value)))
        .slice(0, take)
        .map((value) => snapshotFor(String(value['$id']), value)),
    }),
  }
  return query
}

const firestore = {
  collection: (name: string) => {
    if (name !== 'hosts') throw new Error(`unexpected root ${name}`)
    return {
      doc: () => ({
        collection: (sub: string) => {
          if (sub === 'authors') return { doc: (id: string) => ({ id }) }
          if (sub !== 'collections') {
            throw new Error(`unexpected subcollection ${sub}`)
          }
          const query = {
            where: () => query,
            limit: () => query,
            get: async () => ({
              docs:
                collectionDoc.fields === null
                  ? []
                  : [snapshotFor('collection-1', collectionDoc.fields)],
            }),
          }
          return query
        },
      }),
    }
  },
  getAll: async () => [],
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => firestore }) },
  getOrgForHost: async () => orgForHost,
}))

// Pass-through: every case sets its own collection, and a real cache would
// answer one case with the last one's read.
jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  __esModule: true,
  PUBLISHED_SITE_DATA_TTL_SECONDS: 3600,
  tenantDataTag: (hostId: string) => `tenant-data:${hostId}`,
  withRenderCache: async (options: { read: () => unknown }) => options.read(),
}))

import {
  COLLECTION_LIST_PAGE_SIZE,
  COLLECTION_SOURCE_MAX,
} from '@aglyn/aglyn/server'
import {
  getCollectionContent,
  getPublishedCollectionSource,
} from './get-collection-content'

const HOST = 'host-1'
const nowSeconds = () => Math.floor(Date.now() / 1000)
const IN_AN_HOUR = () => ({ seconds: nowSeconds() + 3600 })
const AN_HOUR_AGO = () => ({ seconds: nowSeconds() - 3600 })

const published = (index: number, extra: Record<string, unknown> = {}) => ({
  $id: `video-${index}`,
  title: `Video ${index}`,
  slug: `video-${index}`,
  status: 'published',
  publishedAt: { seconds: nowSeconds() - index * 3600 },
  ...extra,
})

beforeEach(() => {
  entryDocs = []
  orgForHost = { orgId: 'org-1', org: { plan: 'business' } }
  collectionDoc.fields = {
    displayName: 'Videos',
    slug: 'videos',
    kind: 'content',
    categories: [
      { id: 'demos', name: 'Demos' },
      { id: 'talks', name: 'Talks' },
    ],
  }
})

/** A routed listing, as the page loader asks for one. */
const listing = (options: { page?: number; categorySlug?: string } = {}) =>
  getCollectionContent({
    hostId: HOST,
    collectionSlug: 'videos',
    page: options.page ?? 1,
    perPage: COLLECTION_LIST_PAGE_SIZE,
    ...(options.categorySlug ? { categorySlug: options.categorySlug } : {}),
  })

describe('a collection with nothing live is not a listing (AGL-3101)', () => {
  it('answers no collection at /{slug} for a collection just created', async () => {
    const content = await listing()
    // The page loader, the RSS feed and the markdown twin all read
    // `collection: null` as "404" — the same answer a slug that names no
    // collection at all has always had.
    expect(content.collection).toBeNull()
    expect(content.entries).toEqual([])
  })

  it('answers none at /{slug}/page/{n} or /{slug}/category/{c} either', async () => {
    expect((await listing({ page: 1 })).collection).toBeNull()
    expect((await listing({ page: 2 })).collection).toBeNull()
    expect((await listing({ categorySlug: 'demos' })).collection).toBeNull()
    // A segment that names no category rendered an empty `noindex` listing;
    // with nothing live there is no listing for it to be a filter of.
    expect((await listing({ categorySlug: 'ghosts' })).collection).toBeNull()
  })

  it('answers none for the unpaginated read the RSS feed makes', async () => {
    const content = await getCollectionContent({
      hostId: HOST,
      collectionSlug: 'videos',
    })
    expect(content.collection).toBeNull()
  })

  it('does not count a draft, a schedule still to come, or a refused one', async () => {
    entryDocs = [
      { $id: 'draft', title: 'Draft', slug: 'draft', status: 'draft' },
      {
        $id: 'later',
        title: 'Later',
        slug: 'later',
        status: 'scheduled',
        publishAt: IN_AN_HOUR(),
      },
      {
        $id: 'refused',
        title: 'Refused',
        slug: 'refused',
        status: 'scheduled',
        publishAt: AN_HOUR_AGO(),
        scheduleStatus: 'skipped-unentitled',
      },
    ]
    expect((await listing()).collection).toBeNull()
  })

  it('does not count a due schedule on a plan that cannot publish it', async () => {
    orgForHost = { orgId: 'org-1', org: { plan: 'free' } }
    entryDocs = [
      {
        $id: 'due',
        title: 'Due',
        slug: 'due',
        status: 'scheduled',
        publishAt: AN_HOUR_AGO(),
      },
    ]
    expect((await listing()).collection).toBeNull()
  })
})

describe('one live entry makes it a listing, answered exactly as before', () => {
  it('serves /{slug} once an entry is published', async () => {
    entryDocs = [published(1)]
    const content = await listing()
    expect(content.collection).toMatchObject({
      $id: 'collection-1',
      displayName: 'Videos',
      slug: 'videos',
    })
    expect(content.entries.map((entry) => entry.$id)).toEqual(['video-1'])
    expect(content.pagination).toEqual({
      page: 1,
      perPage: COLLECTION_LIST_PAGE_SIZE,
      totalEntries: 1,
      totalPages: 1,
    })
  })

  it('counts a schedule that has come due on a plan that can schedule', async () => {
    entryDocs = [
      {
        $id: 'due',
        title: 'Due',
        slug: 'due',
        status: 'scheduled',
        publishAt: AN_HOUR_AGO(),
      },
    ]
    const content = await listing()
    expect(content.collection).not.toBeNull()
    expect(content.entries.map((entry) => entry.$id)).toEqual(['due'])
  })

  it('still renders an EMPTY category of a live collection', async () => {
    entryDocs = [published(1, { categoryId: 'demos' })]
    const content = await listing({ categorySlug: 'talks' })
    // Liveness is a fact about the COLLECTION, read before the filter. A
    // category with nothing in it yet is still a page of a live collection,
    // where a reader can pick another pill rather than hit a 404.
    expect(content.collection).not.toBeNull()
    expect(content.entries).toEqual([])
    expect(content.category).toEqual({
      slug: 'talks',
      id: 'talks',
      name: 'Talks',
      known: true,
    })
    expect(content.pagination?.totalPages).toBe(1)
  })

  it('keeps answering a read too large to prove the collection empty', async () => {
    // Fail-open. The query stops at `COLLECTION_SOURCE_MAX`, and when every
    // document it returned was a schedule still to come, the published
    // entries past the bound are simply unseen — "nothing live" is a claim
    // this read cannot make, so the listing stays up as it always did.
    entryDocs = Array.from({ length: COLLECTION_SOURCE_MAX }, (_, index) => ({
      $id: `later-${index}`,
      title: `Later ${index}`,
      slug: `later-${index}`,
      status: 'scheduled',
      publishAt: IN_AN_HOUR(),
    }))
    const content = await listing()
    expect(content.entries).toEqual([])
    expect(content.entriesReachedBound).toBe(true)
    expect(content.collection).not.toBeNull()
  })
})

describe('the compose-time source is untouched', () => {
  it('still hands a Collection entries block an empty collection, not a missing one', async () => {
    const source = await getPublishedCollectionSource({
      hostId: HOST,
      collectionSlug: 'videos',
    })
    // A block on some other page — and the author page — read this rather
    // than the listing. There an empty collection has always been an empty
    // list, and a block that lost its collection would render differently.
    expect(source.collection).toMatchObject({
      $id: 'collection-1',
      slug: 'videos',
    })
    expect(source.entries).toEqual([])
  })
})
