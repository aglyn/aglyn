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
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import type { ListFilterRequest } from '@aglyn/shared-ui-jsx/const/list-filter'
import {
  type ListQueryDeclaration,
  type ListQueryFilter,
  type ListQueryPlan,
  type ListQueryRefusal,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { applyListQuery } from './list-filter'
import { ACTIVITY_LIST_QUERY, activityActorBase } from '../activity-list-query'

/**
 * One person's activity, wherever it happened — and one organization's,
 * across every site it owns.
 *
 * Activity is written per subject — `hosts/{hostId}/activity` and
 * `orgs/{orgId}/activity` — which answers "what happened to this site" and
 * cannot answer "what did this person do", the question both the staff user
 * page and the org member page are actually asking.
 *
 * EVERY CLAUSE AND THE SEARCH ARE ON THE QUERY (AGL-3321). Each reader here
 * plans its query from `../activity-list-query` with `planListQuery` and
 * pages the answer; nothing is matched over rows it read, and what the plan
 * could not put on the query comes back as `refused` for the page to say.
 *
 *  - `readActorActivity`: one account everywhere, for staff — a collection-
 *    group query on `actorId`, through the Admin SDK because a collection-
 *    group read is evaluated against a rule that matches the GROUP, and there
 *    is deliberately no such rule: "every activity document on the platform"
 *    is not a query any client should be able to run.
 *  - `readOrgWideActivity`: one organization, its sites included — the SAME
 *    plan on each of its subjects' queries, merged by date. With an `actorId`
 *    base it is one member's activity in that organization.
 *
 * ## Why the organization is a set of subjects, not a predicate
 *
 * No entry carries its organization, and none should while the site log is
 * written from the browser under a rule that validates no keys: a stamped
 * `orgId` would be a claim any site editor could make about any
 * organization. The subjects an entry lives UNDER cannot be forged that way,
 * so a member's activity in one organization is read as their equality on
 * each of its subjects — nothing from another organization is read, so
 * nothing is read and discarded. See `../activity-list-query`.
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
  /** The acting uid, `'api'` for a key, or null when no person acted. */
  actorId?: string | null
  actorEmail?: string | null
  /** The staff member behind an entry the workspace did not perform. */
  staffActorId?: string
  /** The API key that wrote the entry, when an integration did (AGL-2632). */
  apiKeyName?: string
  createdAt: { seconds: number } | null
}

/** What the plan could not put on the query, and what it says about what it did. */
export interface ActivityQueryAnswer {
  refused: ListQueryRefusal[]
  notices: string[]
}

export interface ActorActivityPage extends ActivityQueryAnswer {
  entries: ActorActivityEntry[]
  /** Opaque; hand it back to continue. `null` when there is no next page. */
  nextCursor: string | null
}

/** What a reader of the log asked: the panel's clauses and the search words. */
export interface ActivityListRequest {
  clauses?: readonly ListFilterRequest[]
  search?: readonly string[]
}

/** A declaration, a request and a base, as the one query they make. */
export function planActivityQuery(
  declaration: ListQueryDeclaration,
  request: ActivityListRequest,
  base: readonly ListQueryFilter[] = [],
): ListQueryPlan {
  return planListQuery(
    declaration,
    { clauses: request.clauses ?? [], search: request.search ?? [], base },
    nameSearchNormalizers,
  )
}

/** Pages larger than this are a query nobody reads and a bill somebody pays. */
export const ACTOR_ACTIVITY_MAX_PAGE = 100

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

