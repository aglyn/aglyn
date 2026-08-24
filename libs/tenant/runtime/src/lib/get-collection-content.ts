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

import {
  AUTHORS_MAX_PER_HOST,
  type CollectionCategory,
  collectionCategorySlug,
  COLLECTION_SOURCE_MAX,
  collectionTotalPages,
  type ContentAuthorRecord,
  entryMatchesCategoryRoute,
  hostCollectionKind,
  normalizeContentAuthor,
  resolveCollectionCategoryBySlug,
  resolveEntryAuthor,
} from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'

/**
 * Only the compose-time source is cached (AGL-1302): a Collection entries
 * block in a shared layout re-read up to ~100 entry docs on EVERY page of
 * the site. The routed-page reader (`getCollectionContent`) stays uncached —
 * it is amortized by the page's own ISR entry, and its scheduled-entry flip
 * (`flipDueEntry`) is a write a cache must not suppress. The 60s TTL means
 * a scheduled entry's lazy flip waits at most one extra window.
 */
const COLLECTION_SOURCE_TTL_SECONDS = 60

/**
 * Resolve a public content-collection slug (AGL-954). Commerce's product
 * collections share `hosts/{hostId}/collections`, and a slug is only unique
 * within a kind — a bare `limit(1)` handed the URL to whichever doc Firestore
 * returned first, so a catalog collection could shadow a blog. Reads a small
 * window instead and takes the first content-kind match.
 */
async function findContentCollection(
  hostId: string,
  collectionSlug: string,
): Promise<FirebaseFirestore.QueryDocumentSnapshot | undefined> {
  const matches = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('collections')
    .where('slug', '==', collectionSlug)
    .limit(5)
    .get()
  return matches.docs.find(
    (docSnapshot) => hostCollectionKind(docSnapshot.data()) === 'content',
  )
}

export interface CollectionEntrySummary {
  $id: string
  title: string
  slug: string
  excerpt?: string
  /**
   * The byline TEXT (AGL-686). Either the entry's own legacy free-typed
   * string or — since AGL-2486 — the name of the author record `authorId`
   * points at, resolved here so every downstream reader (the Entry Meta
   * block, `{{entry.author}}`, the RSS feed) keeps asking one field.
   */
  authorName?: string
  /** Reference into `hosts/{hostId}/authors` (AGL-2486). */
  authorId?: string
  /**
   * The resolved author RECORD (AGL-2486) — what `Article.author` is built
   * from. Null when the entry names no author, in which case the page falls
   * back to the site's publisher entity exactly as it always has.
   */
  author?: ContentAuthorRecord | null
  body?: string
  coverImage?: string
  /** `og:image:alt` for the cover (AGL-2417); travels WITH `coverImage`. */
  coverImageAlt?: string
  /** Search-result title override (AGL-582); falls back to `title`. */
  seoTitle?: string
  /** Meta description override (AGL-582); falls back to `excerpt`. */
  seoDescription?: string
  /**
   * Stable reference into the collection's `categories` taxonomy
   * (AGL-582); resolved to a display name at render.
   */
  categoryId?: string
  /** Legacy free-typed bucket (AGL-582); read-only fallback. */
  category?: string
  /** Free-form labels (AGL-582). */
  tags?: string[]
  publishedAt?: { seconds: number } | null
}

/** Entry-doc fields shared by the list and single-entry mappers (AGL-582). */
function mapEntryFields(
  value: FirebaseFirestore.DocumentData,
): Pick<
  CollectionEntrySummary,
  | 'excerpt'
  | 'coverImage'
  | 'coverImageAlt'
  | 'seoTitle'
  | 'seoDescription'
  | 'authorName'
  | 'authorId'
  | 'categoryId'
  | 'category'
  | 'tags'
> {
  return {
    excerpt: value['excerpt'] ?? '',
    // The byline was DECLARED on `CollectionEntrySummary` (AGL-686) and
    // mapped by nobody, so `entry.authorName` was `undefined` on every entry
    // this loader returned — which is every routed entry page and every
    // Collection entries block. The console collected the field, the rules
    // stored it, the JSON-LD builder read it and the Entry Meta block printed
    // it, and all three saw nothing, because the one hop between Firestore
    // and them dropped it (AGL-2486). Written but never read, in the
    // direction that leaves no error behind.
    authorName: value['authorName'] ?? '',
    authorId: value['authorId'] ?? '',
    coverImage: value['coverImage'] ?? '',
    coverImageAlt: value['coverImageAlt'] ?? '',
    seoTitle: value['seoTitle'] ?? '',
    seoDescription: value['seoDescription'] ?? '',
    categoryId: value['categoryId'] ?? '',
    category: value['category'] ?? '',
    tags: Array.isArray(value['tags'])
      ? value['tags'].filter((tag): tag is string => typeof tag === 'string')
      : [],
  }
}

