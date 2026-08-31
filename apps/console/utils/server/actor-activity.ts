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
  /** The `nextCursor` of the previous page — a document path. */
  cursor?: string | null
  /**
   * Parent paths this reader may see (`hosts/x`, `orgs/y`). Absent means
   * every scope, which is the staff view; present and EMPTY means none, which
   * is a real answer and not an oversight.
   */
  scopePaths?: ReadonlySet<string>
}

export async function readActorActivity(
  options: ReadActorActivityOptions,
): Promise<ActorActivityPage> {
  const { actorId, cursor, scopePaths } = options
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
  const base = (
    applyListFilter(unfiltered, ACTIVITY_LIST_FILTER_FIELDS, options.filter ?? null, {
      fixedOrderBy: 'createdAt',
    }) ?? unfiltered
  ).orderBy('createdAt', 'desc')

  // The cursor is a document PATH, not a timestamp. Two entries can share a
  // second — a save and its revalidation, a bulk role change — and starting
  // after a timestamp would either repeat them on the next page or skip them.
  let after = cursor
    ? await firestore.doc(cursor).get().catch(() => null)
    : null
  if (after && !after.exists) after = null

  const entries: ActorActivityEntry[] = []
  let scanned = 0
  let exhausted = false

  while (entries.length < pageSize && scanned < SCAN_CAP && !exhausted) {
    // One extra so a full batch can be told from the last batch without a
    // second query.
    const batchSize = Math.min(pageSize + 1, ACTOR_ACTIVITY_MAX_PAGE)
    const query = after
      ? base.startAfter(after).limit(batchSize)
      : base.limit(batchSize)
    const snapshot = await query.get()
    if (snapshot.empty) {
      exhausted = true
      break
    }
    if (snapshot.docs.length < batchSize) exhausted = true
    for (const doc of snapshot.docs) {
      // Stop BEFORE consuming a document the page has no room for. `after`
      // is the resume point, so advancing past a row that was never shown
      // would drop it from every page — the quiet half of an off-by-one in
      // an audit log, where the missing entry is the one nobody looks for.
      if (entries.length >= pageSize) break
      scanned += 1
      after = doc
      const scopePath = doc.ref.parent.parent?.path ?? ''
      if (scopePaths && !scopePaths.has(scopePath)) continue
      const data = doc.data() as Record<string, unknown>
      const seconds = timestampSeconds(data['createdAt'])
      entries.push({
        $id: doc.id,
        scopePath,
        ...describeScope(scopePath),
        action: typeof data['action'] === 'string' ? data['action'] : undefined,
        target: (data['target'] as Record<string, unknown> | null) ?? null,
        actorEmail:
          typeof data['actorEmail'] === 'string' ? data['actorEmail'] : null,
        createdAt: seconds === null ? null : { seconds },
      })
    }
  }

  /*
   * More to come unless the query genuinely ran out. A page cut short by the
   * scan cap counts as more — the reader clicks Next and the walk continues
   * from the last document READ, not the last one shown, so the filtered-out
   * rows in between are never re-walked.
   */
  const nextCursor = exhausted ? null : (after?.ref.path ?? null)
  return { entries, nextCursor, scanned }
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
}

export async function readOrgWideActivity(options: {
  orgId: string
  limit: number
  cursor?: string | null
  /** Narrows every subject's query, not the merged page. See below. */
  filter?: ListFilterInput | null
}): Promise<OrgWideActivityPage> {
  const firestore = firebaseAdmin.app().firestore()
  const limit = Math.min(
    Math.max(1, Math.floor(options.limit) || 25),
    ACTOR_ACTIVITY_MAX_PAGE,
  )
  const cursor = decodeOrgWideCursor(options.cursor)
  const paths = await orgActivityScopePaths(options.orgId)
  const perSubject = await Promise.all(
    [...paths].map(async (path) => {
      const [collection, id] = path.split('/')
      if (!collection || !id) return []
      // `limit + 1` from EACH, because the newest `limit` overall could all
      // have come from one site — taking fewer per subject to save reads
      // would silently cap how much of a busy site can appear. The extra row
      // is what tells a full subject from an exhausted one.
      //
      // `select` because the merge reads four fields and a version of an
      // activity document can carry considerably more. It does not change
      // what Firestore bills — that is per document — only what crosses the
      // wire.
      const subject = firestore
        .collection(collection)
        .doc(id)
        .collection('activity')
      /*
       * The filter is applied to EACH subject before the merge, never to the
       * merged page. The merge takes the newest `limit` across subjects, so
       * narrowing afterwards would first discard the rows the filter wanted
       * and then report what survived — a filter that gets emptier the busier
       * the organization is.
       */
      let query = (
        applyListFilter(subject, ACTIVITY_LIST_FILTER_FIELDS, options.filter ?? null, {
          fixedOrderBy: 'createdAt',
        }) ?? subject
      )
        .orderBy('createdAt', 'desc')
        .select('action', 'target', 'actorEmail', 'createdAt')
      if (cursor) {
        query = query.where(
          'createdAt',
          '<=',
          firebaseAdmin.firestore.Timestamp.fromMillis(cursor.seconds * 1000),
        )
      }
      const snapshot = await query
        .limit(limit + 1)
        .get()
        .catch(() => null)
      return (snapshot?.docs ?? []).map((doc) => {
        const data = doc.data() as Record<string, unknown>
        const seconds = timestampSeconds(data['createdAt'])
        return {
          $id: doc.id,
          scopePath: path,
          ...describeScope(path),
          action:
            typeof data['action'] === 'string' ? data['action'] : undefined,
          target: (data['target'] as Record<string, unknown> | null) ?? null,
          actorEmail:
            typeof data['actorEmail'] === 'string' ? data['actorEmail'] : null,
          createdAt: seconds === null ? null : { seconds },
        } satisfies ActorActivityEntry
      })
    }),
  )

  const alreadyShown = new Set(cursor?.ids ?? [])
  const merged = perSubject
    .flat()
    .filter((entry) => !alreadyShown.has(entry.$id))
    // An entry with no timestamp sorts last rather than first: an unreadable
    // date is not a reason to lead the feed with it.
    .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))

  const entries = merged.slice(0, limit)
  const last = entries[entries.length - 1]
  const lastSeconds = last?.createdAt?.seconds ?? null
  /*
   * More to come only when this page was FULL and the boundary second is
   * readable. A short page means every subject ran out; a final row with no
   * timestamp cannot be a cursor, and continuing from a guess would repeat or
   * skip rows rather than admit the feed ended.
   */
  const hasMore = merged.length > limit && lastSeconds !== null
  return {
    entries,
    nextCursor: hasMore
      ? encodeOrgWideCursor({
          seconds: lastSeconds,
          // Everything shown at the boundary second, including what an
          // earlier page showed there — otherwise a second spanning three
          // pages would serve its first page's rows again on the third.
          ids: [
            ...(cursor?.seconds === lastSeconds ? (cursor?.ids ?? []) : []),
            ...entries
              .filter((entry) => entry.createdAt?.seconds === lastSeconds)
              .map((entry) => entry.$id),
          ],
        })
      : null,
  }
}
