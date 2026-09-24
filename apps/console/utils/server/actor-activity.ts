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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  applyListFilter,
  type ListFilterInput,
} from './list-filter'
import { ACTIVITY_LIST_FILTER_FIELDS } from '../list-filters'
import { scanCursorPage } from '../scan-cursor-page'

/**
 * One person's activity, wherever it happened.
 *
 * Activity is written per subject — `hosts/{hostId}/activity` and
 * `orgs/{orgId}/activity` — which answers "what happened to this site" and
 * cannot answer "what did this person do", the question both the staff user
 * page and the org member page are actually asking. A collection-group query
 * on `activity` by `actorId` answers it in one place, at the cost of an index
 * (`cloud/firebase-firestore.indexes.json`) and of running through the Admin
 * SDK: a collection-group read is evaluated against a rule that matches the
 * GROUP, and there is no such rule — deliberately, because "every activity
 * document on the platform" is not a query any client should be able to run.
 *
 * ## Scoping, and why it is a filter rather than a second `where`
 *
 * The org view wants this person's activity inside ONE organization. There is
 * no `orgId` on a host's activity document to filter on — the org is the
 * document's grandparent, not a field — so the scope is applied to the parent
 * PATH after the read.
 *
 * Adding the field and backfilling it would make this a two-field query and a
 * smaller read. It would also be a schema change to every activity document
 * ever written, to make a staff-and-owner audit page faster; the filter is
 * what that trade does not justify yet, and `scanned` in the result is what
 * would say when it does.
 */

/** A stored activity document, flattened for the client. */
export interface ActorActivityEntry {
  $id: string
  /** `hosts/{hostId}` or `orgs/{orgId}` — where it happened. */
  scopePath: string
  scopeType: 'host' | 'org' | 'unknown'
  scopeId: string
  action?: string
  target?: Record<string, unknown> | null
  actorEmail?: string | null
  createdAt: { seconds: number } | null
}

export interface ActorActivityPage {
  entries: ActorActivityEntry[]
  /** Opaque; hand it back to continue. `null` when there is no next page. */
  nextCursor: string | null
  /**
   * Documents READ to fill this page, matching or not.
   *
   * Reported rather than hidden because it is the number that says whether
   * the path filter above has stopped being affordable — a page that scans
   * hundreds to show twenty-five is the signal to put `orgId` on the
   * document, and without this nobody would ever see it.
   */
  scanned: number
}

/** Pages larger than this are a query nobody reads and a bill somebody pays. */
export const ACTOR_ACTIVITY_MAX_PAGE = 100

/**
 * How many documents one request may read while filtering.
 *
 * Without it, a person with a great deal of activity in OTHER organizations
 * makes the org-scoped view walk their whole history looking for matches, on
 * one request, holding a connection. The page comes back short instead, with
 * a cursor — the reader clicks Next and the work continues.
 */
const SCAN_CAP = 1_000

const timestampSeconds = (value: unknown): number | null => {
  const seconds = (value as { seconds?: unknown } | undefined)?.seconds
  return typeof seconds === 'number' ? seconds : null
}

function describeScope(path: string): {
  scopeType: ActorActivityEntry['scopeType']
  scopeId: string
} {
  const [collection, id] = path.split('/')
  if (collection === 'hosts' && id) return { scopeType: 'host', scopeId: id }
  if (collection === 'orgs' && id) return { scopeType: 'org', scopeId: id }
  return { scopeType: 'unknown', scopeId: '' }
}

