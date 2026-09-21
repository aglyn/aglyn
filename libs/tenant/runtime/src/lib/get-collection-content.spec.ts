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

/** Writes the loader made, so a spec can assert a schedule actually went out. */
let entryUpdates: Array<{ id: string; patch: Record<string, unknown> }> = []

/** Set to fail the ORDERED read, as a missing composite index does. */
let orderedReadFails = false

const snapshotFor = (id: string, value: Record<string, unknown>) => ({
  id,
  data: () => ({ ...value }),
  get: (key: string) => value[key],
  exists: true,
  ref: {
    update: async (patch: Record<string, unknown>) => {
      entryUpdates.push({ id, patch })
      return undefined
    },
    collection: (name: string) => entriesCollection(name),
  },
})

/**
 * Honors the `where` and `limit` the loader sends rather than ignoring them:
 * the bounded-read case below is only honest if the fake stops where the real
 * query stops.
 */
/**
 * Apply a field mask the way Firestore does (AGL-3213): a field the query did
 * not ask for is ABSENT from the snapshot, not merely ignored.
 *
 * Honored rather than waved through, for the reason the `where('slug', '==')`
 * below is honored. `select()` is the one query builder whose mistakes are
 * invisible — a field left out of the mask arrives `undefined`, which is a
 * value the readers all tolerate, so a fake that returned the whole document
 * would let a mask missing `publishAt` or `updatedAt` pass every assertion in
 * this file. The two fields that went missing this way for months (AGL-2486,
 * AGL-2534) were lost to exactly that shape of silence.
 */
const applyMask = (
  value: Record<string, unknown>,
  mask: readonly string[] | null,
): Record<string, unknown> => {
  if (!mask) return value
  const masked: Record<string, unknown> = {}
  for (const field of mask) {
    if (field in value) masked[field] = value[field]
  }
  return masked
}

/**
 * The value an ordered read sorts on: a timestamp by its seconds, the
 * document name by its id, anything else as it is.
 */
const sortValue = (value: Record<string, unknown>, field: string): unknown => {
  if (field === '__name__') return String(value['$id'])
  const raw = value[field]
  if (raw && typeof raw === 'object' && 'seconds' in (raw as object)) {
    return Number((raw as { seconds: number }).seconds)
  }
  return raw
}

interface FakeQueryState {
  filters: Array<{ field: string; op: string; wanted: unknown }>
  orders: Array<{ field: string; direction: 'asc' | 'desc' }>
  mask: readonly string[] | null
  take: number
  skip: number
  /** The document a `startAfter` cursor names, if any (AGL-3219). */
  after: Record<string, unknown> | null
}

/**
 * A query BUILDS A NEW QUERY, it does not mutate the one it was called on.
 *
 * Firestore's builders are immutable, and a fake that accumulated state on one
 * shared object read fine for a loader that built one query per collection
 * reference — which this one did until AGL-3213. It now builds three, and on a
 * mutating fake their predicates merged — a status that must be published or
 * scheduled AND equal to scheduled — and matched nothing. The fake would have
 * reported a collection with no live entries at all, for code that is
 * correct.
 */
const entriesQuery = (state: FakeQueryState) => {
  const matching = () => {
    const rows = entryDocs
      .filter((value) =>
        state.filters.every(({ field, op, wanted }) =>
          op === 'in'
            ? (wanted as unknown[]).includes(value[field])
            : value[field] === wanted,
        ),
      )
      /*
       * The rows an ordered read would NOT RETURN AT ALL (AGL-3213).
       *
       * `orderBy(field)` omits every document missing that field — it does not
       * sort them last. That omission is the whole reason the loader's live
       * read is three queries instead of one, so a fake that sorted such a row
       * to the end would let a read that hides every schedule pass this file.
       */
      .filter((value) =>
        state.orders.every(
          (order) =>
            order.field === '__name__' || value[order.field] !== undefined,
        ),
      )
    if (!state.orders.length) return rows
    const sorted = [...rows].sort((a, b) => {
      for (const order of state.orders) {
        const left = sortValue(a, order.field)
        const right = sortValue(b, order.field)
        if (left === right) continue
        const ascending = (left as never) < (right as never) ? -1 : 1
        return order.direction === 'desc' ? -ascending : ascending
      }
      return 0
    })
    if (!state.after) return sorted
    /*
     * `startAfter(doc)` positions by the ORDERED VALUES of that document, so
     * the fake has to find it in the sorted rows rather than filter by id.
     * A cursor document the query itself would not return — a draft, say —
     * still positions correctly in Firestore; here it simply is not found,
     * and an empty page is the safe reading for a spec.
     */
    const at = sorted.findIndex(
      (row) => String(row['$id']) === String(state.after?.['$id']),
    )
    return at < 0 ? [] : sorted.slice(at + 1)
  }

  return {
    where: (field: string, op: string, wanted: unknown) =>
      entriesQuery({
        ...state,
        filters: [...state.filters, { field, op, wanted }],
      }),
    select: (...fields: string[]) => entriesQuery({ ...state, mask: fields }),
    orderBy: (field: string, direction: 'asc' | 'desc' = 'asc') =>
      entriesQuery({
        ...state,
        orders: [...state.orders, { field, direction }],
      }),
    offset: (count: number) => entriesQuery({ ...state, skip: count }),
    startAfter: (cursor: { id: string }) =>
      entriesQuery({
        ...state,
        after: entryDocs.find((row) => String(row['$id']) === cursor.id) ?? {
          $id: cursor.id,
        },
      }),
    limit: (count: number) => entriesQuery({ ...state, take: count }),
    count: () => ({
      get: async () => ({ data: () => ({ count: matching().length }) }),
    }),
    get: async () => {
      // A composite index the project has not deployed fails the QUERY, not
      // the connection — which is why the loader has a fallback at all.
      if (orderedReadFails && state.orders.length) {
        throw new Error('FAILED_PRECONDITION: The query requires an index.')
      }
      return {
        docs: matching()
          .slice(state.skip, state.skip + state.take)
          // The id comes off the UNMASKED row: `$id` is the fake's own key,
          // not a document field, and Firestore never puts the id in the mask.
          .map((value) =>
            snapshotFor(String(value['$id']), applyMask(value, state.mask)),
          ),
      }
    },
  }
}

