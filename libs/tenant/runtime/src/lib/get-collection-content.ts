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
  entryMatchesCategoryRoute,
  hostCollectionKind,
  normalizeContentAuthor,
  normalizeContentSchemaType,
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
  /**
   * The featured video (AGL-2956): a media reference or a URL, a Wistia link
   * included, in the shape `coverImage` is. See
   * `CollectionEntryRecord.coverVideo`.
   */
  coverVideo?: string
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
  /**
   * Last edited, which is what `Article.dateModified` publishes (AGL-2534).
   *
   * Distinct from {@link publishedAt} on purpose: re-dating a post is not
   * editing it, so the console writes `publishedAt` alone when an author
   * backdates and this stays put. Google reads `dateModified` for freshness.
   */
  updatedAt?: { seconds: number } | null
  /**
   * The collection this entry came out of (AGL-2518), stamped only by a
   * reader that MIXES collections — the author page. Unset on every routed
   * listing, where the route already answers the question. See
   * `CollectionEntryRecord.collectionSlug`.
   */
  collectionSlug?: string
  /** The display name of {@link collectionSlug}. */
  collectionName?: string
}

/** Entry-doc fields shared by the list and single-entry mappers (AGL-582). */
function mapEntryFields(
  value: FirebaseFirestore.DocumentData,
): Pick<
  CollectionEntrySummary,
  | 'excerpt'
  | 'coverImage'
  | 'coverImageAlt'
  | 'coverVideo'
  | 'seoTitle'
  | 'seoDescription'
  | 'authorName'
  | 'authorId'
  | 'categoryId'
  | 'category'
  | 'tags'
  | 'updatedAt'
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
    // Here, where both read paths pick it up, so a list card and the routed
    // entry page can each bind the featured video (AGL-2956).
    coverVideo: value['coverVideo'] ?? '',
    seoTitle: value['seoTitle'] ?? '',
    seoDescription: value['seoDescription'] ?? '',
    categoryId: value['categoryId'] ?? '',
    category: value['category'] ?? '',
    tags: Array.isArray(value['tags'])
      ? value['tags'].filter((tag): tag is string => typeof tag === 'string')
      : [],
    /*
      `dateModified`'s source (AGL-2534), and it was missing for the same
      reason `authorName` was — the reason this function's own comment above
      describes.

      The console has written `updatedAt` on every save, `page.tsx` reads
      `entry.updatedAt.seconds` to publish `Article.dateModified`, a spec
      asserts the conversion, and two console comments explain why it must not
      track `publishedAt`. Nothing mapped it, so `entry.updatedAt` was
      `undefined` on every entry the loader has ever returned and no published
      article has ever carried a `dateModified` — the freshness signal Google
      reads. The spec passed throughout because it builds its entry object by
      hand and never crosses this boundary.

      Mapped HERE rather than beside `publishedAt` at the two call sites: this
      is an ordinary field with no `publishAt` fallback and nothing sorts on
      it, so one place is enough — and one place is what stops the next read
      path from forgetting it.
    */
    updatedAt: value['updatedAt']?.seconds
      ? { seconds: value['updatedAt'].seconds }
      : null,
  }
}

/**
 * The collection doc's category taxonomy (AGL-582), sanitized: only
 * `{ id, name }` pairs with non-empty strings survive, order preserved.
 *
 * `description` rides along when the author wrote one and is dropped when it
 * is blank or not a string, so the head can tell "described" from "not
 * described" by truthiness alone — an empty string reaching the metadata
 * would suppress the template screen's description and leave the listing with
 * none at all.
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
    .map((item) => {
      const description =
        typeof item.description === 'string' ? item.description.trim() : ''
      return {
        id: item.id,
        name: item.name,
        ...(description ? { description } : {}),
      }
    })
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
    // Normalized HERE rather than at the head (AGL-2536), so an unrecognised
    // stored value can never reach the JSON-LD: an `@type` the vocabulary
    // does not define makes a consumer discard the whole node, costing the
    // page every property it publishes rather than just this one.
    schemaType: normalizeContentSchemaType(collectionDoc.get('schemaType')),
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
export function isDueScheduled(value: FirebaseFirestore.DocumentData): boolean {
  return (
    value['status'] === 'scheduled' &&
    !scheduleAlreadyRefused(value) &&
    (value['publishAt']?.seconds ?? Number.POSITIVE_INFINITY) * 1000 <=
      Date.now()
  )
}

/**
 * A scheduled entry still waiting on its time: not due yet, and not refused.
 * Nothing but a render publishes a content entry, so a cache that stored a
 * read holding one would withhold the render that notices it come due — see
 * {@link LiveEntriesRead.pendingSchedule}.
 */
