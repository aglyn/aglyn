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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import {
  assistSignalRow,
  mineAssistSignals,
} from '../../../../utils/assist-signal-mining'

/**
 * The Assist docs-gap and cost mining view (AGL-1860, AGL-2252). Staff-gated,
 * read-only, and the only reader `assistSignals` has.
 *
 * ## Why a route and not a client query
 *
 * `assistSignals` is absent from `firebase-firestore.rules` deliberately: the
 * org block matches its subcollections BY NAME and carries no wildcard, so an
 * unlisted name is default-deny for every client. That is the property that
 * lets the collection hold cross-tenant analytics at all. Reading it therefore
 * goes through the Admin SDK behind the staff claim, exactly as the rest of
 * `/api/admin/*` does.
 *
 * ## The collection group, and the index it does not need
 *
 * One `collectionGroup('assistSignals')` read gathers every org's signals in a
 * single query; the owning org is `ref.parent.parent.id`, since the document
 * carries no `orgId` field (it carries no identifiers at all — see AGL-1972).
 * The query has no `where` and no `orderBy`, so it needs no composite index,
 * and adding one later would mean declaring a `COLLECTION_GROUP`-scoped
 * override and deploying it by hand. `/api/admin/overview` reads org billing
 * the same way and for the same reason.
 *
 * ## Truncation is reported, never hidden
 *
 * The read is bounded — an unbounded fleet-wide get is how a staff page
 * becomes an outage — but a ranking cut short looks exactly like a complete
 * one, so the ceiling is fetched PLUS ONE and the extra row sets `truncated`.
 * AGL-2220 is the standing example of the alternative: a sweep that stopped at
 * 500 orgs and reported nothing about the rest, for as long as nobody counted.
 */

/**
 * Rows read in one pass. Each signal is a handful of scalars, so this is a
 * few megabytes at the ceiling — large enough to be worth ranking, small
 * enough that the honest answer to "is it all of them" is usually yes.
 */
const SCAN_CEILING = 20000

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

    const requested = Number(query.limit ?? 25)
    const limit =
      Number.isFinite(requested) && requested > 0
        ? Math.min(Math.floor(requested), 100)
        : 25

    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collectionGroup('assistSignals')
      // Ceiling PLUS ONE: the extra document is what makes truncation
      // detectable rather than assumed.
      .limit(SCAN_CEILING + 1)
      .get()

    const truncated = snapshot.size > SCAN_CEILING
    const docs = truncated ? snapshot.docs.slice(0, SCAN_CEILING) : snapshot.docs
    const rows = docs.map((doc) =>
      assistSignalRow(doc.ref.parent.parent?.id ?? '(unknown)', doc.data()),
    )

    return Response.json(
      { ...mineAssistSignals(rows, { truncated, limit }), ceiling: SCAN_CEILING },
      { status: 200 },
    )
  } catch (error) {
    console.error('[admin/assist-signals]', error)
    return Response.json({ error: 'Assist signal lookup failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