const entriesCollection = (name: string) => {
  if (name !== 'entries') throw new Error(`unexpected subcollection ${name}`)
  const query = entriesQuery({
    filters: [],
    orders: [],
    mask: null,
    take: Number.POSITIVE_INFINITY,
    skip: 0,
    after: null,
  })
  // A cursor read resolves its position with a DIRECT get (AGL-3219), not a
  // query, so the collection reference has to answer `doc(id)` too.
  return Object.assign(query, {
    doc: (id: string) => ({
      get: async () => {
        const row = entryDocs.find((value) => String(value['$id']) === id)
        return row
          ? snapshotFor(id, row)
          : { id, exists: false, data: () => undefined }
      },
    }),
  })
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
            select: () => query,
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
  collectionEntriesPageWindow,
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
  entryUpdates = []
  orderedReadFails = false
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
const listing = (
  options: {
    page?: number
    categorySlug?: string
    after?: string
    before?: string
  } = {},
) =>
  getCollectionContent({
    hostId: HOST,
    collectionSlug: 'videos',
    page: options.page ?? 1,
    perPage: COLLECTION_LIST_PAGE_SIZE,
    ...(options.categorySlug ? { categorySlug: options.categorySlug } : {}),
    ...(options.after ? { after: options.after } : {}),
    ...(options.before ? { before: options.before } : {}),
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
      // Inside the bound the totals are still exact and still stated
      // (AGL-3219): one read holds the whole collection, so counting it is
      // honest. Both cursors are empty — nowhere older, nowhere newer.
      nextCursor: '',
      prevCursor: '',
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

/**
 * A collection with more live entries than one read may hold (AGL-3213).
 *
 * `published(index)` dates entry `index` hours ago, so index 0 is the newest
 * and the ids sort in a DIFFERENT order than the dates do — `video-100` sorts
 * between `video-10` and `video-11`. That divergence is the point: it is what
 * made an unordered `limit(100)` return an arbitrary hundred rather than the
 * newest hundred, and it is what these cases would not be able to see if the
 * fixture's ids and dates agreed.
 */
describe('a collection past the bound', () => {
  const entries = (count: number) => {
    entryDocs = Array.from({ length: count }, (_, index) => published(index))
  }

  it('holds the NEWEST page, not the page the ids sorted to', async () => {
    entries(150)
    const source = await getPublishedCollectionSource({
      hostId: HOST,
      collectionSlug: 'videos',
    })
    expect(source.reachedBound).toBe(true)
    expect(source.entries).toHaveLength(COLLECTION_SOURCE_MAX)
    expect(source.entries[0]?.slug).toBe('video-0')
    expect(source.entries.at(-1)?.slug).toBe(`video-${COLLECTION_SOURCE_MAX - 1}`)
    // The id-ordered read took `video-100` inside its first hundred and left
    // `video-99` out of it. Ordering by date is what reverses that.
    expect(source.entries.map((entry) => entry.slug)).not.toContain('video-100')
  })

  it('states no total it cannot know, and says so with a cursor', async () => {
    entries(150)
    const content = await listing()
    /*
     * Past the bound there IS no honest total (AGL-3219). The old answer was
     * a `count()` over a set the listing's two reads disagreed about, which
     * is what let page 10 of a seventeen-page changelog call itself the last
     * one. Absent beats wrong.
     */
    expect(content.pagination?.totalEntries).toBeUndefined()
    expect(content.pagination?.totalPages).toBeUndefined()
    // What a pager actually needs is not the total but whether anything
    // follows, and the newest page's last entry is where it follows FROM.
    expect(content.pagination?.nextCursor).toBe(
      `video-${COLLECTION_LIST_PAGE_SIZE - 1}`,
    )
    expect(content.pagination?.prevCursor).toBe('')
  })

  it('counts a collection it can read whole, exactly as before', async () => {
    entries(12)
    const content = await listing()
    // Inside the bound one read holds everything, every page is sliced out of
    // that one snapshot, and a total is both knowable and stable. Nothing
    // about those listings changes.
    expect(content.pagination?.totalEntries).toBe(12)
    expect(content.pagination?.totalPages).toBe(2)
  })

  it('serves a page past the bound from its cursor', async () => {
    entries(150)
    const content = await listing({ after: 'video-109' })
    expect(content.entries).toHaveLength(COLLECTION_LIST_PAGE_SIZE)
    expect(content.entries[0]?.slug).toBe('video-110')
    expect(content.entries.at(-1)?.slug).toBe('video-119')
    expect(content.pagination?.nextCursor).toBe('video-119')
  })

  it('hands a cursor page through whole, without windowing it twice', async () => {
    entries(150)
    const content = await listing({ after: 'video-109', page: 12 })
    // Every consumer slices `[(page - 1) * perPage, …)`. Handed ten entries
    // and no `windowStart`, all of them would slice from 110 of an array of
    // ten and render an empty listing.
    expect(content.pagination?.windowStart).toBe(110)
    expect(
      collectionEntriesPageWindow(content.entries, content.pagination),
    ).toHaveLength(COLLECTION_LIST_PAGE_SIZE)
  })

  it('gives a cursor page the same entries whatever the page label says', async () => {
    entries(150)
    const real = await listing({ after: 'video-109', page: 12 })
    // The counter is a label; the cursor is the address. A hand-edited number
    // moves the window and the offset that corrects for it by the same
    // amount, so the reader still gets the cursor's page.
    const mislabelled = await listing({ after: 'video-109', page: 99 })
    expect(
      collectionEntriesPageWindow(mislabelled.entries, mislabelled.pagination)
        .map((entry) => entry.slug),
    ).toEqual(
      collectionEntriesPageWindow(real.entries, real.pagination).map(
        (entry) => entry.slug,
      ),
    )
  })

  it('does not move a cursor page when something is published above it', async () => {
    /*
     * THE SEAM (AGL-3219). `v1.0.0-beta.147` served, and `/changelog` showed
     * one entry as both the last of page 10 and the first of page 11: the
     * head was a cached snapshot from before the publish, the deep page was a
     * live offset read from after it, and one insert at the head had moved
     * every position under them by one.
     *
     * A cursor page is the answer to "what follows THIS entry", which no
     * insert above it can change. The same read, before and after publishing
     * a hundred newer entries, returns the same ten.
     */
    entries(150)
    const before = await listing({ after: 'video-109' })
    entryDocs = [
      ...Array.from({ length: 100 }, (_, index) => ({
        ...published(index),
        $id: `newer-${index}`,
        slug: `newer-${index}`,
        publishedAt: { seconds: 1_900_000_000 - index },
      })),
      ...entryDocs,
    ]
    const after = await listing({ after: 'video-109' })
    expect(after.entries.map((entry) => entry.slug)).toEqual(
      before.entries.map((entry) => entry.slug),
    )
    expect(after.entries[0]?.slug).toBe('video-110')
  })

  it('serves the pages inside the bound from the shared read', async () => {
    entries(150)
    const content = await listing({ page: 2 })
    // No cursor read, so nothing to correct for: the cached source already
    // holds page 2, and paying a second read for it would undo the sharing
    // that makes every listing address free.
    expect(content.pagination?.windowStart).toBeUndefined()
    expect(content.entries).toHaveLength(COLLECTION_SOURCE_MAX)
  })
})

describe('the live read drops nothing', () => {
  it('lists an entry that carries no publish date at all', async () => {
    // An import restores what the bundle carried, and `/api/hosts/resources`
    // validates no field for presence — so a published entry with no
    // `publishedAt` exists, and an ordered read alone would hide it.
    entryDocs = [
      published(0),
      { $id: 'undated', title: 'Undated', slug: 'undated', status: 'published' },
    ]
    const content = await listing()
    expect(content.entries.map((entry) => entry.slug)).toEqual([
      'video-0',
      // Last, not missing, and not sorted to 1970 above a dated entry.
      'undated',
    ])
  })

  it('publishes a due schedule the dated read cannot see', async () => {
    // Scheduling writes `publishAt` and never `publishedAt`, so the ordered
    // read cannot return this document at all. Nothing else publishes a
    // content entry: if this read misses it, the post never goes out.
    entryDocs = [
      published(0),
      {
        $id: 'due',
        title: 'Due',
        slug: 'due',
        status: 'scheduled',
        publishAt: AN_HOUR_AGO(),
      },
    ]
    const content = await listing()
    expect(content.entries.map((entry) => entry.slug)).toContain('due')
    expect(entryUpdates).toContainEqual({
      id: 'due',
      patch: { status: 'published', publishedAt: expect.anything() },
    })
  })

  it('falls back to the unordered read when the ordered one cannot run', async () => {
    // The composite index ships by hand, after the code (RELEASING.md step 4).
    // In that window the listing degrades to what it did before this change;
    // it does not 500 a customer's blog.
    orderedReadFails = true
    entryDocs = [published(0), published(1)]
    const content = await listing()
    expect(content.collection).not.toBeNull()
    expect(content.entries).toHaveLength(2)
  })
})