export function isPendingScheduled(
  value: FirebaseFirestore.DocumentData,
): boolean {
  return (
    value['status'] === 'scheduled' &&
    !scheduleAlreadyRefused(value) &&
    !isDueScheduled(value)
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
 * entitlement caller on the tenant runtime already does: `apply-publish-schedule`
 * here, and the automation engine's two runners, all pass a possibly
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
export type SchedulePermission = 'allowed' | 'refused' | 'unresolved'

export async function scheduledPublishingPermission(
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
 *
 * Exported for the one other reader that decides whether an entry is on the
 * site — whether a LINK to it resolves (AGL-3118) — so a link and the page it
 * points at can never disagree about which entries exist.
 */
export function isLive(
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
  /**
   * The zone this site's dates read in (AGL-3237), carried on the CONTENT so
   * it reaches the client.
   *
   * `collection-fallback.tsx` renders through `next/dynamic` from
   * `catch-all-client`, so it formats dates in the browser as well as on the
   * server. A zone it read from its own runtime would be the visitor's, which
   * is precisely the hydration mismatch AGL-1926 fixed — so the server
   * decides it once and it travels here, in the props both renders read.
   */
  timeZone?: string
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
     * What KIND of article this collection publishes (AGL-2536) — the
     * `schema.org` type its entries serialise as. Unset publishes `Article`,
     * which is what every collection published before the setting existed.
     */
    schemaType?: string
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
  /**
   * Present ONLY when a verified preview grant revealed an entry the public
   * site withholds (AGL-3205) — never on a public render, and never for an
   * entry that is already live. Its absence is what the preview chrome reads
   * to say "this one is actually published", so it must not be set
   * defensively.
   */
  entryPreview?: {
    /** The stored `status` — `scheduled` or `draft`. */
    status: string
    /** The instant it is scheduled for, or null when nothing is scheduled. */
    publishAtSeconds: number | null
  }
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
   * The taxonomy's {@link CollectionCategory.description}, carried onto the
   * route so the head can describe the FILTERED listing rather than inherit
   * the whole collection's description. Absent for an unknown segment, which
   * names no category and therefore has nothing to describe.
   */
  description?: string
  /**
   * Whether the segment resolved against the collection's taxonomy. An
   * unknown category still renders — an empty listing, not a crash — but the
   * page must not invite indexing of a URL that names nothing.
   */
  known: boolean
}

export interface CollectionPagination {
  /**
   * 1-based counter for display only (AGL-3219).
   *
   * It is what `{{pagination.page}}` renders and nothing reads it back: a
   * cursor page is addressed by the document it starts after, so this number
   * describes how far a reader has walked rather than where the read began.
   * Hand-edit it in a URL and the label is wrong; the entries are not.
   */
  page: number
  perPage: number
  /**
   * The document id the NEXT (older) page starts after, or `''` when this is
   * the last page (AGL-3219).
   *
   * Set from a `limit(perPage + 1)` probe: the extra row is the only evidence
   * needed that an older page exists, and it costs one document rather than
   * the `count()` aggregation a total used to need. It is also the only
   * honest answer available — see {@link CollectionPagination.totalPages}.
   */
  nextCursor: string
  /** The document id the PREVIOUS (newer) page starts before, or `''`. */
  prevCursor: string
  /**
   * How many pages there are.
   *
   * @deprecated AGL-3219. Still resolved, so a template binding
   * `{{pagination.totalPages}}` keeps rendering, but no longer a promise: a
   * total can only be stated for a collection that fits inside one read, and
   * past that it is absent rather than wrong. It used to be derived from a
   * `count()` over a set the listing's two reads disagreed about, which is
   * how the page 10/11 seam came to repeat an entry. Bind
   * {@link CollectionPagination.nextCursor} instead — `''` means there is
   * nothing older, which is the question a pager is actually asking.
   */
  totalPages?: number
  /** @deprecated AGL-3219, with {@link CollectionPagination.totalPages}. */
  totalEntries?: number
  /**
   * Where `entries` begins in the collection's own order (AGL-3213): 0 for a
   * listing served from the cached read, and the page's own offset for one
   * served by a window read past that read's bound.
   *
   * Both windowing sites subtract it — `collectionEntriesPageWindow` on the
   * way into props, and the Collection entries block on the way into compose.
   * Without it a windowed listing renders empty, because every one of them
   * slices `[(page - 1) * perPage, …)` on the premise that `entries` starts at
   * the beginning of the collection.
   */
  windowStart?: number
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
 * The fields a LISTING read of an entry needs — the field mask on the query
 * below (AGL-3213).
 *
 * The point of the mask is the field that is NOT in it. `body` is the whole
 * post, and `mapEntryFields` has never mapped it on this path: a list card
 * binds a title, an excerpt, a cover and a byline, and the routed entry page
 * reads its one document separately. So the markdown of up to
 * {@link COLLECTION_SOURCE_MAX} posts crossed the wire, was parsed out of the
 * response, and was dropped one function later — on every fill of a cache
 * that every listing address, every "Latest posts" rail, the feed and the
 * author page share. A changelog is the worst case and also the common one.
 *
 * Firestore bills the document read either way, so this buys no reads; it
 * buys egress and the JSON parse, which is the part of a collection render
 * that grows with how much people have written.
 *
 * Site search is unaffected and must stay that way: it matches on `body`
 * through its OWN query in `apps/tenant/utils/search-content.ts`, which this
 * mask does not touch.
 *
 * ⛔ A reader added to `mapEntryFields` or to the liveness/schedule helpers
 * must be added HERE in the same edit. A field left out does not error — it
 * arrives `undefined`, which is exactly how `authorName` and `updatedAt` went
 * missing for months (AGL-2486, AGL-2534). The four schedule fields are
 * listed first for that reason: `status`, `publishAt` and `scheduleStatus`
 * decide whether an entry is live at all, and `flipDueEntry` WRITES
 * `publishAt` back as `publishedAt`, so a mask that dropped it would publish
 * a due entry with no date.
 */
const LIVE_ENTRY_FIELDS = [
  'status',
  'publishAt',
  'publishedAt',
  'scheduleStatus',
  'title',
  'slug',
  'excerpt',
  'authorName',
  'authorId',
  'coverImage',
  'coverImageAlt',
  'coverVideo',
  'seoTitle',
  'seoDescription',
  'categoryId',
  'category',
  'tags',
  'updatedAt',
] as const

/**
 * Most SCHEDULED entries one live read considers (AGL-3213).
 *
 * Read by its own query rather than taken from the dated page below, because
 * a schedule is invisible to that page: scheduling writes `publishAt` and
 * never `publishedAt`, and `flipDueEntry` during a render is the only thing
 * that publishes one. A schedule the read misses is a post that never goes
 * out. The set is small by nature — a hundred pending schedules on one
 * collection is already an unusual editorial calendar.
 */
const SCHEDULED_SOURCE_MAX = 100

/** Everything a public listing may show, before any ordering. */
function liveEntriesBase(
  entriesRef: FirebaseFirestore.CollectionReference,
): FirebaseFirestore.Query {
  return (
    entriesRef
      .where('status', 'in', ['published', 'scheduled'])
      // Everything this path reads, and nothing else (AGL-3213) — see
      // {@link LIVE_ENTRY_FIELDS}.
      .select(...LIVE_ENTRY_FIELDS)
  )
}

/**
 * The documents a live read considers, in the order the site shows them
 * (AGL-3213).
 *
 * ## Why this is ordered now, and why ordering alone would have broken it
 *
 * It was `where(status).limit(100)` with NO `orderBy`, sorted in memory
 * afterwards. That is not the newest hundred — it is a hundred documents in
 * NAME order, then sorted. Under the bound the two agree, because a hundred
 * out of a hundred is everything; past it they diverge completely. This site's
 * own changelog reached 166 live entries and its listing showed an arbitrary
 * hundred of them, chosen by document id, with 66 releases reachable only at
 * their own URLs.
 *
 * The comment that used to sit here was right about `orderBy`, though:
 * Firestore returns only documents that HAVE the ordered field, so a dated
 * read does not mis-sort an entry without a date — it hides it. Two of those
 * exist and both matter:
 *
 *   A SCHEDULE  carries `publishAt` and no `publishedAt` until it goes out.
 *               Ordering alone would have stopped scheduled posts publishing
 *               at all, silently, because nothing else publishes them.
 *   AN IMPORT   restores whatever the bundle carried, and
 *               `/api/hosts/resources` validates no field for presence
 *               either — so a published entry with no `publishedAt` exists.
 *
 * So it is three queries, in the shape the console's sorted window uses
 * (AGL-2853): the DATED page, every SCHEDULE, and — only when the dated page
 * came back SHORT, which is the server's own proof that the collection fits
 * inside the bound — a scan for live entries carrying no date. Past the bound
 * an undated entry sorts after every dated one by definition, so it belongs to
 * the tail pages, which are served by their own window read.
 */
async function readLiveEntryDocs(
  entriesRef: FirebaseFirestore.CollectionReference,
): Promise<{
  docs: FirebaseFirestore.QueryDocumentSnapshot[]
  reachedBound: boolean
}> {
  try {
    const dated = await liveEntriesBase(entriesRef)
      .orderBy('publishedAt', 'desc')
      // The document name breaks ties, so two entries published in the same
      // second cannot swap places between two reads and move a page boundary
      // under a reader. Descending to match the date: a composite index ends
      // with `__name__` in the last field's direction, which makes this the
      // `(status, publishedAt DESC)` index the console's table already needs.
      .orderBy('__name__', 'desc')
      // Named rather than literal (AGL-1516): a search index has to be able to
      // say "this read reached its bound", and it can only do that against a
      // bound it shares with the query. `collectionSourceReachedBound` reads
      // the same constant.
      .limit(COLLECTION_SOURCE_MAX)
      .get()

    const scheduled = await entriesRef
      .where('status', '==', 'scheduled')
      .select(...LIVE_ENTRY_FIELDS)
      .limit(SCHEDULED_SOURCE_MAX)
      .get()

    /*
     * EITHER read stopping at its own limit means entries went unseen.
     *
     * The dated page is the usual one. The schedule page is the case a dated
     * read alone cannot even detect: a collection holding nothing but pending
     * schedules returns ZERO dated documents, so a bound measured only there
     * would report a complete read of an empty collection — and "nothing is
     * live here" is the claim that takes a listing off the site (AGL-3101).
     */
    const reachedBound =
      dated.docs.length >= COLLECTION_SOURCE_MAX ||
      scheduled.docs.length >= SCHEDULED_SOURCE_MAX

    const undated = reachedBound
      ? []
      : (
          await liveEntriesBase(entriesRef)
            .orderBy('__name__')
            .limit(COLLECTION_SOURCE_MAX)
            .get()
        ).docs.filter((entryDoc) => !entryDoc.get('publishedAt'))

    const seen = new Set<string>()
    const docs: FirebaseFirestore.QueryDocumentSnapshot[] = []
    for (const entryDoc of [...dated.docs, ...scheduled.docs, ...undated]) {
      if (seen.has(entryDoc.id)) continue
      seen.add(entryDoc.id)
      docs.push(entryDoc)
    }
    return { docs, reachedBound }
  } catch (error) {
    /*
     * FAIL SOFT TO THE UNORDERED READ.
     *
     * The ordered query needs the `(status, publishedAt DESC)` composite
     * index. Indexes do NOT ship with a promotion — RELEASING.md deploys them
     * by hand afterwards — so the window between the code landing and the
     * index existing has to degrade rather than break. An arbitrary hundred
     * is a bad listing; a 500 is a customer's blog down.
     */
    console.error(error)
    const unordered = await liveEntriesBase(entriesRef)
      .limit(COLLECTION_SOURCE_MAX)
      .get()
    return {
      docs: unordered.docs,
      reachedBound: unordered.docs.length >= COLLECTION_SOURCE_MAX,
    }
  }
}

/** The live entries among `docs`, newest first, publishing any that came due. */
function toLiveEntries(
  docs: readonly FirebaseFirestore.QueryDocumentSnapshot[],
  permission: SchedulePermission,
): CollectionEntrySummary[] {
  return (
    docs
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
      // An entry carrying no date at all sorts last rather than to 1970 —
      // the same place the query's own order puts it.
      .sort(
        (a, b) => (b.publishedAt?.seconds ?? 0) - (a.publishedAt?.seconds ?? 0),
      )
  )
}

/**
 * Fetches a collection's live entries (newest first), shared by the route
 * loader and the compose-time Collection entries block (AGL-551).
 */
async function listLiveEntries(
  entriesRef: FirebaseFirestore.CollectionReference,
  hostId: string,
): Promise<LiveEntriesRead> {
  const { docs, reachedBound } = await readLiveEntryDocs(entriesRef)

  // Ask the plan question ONLY if something is actually due (AGL-471). A
  // collection with no due schedule — almost every render — never reads the
  // org at all.
  const due = docs.filter((entryDoc) => isDueScheduled(entryDoc.data()))
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

  // Measured on the RAW docs, before the liveness filter (AGL-1516): a
  // not-yet-due entry is filtered out one line down, so this is the last
  // place that can see one at all.
  const pendingSchedule = docs.some((entryDoc) =>
    isPendingScheduled(entryDoc.data()),
  )

  const entries = toLiveEntries(docs, permission)

  return {
    entries,
    reachedBound,
    pendingSchedule,
  }
}

/** One page of a listing, and whether anything older follows it. */
interface CollectionListingPage {
  entries: CollectionEntrySummary[]
  /** The `limit(perPage + 1)` probe found an extra row. */
  hasMore: boolean
}

/**
 * One page of a listing that starts PAST the cached read (AGL-3213),
 * addressed by the document it continues from rather than by a position
 * (AGL-3219).
 *
 * Uncached on purpose, and it is the only read on the collection path that is.
 * The cached source exists because `/blog`, every listing address, the feed
 * and every "Latest posts" rail want the same first hundred entries
 * (AGL-1302); a page past that bound wants ten entries nobody else is asking
 * for, and its own ISR entry is already the cache for them.
 *
 * ## Why a cursor, and not the offset this replaces
 *
 * `.offset(n)` asks for a POSITION, and a listing takes its inserts at the
 * head, so every publish moves every position by one. The head pages and this
 * read are cached under different policies and revalidated by different
 * triggers — the publish fan-out refreshes the head eagerly and deliberately
 * stops there — so the two sides were routinely describing the collection as
 * it stood at two different moments, and the seam between them repeated an
 * entry or hid one for as long as the slower side lagged. `v1.0.0-beta.147`
 * shipped and `/changelog` showed `v1-0-0-beta-36` as both the last entry of
 * page 10 and the first of page 11.
 *
 * `startAfter(doc)` asks a question whose answer does not move: what follows
 * THIS entry. Publish a hundred entries at the head and this page returns the
 * same ten. The seam cannot drift because there is no longer a number on
 * either side of it to disagree about.
 *
 * `offset` also billed every document it skipped; a cursor bills none of them.
 */
async function readCollectionListingPage(options: {
  hostId: string
  collectionSlug: string
  /** Start after this document id — the older direction. */
  after?: string
  /** Start before this document id — the newer direction. */
  before?: string
  limit: number
}): Promise<CollectionListingPage | null> {
  try {
    const collectionDoc = await findContentCollection(
      options.hostId,
      options.collectionSlug,
    )
    if (!collectionDoc) return null
    const entriesRef = collectionDoc.ref.collection('entries')

    const cursorId = options.before || options.after
    if (!cursorId) return null
    // A direct get, not a `where('slug', ...)` query: the cursor IS the
    // document name, which is the second field the read orders on, so the
    // snapshot it needs is one document rather than an index lookup.
    const cursorDoc = await entriesRef.doc(cursorId).get()
    // A cursor naming a document that no longer exists — deleted, or a URL
    // someone kept — cannot be positioned against. Null sends the caller back
    // to the cached head, which is a page the reader can act on.
    if (!cursorDoc.exists) return null

    // Backwards is the same query read the other way up, so both directions
    // rest on an index the project already deploys: `(status, publishedAt)`
    // exists ascending and descending both.
    const backwards = Boolean(options.before)
    const snapshot = await liveEntriesBase(entriesRef)
      .orderBy('publishedAt', backwards ? 'asc' : 'desc')
      .orderBy('__name__', backwards ? 'asc' : 'desc')
      .startAfter(cursorDoc)
      // One more than the page: the extra row is the whole of "is there
      // another page", and it replaces a `count()` over the collection.
      .limit(options.limit + 1)
      .get()

    const hasMore = snapshot.docs.length > options.limit
    const pageDocs = snapshot.docs.slice(0, options.limit)
    // Read backwards, the newest of the page came back last.
    const docs = backwards ? [...pageDocs].reverse() : pageDocs

    const due = docs.filter((entryDoc) => isDueScheduled(entryDoc.data()))
    const permission: SchedulePermission = due.length
      ? await scheduledPublishingPermission(options.hostId)
      : 'allowed'
    if (permission !== 'allowed') {
      for (const entryDoc of due) {
        flipDueEntry(entryDoc.ref, entryDoc.data(), permission)
      }
    }
    const entries = toLiveEntries(docs, permission)
    // The byline reads `authorName`, which a record-backed author only has
    // once resolved — the cached source does this for the entries it holds,
    // and a windowed page holds entries it never saw (AGL-2486).
    await attachEntryAuthors(options.hostId, entries)
    return { entries, hasMore }
  } catch (error) {
    // Fail open to the cached head rather than to a 500: the caller keeps
    // whatever it already had, which is a page the reader has seen before
    // rather than an error they cannot get past.
    console.error(error)
    return null
  }
}

/**
 * The cursor a retired `/{collection}/page/{n}` address redirects onto
 * (AGL-3219).
 *
 * This is the ONE place a position is still resolved, and it is deliberately
 * the only one: a 301 is served once, the reader lands on an address that
 * cannot drift afterwards, and whatever the position meant at that instant is
 * the page they would have got anyway. Everything downstream is cursors.
 *
 * Keys only — `select()` with no fields asks Firestore for document names and
 * nothing else — so the skipped documents are billed at the cheapest rate the
 * offset can be had for. Returns `''` when the position is past the end,
 * which is a 404 rather than a redirect to nowhere.
 */
export async function resolveCollectionPageCursor(options: {
  hostId: string
  collectionSlug: string
  /** 1-based page whose PREVIOUS entry is the cursor. */
  page: number
  perPage: number
}): Promise<string> {
  const skip = (options.page - 1) * options.perPage - 1
  if (!Number.isFinite(skip) || skip < 0) return ''
  try {
    const collectionDoc = await findContentCollection(
      options.hostId,
      options.collectionSlug,
    )
    if (!collectionDoc) return ''
    const snapshot = await collectionDoc.ref
      .collection('entries')
      .where('status', 'in', ['published', 'scheduled'])
      .select()
      .orderBy('publishedAt', 'desc')
      .orderBy('__name__', 'desc')
      .offset(skip)
      .limit(1)
      .get()
    return snapshot.docs[0]?.id ?? ''
  } catch (error) {
    console.error(error)
    return ''
  }
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
  },
  listing?: {
    /** Where `data.entries` begins in that collection's order. */
    windowStart?: number
    /** The shared read came back holding its own limit. */
    reachedBound?: boolean
    /**
     * The `perPage + 1` probe of a CURSOR page found an extra row — set only
     * when this listing was served by one, because only that read can answer
     * it (AGL-3219).
     */
    cursorHasMore?: boolean
  },
): void {
  const { page = 1, perPage } = options
  const routedCategory = (options.categorySlug ?? '').trim()
  if (routedCategory) {
    const match = resolveCollectionCategoryBySlug(
      data.collection?.categories,
      routedCategory,
    )
    data.category = {
      slug: collectionCategorySlug(routedCategory),
      ...(match ? { id: match.id } : {}),
      name: match?.name ?? routedCategory,
      ...(match?.description ? { description: match.description } : {}),
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
    /*
     * The total is the COLLECTION's, not the read's (AGL-3213).
     *
     * `entries.length` was the count, and on a collection inside the bound it
     * still is — the two are the same number there. Past the bound it is the
     * size of the window, which is how `/changelog` advertised "Page 10 of
     * 10" while holding 166 entries and linking to 100 of them.
     *
     * A ROUTED CATEGORY keeps counting its own entries, because that is the
     * only honest number available here: the narrowing happens in memory over
     * the cached head, so both the count and the listing describe the same
     * bounded set. Paging a category past the bound needs its own ordered
     * query and a `(categoryId, status, publishedAt DESC)` index; until then
     * a category of a very large collection is capped, and says so by
     * agreeing with what it shows.
     */
    const windowStart = Number(listing?.windowStart)
    const windowed = Number.isFinite(windowStart) && windowStart > 0

    /*
     * The cursors, which are the pager's real answer (AGL-3219).
     *
     * `data.entries` is either EXACTLY this page — a cursor read — or the
     * whole cached head, which every listing address shares and each slices
     * its own page out of. So the page's own last entry is at the end of the
     * array in the first case and at `page * perPage - 1` in the second, and
     * the cursor is that entry's document id.
     */
    const pageEnd = windowed ? data.entries.length : page * perPage
    const last = data.entries[pageEnd - 1]
    const first = data.entries[windowed ? 0 : (page - 1) * perPage]

    /*
     * Is there an older page?
     *
     * A cursor page KNOWS, because its read asked for one more entry than it
     * needed and the extra row came back. The head has to reason: either it
     * is holding more entries than this page shows, or it is holding all it
     * could read and the read stopped at its own bound, which is the one
     * thing `entries.length` can never tell you about the collection.
     */
    const hasMore =
      listing?.cursorHasMore ??
      (data.entries.length > pageEnd ||
        (Boolean(listing?.reachedBound) && !routedCategory))

    /*
     * The deprecated total, stated ONLY where it can be true.
     *
     * A collection that fits inside one read can be counted, and a template
     * binding `{{pagination.totalPages}}` keeps rendering the number it
     * always did. Past the bound there is no honest total — the count and
     * the listing were reading the collection at two different moments, which
     * is what made the seam repeat an entry — so it is left absent rather
     * than asserted. A routed category counts its own narrowed set, which is
     * bounded by the same head and therefore countable.
     */
    const countable = routedCategory || !listing?.reachedBound
    const totalEntries = countable ? data.entries.length : undefined

    data.pagination = {
      page,
      perPage,
      nextCursor: hasMore && last?.$id ? last.$id : '',
      prevCursor: page > 1 && first?.$id ? first.$id : '',
      ...(totalEntries === undefined
        ? {}
        : {
            totalEntries,
            totalPages: collectionTotalPages(totalEntries, perPage),
          }),
      ...(windowed ? { windowStart } : {}),
    }
  }
}

/**
 * Resolves a non-screen path against the host's content collections
 * (Content Collections & Blog): `/{collectionSlug}` returns the published
 * entry list, `/{collectionSlug}/{entrySlug}` one entry. Fail-open — errors
 * resolve to `collection: null` and the caller 404s.
 *
 * A listing resolves only for a collection with a live entry (AGL-3101); one
 * with nothing live answers `collection: null` as well, so its listing, feed
 * and markdown twin are not public until its first entry is.
 */
export async function getCollectionContent(options: {
  hostId: string
  collectionSlug: string
  entrySlug?: string
  /**
   * 1-based list page (AGL-620), now a DISPLAY counter (AGL-3219): it labels
   * the page the reader is on and no read is positioned from it. The entries
   * come from `after`/`before`, or from the head of the cached source when
   * neither is set.
   */
  page?: number
  /** Entries per page (AGL-620); when set the list is paginated. */
  perPage?: number
  /**
   * Continue AFTER this entry's document id — the older direction (AGL-3219).
   *
   * What `/{collection}?after={id}` carries. A page defined this way does not
   * move when something is published above it, which is the whole reason the
   * addresses stopped being positions.
   */
  after?: string
  /** Continue BEFORE this entry's document id — the newer direction. */
  before?: string
  /**
   * The site's zone (AGL-3237). Stamped onto the returned content so every
   * reader downstream — including the client fallback renderer — formats from
   * the same string rather than from its own runtime.
   */
  timeZone?: string
  /**
   * Category segment of `/{collection}/category/{slug}` (AGL-1321). Filters
   * the listing before pagination is computed, so page counts and the page
   * windows describe the FILTERED set rather than the whole collection.
   */
  categorySlug?: string
  /**
   * Reveal the named entry even though the public site withholds it — the
   * live-site preview of a scheduled post (AGL-3205).
   *
   * ⛔ A VERIFIED GRANT, NOT A REQUEST. The caller passes `true` only after a
   * signed preview token has been checked against the resolved hostId AND
   * this exact `collectionSlug`/`entrySlug` (`verifyCollectionPreviewToken`).
   * The token format stays in the app that receives the URL; what crosses into
   * this lib is the verdict, so nothing here can be tricked by a payload's own
   * spelling of which entry it names.
   *
   * ENTRY ROUTES ONLY, and one entry at a time. It is ignored on a list route
   * — a preview of one post must not add it to `/blog`, to the feed, or to a
   * Collection entries block on any other page, all of which read the SHARED
   * cached source. Nothing it touches is cached at all.
   *
   * The preview render also writes NOTHING: see the `flipDueEntry` guard
   * below. Publishing a schedule stays the sole business of a public render.
   */
  previewUnpublishedEntry?: boolean
}): Promise<CollectionContent> {
  const { hostId, collectionSlug, entrySlug } = options
  // Never on a list route, whatever the caller passed: `entrySlug` is what
  // makes the grant addressable at all, and the list is the shared cached
  // read this must stay out of.
  const preview = Boolean(options.previewUnpublishedEntry) && Boolean(entrySlug)
  const data: CollectionContent = {
    // Stamped before any early return, so every shape this function can hand
    // back carries it — including the empty one a 404 renders from.
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
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
      // A collection is not a PAGE until something in it is live (AGL-3101).
      // Without this, creating one publishes `/{slug}` at once — an empty
      // listing with a feed and a markdown twin, before a word of it is
      // written. Answering it as no collection makes every listing address
      // 404 the way an unknown slug does, until the first entry is published
      // or its schedule comes due.
      //
      // Read off the UNFILTERED live set, before the category narrows it, so
      // an empty category of a live collection still renders. A read that
      // stopped at its bound cannot prove the collection empty — the live
      // entries may be past it — so that one keeps its listing. The rule
      // lives here and not in the source above: the source also feeds the
      // Collection entries block and the author page, and to them an empty
      // collection is an empty list, not a missing one.
      if (!source.entries.length && !source.reachedBound) return data
      data.collection = source.collection
      data.entries = source.entries
      data.entriesReachedBound = source.reachedBound
      /*
       * A page that starts past the cached read is served by its own window
       * (AGL-3213). Everything before that point comes out of the shared
       * source, so the pages a reader actually visits stay free.
       *
       * Only the unfiltered listing: a category route narrows in memory over
       * the same head, and a window read of the whole collection would hand
       * it ten entries of which any number may belong to another category.
       */
      const { page = 1, perPage } = options
      const cursor = (options.after ?? options.before ?? '').trim()
      let windowStart = 0
      let cursored: CollectionListingPage | null = null
      /*
       * A cursor address is served by its own read (AGL-3219). Everything
       * reachable without one comes out of the shared source, so the pages a
       * reader actually visits stay free.
       *
       * Only the unfiltered listing: a category route narrows in memory over
       * the same head, and a cursor read of the whole collection would hand it
       * ten entries of which any number belong to another category.
       */
      if (perPage && perPage > 0 && cursor && !(options.categorySlug ?? '').trim()) {
        cursored = await readCollectionListingPage({
          hostId,
          collectionSlug,
          ...(options.before ? { before: options.before } : { after: cursor }),
          limit: perPage,
        })
        // Null means the cursor read failed, or named a document that is
        // gone. The cached head is the better answer than an empty page: the
        // reader sees the newest entries rather than nothing at all.
        if (cursored) {
          data.entries = cursored.entries
          /*
           * `entries` is now EXACTLY this page, and both windowing sites
           * slice `[(page - 1) * perPage, …)`. Declaring the window to start
           * at that same offset makes their subtraction come out at zero, so
           * they take the page whole.
           *
           * Both sides of the subtraction are built from the same `page`, so
           * a hand-edited counter in a URL cancels itself out: the label is
           * wrong and the entries are still this cursor's page.
           */
          windowStart = (page - 1) * perPage
        }
      }
      applyCategoryAndPagination(data, options, {
        windowStart,
        reachedBound: source.reachedBound,
        ...(cursored ? { cursorHasMore: cursored.hasMore } : {}),
      })
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
    //
    // A PREVIEW RENDER SKIPS BOTH WRITES (AGL-3205). `flipDueEntry` is the
    // entire publishing mechanism for a content entry, and it is a mechanism
    // that belongs to the PUBLIC render: a preview is one person looking at
    // one post through a link, and it must not be able to publish it, nor to
    // burn its schedule with the terminal refusal marker. Skipping the writes
    // costs nothing — the next public render asks the same questions and
    // writes the same answers — and it is what keeps "nothing but a render
    // publishes a content entry" true of renders anybody can reach.
    const dueHere = entryQuery.docs.filter((docSnapshot) =>
      isDueScheduled(docSnapshot.data()),
    )
    const permission: SchedulePermission = dueHere.length
      ? await scheduledPublishingPermission(hostId)
      : 'allowed'
    if (permission !== 'allowed' && !preview) {
      for (const docSnapshot of dueHere) {
        flipDueEntry(docSnapshot.ref, docSnapshot.data(), permission)
      }
    }
    /**
     * What a grant reveals: an entry this collection HOLDS and the site does
     * not serve.
     *
     * Deliberately not routed through `isLive`, which is the public answer and
     * has one other reader (`entry-link-routes`) whose whole job is to agree
     * with it. A second, wider answer inside it would make a LINK to a
     * previewed post resolve on the public site.
     *
     * Every status but `published` qualifies, which is `draft` as well as
     * `scheduled`: the ask is "let me see it before it goes out", and a post
     * is most worth looking at before its schedule is set. The blast radius is
     * the same either way — one entry, named in the signature, on one host.
     */
    const entryDoc =
      entryQuery.docs.find((docSnapshot) =>
        isLive(docSnapshot.data(), permission),
      ) ?? (preview ? entryQuery.docs[0] : undefined)
    if (entryDoc) {
      const value = entryDoc.data()
      if (!preview) flipDueEntry(entryDoc.ref, value, permission)
      if (preview && !isLive(value, permission)) {
        // The facts the preview chrome states back to the reader, so the page
        // cannot be mistaken for the published post. Read from the stored
        // document rather than inferred from the render.
        data.entryPreview = {
          status: String(value['status'] ?? 'draft'),
          publishAtSeconds:
            typeof value['publishAt']?.seconds === 'number'
              ? value['publishAt'].seconds
              : null,
        }
      }
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
