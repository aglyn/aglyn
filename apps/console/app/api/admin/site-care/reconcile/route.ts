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

// lockdown-423: exempt — server-internal cron (x-cron-secret), no user caller; it compares Site
// Care charges with Stripe and alerts the operator, which no workspace lock may silence.

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { reconcileSiteCare } from '@aglyn/tenant-data-admin/server/site-care-reconcile'
import { isCronAuthorized, isCronDryRun } from '../../../../../utils/cron-auth'
import { recordCronBeat } from '../../../../../utils/cron-beat'

/** The beat id `/api/health/crons` reads. */
export const SITE_CARE_RECONCILE_JOB_ID = 'site-care-reconcile'

/**
 * THE SITE CARE RECONCILIATION (AGL-3959), daily: each Site Care request's
 * billed hours against its Stripe invoice item, and each month's total
 * against its statement, for this month and the last, and each request against
 * its own logged minutes and approval (AGL-4031). Any difference raises
 * `billing.siteCareReconciliation` (Should know). A GET compares and reports
 * and raises nothing; the POST raises. It never changes a charge — the fix
 * is made from the request.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders, query } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  if (!process.env.CRON_SECRET) {
    return Response.json({ error: 'The Site Care reconciliation is not scheduled (CRON_SECRET).' }, { status: 501 })
  }
  if (!isCronAuthorized(headers)) return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  const dryRun = isCronDryRun({ method, body, query })
  if (method === 'POST') await recordCronBeat(SITE_CARE_RECONCILE_JOB_ID)
  const report = await reconcileSiteCare(firebaseAdmin.app().firestore(), { dryRun })
  // 207 when a workspace could not be read: the workflow goes red on it, so a
  // check that compared nothing never reads as one that found nothing.
  return Response.json({ dryRun, ...report }, { status: report.errors.length ? 207 : 200 })
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
export const maxDuration = 120
