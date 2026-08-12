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

/**
 * Per-organization usage drill-down (AGL-205/238): the last 12 monthly
 * rollups for one org with month-over-month deltas, powering the Usage
 * dialog on the staff Organizations page. Staff-gated, read-only.
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
    console.error(error)
    return Response.json({ error: 'Usage lookup failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