/**
 * The collection doc's category taxonomy (AGL-582), sanitized: only
 * `{ id, name }` pairs with non-empty strings survive, order preserved.
 */
function mapCollectionCategories(value: unknown): CollectionCategory[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (item): item is CollectionCategory =>
        typeof item?.id === 'string' &&
        item.id.trim() !== '' &&
        typeof item?.name === 'string' &&
        item.name.trim() !== '',
    )
    .map((item) => ({ id: item.id, name: item.name }))
}

/**
 * Resolve the author RECORDS a set of entries reference (AGL-2486).
 *
 * Costs ZERO reads when no entry names an `authorId`, which is every site
 * that has not adopted custom authors and every entry written before them —
 * the check is on the ids already in hand, not a probe of the collection. When
 * ids are present it is one `getAll` of the DISTINCT ones, bounded by
 * {@link AUTHORS_MAX_PER_HOST} and by the ≤100-entry page above it, rather
 * than a read per entry.
 *
 * Fail-open, like every other read in this file: an authors read that throws
 * leaves the entries with their legacy `authorName` (or the site entity) and
 * the page renders. A byline is not worth a 500.
 */
async function attachEntryAuthors(
  hostId: string,
  entries: CollectionEntrySummary[],
): Promise<void> {
  const ids = [
    ...new Set(
      entries
        .map((entry) => (entry.authorId ?? '').trim())
        .filter(Boolean),
    ),
  ].slice(0, AUTHORS_MAX_PER_HOST)
  let authors: ContentAuthorRecord[] = []
  if (ids.length) {
    try {
      const authorsRef = firebaseAdmin
        .app()
        .firestore()
        .collection('hosts')
        .doc(hostId)
        .collection('authors')
      const snapshots = await firebaseAdmin
        .app()
        .firestore()
        .getAll(...ids.map((id) => authorsRef.doc(id)))
      authors = snapshots
        .map((snapshot) =>
          snapshot.exists
            ? normalizeContentAuthor(snapshot.data(), snapshot.id)
            : null,
        )
        .filter((author): author is ContentAuthorRecord => Boolean(author))
    } catch (error) {
      console.error(error)
    }
  }
  for (const entry of entries) {
    const author = resolveEntryAuthor(entry, authors)
    entry.author = author
    // The byline TEXT is denormalized onto the field everything downstream
    // already reads, so a record-backed author needs no change in the Entry
    // Meta block, the token map, the fallback nodes or the RSS feed. A record
    // WINS over the legacy string on the same entry: picking an author is the
    // more recent statement of who wrote it.
    if (author?.name) entry.authorName = author.name
  }
}

/**
 * Scheduled entries (AGL-123) go live lazily like AGL-61: a due
 * `publishAt` counts as published for this render, and the doc is flipped
 * to `published` fail-open so the state becomes durable.
 */
function isLive(value: FirebaseFirestore.DocumentData): boolean {
  if (value['status'] === 'published') return true
  return (
    value['status'] === 'scheduled' &&
    (value['publishAt']?.seconds ?? Number.POSITIVE_INFINITY) * 1000 <=
      Date.now()
  )
}

function flipDueEntry(
  docRef: FirebaseFirestore.DocumentReference,
  value: FirebaseFirestore.DocumentData,
): void {
  if (value['status'] !== 'scheduled') return
  docRef
    .update({ status: 'published', publishedAt: value['publishAt'] })
    .catch((error) => console.error(error))
}

