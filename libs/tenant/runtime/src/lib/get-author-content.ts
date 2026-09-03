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
  collectionTotalPages,
  type ContentAuthorRecord,
  contentAuthorMatchesSlug,
  contentAuthorSlug,
  contentAuthorSlugCandidates,
  hostCollectionKind,
  normalizeContentAuthor,
  urlSlugSegment,
} from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  PUBLISHED_SITE_DATA_TTL_SECONDS,
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'
import {
  type CollectionEntrySummary,
  getPublishedCollectionSource,
} from './get-collection-content'

/**
 * How many content collections one author page walks.
 *
 * The same window site search reads, and for the same reason: a host's
 * `collections` subcollection holds commerce's catalogs too, so this is a
 * bound on DOCUMENTS SCANNED rather than on content collections found. Sites
 * with more than twenty collections of both kinds are not a shape the product
 * has yet, and the alternative — an unbounded scan on a public, uncached
 * first render — is the shape of an outage.
 */
const AUTHOR_PAGE_COLLECTION_SCAN = 20

/** How long the host's author roster stays warm. */
const AUTHORS_TTL_SECONDS = PUBLISHED_SITE_DATA_TTL_SECONDS

/**
 * Every author a host has defined, normalized (AGL-2518).
 *
 * ONE cached query, shared by the author page, the sitemap and anything else
 * that needs to turn a slug into a person. Bounded by
 * {@link AUTHORS_MAX_PER_HOST}, which is the platform cap, so the bound can
 * never hide an author that exists.
 *
 * Reading the roster rather than resolving the author out of their own posts
 * is a deliberate reversal of what AGL-2517 did. That version took the record
 * off the first matching entry to avoid a second Firestore read — which meant
 * an author with no published posts had no record, so their page had no name,
 * no bio and no links, and rendered as an empty archive of nobody. A person
 * who has not published yet still has a page; and this read is cached across
 * the whole site, so it costs one query per TTL rather than one per render.
 *
 * Fail-open to an empty roster: the page then falls back to whatever the
 * entries themselves carry, which is the old behavior rather than a 500.
 */
export async function getContentAuthors(options: {
  hostId: string
}): Promise<ContentAuthorRecord[]> {
  try {
    return await withRenderCache({
      key: ['tenant-content-authors', options.hostId],
      revalidate: AUTHORS_TTL_SECONDS,
      tags: [tenantDataTag(options.hostId)],
      read: () => readContentAuthors(options.hostId),
    })
  } catch (error) {
    console.error(error)
    return readContentAuthors(options.hostId)
  }
}

async function readContentAuthors(
  hostId: string,
): Promise<ContentAuthorRecord[]> {
  try {
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .collection('authors')
      .limit(AUTHORS_MAX_PER_HOST)
      .get()
    return snapshot.docs
      .map((doc) => normalizeContentAuthor(doc.data(), doc.id))
      .filter((author): author is ContentAuthorRecord => Boolean(author))
  } catch (error) {
    console.error(error)
    return []
  }
}

/** The public slugs of every content collection this host owns. */
async function listContentCollections(hostId: string): Promise<
  { slug: string; name: string }[]
> {
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('collections')
    .limit(AUTHOR_PAGE_COLLECTION_SCAN)
    .get()
  const collections: { slug: string; name: string }[] = []
  for (const doc of snapshot.docs) {
    // Commerce's catalogs share this path (AGL-954) and own no entries.
    if (hostCollectionKind(doc.data()) !== 'content') continue
    const slug = String(doc.get('slug') ?? '').trim()
    if (!slug) continue
    collections.push({
      slug,
      name:
        String(
          doc.get('displayName') ?? doc.get('name') ?? doc.get('title') ?? '',
        ).trim() || slug,
    })
  }
  return collections
}

/** What a `/author/{slug}` route resolved to. */
export interface AuthorContent {
  /** The addressed segment, normalized — what a canonical link must say. */
  slug: string
  /** The author's record, when the slug names one. */
  author: ContentAuthorRecord | null
  /**
   * The byline to print. Falls back to the raw segment so an unknown author
   * still gets a page with a heading rather than a blank one.
   */
  name: string
  /**
   * Did the slug resolve to a real author — a roster record, or an entry
   * published under that byline? An unknown slug renders an empty page rather
   * than crashing, which is the category route's rule, but the page must not
   * invite indexing of an address that names nobody.
   */
  known: boolean
  /** This author's published entries, newest first, across every collection. */
  entries: CollectionEntrySummary[]
  /** The merged taxonomy of every collection walked, for name resolution. */
  categories: CollectionCategory[]
  page: number
  perPage: number
  totalEntries: number
  totalPages: number
}

/**
 * Everything one author's page shows (AGL-2518) — the person, and what they
 * wrote across the WHOLE site.
 *
 * ## Where the entries come from
 *
 * Every content collection the host owns, through
 * {@link getPublishedCollectionSource} — the same cached per-collection read
 * `/blog` and every "Latest posts" rail already use. So on a warm site this
 * page adds no Firestore reads at all: it is a filter over data the cache is
 * holding anyway. That is the whole reason it walks collections rather than
 * running a collection-group query on `authorId`, which would be one query
 * but would also need its own composite index, would miss every entry written
 * under the legacy free-typed byline (AGL-686), and would share nothing with
 * the rest of the site.
 *
 * ## Why each entry is stamped with its collection
 *
 * One page, several collections, so the routed slug cannot build `entry.url`
 * any more — a changelog note listed under a `/blog` route would link to a
 * page that does not exist. Each entry carries `collectionSlug` and
 * `collectionName` out of the read that found it, and the token map prefers
 * them (`collectionEntryTokens`). Single-collection listings set neither and
 * are unchanged.
 *
 * ## Ordering
 *
 * Newest first by `publishedAt`, with undated entries last rather than first:
 * a draft-turned-live with no timestamp should not lead a person's archive.
 * Sorted ACROSS collections, because the point of the page is a single
 * chronological body of work rather than three lists stacked.
 */
