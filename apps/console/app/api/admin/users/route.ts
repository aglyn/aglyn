/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  collapseCrossPoolUidRows,
  emailUnverifiedResponse,
  findUserByEmailAcrossPools,
  findUserByUidAcrossPools,
  firebaseAdmin,
  isImpersonationSession,
  listUsersAcrossPools,
  resolveUserRecordIdentities,
  scanUsersAcrossPools,
  type PooledUserRecord,
} from '@aglyn/tenant-data-admin'
import type { ResolvedAccountIdentity } from '@aglyn/shared-util-tools/account-identity'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import {
  type ListFilterRequest,
  listFilterDay,
  listFilterOperators,
  matchListFilter,
} from '@aglyn/shared-ui-jsx/const/list-filter'
import type { ListQueryRefusal } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { readStaffListQuery } from '../../../../utils/server/staff-list-query'
import { sortListRows } from '@aglyn/shared-util-tools/list-query/list-column-sort'
import {
  accountLastActiveAt,
  userListSort,
  USER_LIST_FILTER_FIELDS,
  USER_LIST_SORT_VALUES,
} from '../../../../utils/list-filters'

/**
 * How many accounts a filtered request may read. Past it the directory is
 * not read whole, and a match over part of it would answer "no such account"
 * for everyone past the bound — so the filters are REFUSED by name instead,
 * and the reader is pointed at the exact lookups, which have no bound.
 *
 * Firebase Auth cannot filter, so anything but an exact email or uid is
 * answered by reading accounts and matching them. Since the list opens newest
 * account first (AGL-3660) every read sorts, so every read — the mount too —
 * reads up to this bound: at most a few Auth pages, for a staff-only list.
 */
const FILTER_SCAN_CAP = 2000

/**
 * How many matches one response carries. More are paged, never dropped: the
 * next page is the same complete match, read again from the offset in its
 * cursor (`match:<offset>`).
 */
const FILTER_PAGE = 200

/** The cursor prefix of a page of matches, as against an Auth page token. */
const MATCH_CURSOR = 'match:'

/** Operators that carry no value. */
const VALUELESS = ['isEmpty', 'isNotEmpty']

/**
 * The clauses this list can answer, and the rest refused by name — a field
 * it does not declare, an operator that field does not offer, a value that
 * is not one yet. A refused clause is not applied at all; it is never read
 * as "matches everything" under a chip that says it narrowed the list.
 */
function readUserListClauses(clauses: readonly ListFilterRequest[]): {
  served: ListFilterRequest[]
  refused: ListQueryRefusal[]
} {
  const served: ListFilterRequest[] = []
  const refused: ListQueryRefusal[] = []
  for (const clause of clauses) {
    const field = USER_LIST_FILTER_FIELDS.find((entry) => entry.column === clause.field)
    if (!field) {
      refused.push({ clause, reason: 'this list does not filter by that' })
      continue
    }
    if (!listFilterOperators(field).includes(clause.op)) {
      refused.push({
        clause,
        reason: `${clause.op} is not something this list can ask of ${field.column}`,
      })
      continue
    }
    const raw = (clause.value ?? '').trim()
    if (field.kind === 'boolean' && raw !== 'true' && raw !== 'false') {
      refused.push({ clause, reason: 'pick true or false' })
      continue
    }
    if (!VALUELESS.includes(clause.op) && !raw) {
      refused.push({ clause, reason: 'no value yet' })
      continue
    }
    if (
      field.kind === 'date' &&
      !VALUELESS.includes(clause.op) &&
      Number.isNaN(listFilterDay(raw).getTime())
    ) {
      refused.push({ clause, reason: 'pick a date' })
      continue
    }
    served.push(clause)
  }
  return { served, refused }
}