export interface CollectionContent {
  collection: {
    $id: string
    displayName: string
    slug: string
    /**
     * Legacy entry-template screen (AGL-105); superseded by
     * `entryScreenId` but still honored when only it is set.
     */
    templateScreenId?: string
    /** List-template screen (AGL-551); `/{collection}` renders through it. */
    listScreenId?: string
    /**
     * Entry-template screen (AGL-551); `/{collection}/{entry}` renders
     * through it with `{{entry.*}}` tokens.
     */
    entryScreenId?: string
    /**
     * Category taxonomy (AGL-582): entries reference these by stable
     * `id`; `name` is the renameable display label.
     */
    categories?: CollectionCategory[]
  } | null
  entries: CollectionEntrySummary[]
  entry: CollectionEntrySummary | null
  /** List pagination (AGL-620); null for entry pages or unpaginated lists. */
  pagination?: CollectionPagination | null
  /**
   * The category this listing is filtered to (AGL-1321); null on the
   * canonical unfiltered list and on entry pages.
   */
  category?: CollectionRouteCategory | null
  error: unknown
}

/** The category a `/{collection}/category/{slug}` route addresses (AGL-1321). */
export interface CollectionRouteCategory {
  /** The URL segment, normalized — what the canonical link must say. */
  slug: string
  /** Taxonomy id; absent when the segment matched no known category. */
  id?: string
  /** Display label; falls back to the raw segment for an unknown category. */
  name: string
  /**
   * Whether the segment resolved against the collection's taxonomy. An
   * unknown category still renders — an empty listing, not a crash — but the
   * page must not invite indexing of a URL that names nothing.
   */
  known: boolean
}

export interface CollectionPagination {
  /** 1-based current page. */
  page: number
  perPage: number
  totalPages: number
  totalEntries: number
}

/**
 * Fetches a collection's live entries (newest first), shared by the route
 * loader and the compose-time Collection entries block (AGL-551).
 */
async function listLiveEntries(
  entriesRef: FirebaseFirestore.CollectionReference,
): Promise<CollectionEntrySummary[]> {
  // No orderBy: entries missing publishedAt would be dropped by Firestore;
  // sort client-side like the version lists.
  const entriesQuery = await entriesRef
    .where('status', 'in', ['published', 'scheduled'])
    // Named rather than literal (AGL-1516): a search index has to be able to
    // say "this read reached its bound", and it can only do that against a
    // bound it shares with the query. `collectionSourceReachedBound` reads
    // the same constant.
    .limit(COLLECTION_SOURCE_MAX)
    .get()
  return entriesQuery.docs
    .filter((entryDoc) => isLive(entryDoc.data()))
    .map((entryDoc) => {
      const value = entryDoc.data()
      flipDueEntry(entryDoc.ref, value)
      return {
        $id: entryDoc.id,
        title: value['title'] ?? entryDoc.id,
        slug: value['slug'] ?? entryDoc.id,
        ...mapEntryFields(value),
        publishedAt: (value['publishedAt'] ?? value['publishAt'])
          ? {
              seconds: (value['publishedAt'] ?? value['publishAt']).seconds,
            }
          : null,
      }
    })
    .sort(
      (a, b) => (b.publishedAt?.seconds ?? 0) - (a.publishedAt?.seconds ?? 0),
    )
}

/**
 * Published entries + category taxonomy for a collection resolved by slug —
 * the data source of the Collection entries block on arbitrary screens
 * (AGL-551/582). Fail-open: errors and unknown slugs resolve to an empty
 * list so a renamed collection never takes a published screen down.
 */
export async function getPublishedCollectionSource(options: {
  hostId: string
  collectionSlug: string
}): Promise<{
  entries: CollectionEntrySummary[]
  categories: CollectionCategory[]
}> {
  try {
    return await withRenderCache({
      key: [
        'tenant-collection-source',
        options.hostId,
        options.collectionSlug,
      ],
      revalidate: COLLECTION_SOURCE_TTL_SECONDS,
      tags: [tenantDataTag(options.hostId)],
      read: () => readPublishedCollectionSource(options),
    })
  } catch (error) {
    console.error(error)
    return readPublishedCollectionSource(options)
  }
}

async function readPublishedCollectionSource(options: {
  hostId: string
  collectionSlug: string
}): Promise<{
  entries: CollectionEntrySummary[]
  categories: CollectionCategory[]
}> {
  try {
    const collectionDoc = await findContentCollection(
      options.hostId,
      options.collectionSlug,
    )
    if (!collectionDoc) return { entries: [], categories: [] }
    const entries = await listLiveEntries(
      collectionDoc.ref.collection('entries'),
    )
    // The compose-time source feeds the Collection entries block, whose byline
    // reads `authorName` — so a record-backed author has to be resolved here
    // too, or the block prints nothing for the entries a list page shows
    // (AGL-2486). This result is the cached one, which is what keeps the extra
    // read amortized across every page of the site that carries the block.
    await attachEntryAuthors(options.hostId, entries)
    return {
      entries,
      categories: mapCollectionCategories(collectionDoc.get('categories')),
    }
  } catch (error) {
    console.error(error)
    return { entries: [], categories: [] }
  }
}