export interface ReadActorActivityOptions extends ActivityListRequest {
  actorId: string
  pageSize: number
  /** The `nextCursor` of the previous page — a document path. */
  cursor?: string | null
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
    actorId: typeof data['actorId'] === 'string' ? data['actorId'] : null,
    actorEmail: typeof data['actorEmail'] === 'string' ? data['actorEmail'] : null,
    ...(typeof data['staffActorId'] === 'string'
      ? { staffActorId: data['staffActorId'] }
      : {}),
    ...(typeof data['apiKeyName'] === 'string' ? { apiKeyName: data['apiKeyName'] } : {}),
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

/**
 * One account's activity everywhere, newest first: `actorId ==` and every
 * served clause and the search on one collection-group query, paged by the
 * last document of the previous page.
 */
export async function readActorActivity(
  options: ReadActorActivityOptions,
): Promise<ActorActivityPage> {
  const { actorId, cursor } = options
  const pageSize = Math.min(
    Math.max(1, Math.floor(options.pageSize) || 25),
    ACTOR_ACTIVITY_MAX_PAGE,
  )
  if (!actorId) return { entries: [], nextCursor: null, refused: [], notices: [] }
  const firestore = firebaseAdmin.app().firestore()
  const plan = planActivityQuery(ACTIVITY_LIST_QUERY, options, activityActorBase(actorId))
  const ordered = applyListQuery(firestore.collectionGroup('activity'), plan)

  // The cursor is a document PATH, not a timestamp. Two entries can share a
  // second — a save and its revalidation, a bulk role change — and starting
  // after a timestamp would either repeat them on the next page or skip them.
  const after = await cursorDocument(firestore, cursor)
  // One extra row answers "is there another page" without a second query.
  const snapshot = await (after ? ordered.startAfter(after) : ordered)
    .limit(pageSize + 1)
    .get()
  const docs = snapshot.docs.slice(0, pageSize)
  return {
    entries: docs.map((doc) => flattenEntry(doc, doc.ref.parent.parent?.path ?? '')),
    nextCursor:
      snapshot.docs.length > pageSize ? (docs[docs.length - 1]?.ref.path ?? null) : null,
    refused: plan.refused,
    notices: plan.notices,
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
 * filter for "this org": the org is a document's grandparent, not a field
 * (see the top of this file for why it stays that way). A collection-group
 * query with no filter would order every activity document on the platform
 * by date and throw away all but this org's, which is the one shape that
 * gets more expensive as other customers get busier.
 *
 * So: one bounded query per subject, merged by date here. The cost is a
 * function of THIS org's site count, which is what it should be.
 *
 * Every subject's query carries the SAME plan — each clause, the search
 * word and the base — so a subject contributes only rows that match, and
 * the merge keeps the newest `limit` of those. Narrowing after the merge
 * would first discard the rows the filter wanted and then report what
 * survived: a filter that gets emptier the busier the organization is.
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

/** A page of the merge; its cursor is opaque, like any other. */
export type OrgWideActivityPage = ActorActivityPage

/** A merged entry, and the cursor that resumes the feed just after it. */
interface MergedEntry {
  entry: ActorActivityEntry
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

export interface ReadOrgWideActivityOptions extends ActivityListRequest {
  orgId: string
  limit: number
  cursor?: string | null
  /** The query every subject answers: `ACTIVITY_LIST_QUERY` unless named. */
  declaration?: ListQueryDeclaration
  /** Predicates every subject's query carries — one member's `actorId`. */
  base?: readonly ListQueryFilter[]
  /** The subjects to read — Where. Every one the organization has, when absent. */
  paths?: ReadonlySet<string>
}

export async function readOrgWideActivity(
  options: ReadOrgWideActivityOptions,
): Promise<OrgWideActivityPage> {
  const firestore = firebaseAdmin.app().firestore()
  const limit = Math.min(
    Math.max(1, Math.floor(options.limit) || 25),
    ACTOR_ACTIVITY_MAX_PAGE,
  )
  const start = decodeOrgWideCursor(options.cursor)
  const paths = options.paths ?? (await orgActivityScopePaths(options.orgId))
  const plan = planActivityQuery(
    options.declaration ?? ACTIVITY_LIST_QUERY,
    options,
    options.base ?? [],
  )
  const subjects = [...paths].flatMap((path) => {
    const [collection, id] = path.split('/')
    if (!collection || !id) return []
    // `select` because the merge reads these fields and a version of an
    // activity document can carry considerably more. It does not change
    // what Firestore bills — that is per document — only what crosses the
    // wire.
    return [
      {
        path,
        query: applyListQuery(
          firestore.collection(collection).doc(id).collection('activity'),
          plan,
        ).select(
          'action',
          'target',
          'actorId',
          'actorEmail',
          'staffActorId',
          'apiKeyName',
          'createdAt',
        ),
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
        // A subject that cannot be read fails the page rather than reading
        // as a subject where nothing happened (AGL-2486).
        const snapshot = await bounded.limit(count + (from?.ids.length ?? 0)).get()
        return snapshot.docs.map((doc) => flattenEntry(doc, path))
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

  // One extra so a full merge can be told from the last one: past `limit`,
  // a merged row proves the feed goes on.
  const merged = await readMerged(start, limit + 1)
  const shown = merged.slice(0, limit)
  /*
   * More to come unless the merge genuinely ran out. A position that cannot
   * be expressed — the last entry shown had no timestamp — ends the feed
   * rather than continuing from a guess that would repeat or skip rows.
   */
  const position = shown[shown.length - 1]?.position ?? null
  return {
    entries: shown.map(({ entry }) => entry),
    nextCursor: merged.length > limit && position ? encodeOrgWideCursor(position) : null,
    refused: plan.refused,
    notices: plan.notices,
  }
}

/** `getUsers` answers at most this many identifiers per call. */
const GET_USERS_BATCH = 100

/**
 * The page's entries with every actor a reader can narrow down (AGL-3369):
 *
 * - `actorEmailNow`: the address a uid holds now, for an entry that recorded
 *   a uid and no address — the billing webhook, before it carried the
 *   address stamped at the console act. The snapshot field is left alone,
 *   so a reader can tell an address recorded then from one looked up since.
 * - `staffActorEmail`: for a STAFF reader, the address of the staff member
 *   behind an entry the workspace did not perform. Everyone else gets the
 *   entry with `staffActorId` removed — which of us acted is not the
 *   customer's record.
 *
 * Never throws. An account that no longer exists, or an Auth read that
 * fails, leaves the entry as it was and the presenter names the uid.
 */
export async function withResolvedActors<T extends object>(
  entries: T[],
  options: { staff: boolean },
): Promise<Array<T & { actorEmailNow?: string; staffActorEmail?: string }>> {
  // Read defensively: the org feed's own branch hands over stored data.
  const unaddressedUid = (entry: T): string | null => {
    const { actorId, actorEmail } = entry as { actorId?: unknown; actorEmail?: unknown }
    if (typeof actorEmail === 'string' && actorEmail) return null
    const uid = typeof actorId === 'string' ? actorId.trim() : ''
    return uid && uid !== 'api' && !uid.startsWith('system:') ? uid : null
  }
  const staffUid = (entry: T): string | null => {
    const { staffActorId } = entry as { staffActorId?: unknown }
    return options.staff && typeof staffActorId === 'string' && staffActorId
      ? staffActorId
      : null
  }
  const emails = await resolveAccountEmails([
    ...entries.map(unaddressedUid),
    ...entries.map(staffUid),
  ])
  return entries.map((entry) => {
    const shown = { ...entry } as T & { staffActorId?: unknown }
    if (!options.staff) delete shown.staffActorId
    const now = emails.get(unaddressedUid(entry) ?? '')
    const staffEmail = emails.get(staffUid(entry) ?? '')
    return {
      ...shown,
      ...(now ? { actorEmailNow: now } : {}),
      ...(staffEmail ? { staffActorEmail: staffEmail } : {}),
    }
  })
}

/**
 * The current address of each account, by uid, from Admin Auth. Missing
 * accounts and a failed lookup are simply absent from the answer.
 */
export async function resolveAccountEmails(
  candidates: ReadonlyArray<string | null>,
): Promise<Map<string, string>> {
  const uids = [...new Set(candidates.filter((uid): uid is string => Boolean(uid)))]
  const emails = new Map<string, string>()
  if (!uids.length) return emails
  try {
    const auth = firebaseAdmin.app().auth()
    for (let start = 0; start < uids.length; start += GET_USERS_BATCH) {
      const batch = uids.slice(start, start + GET_USERS_BATCH)
      const { users } = await auth.getUsers(batch.map((uid) => ({ uid })))
      for (const user of users) if (user.email) emails.set(user.uid, user.email)
    }
  } catch (error) {
    console.error('activity actor lookup failed', error)
  }
  return emails
}
