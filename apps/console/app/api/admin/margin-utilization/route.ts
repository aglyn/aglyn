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
  orgCogsInputFrom,
  pluginRequestFromWeb,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import { orgMarginRow, type OrgMarginRow } from '@aglyn/aglyn/app-utils/margin-utilization'
import {
  ASSIST_PROVIDER_COST_FIELD,
  assistProviderCostUsd,
} from '@aglyn/aglyn/app-utils/assist-credits'
import type { ListQueryRefusal } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import {
  readStaffListQuery,
  runStaffListQuery,
} from '../../../../utils/server/staff-list-query'
import { ORG_MARGIN_QUERY } from '../../../../utils/org-list-query'

/**
 * REALISED BAND UTILIZATION, PER ORGANIZATION.
 *
 * `tier-margin-floor.spec.ts` proves what each tier costs at 3 / 25 / 50 /
 * 100% of its bands. Which column the business is actually in has never been
 * measured, and on Pro it is the difference between an 89.3% margin and a
 * 7.1% one. This route is the measurement: for each org, what the newest
 * rollup recorded, over the band that org's plan sells, priced by the shared
 * cost model.
 *
 * Read-only. Every access below is a `get()`; nothing here writes, and it adds
 * no rollup of its own — the monthly cron already records all seven meters and
 * `orgMonthlyCogsUsd` already prices them.
 *
 * ## Paged, and it says when there is more
 *
 * A staff dashboard that sweeps every organization on mount is a bill that
 * grows with the customer base, and the browser cannot even tell it was short.
 * So this serves ONE page ordered on the document id — `orderBy` on any field
 * would drop organizations that lack it, which on a list whose purpose is
 * finding one outlier is the worst available failure — and asks for one row
 * beyond the page as a truncation probe. `nextCursor` is a fact rather than an
 * estimate: it is non-null exactly when a further organization exists.
 *
 * The caller folds pages into the fleet distribution and states how many
 * organizations it covers. A median over a partial fleet is still useful; a
 * median over a partial fleet presented as the whole one is not.
 *
 * ## Which organizations: on the query, never over the rows (AGL-3321)
 *
 * The per-organization table's Filters panel and search choose WHICH
 * organizations the walk reads — Organization and Stored plan, the two
 * columns stored on the org document, and the name search — and they are
 * planned onto this query (`ORG_MARGIN_QUERY`) through the staff list wire
 * (`utils/server/staff-list-query.ts`). What one query cannot hold comes back
 * in `refused` and is not applied. Every figure the page folds is then over
 * the organizations that match. Month, revenue, margin and the bands are
 * computed from each organization's rollup AFTER the read, so no query can
 * narrow by them and none is offered.
 *
 * ## The read cost, stated rather than implied
 *
 * Four reads per organization, in three round trips plus one query each:
 * the org document, its billing mirror, its newest usage rollup, and the
 * Assist spend for that rollup's month. `reads` in the response reports the
 * figure this request actually incurred, so the cost of the page is visible on
 * the page.
 */

/** Organizations per request. Small: this is four reads per row, not one. */
const PAGE_SIZE = 25

/** Clamped, because a page nobody reads is still a page somebody pays for. */
const MAX_PAGE_SIZE = 100

export interface MarginUtilizationResponse {
  rows: OrgMarginRow[]
  /**
   * The document path to resume from, or null when this page reached the end
   * of the organizations that match. Non-null means the fold above it is
   * INCOMPLETE.
   */
  nextCursor: string | null
  /** What the query could not hold, and why; none of it was applied. */
  refused: ListQueryRefusal[]
  /** What the query said about what it did serve. */
  notices: string[]
  /** Organizations in this page. */
  scanned: number
  /** Firestore document reads this request billed. */
  reads: number
}