export interface ReadActorActivityOptions {
  actorId: string
  pageSize: number
  /**
   * One column filter from the grid, or null. Applied to the QUERY so it
   * narrows the whole feed rather than the page already on screen — a filter
   * that sees one page answers "nothing happened" for everything before it,
   * which on an audit log is the wrong answer to the question being asked.
   */
  filter?: ListFilterInput | null
  /**
   * Several clauses, every one applied to the query. The caller has checked
   * them against the fields it offers (`auditLogFilterRefusal`).
   */
  filters?: readonly ListFilterInput[]
  /**
   * Keeps only the entries it accepts — a word search no index can answer.
   * Matched as the feed is read, like the scope below.
   */
  matches?: ((entry: ActorActivityEntry) => boolean) | null
  /** The `nextCursor` of the previous page — a document path. */
  cursor?: string | null
  /**
   * Parent paths this reader may see (`hosts/x`, `orgs/y`). Absent means
   * every scope, which is the staff view; present and EMPTY means none, which
   * is a real answer and not an oversight.
   */
  scopePaths?: ReadonlySet<string>
}

/** A stored activity document as the client reads it. */
function flattenEntry(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  scopePath: string,
): ActorActivityEntry {
  const data = doc.data() as Record<string, unknown>
  const seconds = timestampSeconds(data['createdAt'])
  return {
    $id: doc.id,
    scopePath,
    ...describeScope(scopePath),
    action: typeof data['action'] === 'string' ? data['action'] : undefined,
    target: (data['target'] as Record<string, unknown> | null) ?? null,
    actorEmail: typeof data['actorEmail'] === 'string' ? data['actorEmail'] : null,
    createdAt: seconds === null ? null : { seconds },
  }
}

/**
 * A document path read back as a cursor, or `null` when it is not one.
 * `doc()` throws on a path with an odd number of segments, and a cursor from
 * the org-wide merge is not a path at all.
 */
async function cursorDocument(
  firestore: FirebaseFirestore.Firestore,
  cursor: string | null | undefined,
): Promise<FirebaseFirestore.DocumentSnapshot | null> {
  if (!cursor) return null
  try {
    const snapshot = await firestore.doc(cursor).get()
    return snapshot.exists ? snapshot : null
  } catch {
    return null
  }
}

export async function readActorActivity(
  options: ReadActorActivityOptions,
): Promise<ActorActivityPage> {
  const { actorId, cursor, scopePaths, matches } = options
  const pageSize = Math.min(
    Math.max(1, Math.floor(options.pageSize) || 25),
    ACTOR_ACTIVITY_MAX_PAGE,
  )
  const firestore = firebaseAdmin.app().firestore()
  if (!actorId) return { entries: [], nextCursor: null, scanned: 0 }
  if (scopePaths && scopePaths.size === 0) {
    return { entries: [], nextCursor: null, scanned: 0 }
  }

  const unfiltered = firestore
    .collectionGroup('activity')
    .where('actorId', '==', actorId)
  /*
   * `fixedOrderBy` because this feed owns its ordering: the cursor below is a
   * DOCUMENT in `createdAt` order, so a predicate that needed a different sort
   * would invalidate every cursor already issued. The translator refuses those
   * rather than reordering, and the feed comes back unfiltered — which is the
   * honest answer to an ask this query cannot serve.
   */
  let filtered: FirebaseFirestore.Query = unfiltered
  for (const clause of [
    ...(options.filter ? [options.filter] : []),
    ...(options.filters ?? []),
  ]) {
    filtered =
      applyListFilter(filtered, ACTIVITY_LIST_FILTER_FIELDS, clause, {
        fixedOrderBy: 'createdAt',
      }) ?? filtered
  }
  const base = filtered.orderBy('createdAt', 'desc')

  // The cursor is a document PATH, not a timestamp. Two entries can share a
  // second — a save and its revalidation, a bulk role change — and starting
  // after a timestamp would either repeat them on the next page or skip them.
  const after = await cursorDocument(firestore, cursor)

  /*
   * Rows outside the scope, or not matching the search, are READ and not
   * kept. The read budget bounds the walk: a person with a great deal of
   * activity in other organizations comes back as a short page with a
   * cursor, and Next carries on from the last document read.
   */
  const page = await scanCursorPage<FirebaseFirestore.DocumentSnapshot, ActorActivityEntry>({
    pageSize,
    scanCap: SCAN_CAP,
    // One extra so a full batch can be told from the last batch without a
    // second query.
    batchSize: Math.min(pageSize + 1, ACTOR_ACTIVITY_MAX_PAGE),
    after,
    read: async (from, count) =>
      (await (from ? base.startAfter(from) : base).limit(count).get()).docs,
    accept: (doc) => {
      const scopePath = doc.ref.parent.parent?.path ?? ''
      if (scopePaths && !scopePaths.has(scopePath)) return null
      const entry = flattenEntry(doc as FirebaseFirestore.QueryDocumentSnapshot, scopePath)
      return !matches || matches(entry) ? entry : null
    },
  })

  return {
    entries: page.rows,
    nextCursor: page.exhausted ? null : (page.last?.ref.path ?? null),
    scanned: page.scanned,
  }
}

