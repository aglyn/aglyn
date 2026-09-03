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
  checkEntitlement,
  COLLECTION_SOURCE_MAX,
  collectionTotalPages,
  type ContentAuthorRecord,
  entryMatchesAuthorRoute,
  entryMatchesCategoryRoute,
  hostCollectionKind,
  normalizeContentAuthor,
  resolveCollectionCategoryBySlug,
  resolveEntryAuthor,
} from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import {
  PUBLISHED_SITE_DATA_TTL_SECONDS,
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'

/**
 * ONE cached read per collection, shared by every surface that lists it
 * (AGL-1302).
 *
 * It began as the compose-time source only: a Collection entries block in a
 * shared layout re-read up to ~100 entry docs on EVERY page of the site. The
 * routed listing was left out on the argument that the page's own ISR entry
 * amortized it — which is true of ONE address and false of a collection,
 * because a collection is not one address. `/blog`, `/blog/page/2…10`, a
 * `/blog/category/{slug}` per category and `/blog/rss.xml` are all the same
 * data, each paying its own `1 + entries + authors` per window, beside a
 * cache already holding exactly that.
 *
 * The other half of that argument was real and is answered rather than
 * dropped: `flipDueEntry` is a write, and nothing else publishes a content
 * entry, so a cache that stored a collection with a schedule still pending
 * would suppress the render that publishes it. `getPublishedCollectionSource`
 * therefore declines to STORE exactly those collections — see its `store`
 * predicate — which leaves scheduled publishing on the render window it has
 * always been on, and puts everything else on this TTL.
 */
const COLLECTION_SOURCE_TTL_SECONDS = PUBLISHED_SITE_DATA_TTL_SECONDS

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
 * The routed view of a collection DOCUMENT (AGL-551): its name and the
 * template screens its list and entry routes render through.
 *
 * `slug` is the slug that was ASKED FOR rather than the one stored, which is
 * what every caller of this file has always returned — a listing has to build
 * its own URLs out of the segment the reader is standing on.
 */
function mapCollectionDoc(
  collectionDoc: FirebaseFirestore.QueryDocumentSnapshot,
  collectionSlug: string,
): CollectionContent['collection'] {
  return {
    $id: collectionDoc.id,
    displayName: collectionDoc.get('displayName') ?? collectionSlug,
    slug: collectionSlug,
    templateScreenId: collectionDoc.get('templateScreenId') ?? undefined,
    listScreenId: collectionDoc.get('listScreenId') ?? undefined,
    entryScreenId: collectionDoc.get('entryScreenId') ?? undefined,
    categories: mapCollectionCategories(collectionDoc.get('categories')),
  }
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
 * Terminal refusal marker for an entry schedule, the flat-status twin of
 * `publishSchedule.status: 'skipped-unentitled'` on screens (AGL-1185).
 *
 * A field rather than a new `status` value on purpose. `status` is queried
 * (`where('status', 'in', [...])`), rendered by the console, and sorted on by
 * `bundle-timestamps.ts`; adding a member would have meant auditing every one
 * of those readers. A sibling field is invisible to all of them and is read
 * only here.
 */
const ENTRY_SCHEDULE_SKIPPED = 'skipped-unentitled'

/** A schedule this entry already had declined, and will not have reconsidered. */
function scheduleAlreadyRefused(
  value: FirebaseFirestore.DocumentData,
): boolean {
  return value['scheduleStatus'] === ENTRY_SCHEDULE_SKIPPED
}

/** A scheduled entry whose time has come — before any plan question. */
function isDueScheduled(value: FirebaseFirestore.DocumentData): boolean {
  return (
    value['status'] === 'scheduled' &&
    !scheduleAlreadyRefused(value) &&
    (value['publishAt']?.seconds ?? Number.POSITIVE_INFINITY) * 1000 <=
      Date.now()
  )
}

/**
 * Is this host's plan allowed to publish on a schedule? (AGL-471 shape.)
 *
 * `React.cache`-deduped per request via `getOrgForHost`, and — this is the
 * part that keeps it off the hot path — every caller below only asks once it
 * has already found a due scheduled entry. A collection with nothing due pays
 * nothing, which is almost every render.
 *
 * THREE answers, not two, and the third is the point. `refused` means we read
 * the plan and it does not carry the entitlement. `unresolved` means we could
 * not find out. Both withhold the entry, but only `refused` may write the
 * terminal marker — burning a schedule permanently on the strength of a
 * hostIndex miss or a transient rejection would destroy a customer's post for
 * a reason that may not be true a second later.
 *
 * Withholding on `unresolved` rather than publishing is what every other
 * entitlement caller in this library already does: `run-event-actions`,
 * `run-event-workflows` and `apply-publish-schedule` all pass a possibly
 * undefined org straight into `checkEntitlement`, which resolves a missing
 * plan as free and denies (AGL-247). Opening here instead would make this the
 * one gate in the lib that admits when it cannot see — the exact shape of the
 * free-tier leak `no-plan-gated-entitlement` exists to forbid.
 *
 * The blast radius of withholding is deliberately small: `isLive` answers true
 * for `status: 'published'` before it ever consults this, so an unresolved
 * read hides only the due-scheduled entry, never the published ones, and the
 * next render retries.
 */
type SchedulePermission = 'allowed' | 'refused' | 'unresolved'

async function scheduledPublishingPermission(
  hostId: string,
): Promise<SchedulePermission> {
  try {
    const org = (await getOrgForHost(hostId))?.org
    if (!org) return 'unresolved'
    return checkEntitlement(org, 'scheduledPublishing') ? 'allowed' : 'refused'
  } catch (error) {
    // Caught rather than thrown: the only caller sits inside
    // `getCollectionContent`'s try/catch, which returns an EMPTY collection —
    // so an unhandled rejection here would blank every published entry on the
    // page, not just the scheduled one.
    console.error(error)
    return 'unresolved'
  }
}

/**
 * Scheduled entries (AGL-123) go live lazily like AGL-61: a due
 * `publishAt` counts as published for this render, and the doc is flipped
 * to `published` fail-open so the state becomes durable.
 *
 * PLAN GATE (AGL-471). `scheduledPublishing` is a Business entitlement, and
 * until now nothing on the entry path checked it: the console let any plan
 * write `status: 'scheduled'`, and this render path published it. Scheduling
 * worked end to end on Free. The screens path has gated this since AGL-471
 * and records its refusal since AGL-1185 — entries were simply never wired
 * to either, which is why the leak was invisible from the screens side.
 *
 * The permission is threaded in rather than resolved here so the org read
 * happens once per call site instead of once per entry.
 */
function isLive(
  value: FirebaseFirestore.DocumentData,
  permission: SchedulePermission,
): boolean {
  if (value['status'] === 'published') return true
  return permission === 'allowed' && isDueScheduled(value)
}

/**
 * Make the due state durable — or record that it was refused.
 *
 * The refusal is TERMINAL, for the AGL-1185 reason: left as a bare pending
 * `scheduled`, the entry stays permanently due, so the day the org upgrades
 * to Business the next render publishes it. Content scheduled on a plan that
 * could not honour it, and forgotten, surfacing during an upgrade — exactly
 * when nobody is looking for it. Recording the refusal is what makes it stop
 * being due, and it also stops this path re-reading the org on every
 * subsequent render.
 *
 * Both writes fail open: an error leaves today's state, and the next render
 * retries.
 */
function flipDueEntry(
  docRef: FirebaseFirestore.DocumentReference,
  value: FirebaseFirestore.DocumentData,
  permission: SchedulePermission,
): void {
  if (value['status'] !== 'scheduled') return
  if (scheduleAlreadyRefused(value)) return
  // `unresolved` writes NOTHING. It withholds this render and leaves the
  // schedule exactly as it found it, so a later render can still publish it.
  if (permission === 'unresolved') return
  if (permission === 'refused') {
    if (!isDueScheduled(value)) return
    docRef
      .update({ scheduleStatus: ENTRY_SCHEDULE_SKIPPED })
      .catch((error) => console.error(error))
    return
  }
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
  /**
   * Whether the read that produced `entries` stopped at
   * {@link COLLECTION_SOURCE_MAX} (AGL-1516). Set on LIST routes only —
   * an entry route reads one document by slug and bounds nothing.
   */
  entriesReachedBound?: boolean
  /** List pagination (AGL-620); null for entry pages or unpaginated lists. */
  pagination?: CollectionPagination | null
  /**
   * The author this listing is filtered to (AGL-2517); absent on every route
   * that is not an author archive.
   */
  author?: CollectionRouteAuthor | null
  /**
   * The category this listing is filtered to (AGL-1321); null on the
   * canonical unfiltered list and on entry pages.
   */
  category?: CollectionRouteCategory | null
  error: unknown
}

/** The author a `/{collection}/author/{slug}` route addresses (AGL-2517). */
export interface CollectionRouteAuthor {
  /** The URL segment, slugified. */
  slug: string
  /** The resolved record, when a published entry names one. */
  record?: ContentAuthorRecord
  /** Display name; falls back to the raw segment for an unknown author. */
  name: string
  /**
   * Did the segment match a published entry? An unknown author still renders
   * — an empty archive, not a crash — which is the category route's rule.
   */
  known: boolean
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
 * A bounded read of a collection's live entries (AGL-1516).
 *
 * `reachedBound` is a fact about the QUERY, not about `entries`, and the two
 * genuinely differ: the query asks for `status in ['published', 'scheduled']`
 * and the filter below then drops everything not live yet, so a read that came
 * back holding all {@link COLLECTION_SOURCE_MAX} docs can hand back fewer.
 * Counting the survivors — which is all a downstream consumer can do — reads
 * that as a complete collection, and the one thing a truncated read must never
 * be allowed to claim is completeness.
 */
interface LiveEntriesRead {
  entries: CollectionEntrySummary[]
  /** The query came back holding its own `.limit()`. */
  reachedBound: boolean
  /**
   * The read saw a `scheduled` entry whose `publishAt` has NOT arrived and
   * which has not been terminally refused — a schedule this collection is
   * still waiting on.
   *
   * Nothing promotes a content entry on a beat: `publish-schedule-job.ts` is
   * screens-only, so `isLive`/`flipDueEntry` running during a render is the
   * entire mechanism. A cached source therefore does not merely serve stale
   * entries, it withholds the render that would have published one, for as
   * long as the entry stays cached. This is what lets the cache decline to
   * store exactly those collections, so a schedule keeps landing on the
   * render window rather than on the TTL.
   */
  pendingSchedule: boolean
}

/**
 * Fetches a collection's live entries (newest first), shared by the route
 * loader and the compose-time Collection entries block (AGL-551).
 */
async function listLiveEntries(
  entriesRef: FirebaseFirestore.CollectionReference,
  hostId: string,
): Promise<LiveEntriesRead> {
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

  // Ask the plan question ONLY if something is actually due (AGL-471). A
  // collection with no due schedule — almost every render — never reads the
  // org at all.
  const due = entriesQuery.docs.filter((entryDoc) =>
    isDueScheduled(entryDoc.data()),
  )
  const permission: SchedulePermission = due.length
    ? await scheduledPublishingPermission(hostId)
    : 'allowed'

  // Record the terminal refusal on its own pass, because a refused entry is
  // NOT live and so never reaches the `flipDueEntry` inside the map below.
  // Without this the entry stays due forever: excluded from every render, and
  // re-reading the org on each one.
  if (permission !== 'allowed') {
    for (const entryDoc of due) {
      flipDueEntry(entryDoc.ref, entryDoc.data(), permission)
    }
  }

  // Measured on the RAW docs, before the liveness filter (AGL-1516). This is
  // the only place that can still see how many documents the query returned;
  // one line down that number is gone for good.
  const reachedBound = entriesQuery.docs.length >= COLLECTION_SOURCE_MAX

  // Also measured on the RAW docs, and for the same reason: a not-yet-due
  // entry is filtered out one line down, so this is the last place that can
  // see one at all.
  const pendingSchedule = entriesQuery.docs.some((entryDoc) => {
    const value = entryDoc.data()
    return (
      value['status'] === 'scheduled' &&
      !scheduleAlreadyRefused(value) &&
      !isDueScheduled(value)
    )
  })

  const entries = entriesQuery.docs
    .filter((entryDoc) => isLive(entryDoc.data(), permission))
    .map((entryDoc) => {
      const value = entryDoc.data()
      flipDueEntry(entryDoc.ref, value, permission)
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

  return { entries, reachedBound, pendingSchedule }
}

/** Compose-time view of a collection: its live entries and its taxonomy. */
export interface PublishedCollectionSource {
  /**
   * The collection DOCUMENT this source was read from — its display name and
   * its template screen ids — or null when the slug names no content
   * collection.
   *
   * Carried so a routed listing can be served ENTIRELY from this cached
   * source. `getCollectionContent` used to resolve the same document itself
   * and then read the same entries again uncached, which meant `/blog`,
   * every `/blog/page/{n}`, every `/blog/category/{slug}` and the RSS feed
   * each paid a full collection read per regeneration while the identical
   * data already sat in this cache for every OTHER page on the site.
   */
  collection: CollectionContent['collection']
  entries: CollectionEntrySummary[]
  categories: CollectionCategory[]
  /**
   * Whether the read saw a schedule it is still waiting on — see
   * {@link LiveEntriesRead.pendingSchedule}. Never stored, only consulted by
   * the cache above, so no consumer has to know about it.
   */
  pendingSchedule?: boolean
  /**
   * Whether the entries read stopped at {@link COLLECTION_SOURCE_MAX}
   * (AGL-1516) — carried out of the loader because `entries.length` cannot
   * answer it once the liveness filter has run. Fail-open paths report
   * `false`: an empty result is not a bounded read, and describing it as one
   * would tell a reader their search covered less than it did.
   */
  reachedBound: boolean
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
}): Promise<PublishedCollectionSource> {
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
      // A collection with a schedule still pending is SERVED but not STORED.
      //
      // No beat publishes a content entry — `flipDueEntry` during a render is
      // the whole mechanism — so storing this source would suppress the very
      // renders that would have noticed the entry coming due, and the post
      // would wait out the TTL rather than land at its time. Declining to
      // store leaves those collections exactly as uncached as they were
      // before this cache existed, which is the only cost this cache is not
      // allowed to reduce.
      //
      // Also refuses a collection that resolved to nothing, for the reason
      // `withRenderCache` states about negatives generally: a slug that
      // misses once must not miss for an hour.
      store: (value) => Boolean(value.collection) && !value.pendingSchedule,
    })
  } catch (error) {
    console.error(error)
    return readPublishedCollectionSource(options)
  }
}

async function readPublishedCollectionSource(
  options: {
    hostId: string
    collectionSlug: string
  },
): Promise<PublishedCollectionSource> {
  try {
    const collectionDoc = await findContentCollection(
      options.hostId,
      options.collectionSlug,
    )
    if (!collectionDoc) {
      return {
        collection: null,
        entries: [],
        categories: [],
        reachedBound: false,
      }
    }
    const { entries, reachedBound, pendingSchedule } = await listLiveEntries(
      collectionDoc.ref.collection('entries'),
      options.hostId,
    )
    // The compose-time source feeds the Collection entries block, whose byline
    // reads `authorName` — so a record-backed author has to be resolved here
    // too, or the block prints nothing for the entries a list page shows
    // (AGL-2486). This result is the cached one, which is what keeps the extra
    // read amortized across every page of the site that carries the block.
    await attachEntryAuthors(options.hostId, entries)
    return {
      collection: mapCollectionDoc(collectionDoc, options.collectionSlug),
      entries,
      categories: mapCollectionCategories(collectionDoc.get('categories')),
      reachedBound,
      ...(pendingSchedule ? { pendingSchedule: true } : {}),
    }
  } catch (error) {
    console.error(error)
    return {
      collection: null,
      entries: [],
      categories: [],
      reachedBound: false,
    }
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
 * Narrows a listing to its routed category and stamps its pagination
 * (AGL-1321 / AGL-620).
 *
 * Category first, ALWAYS: the two have to describe the same set. Counting
 * pages over the whole collection and then filtering would advertise pages
 * that render empty and hide entries that exist.
 *
 * `entriesReachedBound` is read by the caller BEFORE this runs, because a
 * category route hands its already-narrowed entries to compose and the
 * entries block's "measure the raw set, not the filtered one" rule then has
 * nothing raw left to measure (AGL-1516).
 */
function applyCategoryAndPagination(
  data: CollectionContent,
  options: {
    page?: number
    perPage?: number
    categorySlug?: string
    authorSlug?: string
  },
): void {
  const { page = 1, perPage } = options
  const routedCategory = (options.categorySlug ?? '').trim()
  /**
   * The author archive narrows on the same terms and BEFORE pagination, for
   * the reason the category comment gives: counting pages over the whole
   * collection and filtering afterwards advertises pages that render empty
   * (AGL-2517).
   *
   * The two are independent filters rather than alternatives — the route
   * parser only ever sets one, but narrowing both here means neither can
   * quietly win if that ever changes.
   */
  const routedAuthor = (options.authorSlug ?? '').trim()
  if (routedAuthor) {
    const match = data.entries.find((entry) =>
      entryMatchesAuthorRoute(entry, routedAuthor),
    )
    data.author = {
      slug: collectionCategorySlug(routedAuthor),
      // The RESOLVED record, taken from a post the author actually wrote —
      // there is no author collection read here, and adding one to render a
      // heading would put a second Firestore read on a cached page. An
      // archive with no posts therefore has no record to show, which is the
      // same page as "this author has written nothing".
      ...(match?.author ? { record: match.author } : {}),
      name: match?.author?.name || match?.authorName || routedAuthor,
      known: Boolean(match),
    }
    data.entries = data.entries.filter((entry) =>
      entryMatchesAuthorRoute(entry, routedAuthor),
    )
  }
  if (routedCategory) {
    const match = resolveCollectionCategoryBySlug(
      data.collection?.categories,
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
  /**
   * Author segment of `/{collection}/author/{slug}` (AGL-2517). Narrows the
   * same way and at the same point as `categorySlug`, so an archive's page
   * count describes the archive rather than the collection.
   */
  authorSlug?: string
}): Promise<CollectionContent> {
  const { hostId, collectionSlug, entrySlug } = options
  const data: CollectionContent = {
    collection: null,
    entries: [],
    entry: null,
    pagination: null,
    category: null,
    error: null,
  }
  try {
    // A LIST route is served entirely from the CACHED source, which every
    // other page on the site already shares. It used to resolve the
    // collection and re-read its entries here, uncached, on every
    // regeneration of every listing address — `/blog`, nine `/blog/page/{n}`,
    // one `/blog/category/{slug}` per category, and the RSS feed — so a
    // collection of N live entries cost `1 + N + authors` reads per address
    // per window, for data byte-identical to what the cache was already
    // holding for the home page's "Latest posts" rail.
    //
    // An ENTRY route stays where it was: it reads ONE document by slug and
    // has nothing to share.
    if (!entrySlug) {
      const source = await getPublishedCollectionSource({
        hostId,
        collectionSlug,
      })
      if (!source.collection) return data
      data.collection = source.collection
      data.entries = source.entries
      data.entriesReachedBound = source.reachedBound
      applyCategoryAndPagination(data, options)
      return data
    }

    const collectionDoc = await findContentCollection(hostId, collectionSlug)
    if (!collectionDoc) return data
    data.collection = mapCollectionDoc(collectionDoc, collectionSlug)

    const entryQuery = await collectionDoc.ref
      .collection('entries')
      .where('slug', '==', entrySlug)
      .limit(5)
      .get()
    // Same two-step as `listLiveEntries`: only pay for the org read when
    // something is due, and record the refusal on its own pass because a
    // refused entry never becomes the `entryDoc` below (AGL-471).
    const dueHere = entryQuery.docs.filter((docSnapshot) =>
      isDueScheduled(docSnapshot.data()),
    )
    const permission: SchedulePermission = dueHere.length
      ? await scheduledPublishingPermission(hostId)
      : 'allowed'
    if (permission !== 'allowed') {
      for (const docSnapshot of dueHere) {
        flipDueEntry(docSnapshot.ref, docSnapshot.data(), permission)
      }
    }
    const entryDoc = entryQuery.docs.find((docSnapshot) =>
      isLive(docSnapshot.data(), permission),
    )
    if (entryDoc) {
      const value = entryDoc.data()
      flipDueEntry(entryDoc.ref, value, permission)
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
  } catch (error) {
    console.error(error)
    data.error = error
  }
  return data
}

export default getCollectionContent
