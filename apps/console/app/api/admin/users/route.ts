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
  scanUsersAcrossPools,
  type PooledUserRecord,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import { matchListFilter } from '@aglyn/shared-ui-jsx/const/list-filter'
import { readListFilter } from '../../../../utils/server/list-filter'
import { USER_LIST_FILTER_FIELDS } from '../../../../utils/list-filters'

/**
 * How many accounts a filtered request may read before it stops and says so.
 *
 * Firebase Auth cannot filter, so anything but an exact email or uid is
 * answered by reading accounts and matching them. That is an expensive read,
 * so it happens only when a request CARRIES a filter — never on a mount — and
 * it stops at a bound rather than walking a directory of unknown size.
 */
const FILTER_SCAN_CAP = 2000

/**
 * How many matches come back. A staff filter is used to FIND an account, not
 * to browse thousands, and an unbounded response is a page nobody can render.
 */
const FILTER_MATCH_CAP = 200

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
    const serialize = ({
      record,
      tenantId,
      uidAlsoInPools,
    }: PooledUserRecord) => ({
      uid: record.uid,
      email: record.email ?? null,
      displayName: record.displayName ?? null,
      disabled: record.disabled,
      staff: Boolean(record.customClaims?.['staff']),
      staffRole: record.customClaims?.['staffRole'] ?? null,
      createdAt: record.metadata.creationTime ?? null,
      lastSignInAt: record.metadata.lastSignInTime ?? null,
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
    // Exact-email lookup (AGL-270): listUsers can't search, this can.
    const email = typeof query.email === 'string' ? query.email : ''
    if (email) {
      const found = await findUserByEmailAcrossPools(email)
      return Response.json({
        users: found ? [serialize(found)] : [],
        nextPageToken: null,
      }, { status: 200 })
    }
    /*
     * The column filter, answered ACROSS THE POOLS (AGL-693).
     *
     * The staff list paged 200 accounts at a time and filtered the rows it
     * had — so it answered "no such account" for everyone past the current
     * page, on the list whose whole job is that nobody is missing.
     *
     * Firebase Auth has no predicate to push this into. What it does have is
     * three O(1) lookups, and an exact email or uid is routed to one of them
     * rather than to a walk. Everything else reads the pools and matches in
     * memory, which is why this list can offer a mid-string `contains` and a
     * `doesNotContain` that a Firestore-backed list cannot.
     */
    /*
     * The toolbar's quick search, answered across the POOLS.
     *
     * It matched email, display name or uid within the loaded page, which on
     * a 200-account page meant it stopped at 200 accounts. A complete email
     * is routed to the O(1) lookup first — that is the common case and it
     * needs no walk at all — and anything else falls through to the same
     * bounded scan a column filter uses.
     */
    const search =
      typeof query.search === 'string' ? query.search.trim() : ''
    if (search) {
      if (/^[^@\s]+@[^@\s]+$/.test(search)) {
        const found = await findUserByEmailAcrossPools(search)
        if (found) {
          return Response.json({
            users: [serialize(found)],
            nextPageToken: null,
          }, { status: 200 })
        }
      }
      const scan = await scanUsersAcrossPools(FILTER_SCAN_CAP)
      const term = search.toLowerCase()
      const matched = collapseCrossPoolUidRows(scan.users)
        .map(serialize)
        .filter((row) =>
          [row.email, row.displayName, row.uid]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(term),
        )
      return Response.json({
        users: matched.slice(0, FILTER_MATCH_CAP),
        nextPageToken: null,
        tenantsIncluded: true,
        tenantTruncated: scan.tenantTruncated,
        scanTruncated: scan.truncated,
        matchTruncated: matched.length > FILTER_MATCH_CAP,
        matchCount: matched.length,
      }, { status: 200 })
    }
    const filter = readListFilter(query)
    if (filter) {
      const exact = filter.op === 'equals' ? filter.value.trim() : ''
      if (exact && (filter.field === 'email' || filter.field === 'uid')) {
        const found =
          filter.field === 'email'
            ? await findUserByEmailAcrossPools(exact)
            : await findUserByUidAcrossPools(exact)
        return Response.json({
          users: found ? [serialize(found)] : [],
          nextPageToken: null,
        }, { status: 200 })
      }
      const scan = await scanUsersAcrossPools(FILTER_SCAN_CAP)
      const matched = collapseCrossPoolUidRows(scan.users)
        .map(serialize)
        .filter((row) => matchListFilter(row, USER_LIST_FILTER_FIELDS, filter))
      return Response.json({
        users: matched.slice(0, FILTER_MATCH_CAP),
        nextPageToken: null,
        tenantsIncluded: true,
        tenantTruncated: scan.tenantTruncated,
        /*
         * Never let a partial answer read as a complete one. `scanTruncated`
         * says the directory outran the cap; `matchTruncated` says the filter
         * matched more than one response can carry. A staff list that stopped
         * early and reported "no matches" is the failure this whole change is
         * about.
         */
        scanTruncated: scan.truncated,
        matchTruncated: matched.length > FILTER_MATCH_CAP,
        matchCount: matched.length,
      }, { status: 200 })
    }
    const pageToken =
      typeof query.nextPageToken === 'string'
        ? query.nextPageToken
        : undefined
    const page = await listUsersAcrossPools(200, pageToken)
    // One row per human (AGL-2005). `listUsersAcrossPools` stays the honest
    // primitive and returns every auth record; the collapse happens here, at
    // share an email are two people and stay two rows — and the survivor is
    // the identified record, never the emailless twin.
    const rows = collapseCrossPoolUidRows(page.users)
    return Response.json({
      users: rows.map(serialize),
      nextPageToken: page.nextPageToken,
      tenantsIncluded: page.tenantsIncluded,
      // Never silently truncate: a tenant whose pool outgrew the cap is named
      // so the page can say so rather than quietly dropping the tail.
      tenantTruncated: page.tenantTruncated,
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
