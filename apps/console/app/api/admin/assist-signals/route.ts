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

/**
 * How much of an answer the prose panel shows.
 *
 * Enough to judge whether the answer was wrong, short enough that twenty-five
 * of them are still a page somebody reads.
 */
const ANSWER_PREVIEW_CHARS = 600

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
      assistSignalRow(
        doc.ref.parent.parent?.id ?? '(unknown)',
        // The signal id IS the exchange id (AGL-2314) — one id, two halves,
        // minted together by `recordAssistExchange` precisely so the join is
        // possible. Until now nothing carried it this far.
        doc.id,
        doc.data(),
      ),
    )

    const report = mineAssistSignals(rows, { truncated, limit })

    /*==========================================
     * THE VERBATIM HALF (AGL-2314).
     *
     * `assistExchanges` stores the question a customer typed and the answer
     * we gave, for 180 days, and `assist-usage.ts` calls it "the data loop's
     * corpus". NOTHING read it — one write, no reader, no collection group.
     * So we retained customers' words, and committed publicly in the privacy
     * policy to retaining them, for zero product value.
     *
     * Read here rather than in the miner because the miner is pure: it does
     * the arithmetic, the route does the reading.
     *
     * ## Only the turns that FAILED
     *
     * The shortlist is thumbs-down and ungrounded turns only, capped by the
     * same `limit` as every other panel. That is a privacy decision as much
     * as a cost one: the counts already answer "how often", and the words are
     * fetched only where the counts CANNOT say what went wrong. Pulling every
     * exchange would be surveillance with a dashboard on it.
     *
     * `uid` is deliberately not projected. The corpus question is what people
     * asked, never who asked it — and the exchange is the only document that
     * still carries an identifier at all.
     *
     * ## An expired exchange is an ANSWER
     *
     * The 180-day TTL means a signal can outlive its prose, and it is meant
     * to. A missing document therefore reports `expired: true` rather than
     * being dropped: a shortlist silently shorter than the failure count it
     * came from would read as "these are all the failures", which is the
     * AGL-2220 shape.
     *=========================================*/
    const firestore = firebaseAdmin.app().firestore()
    const exchanges = report.proseCandidates.length
      ? await firestore.getAll(
          ...report.proseCandidates.map((candidate) =>
            firestore
              .collection('orgs')
              .doc(candidate.orgId)
              .collection('assistExchanges')
              .doc(candidate.exchangeId),
          ),
        )
      : []
    const prose = report.proseCandidates.map((candidate, index) => {
      const snapshot = exchanges[index]
      const data = (snapshot?.exists ? snapshot.data() : null) ?? {}
      return {
        ...candidate,
        expired: !snapshot?.exists,
        question: typeof data['question'] === 'string' ? data['question'] : null,
        // Trimmed, not omitted: judging whether an answer was wrong needs to
        // see it, and a whole answer per row would make the panel unreadable.
        answer:
          typeof data['answer'] === 'string'
            ? data['answer'].slice(0, ANSWER_PREVIEW_CHARS)
            : null,
        answerTruncated:
          typeof data['answer'] === 'string' &&
          data['answer'].length > ANSWER_PREVIEW_CHARS,
      }
    })

    return Response.json(
      { ...report, prose, ceiling: SCAN_CEILING },
      { status: 200 },
    )
  } catch (error) {
    console.error('[admin/assist-signals]', error)
    return Response.json({ error: 'Assist signal lookup failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