/**
 * The parent paths that belong to one organization: the org itself, and every
 * site it owns.
 *
 * Read once per request. An org with no sites still has its own feed, which
 * is why the org path is added unconditionally.
 */
export async function orgActivityScopePaths(
  orgId: string,
): Promise<Set<string>> {
  const firestore = firebaseAdmin.app().firestore()
  const hosts = await firestore
    .collection('hosts')
    .where('orgId', '==', orgId)
    .select()
    .get()
  const paths = new Set<string>([`orgs/${orgId}`])
  for (const doc of hosts.docs) paths.add(`hosts/${doc.id}`)
  return paths
}


/** A choice the org-wide log offers in its Who and Where filters. */
export interface OrgActivityFacet {
  value: string
  label: string
}

/** How many members the Who filter lists; an organization past it is typed into. */
const FACET_MEMBERS_LIMIT = 500

/**
 * The org-wide log's picked filter values: the organization's members, by
 * the address they are listed under, and the organization itself beside each
 * of its sites. Read once, with the first page, rather than on every page.
 *
 * Members only — someone who has left the organization has no member
 * document, and their entries are still in the log under the search box.
 */
export async function orgActivityFacets(orgId: string): Promise<{
  actors: OrgActivityFacet[]
  sites: OrgActivityFacet[]
}> {
  const firestore = firebaseAdmin.app().firestore()
  const [members, hosts] = await Promise.all([
    firestore
      .collection('orgs')
      .doc(orgId)
      .collection('members')
      .select('email', 'displayName')
      .limit(FACET_MEMBERS_LIMIT)
      .get()
      .catch(() => null),
    firestore
      .collection('hosts')
      .where('orgId', '==', orgId)
      .select('displayName', 'subdomain')
      .get()
      .catch(() => null),
  ])
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)
  const byLabel = (a: OrgActivityFacet, b: OrgActivityFacet) => a.label.localeCompare(b.label)
  const actors = (members?.docs ?? [])
    .map((doc) => {
      const data = doc.data() as Record<string, unknown>
      return { value: doc.id, label: text(data['email']) ?? text(data['displayName']) ?? doc.id }
    })
    .sort(byLabel)
  const sites = (hosts?.docs ?? [])
    .map((doc) => {
      const data = doc.data() as Record<string, unknown>
      return {
        value: doc.id,
        label: text(data['displayName']) ?? text(data['subdomain']) ?? doc.id,
      }
    })
    .sort(byLabel)
  return { actors, sites: [{ value: orgId, label: 'Organization' }, ...sites] }
}

