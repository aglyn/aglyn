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
  ORG_BILLING_DOC_ID,
  ORG_BILLING_SUBCOLLECTION,
  pluginRequestFromWeb,
} from '@aglyn/aglyn/server'
import {
  assistUsageDay,
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  readPlatformFreeSpend,
} from '@aglyn/tenant-data-admin'
import { assistCreditsFromUsd } from '@aglyn/aglyn/app-utils/assist-credits'
import {
  hasAiAddon,
  resolveEffectivePlan,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import { assistRefusalCounts } from '@aglyn/tenant-data-admin/server/assist-refusals'
import { assistUsageMonth } from '@aglyn/tenant-data-admin/server/assist-usage'
import { invalidIdTokenResponse } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import {
  assistSignalRow,
  mineAssistSignals,
  rankAssistSpend,
  type AssistSpendRow,
} from '../usage/assist-signal-mining'

/**
 * The Assist docs-gap and cost mining view (AGL-1860, AGL-2252), served at
 * `/api/ai/admin/signals` for the plugin's Assist signal staff page.
 * Staff-gated, read-only, and the only reader `assistSignals` has.
 *
 * ## Why a route and not a client query
 *
 * `assistSignals` is absent from `firebase-firestore.rules` deliberately: the
 * org block matches its subcollections BY NAME and carries no wildcard, so an
 * unlisted name is default-deny for every client. That is the property that
 * lets the collection hold cross-tenant analytics at all. Reading it therefore
 * goes through the Admin SDK behind the staff claim, exactly as every staff
 * route does.
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

/**
 * Month documents read in one pass for the spend leaderboard (AGL-2930).
 *
 * `assistUsage` holds one document per org per month, so this is orgs times
 * months — a fraction of the signal count, and the same PLUS-ONE truncation
 * probe the signals read uses. Read as a collection group with NO `where`
 * and NO `orderBy`, for the reason the module note gives: a filter on
 * `month` would need a COLLECTION_GROUP-scoped index deployed by hand, and
 * filtering the month in memory costs nothing at this size.
 */
const SPEND_SCAN_CEILING = 20000

export interface AssistSpendLeaderboard {
  month: string
  rows: AssistSpendRow[]
  /** How many workspaces had a document for the month — the ranked count. */
  ranked: number
  /** True when the scan hit its ceiling, so the ranking is over a sample. */
  truncated: boolean
  /**
   * True when the month documents could not be read at all. Reported rather
   * than rendered as an empty table: "no workspace spent anything" and "the
   * read failed" are opposite findings, and the rest of the board — read
   * from a different collection — is still good.
   */
  failed: boolean
}

/**
 * The month's per-org spend, refusals and plan, dearest first.
 *
 * Plan and add-on come from the org and billing documents of the ranked
 * rows only — bounded by `limit`, never by the fleet — merged org-doc-first
 * exactly as every other staff reader merges them.
 */
async function readAssistSpendLeaderboard(
  firestore: FirebaseFirestore.Firestore,
  limit: number,
  month: string,
): Promise<AssistSpendLeaderboard> {
  try {
    return await rankAssistSpendForMonth(firestore, limit, month)
  } catch (error) {
    console.error('[ai/admin/signals] spend leaderboard read failed', error)
    return { month, rows: [], ranked: 0, truncated: false, failed: true }
  }
}

async function rankAssistSpendForMonth(
  firestore: FirebaseFirestore.Firestore,
  limit: number,
  month: string,
): Promise<AssistSpendLeaderboard> {
  const snapshot = await firestore
    .collectionGroup('assistUsage')
    .limit(SPEND_SCAN_CEILING + 1)
    .get()
  const truncated = snapshot.size > SPEND_SCAN_CEILING
  const docs = truncated ? snapshot.docs.slice(0, SPEND_SCAN_CEILING) : snapshot.docs
  const unranked: AssistSpendRow[] = []
  for (const doc of docs) {
    // The id IS the month; the field is the same value and is what an
    // older document may lack.
    if (doc.id !== month && doc.get('month') !== month) continue
    const orgId = doc.ref.parent.parent?.id
    if (!orgId) continue
    const cost = Number(doc.get('estCostUsd') ?? 0)
    const estCostUsd = Number.isFinite(cost) && cost > 0 ? cost : 0
    unranked.push({
      orgId,
      plan: 'free',
      aiAddon: false,
      credits: assistCreditsFromUsd(estCostUsd),
      estCostUsd,
      refusals: assistRefusalCounts(doc.get('refusals')),
    })
  }
  const { rows, ranked } = rankAssistSpend(unranked, limit)
  if (rows.length) {
    const orgRefs = rows.map((row) => firestore.collection('orgs').doc(row.orgId))
    const [orgSnaps, billingSnaps] = await Promise.all([
      firestore.getAll(...orgRefs),
      firestore.getAll(
        ...orgRefs.map((ref) =>
          ref.collection(ORG_BILLING_SUBCOLLECTION).doc(ORG_BILLING_DOC_ID),
        ),
      ),
    ])
    rows.forEach((row, index) => {
      const orgData = orgSnaps[index]?.exists ? (orgSnaps[index].data() ?? {}) : {}
      const org = {
        ...orgData,
        ...(billingSnaps[index]?.exists ? billingSnaps[index].data() : {}),
      }
      row.plan = resolveEffectivePlan(org as never)
      row.aiAddon = hasAiAddon(org as never)
      const label = (orgData['name'] ?? orgData['slug'] ?? '') as string
      row.orgLabel = label || null
    })
  }
  return { month, rows, ranked, truncated, failed: false }
}

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

    // This month's spend, per workspace (AGL-2930) — the board's only
    // month-scoped panel, read off the month documents rather than mined
    // from the all-time signals above.
    const spend = await readAssistSpendLeaderboard(
      firebaseAdmin.app().firestore(),
      limit,
      assistUsageMonth(),
    )

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

    /*==========================================
     * THE WORKSPACE, BY NAME.
     *
     * A staff reader recognizes a customer by name, never by document id,
     * and the cost board's own column header says "Workspace" over a column
     * of generated ids. `/api/admin/overview` fixed the same shape by
     * building a label map from a snapshot it already held; there is no such
     * snapshot here — this route reads `assistSignals` and nothing else — so
     * the labels are fetched, with the same `name` → `slug` → id precedence
     * so one workspace cannot appear under two different labels on two
     * screens.
     *
     * Bounded by what is actually RENDERED, not by the fleet. Both lists the
     * ids come from are already sliced to `limit` (25 by default, 100 at the
     * ceiling), so this is one `getAll` over at most a couple of hundred
     * documents — and it reads the orgs the reader can see rather than
     * scanning a collection to name a handful of rows.
     *
     * An org that has been deleted keeps its id rather than going blank: an
     * unfamiliar id is still a lead a staff member can paste into the org
     * search, and an empty cell is not.
     *=========================================*/
    const orgIds = [
      ...new Set(
        [
          ...report.orgs.map((row) => row.orgId),
          ...report.proseCandidates.map((row) => row.orgId),
        ].filter((orgId) => orgId && orgId !== '(unknown)'),
      ),
    ]
    const orgLabelById = new Map<string, string>()
    if (orgIds.length) {
      const orgDocs = await firestore.getAll(
        ...orgIds.map((orgId) => firestore.collection('orgs').doc(orgId)),
      )
      for (const doc of orgDocs) {
        if (!doc.exists) continue
        const data = doc.data() ?? {}
        const label = (data['name'] ?? data['slug'] ?? '') as string
        if (label) orgLabelById.set(doc.id, label)
      }
    }
    const orgLabel = (orgId: string): string =>
      orgLabelById.get(orgId) ?? orgId

    // Today's free-tier spend against the platform ceiling (AGL-2925): one
    // document read, and the only place staff can see the taste switching
    // itself off before the email arrives. Best-effort — a readout that
    // cannot be read must not take the rest of the board down with it.
    const freeSpend = await readPlatformFreeSpend(
      firestore,
      assistUsageDay(),
    ).catch((error) => {
      console.error('[ai/admin/signals] free spend readout failed', error)
      return undefined
    })

    return Response.json(
      {
        ...report,
        freeSpend,
        orgs: report.orgs.map((row) => ({
          ...row,
          orgLabel: orgLabel(row.orgId),
        })),
        prose: prose.map((row) => ({ ...row, orgLabel: orgLabel(row.orgId) })),
        spend,
        ceiling: SCAN_CEILING,
      },
      { status: 200 },
    )
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[ai/admin/signals]', error)
    return Response.json({ error: 'Assist signal lookup failed' }, { status: 500 })
  }
}

export { handler as GET }