/** Entries-only view of {@link getPublishedCollectionSource} (AGL-551). */
export async function getPublishedCollectionEntries(options: {
  hostId: string
  collectionSlug: string
}): Promise<CollectionEntrySummary[]> {
  return (await getPublishedCollectionSource(options)).entries
}

/**
 * Resolves a non-screen path against the host's content collections
 * (Content Collections & Blog): `/{collectionSlug}` returns the published
 * entry list, `/{collectionSlug}/{entrySlug}` one entry. Fail-open — errors
 * resolve to `collection: null` and the caller 404s.
 */
export async function getCollectionContent(options: {
  hostId: string
  collectionSlug: string
  entrySlug?: string
  /** 1-based list page (AGL-620); with `perPage`, drives pagination metadata. */
  page?: number
  /** Entries per page (AGL-620); when set the list is paginated. */
  perPage?: number
  /**
   * Category segment of `/{collection}/category/{slug}` (AGL-1321). Filters
   * the listing before pagination is computed, so page counts and the page
   * windows describe the FILTERED set rather than the whole collection.
   */
  categorySlug?: string
}): Promise<CollectionContent> {
  const { hostId, collectionSlug, entrySlug, page = 1, perPage } = options
  const data: CollectionContent = {
    collection: null,
    entries: [],
    entry: null,
    pagination: null,
    category: null,
    error: null,
  }
  try {
    const collectionDoc = await findContentCollection(hostId, collectionSlug)
    if (!collectionDoc) return data
    data.collection = {
      $id: collectionDoc.id,
      displayName: collectionDoc.get('displayName') ?? collectionSlug,
      slug: collectionSlug,
      templateScreenId: collectionDoc.get('templateScreenId') ?? undefined,
      listScreenId: collectionDoc.get('listScreenId') ?? undefined,
      entryScreenId: collectionDoc.get('entryScreenId') ?? undefined,
      categories: mapCollectionCategories(collectionDoc.get('categories')),
    }

    const entriesRef = collectionDoc.ref.collection('entries')
    if (entrySlug) {
      const entryQuery = await entriesRef
        .where('slug', '==', entrySlug)
        .limit(5)
        .get()
      const entryDoc = entryQuery.docs.find((docSnapshot) =>
        isLive(docSnapshot.data()),
      )
      if (entryDoc) {
        const value = entryDoc.data()
        flipDueEntry(entryDoc.ref, value)
        data.entry = {
          $id: entryDoc.id,
          title: value['title'] ?? entrySlug,
          slug: entrySlug,
          body: value['body'] ?? '',
          ...mapEntryFields(value),
          publishedAt: (value['publishedAt'] ?? value['publishAt'])
            ? {
                seconds: (value['publishedAt'] ?? value['publishAt']).seconds,
              }
            : null,
        }
        await attachEntryAuthors(hostId, [data.entry])
      }
      return data
    }

    data.entries = await listLiveEntries(entriesRef)
    await attachEntryAuthors(hostId, data.entries)

    // Category filter (AGL-1321). Applied HERE, before pagination, because
    // the two have to describe the same set: counting pages over the whole
    // collection and then filtering would advertise pages that render empty
    // and hide entries that exist.
    const routedCategory = (options.categorySlug ?? '').trim()
    if (routedCategory) {
      const match = resolveCollectionCategoryBySlug(
        data.collection.categories,
        routedCategory,
      )
      data.category = {
        slug: collectionCategorySlug(routedCategory),
        ...(match ? { id: match.id } : {}),
        name: match?.name ?? routedCategory,
        known: Boolean(match),
      }
      data.entries = data.entries.filter((entry) =>
        entryMatchesCategoryRoute(
          entry,
          { slug: routedCategory, ...(match ? { category: match } : {}) },
          data.collection?.categories,
        ),
      )
    }

    if (perPage && perPage > 0) {
      const totalEntries = data.entries.length
      data.pagination = {
        page,
        perPage,
        totalEntries,
        totalPages: collectionTotalPages(totalEntries, perPage),
      }
    }
  } catch (error) {
    console.error(error)
    data.error = error
  }
  return data
}

export default getCollectionContent