export async function getAuthorContent(options: {
  hostId: string
  authorSlug: string
  page?: number
  perPage?: number
}): Promise<AuthorContent> {
  const { hostId } = options
  const slug = String(options.authorSlug ?? '').trim()
  // The segment as a URL actually spells it. The route parser already
  // slugifies, but this function is called directly by tests and by the
  // sitemap, so it normalizes its own input rather than trusting a caller.
  const slugified = urlSlugSegment(slug)
  const page = Math.max(1, Math.floor(Number(options.page) || 1))
  const perPage = Math.max(1, Math.floor(Number(options.perPage) || 10))
  const empty: AuthorContent = {
    slug: slugified,
    author: null,
    name: slugified,
    known: false,
    entries: [],
    categories: [],
    page,
    perPage,
    totalEntries: 0,
    totalPages: 1,
  }
  if (!slugified) return empty
  try {
    const [authors, collections] = await Promise.all([
      getContentAuthors({ hostId }),
      listContentCollections(hostId),
    ])
    const record =
      authors.find((author) => contentAuthorMatchesSlug({ author }, slug)) ??
      null

    /*
      Every segment that means this person, resolved ONCE from the record and
      then matched against each entry — rather than asking each entry whether
      it matches the routed segment.

      The difference is not cosmetic. An entry stores `authorId`; the URL
      carries the author's stored SLUG. Asking the entry alone, its only
      candidate is the id, which does not equal the slug, so the archive comes
      back empty for exactly the authors who set an address — the field whose
      whole purpose is to give them a stable one.

      It also closes a fail-open hole. `attachEntryAuthors` resolves
      `entry.author` and is deliberately allowed to fail (a byline is not
      worth a 500). When it does, the entry keeps only its `authorId`, and a
      per-entry match against a name-derived segment would silently drop it —
      an archive quietly missing posts, which looks exactly like an author who
      wrote fewer of them.
    */
    const accepted = new Set<string>([slugified])
    if (record) {
      for (const candidate of contentAuthorSlugCandidates({ author: record })) {
        accepted.add(candidate)
      }
    }
    const matchesAuthor = (entry: CollectionEntrySummary): boolean =>
      contentAuthorSlugCandidates({
        ...(entry.author ? { author: entry.author } : {}),
        ...(entry.authorId ? { authorId: entry.authorId } : {}),
        ...(entry.authorName ? { authorName: entry.authorName } : {}),
      }).some((candidate) => accepted.has(candidate))

    const sources = await Promise.all(
      collections.map(async (collection) => ({
        collection,
        source: await getPublishedCollectionSource({
          hostId,
          collectionSlug: collection.slug,
        }),
      })),
    )

    const entries: CollectionEntrySummary[] = []
    const categories: CollectionCategory[] = []
    for (const { collection, source } of sources) {
      categories.push(...source.categories)
      for (const entry of source.entries) {
        if (!matchesAuthor(entry)) continue
        // Stamped rather than mutated in place: `source.entries` is the
        // CACHED array, shared with every other page rendering this
        // collection, and writing a collection slug onto it would leak this
        // page's context into theirs.
        entries.push({
          ...entry,
          collectionSlug: collection.slug,
          collectionName: collection.name,
        })
      }
    }
    entries.sort(
      (a, b) => (b.publishedAt?.seconds ?? 0) - (a.publishedAt?.seconds ?? 0),
    )

    // The record wins for the display name; failing that, the byline of a
    // post they actually wrote; failing that, the raw segment.
    const name =
      record?.name ||
      entries.find((entry) => (entry.authorName ?? '').trim())?.authorName ||
      slugified
    const totalEntries = entries.length
    return {
      slug: slugified,
      author: record,
      name,
      known: Boolean(record) || totalEntries > 0,
      // Narrowed BEFORE the window, so the page count describes this
      // author's work rather than the site's — the rule the category route
      // states, one axis over.
      entries: entries.slice((page - 1) * perPage, page * perPage),
      categories,
      page,
      perPage,
      totalEntries,
      totalPages: collectionTotalPages(totalEntries, perPage),
    }
  } catch (error) {
    // Fail-open, like every read on this path: a person's page that 500s is
    // worse than one that renders their name and nothing else.
    console.error('author content read failed', error)
    return empty
  }
}

/**
 * Every author page this site can serve, for the sitemap (AGL-2518).
 *
 * Roster order, and only authors that address something: an author whose
 * record has neither a slug nor a name has no URL, and listing one would put
 * `/author/` in the sitemap.
 */
export async function listAuthorPageSlugs(options: {
  hostId: string
}): Promise<{ slug: string; name: string }[]> {
  const authors = await getContentAuthors(options)
  const seen = new Set<string>()
  const rows: { slug: string; name: string }[] = []
  for (const author of authors) {
    const slug = contentAuthorSlug({ author })
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    rows.push({ slug, name: author.name ?? slug })
  }
  return rows
}

export default getAuthorContent
