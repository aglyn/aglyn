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

/**
 * Staff read-back for the durable CSP-violation counters (AGL-1799).
 *
 * The collectors log to a runtime log that retains ~60 minutes; the counters
 * in `cspViolationDaily` are what actually accumulates. This route is the
 * reader — the thing that makes AGL-1702's "a week of signed-in traffic" and
 * AGL-1726's "a business week of visitor traffic" checkable sentences: pull
 * fourteen days, look at which (directive, origin) rows exist and how their
 * counts moved, and the flip decision is a table read rather than a log
 * watch.
 *
 * Staff-claim gated, same trust anchor as the Firestore rules and the same
 * shape as `/api/admin/email-health`. Deliberately NOT one of the public
 * `/api/health/*` endpoints: rows carry customer site hostnames (`lastSite`)
 * and page paths, which are nobody else's business.
 *
 * Query params:
 *   `days`      window ending today (UTC), default 7, clamped 1..60 —
 *               the aggregate retention;
 *   `view`      absent: the WINDOW, every counter in it, highest counts
 *               first — the rollup the page's directive chips and totals are
 *               computed from. `rows`: the table, one page of it, on the
 *               staff list wire (`readStaffListQuery`) — every Filters clause
 *               and the search on the Firestore query beneath the window
 *               (`utils/csp-report-list-query.ts`), paged by cursor.
 *
 * The window read is a single-field range on `day` — served by the
 * automatic index, no composite needed (the `/api/health/rate-limits`
 * pattern). The collection is counter documents with a capped mint rate, so
 * the read is bounded by construction, and `READ_LIMIT` is a backstop
 * rather than the bound. Nothing is filtered after either read.
 */

import {
  CSP_AGGREGATE_COLLECTION,
  CSP_AGGREGATE_RETENTION_DAYS,
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import {
  CSP_LIST_QUERY,
  CSP_SORT_COLUMNS,
  type CspListRow,
  cspWindowBase,
  isCspQuerySort,
} from '../../../../utils/csp-report-list-query'
// From the leaf, as `staff-list-query.ts` does.
import { applyListQuery } from '@aglyn/tenant-data-admin/server/list-query'
import { answerStaffCompleteList } from '../../../../utils/server/staff-complete-list'
import {
  planStaffListQuery,
  readStaffListQuery,
  runStaffListQuery,
} from '../../../../utils/server/staff-list-query'

export const dynamic = 'force-dynamic'

/**
 * Documents read per request, worst case. The mint caps bound real growth to
 * well under this; hitting it is itself a finding (reported as `truncated`).
 */
const READ_LIMIT = 2_000

const DEFAULT_WINDOW_DAYS = 7

/** UTC day string `days - 1` days before `now`, so `days=1` means today. */
function cutoffDay(nowMs: number, days: number): string {
  return new Date(nowMs - (days - 1) * 86_400_000).toISOString().slice(0, 10)
}

/**
 * A counter as the page reads it. Named fields rather than the document:
 * the search tokens and the TTL stamp are the query's and the database's,
 * not the reader's.
 */
function cspRow(doc: { id: string; data: () => Record<string, unknown> }) {
  const data = doc.data()
  return {
    id: doc.id,
    day: data['day'],
    app: data['app'],
    directive: data['directive'],
    disposition: data['disposition'],
    origin: data['origin'],
    count: data['count'],
    lastSeenMs: data['lastSeenMs'],
    lastPath: data['lastPath'],
    lastSite: data['lastSite'],
  }
}

async function handler(request: Request): Promise<Response> {
  const authorization = request.headers.get('authorization') ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }

    const url = new URL(request.url)
    const parsedDays = Number.parseInt(url.searchParams.get('days') ?? '', 10)
    const days = Number.isFinite(parsedDays)
      ? Math.min(Math.max(parsedDays, 1), CSP_AGGREGATE_RETENTION_DAYS)
      : DEFAULT_WINDOW_DAYS
    const now = Date.now()
    const since = cutoffDay(now, days)
    const firestore = firebaseAdmin.app().firestore()

    if (url.searchParams.get('view') === 'rows') {
      const listRequest = readStaffListQuery(Object.fromEntries(url.searchParams))
      if (!listRequest) {
        return Response.json({ error: 'Unreadable filters' }, { status: 400 })
      }
      const base = cspWindowBase(since)
      const collection = firestore.collection(CSP_AGGREGATE_COLLECTION)
      /*
       * A HEADER SORT OTHER THAN DAY NEWEST FIRST (AGL-3680, strategy 4s):
       * every counter the window and the clauses select, read whole up to
       * the backstop, sorted here and paged — never a page sorted on its own.
       * Past the backstop the window is not read whole, so the order is not
       * applied and the list says so, in the query's own order.
       */
      const sortNotices: string[] = []
      const column = listRequest.sort ? CSP_SORT_COLUMNS[listRequest.sort.path] : undefined
      if (column && !isCspQuerySort(listRequest.sort)) {
        const plan = planStaffListQuery(CSP_LIST_QUERY, { ...listRequest, sort: null }, base)
        const read = await applyListQuery(collection, plan).limit(READ_LIMIT + 1).get()
        if (read.docs.length <= READ_LIMIT) {
          const page = answerStaffCompleteList<ReturnType<typeof cspRow> & CspListRow>({
            rows: read.docs.map(cspRow) as Array<ReturnType<typeof cspRow> & CspListRow>,
            // Every clause and the search are already on the read.
            fields: [],
            searchPaths: [],
            request: { ...listRequest, clauses: [], search: [] },
            cursorOf: (row) => row.id,
            sorts: CSP_SORT_COLUMNS,
          })
          return Response.json(
            {
              ...page,
              refused: plan.refused,
              notices: [...plan.notices, ...page.notices],
              windowDays: days,
              since,
            },
            { status: 200 },
          )
        }
        sortNotices.push(
          `Not sorted by ${column.label}: the window holds more than ${READ_LIMIT} ` +
            'counters, so it is shown newest day first — narrow the window or filter it.',
        )
      }
      const page = await runStaffListQuery({
        firestore,
        collection,
        declaration: CSP_LIST_QUERY,
        request: { ...listRequest, sort: null },
        base,
        row: cspRow,
      })
      return Response.json(
        { ...page, notices: [...page.notices, ...sortNotices], windowDays: days, since },
        { status: 200 },
      )
    }

    const snapshot = await firestore
      .collection(CSP_AGGREGATE_COLLECTION)
      .where('day', '>=', since)
      .orderBy('day', 'desc')
      .limit(READ_LIMIT)
      .get()

    const rows = snapshot.docs
      .map(cspRow)
      // Highest counts first within the whole window: the read is "what would
      // this flip break", and the answer starts at the top.
      .sort(
        (a, b) => Number(b.count ?? 0) - Number(a.count ?? 0),
      )

    return Response.json(
      {
        windowDays: days,
        since,
        generatedAtMs: now,
        rowCount: rows.length,
        /**
         * True when the raw read hit `READ_LIMIT` — the window may be
         * incomplete and older days are the ones missing.
         */
        truncated: snapshot.docs.length === READ_LIMIT,
        rows,
      },
      { status: 200 },
    )
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'CSP report read failed' }, { status: 500 })
  }
}

export { handler as GET }
