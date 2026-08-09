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
  type CollectionCategory,
  collectionCategorySlug,
  collectionTotalPages,
  entryMatchesCategoryRoute,
  hostCollectionKind,
  resolveCollectionCategoryBySlug,
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
  /** Per-entry byline (AGL-686); falls back to the site as author. */
  authorName?: string
  body?: string
  coverImage?: string
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
  | 'seoTitle'
  | 'seoDescription'
  | 'categoryId'
  | 'category'
  | 'tags'
> {
  return {
    excerpt: value['excerpt'] ?? '',
    coverImage: value['coverImage'] ?? '',
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
    .limit(100)
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
    return {
      entries: await listLiveEntries(collectionDoc.ref.collection('entries')),
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
      }
      return data
    }

    data.entries = await listLiveEntries(entriesRef)

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
