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
  orgCogsInputFrom,
  orgMonthlyCogsUsd,
  pluginRequestFromWeb,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * "The rollup did not record this" and "the rollup recorded zero/false" are
 * different answers, and a projection that collapses them invents history
 * (AGL-2321). Used only for the `recorded` block, whose fields all postdate
 * rollups that are still inside the twelve-month window.
 */
const nullableFlag = (value: unknown): boolean | null =>
  value == null ? null : Boolean(value)

const nullableNumber = (value: unknown): number | null =>
  value == null ? null : Number(value)

/**
 * Per-organization usage drill-down (AGL-205/238): the last 12 monthly
 * rollups for one org with month-over-month deltas, powering the Usage
 * dialog on the staff Organizations page. Staff-gated, read-only.
 */
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
  if (!idToken)
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  const orgId = String(query.orgId ?? '')
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('orgs')
      .doc(orgId)
      .collection('usage')
      .orderBy('month', 'desc')
      .limit(12)
      .get()
    const months = snapshot.docs.map((doc) => ({
      month: String(doc.get('month') ?? doc.id),
      storageGb: Number(doc.get('storageGb') ?? 0),
      pageViews: Number(doc.get('pageViews') ?? 0),
      formSubmissions: Number(doc.get('formSubmissions') ?? 0),
      costUsd: Number(doc.get('costUsd') ?? 0),
      // The three meters this projection used to drop (AGL-1134). The
      // rollup records them and `orgMonthlyCogsUsd` prices them, so a client
      // pricing these rows without them got a SMALLER cost than the server
      // did for the same org — and a smaller cost is the direction that
      // approves a discount. Nothing errors when a projection starves a
      // model; it just quietly answers differently.
      dataStorageMb: Number(doc.get('dataStorageMb') ?? 0),
      apiRequests: Number(doc.get('apiRequests') ?? 0),
      contactsCount: Number(doc.get('contactsCount') ?? 0),
      // Aglyn Assist provider spend for the month (AGL-2280). Dollars, not a
      // meter, and the largest single cost line an org can run up — the same
      // projection argument as the three above: a field the model prices and
      // the projection drops makes the browser's cost SMALLER than the
      // server's, and smaller approves a discount.
      assistCostUsd: Number(doc.get('assistCostUsd') ?? 0),
      // THE RECORDED-NOT-PRICED HALF (AGL-2321). `report-usage` writes these
      // and argues, correctly, that inventing a per-email or per-run rate
      // would put a made-up number into `billedCents` on the same day the
      // meter first had data. That argument justifies not PRICING them. It
      // never justified nothing being able to READ them — and this projection
      // dropping them is AGL-1134's starved-model hazard recurring one layer
      // up: the history a rate would be derived from was unreachable from the
      // only surface anyone looks at it on.
      //
      // Grouped rather than flattened so the boundary stays legible: nothing
      // in `recorded` is an input to `orgMonthlyCogsUsd`, and a future field
      // that IS priced belongs beside `assistCostUsd` above, not here.
      //
      // A field the rollup never wrote reads as NULL, not as zero or false.
      // An org whose July rollup predates the meter did not send zero emails
      // and was not "not billed" for its library — nothing was recorded, and
      // a surface that cannot tell those apart is the same silence the
      // withheld/billed pairs below exist to end.
      recorded: {
        // Meters: counted, never charged.
        emailSends: Number(doc.get('emailSends') ?? 0),
        emailSendsOverage: Number(doc.get('emailSendsOverage') ?? 0),
        workflowRuns: Number(doc.get('workflowRuns') ?? 0),
        actionRuns: Number(doc.get('actionRuns') ?? 0),
        // Dollars the rollup computed but nothing could read back.
        billableCostUsd: Number(doc.get('billableCostUsd') ?? 0),
        apiOverageUsd: Number(doc.get('apiOverageUsd') ?? 0),
        // The withheld/billed PAIRS. Each `*WithheldUsd` is zero when the
        // release flag was on, so the dollar figure alone cannot distinguish
        // a withheld month from an in-band one — which is the defect the
        // writer's own comment names. The flag is what disambiguates it, so
        // the two travel together or neither is worth serving.
        formSubmissionsBilled: nullableFlag(doc.get('formSubmissionsBilled')),
        formSubmissionsOverageWithheldUsd: Number(
          doc.get('formSubmissionsOverageWithheldUsd') ?? 0,
        ),
        contactsOverageBilled: nullableFlag(doc.get('contactsOverageBilled')),
        contactsOverageUsd: Number(doc.get('contactsOverageUsd') ?? 0),
        contactsOverageWithheldUsd: Number(
          doc.get('contactsOverageWithheldUsd') ?? 0,
        ),
        // THE AUDIT FIELDS (AGL-2321 item 3). `orgLibraryBilled` and
        // `orgLibraryBilledFrom` were frozen onto the rollup precisely so a
        // later reader would not have to know what
        // `BILL_ORG_LIBRARY_STORAGE_FROM` held when the cron ran. That reader
        // is this one, and until now it did not exist — which is the actual
        // gap, not "a historical caller reads the live env var". Every
        // `process.env` read of that switch answers "what is it NOW" for a
        // current-month estimate, and would be WRONG to serve from a stored
        // past value. `usage-config` is correct as written.
        orgLibraryStorageGb: nullableNumber(doc.get('orgLibraryStorageGb')),
        orgLibraryBilled: nullableFlag(doc.get('orgLibraryBilled')),
        orgLibraryBilledFrom:
          doc.get('orgLibraryBilledFrom') == null
            ? null
            : String(doc.get('orgLibraryBilledFrom')),
        // `siteSizeTruncated` changes what `siteSizeMb` MEANS — a truncated
        // measurement is a lower bound, not a total — so serving the number
        // without the flag would be worse than serving neither.
        siteSizeMb: nullableNumber(doc.get('siteSizeMb')),
        siteSizeTruncated: nullableFlag(doc.get('siteSizeTruncated')),
      },
    }))
    /**
     * The newest rollup, priced by the shared cost model (AGL-1134) — the
     * same document and the same function `/api/admin/org-discount` uses to
     * decide whether to refuse a discount, so the staff org page's preview
     * and the route that applies it cannot answer differently.
     *
     * It has to be served rather than read from the browser. The page used
     * to read `orgs/{id}/usage/{CURRENT month}` directly, and the metering
     * cron writes `previousMonth()` — the CLOSED month. Checked against
     * production on 2026-08-12: every org's newest rollup was `2026-07` and
     * no org had a `2026-08` document, so that read missed for every org on
     * the platform, every day of the month.
     *
     * `measuredUsd` only — the flat per-site floor is the CALLER's to apply
     * (`checkDiscountMargin` applies it itself), so returning the floored
     * figure here would charge it twice.
     */
    const latestDoc = snapshot.docs[0]
    const latest = latestDoc
      ? {
          month: String(latestDoc.get('month') ?? latestDoc.id),
          measuredCogsUsd: orgMonthlyCogsUsd(
            orgCogsInputFrom(latestDoc.data()),
            0,
          ).measuredUsd,
          rollup: orgCogsInputFrom(latestDoc.data()),
        }
      : null
    // Month-over-month delta vs the next-older row (list is desc).
    const withDeltas = months.map((row, index) => {
      const previous = months[index + 1]
      const delta = (current: number, prior?: number) =>
        prior && prior > 0 ? (current - prior) / prior : null
      return {
        ...row,
        deltas: previous
          ? {
              pageViews: delta(row.pageViews, previous.pageViews),
              costUsd: delta(row.costUsd, previous.costUsd),
            }
          : null,
      }
    })
    return Response.json({ months: withDeltas, latest }, { status: 200 })
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Usage lookup failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