/**
 * Everything that happened in one organization, its SITES included
 *.
 *
 * `orgs/{orgId}/activity` holds only what happened at ORG level — an invite,
 * a role change, a billing edit. Nearly everything a team actually does
 * happens on a site and lands in `hosts/{hostId}/activity`, so a card reading
 * the org collection alone tells a brand-new organization it has done
 * nothing, on the day it published three pages.
 *
 * ## Why a fan-out rather than a collection group
 *
 * `readActorActivity` can use one collection-group query because it filters
 * by `actorId` — a single person, a small result set. There is no equivalent
 * filter for "this org": the org is a document's grandparent, not a field. A
 * collection-group query with no filter would order every activity document
 * on the platform by date and throw away all but this org's, which is the
 * one shape that gets more expensive as other customers get busier.
 *
 * So: one bounded query per subject, merged by date here. The cost is a
 * function of THIS org's site count, which is what it should be.
 */
/**
 * Where a merged fan-out left off.
 *
 * A single-collection cursor can be a document path, because "the row after
 * that one" is a question one query can answer. A merge has no such row: the
 * next page begins part-way through several subjects at once, and the only
 * thing they share is the clock.
 *
 * So the cursor is a TIME plus the ids already emitted AT that time. The time
 * alone is not enough — a strict `<` would drop every entry sharing the
 * boundary second (a save and its revalidation, a bulk role change land in
 * the same second routinely), and a non-strict `<=` would repeat them. The id
 * list is what makes `<=` safe: re-read the boundary second, discard what has
 * already been shown.
 */
interface OrgWideCursor {
  /** `createdAt` seconds of the last row emitted. */
  seconds: number
  /** Ids already emitted whose `createdAt` is exactly `seconds`. */
  ids: string[]
}

const encodeOrgWideCursor = (cursor: OrgWideCursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')

function decodeOrgWideCursor(raw: string | null | undefined): OrgWideCursor | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    const seconds = Number(parsed?.seconds)
    if (!Number.isFinite(seconds)) return null
    const ids = Array.isArray(parsed?.ids) ? parsed.ids.map(String) : []
    return { seconds, ids }
  } catch {
    // An unreadable cursor restarts at the top rather than throwing. A stale
    // Next in an open tab should not turn the feed into a 500.
    return null
  }
}

export interface OrgWideActivityPage {
  entries: ActorActivityEntry[]
  /** Opaque; hand it back to continue. `null` at the end of the feed. */
  nextCursor: string | null
  /** Entries read to fill this page, matching the search or not. */
  scanned: number
}

/** A merged entry, and the cursor that resumes the feed just after it. */
interface MergedEntry {
  /** `null` only for the resume point a cursor names, which is not re-read. */
  entry: ActorActivityEntry | null
  position: OrgWideCursor | null
}

/** The position after `entry`, given the position before it. */
function advance(
  position: OrgWideCursor | null,
  entry: ActorActivityEntry,
): OrgWideCursor | null {
  const seconds = entry.createdAt?.seconds
  // An entry with no timestamp cannot be resumed after; the position stays
  // where it was, and the merge sorts such an entry after every dated one.
  if (seconds === undefined) return position
  // Everything shown at the boundary second, including what an earlier page
  // showed there — otherwise a second spanning three pages would serve its
  // first page's rows again on the third.
  return position?.seconds === seconds
    ? { seconds, ids: [...position.ids, entry.$id] }
    : { seconds, ids: [entry.$id] }
}