async function handler(request: Request): Promise<Response> {
  const {
    method,
    query,
    headers: rawHeaders,
  } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  // Verified in its own try so a rejected credential is a 401 and a Firestore
  // failure below keeps its 500 — the two have different remedies.
  let decoded: Record<string, unknown>
  try {
    decoded = (await firebaseAdmin
      .app()
      .auth()
      .verifyIdToken(idToken)) as unknown as Record<string, unknown>
  } catch (error) {
    // A refused credential is a 401 (AGL-1993). A check that could not run is
    // ours, so it is a 500 like the Firestore failure below.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/margin-utilization] token verification failed', error)
    return Response.json({ error: 'Could not check your sign-in' }, { status: 500 })
  }

  try {
    if (!decoded['email_verified'] && !isImpersonationSession(decoded as never)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }

    const db = firebaseAdmin.app().firestore()
    const listRequest = readStaffListQuery(query, {
      defaultPageSize: PAGE_SIZE,
      maxPageSize: MAX_PAGE_SIZE,
    })
    if (!listRequest) {
      return Response.json({ error: 'Unreadable filters' }, { status: 400 })
    }

    /*
     * One page of the organizations that match, in document-id order, and one
     * row past it: the probe that turns "there may be more" into a fact for
     * the price of a single read. The cursor is the full path of the last
     * organization read, resolved to a snapshot — an organization deleted
     * between two pages restarts the walk rather than ending it.
     */
    const page = await runStaffListQuery({
      firestore: db,
      collection: db.collection('orgs'),
      declaration: ORG_MARGIN_QUERY,
      request: listRequest,
      row: (doc) => doc,
    })
    const pageDocs = page.rows
    let reads = pageDocs.length + (page.hasMore ? 1 : 0) + (listRequest.cursor ? 1 : 0)

    if (!pageDocs.length) {
      return Response.json(
        {
          rows: [],
          nextCursor: null,
          scanned: 0,
          reads,
          refused: page.refused,
          notices: page.notices,
        } satisfies MarginUtilizationResponse,
        { status: 200 },
      )
    }

    // The billing mirror, one batched round trip for the page rather than a
    // get per row. `subscription` moved to `orgs/{id}/billing/stripe`, and the
    // org doc's inline copy is the fallback for anything the backfill missed.
    const billingSnaps = await db.getAll(
      ...pageDocs.map((doc) =>
        doc.ref.collection(ORG_BILLING_SUBCOLLECTION).doc(ORG_BILLING_DOC_ID),
      ),
    )
    reads += billingSnaps.length

    /*
     * The newest usage rollup per organization.
     *
     * `orderBy('month', 'desc').limit(1)` — the same read `latestMeasuredCogsUsd`
     * and `/api/admin/org-usage` make, so this surface and the discount
     * guardrail are looking at the same document. It cannot be batched into a
     * `getAll` because the newest month's ID is not known until it is read;
     * the CURRENT month is the wrong guess, since the cron writes the CLOSED
     * one and a direct read of `usage/{thisMonth}` misses for every org, every
     * day of the month.
     */
    const rollupSnaps = await Promise.all(
      pageDocs.map((doc) =>
        doc.ref
          .collection('usage')
          .orderBy('month', 'desc')
          .limit(1)
          .get()
          .catch(() => null),
      ),
    )
    reads += rollupSnaps.reduce((sum, snap) => sum + (snap?.docs.length ?? 0), 0)

    /*
     * Assist provider spend for the SAME month as each rollup.
     *
     * Live rather than the `assistCostUsd` frozen onto the rollup: the rollup
     * is a snapshot from when the cron ran and Assist keeps spending after it.
     * Pairing it with the CURRENT month instead would report two different
     * periods as one figure.
     *
     * It is the one cost line that can clear the $2/site floor on its own, so
     * a margin surface that could not see it would rate a token-heavy
     * organization exactly as it rates an idle one.
     */
    const assistTargets = pageDocs.map((doc, index) => {
      const rollupDoc = rollupSnaps[index]?.docs[0]
      if (!rollupDoc) return null
      const month = String(rollupDoc.get('month') ?? rollupDoc.id)
      return { month, ref: doc.ref.collection('assistUsage').doc(month) }
    })
    const assistRefs = assistTargets
      .map((target) => target?.ref)
      .filter((ref): ref is FirebaseFirestore.DocumentReference => Boolean(ref))
    const assistSnaps = assistRefs.length ? await db.getAll(...assistRefs) : []
    reads += assistSnaps.length
    // Our bill for the month, not what the organizations drew (AGL-3015):
    // this page rates margins, and a cost side carrying our own markup would
    // rate a token-heavy organization worse than it is.
    const assistByPath = new Map<string, number>()
    assistSnaps.forEach((snap) => {
      const cost = assistProviderCostUsd(
        snap.get('estCostUsd'),
        snap.get(ASSIST_PROVIDER_COST_FIELD),
      )
      if (cost > 0) assistByPath.set(snap.ref.path, cost)
    })

    const rows = pageDocs.map((doc, index) => {
      const orgData = doc.data()
      const billingSnap = billingSnaps[index]
      // Org doc FIRST so a stale inline `subscription` left from before the
      // billing-mirror backfill loses to the authoritative document.
      const org = {
        ...orgData,
        ...(billingSnap?.exists ? billingSnap.data() : {}),
      }
      const rollupDoc = rollupSnaps[index]?.docs[0]
      const target = assistTargets[index]
      const liveAssist = target ? assistByPath.get(target.ref.path) : undefined
      return orgMarginRow({
        orgId: doc.id,
        name: (orgData['name'] as string | undefined) ?? null,
        org: org as never,
        month: target?.month ?? null,
        rollup: rollupDoc
          ? {
              // ONE shared list of priced fields, so this projection cannot
              // starve the cost model the way a hand-listed one did.
              ...orgCogsInputFrom(rollupDoc.data()),
              // The two meters that are recorded and banded but carry no unit
              // cost. `orgCogsInputFrom` is the PRICED list and correctly
              // omits them; a utilization figure needs no rate, so they are
              // read here rather than left unreachable.
              workflowRuns: Number(rollupDoc.get('workflowRuns') ?? 0),
              actionRuns: Number(rollupDoc.get('actionRuns') ?? 0),
              ...(liveAssist === undefined ? {} : { assistCostUsd: liveAssist }),
            }
          : null,
      })
    })

    return Response.json(
      {
        rows,
        nextCursor: page.nextCursor,
        scanned: rows.length,
        reads,
        refused: page.refused,
        notices: page.notices,
      } satisfies MarginUtilizationResponse,
      { status: 200 },
    )
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/margin-utilization]', error)
    return Response.json({ error: 'Utilization scan failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