/**
 * Staff user listing (AGL-204). Replaces the pre-AGL-42 handler that
 * listed every account WITHOUT a staff check — this one requires the
 * `staff` claim like the other admin APIs and returns trimmed records
 * only (no provider tokens, no raw claim payloads).
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    // Both paths go through the cross-pool helpers (AGL-1122). An SSO user
    // lives in their org's GCIP tenant pool, which project-level `listUsers`
    // and `getUserByEmail` do not see — so the owner of an enterprise org was
    // absent from this page AND unfindable by exact email, leaving staff no
    // way to reach the account at all. `tenantId` rides each row so the UI can
    // say which pool a user is in; it is also what a mutation needs, since
    // custom claims are per-pool.
    const serialize = (
      { record, tenantId, uidAlsoInPools }: PooledUserRecord,
      identity?: ResolvedAccountIdentity,
    ) => ({
      uid: record.uid,
      email: record.email ?? null,
      // The name and photo through the one account-identity resolver
      // (AGL-3721): the Auth record, then `users/{uid}`, then a provider
      // entry. An SSO account's Auth record holds neither — GCIP keeps the
      // SAML attributes on the token — so reading the record alone drew a
      // grey initial for the same person the account menu shows by name and
      // face. Without a resolved identity (a row not yet enriched) it is the
      // record's own fields, then a provider's photo, as before (AGL-3660).
      displayName: identity ? identity.displayName : (record.displayName ?? null),
      photoUrl: identity
        ? identity.photoUrl
        : (record.photoURL ??
          record.providerData.find((provider) => provider.photoURL)?.photoURL ??
          null),
      disabled: record.disabled,
      staff: Boolean(record.customClaims?.['staff']),
      staffRole: record.customClaims?.['staffRole'] ?? null,
      createdAt: record.metadata.creationTime ?? null,
      lastSignInAt: record.metadata.lastSignInTime ?? null,
      // Last activity: the later of that sign-in and the last session refresh.
      lastActiveAt: accountLastActiveAt(record.metadata),
      providers: record.providerData.map((provider) => provider.providerId),
      /** GCIP tenant id, or null for a project-pool (non-SSO) account. */
      tenantId,
      /**
       * Other pools holding this same uid (AGL-1962) — present only when
       * something minted a custom token across pools and Firebase created an
       * empty shadow account rather than refusing.
       *
       * Since AGL-2005 those rows are merged, so on a listed row this names
       * the pools that were folded INTO it. It is what stops the merge being
       * a cover-up: one row per human, and the row still says it was two.
       */
      uidAlsoInPools: uidAlsoInPools ?? null,
    })
    // Rows with their identity resolved: one `getAll` of `users/{uid}` for
    // just the rows whose Auth record leaves the name or photo blank.
    const withIdentity = async (pooled: PooledUserRecord[]) => {
      const identities = await resolveUserRecordIdentities(pooled)
      return pooled.map((entry) => serialize(entry, identities.get(entry.record.uid)))
    }
    // Exact-email lookup (AGL-270): listUsers can't search, this can.
    const email = typeof query.email === 'string' ? query.email : ''
    if (email) {
      const found = await findUserByEmailAcrossPools(email)
      return Response.json({
        users: found ? await withIdentity([found]) : [],
        nextPageToken: null,
      }, { status: 200 })
    }
    /*
     * THE FILTERS AND THE SEARCH, ANSWERED OVER THE WHOLE DIRECTORY (AGL-2501,
     * AGL-3321).
     *
     * Firebase Auth is the list's source, and it has no predicate to push a
     * filter into — no Firestore query serves this list, so it is the staff
     * console's exception to the list-query standard. What Auth does have is
     * two O(1) lookups, and an exact email or uid is routed to one of them
     * rather than to a walk. Everything else reads EVERY pool and matches in
     * memory, which is why this list can offer a mid-string `contains` and a
     * `doesNotContain` that a Firestore-backed list cannot.
     *
     * Every clause the Filters panel holds and the search apply together, as
     * one AND, over that complete read — never over a page of it. A clause
     * this list cannot answer is refused by name (`readUserListClauses`).
     * Past `FILTER_SCAN_CAP` the read would not be complete, so every clause
     * and the search are refused rather than answered from part of the
     * directory, and the list stays the unfiltered walk under the notice.
     * More matches than a page are paged (`match:<offset>`), never cut.
     */
    const listRequest = readStaffListQuery(query)
    if (!listRequest) {
      return Response.json({ error: 'Unreadable filters' }, { status: 400 })
    }
    const { served, refused } = readUserListClauses(listRequest.clauses)
    const search = listRequest.search.join(' ')
    const term = search.toLowerCase()
    const matches = (row: ReturnType<typeof serialize>) =>
      served.every((clause) => matchListFilter(row, USER_LIST_FILTER_FIELDS, clause)) &&
      (!term ||
        [row.email, row.displayName, row.uid]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(term))
    const token =
      typeof query.nextPageToken === 'string' ? query.nextPageToken : undefined
    /*
     * THE HEADER SORT (AGL-3680). Auth cannot order a walk, so a sort is
     * answered like a filter: over the complete directory read, then paged.
     * A sort the list does not offer is ignored, as a query ignores one.
     */
    // No sort asked is the default one, newest account first (AGL-3660):
    // the directory is sorted whole before it is paged, so page one is the
    // newest accounts there are, not the newest of Auth's first page.
    const asked = userListSort(listRequest.sort)
    const sortRows = <Row extends ReturnType<typeof serialize>>(rows: Row[]): Row[] =>
      sortListRows(rows, USER_LIST_SORT_VALUES[asked.path], asked.direction)
    const notices: string[] = []
    // Every read is answered over the complete directory when it fits the
    // bound — a sort always rides, the default one at least (AGL-3660).
    /*
     * An exact email or uid is a lookup, not a walk: the one account it can
     * be, and then every other clause and the search over that account. A
     * complete address typed in the search box takes the same lookup, and
     * falls through to the walk when it finds nobody — an address held only
     * where the lookup missed must still be searched for.
     */
    const exact = served.find(
      (clause) =>
        clause.op === 'equals' && (clause.field === 'email' || clause.field === 'uid'),
    )
    const address = !exact && /^[^@\s]+@[^@\s]+$/.test(search) ? search : ''
    const looked = exact
      ? exact.field === 'email'
        ? await findUserByEmailAcrossPools(exact.value.trim())
        : await findUserByUidAcrossPools(exact.value.trim())
      : address
        ? await findUserByEmailAcrossPools(address)
        : null
    if (exact || looked) {
      const rows = looked ? await withIdentity([looked]) : []
      return Response.json({
        users: exact ? rows.filter(matches) : rows.filter((row) =>
          served.every((clause) => matchListFilter(row, USER_LIST_FILTER_FIELDS, clause)),
        ),
        nextPageToken: null,
        refused,
        notices: [],
      }, { status: 200 })
    }
    const scan = await scanUsersAcrossPools(FILTER_SCAN_CAP)
    if (!scan.truncated && !scan.tenantTruncated.length) {
      const collapsed = collapseCrossPoolUidRows(scan.users)
      // A search or a display-name clause matches on the NAME, so every row
      // needs its resolved one first — an SSO account's name lives only in
      // `users/{uid}`. Otherwise only the page returned is resolved, so an
      // unfiltered mount reads at most one page of profiles.
      const matchesOnName =
        Boolean(term) || served.some((clause) => clause.field === 'displayName')
      const rows = matchesOnName
        ? await withIdentity(collapsed)
        : collapsed.map((entry) => serialize(entry))
      const matched = sortRows(rows.filter(matches))
      const offset = token?.startsWith(MATCH_CURSOR)
        ? Math.max(0, Math.floor(Number(token.slice(MATCH_CURSOR.length))) || 0)
        : 0
      const next = offset + FILTER_PAGE
      const pageRows = matched.slice(offset, next)
      let users = pageRows
      if (!matchesOnName) {
        const byUid = new Map(collapsed.map((entry) => [entry.record.uid, entry]))
        users = await withIdentity(
          pageRows
            .map((row) => byUid.get(row.uid))
            .filter((entry): entry is PooledUserRecord => Boolean(entry)),
        )
      }
      return Response.json({
        users,
        nextPageToken: next < matched.length ? `${MATCH_CURSOR}${next}` : null,
        tenantsIncluded: true,
        tenantTruncated: [],
        refused,
        notices,
      }, { status: 200 })
    }
    /*
     * The directory outran the bound, or an SSO pool did: a match over what
     * was read would answer "none" for accounts it never saw. Refused, by
     * name, and the list below is the unfiltered walk it says it is.
     */
    const reason = scan.truncated
      ? `the directory holds more than ${FILTER_SCAN_CAP.toLocaleString('en-US')} accounts, ` +
        'more than this list can search at once — find an account by its exact email or uid'
      : `SSO ${scan.tenantTruncated.length === 1 ? 'tenant' : 'tenants'} ` +
        `${scan.tenantTruncated.join(', ')} ${scan.tenantTruncated.length === 1 ? 'holds' : 'hold'} ` +
        'more accounts than this list can search at once — find an account by its exact email or uid'
    refused.push(
      ...served.map((clause) => ({ clause, reason })),
      ...(term ? [{ clause: 'search' as const, reason }] : []),
    )
    // The sort cannot reach the whole directory either: it orders the page
    // walked below, and says so rather than reading as everyone's order.
    notices.push(
      `Sorted by ${asked.label ?? asked.path} within each page of the directory: it holds more ` +
        `than ${FILTER_SCAN_CAP.toLocaleString('en-US')} accounts, more than this list can sort at once.`,
    )
    // A match cursor does not name a place in the walk; it starts it over.
    const pageToken = token?.startsWith(MATCH_CURSOR) ? undefined : token
    const page = await listUsersAcrossPools(200, pageToken)
    // One row per human (AGL-2005). `listUsersAcrossPools` stays the honest
    // primitive and returns every auth record; the collapse happens here, at
    // share an email are two people and stay two rows — and the survivor is
    // the identified record, never the emailless twin.
    const rows = collapseCrossPoolUidRows(page.users)
    return Response.json({
      users: sortRows(await withIdentity(rows)),
      nextPageToken: page.nextPageToken,
      tenantsIncluded: page.tenantsIncluded,
      // Never silently truncate: a tenant whose pool outgrew the cap is named
      // so the page can say so rather than quietly dropping the tail.
      tenantTruncated: page.tenantTruncated,
      refused,
      notices,
    }, { status: 200 })
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Listing failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