export async function readOrgWideActivity(options: {
  orgId: string
  limit: number
  cursor?: string | null
  /**
   * Narrow every subject's query, never the merged page. The merge takes the
   * newest `limit` across subjects, so narrowing afterwards would first
   * discard the rows the filter wanted and then report what survived — a
   * filter that gets emptier the busier the organization is.
   */
  filter?: ListFilterInput | null
  filters?: readonly ListFilterInput[]
  /** Keeps only the entries it accepts; matched as the merge is read. */
  matches?: ((entry: ActorActivityEntry) => boolean) | null
  /** How many entries one page may read while `matches` looks. */
  scanCap?: number
  /** The subjects to read. Every one the organization has, when absent. */
  paths?: ReadonlySet<string>
}): Promise<OrgWideActivityPage> {
  const firestore = firebaseAdmin.app().firestore()
  const limit = Math.min(
    Math.max(1, Math.floor(options.limit) || 25),
    ACTOR_ACTIVITY_MAX_PAGE,
  )
  const start = decodeOrgWideCursor(options.cursor)
  const paths = options.paths ?? (await orgActivityScopePaths(options.orgId))
  const clauses = [
    ...(options.filter ? [options.filter] : []),
    ...(options.filters ?? []),
  ]
  const subjects = [...paths].flatMap((path) => {
    const [collection, id] = path.split('/')
    if (!collection || !id) return []
    let query: FirebaseFirestore.Query = firestore
      .collection(collection)
      .doc(id)
      .collection('activity')
    for (const clause of clauses) {
      query =
        applyListFilter(query, ACTIVITY_LIST_FILTER_FIELDS, clause, {
          fixedOrderBy: 'createdAt',
        }) ?? query
    }
    // `select` because the merge reads four fields and a version of an
    // activity document can carry considerably more. It does not change
    // what Firestore bills — that is per document — only what crosses the
    // wire.
    return [
      {
        path,
        query: query
          .orderBy('createdAt', 'desc')
          .select('action', 'target', 'actorEmail', 'createdAt'),
      },
    ]
  })

  /**
   * The next `count` entries after `from`, merged across subjects.
   *
   * `count` plus the ids already shown at the boundary from EACH subject,
   * because the newest `count` overall could all have come from one site and
   * the boundary second is read again. Taking fewer per subject to save reads
   * would silently cap how much of a busy site can appear.
   *
   * The boundary is `< second + 1`, not `<= second`: a stored timestamp
   * carries a fraction, and `<=` the whole second would drop every entry
   * written later within it that the last page did not reach.
   */
  const readMerged = async (
    from: OrgWideCursor | null,
    count: number,
  ): Promise<MergedEntry[]> => {
    const perSubject = await Promise.all(
      subjects.map(async ({ path, query }) => {
        const bounded = from
          ? query.where(
              'createdAt',
              '<',
              firebaseAdmin.firestore.Timestamp.fromMillis((from.seconds + 1) * 1000),
            )
          : query
        const snapshot = await bounded
          .limit(count + (from?.ids.length ?? 0))
          .get()
          .catch(() => null)
        return (snapshot?.docs ?? []).map((doc) => flattenEntry(doc, path))
      }),
    )
    const shown = new Set(from?.ids ?? [])
    const merged = perSubject
      .flat()
      .filter(
        (entry) =>
          !(from && entry.createdAt?.seconds === from.seconds && shown.has(entry.$id)),
      )
      // An entry with no timestamp sorts last rather than first: an
      // unreadable date is not a reason to lead the feed with it.
      .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
      // Only the newest `count` are certain: past them, a subject that
      // returned its full share may hold older rows not read yet.
      .slice(0, count)
    const out: MergedEntry[] = []
    let position = from
    for (const entry of merged) {
      position = advance(position, entry)
      out.push({ entry, position })
    }
    return out
  }

  const matches = options.matches ?? null
  const page = await scanCursorPage<MergedEntry, ActorActivityEntry>({
    pageSize: limit,
    scanCap: matches ? (options.scanCap ?? SCAN_CAP) : limit,
    // One extra so a full merge can be told from the last one.
    batchSize: limit + 1,
    after: start ? { entry: null, position: start } : null,
    read: (from, count) => readMerged(from?.position ?? null, count),
    accept: ({ entry }) => (entry && (!matches || matches(entry)) ? entry : null),
  })

  /*
   * More to come unless the merge genuinely ran out. A position that cannot
   * be expressed — the last entry read had no timestamp — ends the feed
   * rather than continuing from a guess that would repeat or skip rows.
   */
  const position = page.last?.position ?? null
  return {
    entries: page.rows,
    nextCursor: !page.exhausted && position ? encodeOrgWideCursor(position) : null,
    scanned: page.scanned,
  }
}
