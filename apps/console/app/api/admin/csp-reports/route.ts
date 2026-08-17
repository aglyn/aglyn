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
 *   `app`       optional `console` | `tenant` filter;
 *   `directive` optional exact directive filter (e.g. `img-src`).
 *
 * The Firestore query is a single-field range on `day` — served by the
 * automatic index, no composite needed (the `/api/health/rate-limits`
 * pattern) — and the app/directive filters run in memory: the collection is
 * counter documents with a capped mint rate, so the read is bounded by
 * construction, and `READ_LIMIT` is a backstop rather than the bound.
 */

import {
  CSP_AGGREGATE_COLLECTION,
  CSP_AGGREGATE_RETENTION_DAYS,
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'

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
    const appFilter = url.searchParams.get('app')
    const directiveFilter = url.searchParams.get('directive')

    const now = Date.now()
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection(CSP_AGGREGATE_COLLECTION)
      .where('day', '>=', cutoffDay(now, days))
      .orderBy('day', 'desc')
      .limit(READ_LIMIT)
      .get()

    const rows = snapshot.docs
      .map((doc: { data: () => Record<string, unknown> }) => doc.data())
      .filter(
        (row: Record<string, unknown>) =>
          (!appFilter || row['app'] === appFilter) &&
          (!directiveFilter || row['directive'] === directiveFilter),
      )
      // Highest counts first within the whole window: the read is "what would
      // this flip break", and the answer starts at the top.
      .sort(
        (a: Record<string, unknown>, b: Record<string, unknown>) =>
          Number(b['count'] ?? 0) - Number(a['count'] ?? 0),
      )

    return Response.json(
      {
        windowDays: days,
        since: cutoffDay(now, days),
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
    console.error(error)
    return Response.json({ error: 'CSP report read failed' }, { status: 500 })
  }
}

export { handler as GET }
