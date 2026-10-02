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
 * THE AUTOMATIC SECURITY HOLDS (AGL-3450), every fifteen minutes.
 *
 * The page screen runs where a page is composed — mostly the published-site
 * runtime, which holds no lockdown path — so a held page from a young
 * workspace writes `securityHolds/{orgId}` and this places it: the
 * workspace, the site and the publishing account, as `security`, through the
 * staff lockdown cores (`utils/server/page-security-hold.ts`). A GET reports
 * how many are pending and places nothing.
 */

// lockdown-423: exempt — server-internal cron (x-cron-secret), no user caller; it places the
// platform's own locks, which no workspace lock may refuse.

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { listPendingSecurityHolds } from '@aglyn/tenant-data-admin/server/page-security-hold'
import { isCronAuthorized, isCronDryRun } from '../../../../utils/cron-auth'
import { recordCronBeat } from '../../../../utils/cron-beat'
import { applyPendingSecurityHolds } from '../../../../utils/server/page-security-hold'

/** The beat id `/api/health/crons` reads. */
export const SECURITY_HOLDS_JOB_ID = 'security-holds'

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders, query } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  if (!process.env.CRON_SECRET) {
    return Response.json(
      { error: 'Security holds are not configured (CRON_SECRET).' },
      { status: 501 },
    )
  }
  if (!isCronAuthorized(headers)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  const dryRun = isCronDryRun({ method, body, query })
  if (method === 'POST') await recordCronBeat(SECURITY_HOLDS_JOB_ID)
  try {
    const firestore = firebaseAdmin.app().firestore()
    if (dryRun) {
      const pending = await listPendingSecurityHolds(firestore, 50)
      return Response.json({
        dryRun: true,
        pending: pending.length,
        holds: pending.map((hold) => ({ orgId: hold.orgId, hostId: hold.hostId, reference: hold.reference })),
      })
    }
    const sweep = await applyPendingSecurityHolds(firestore)
    // 207 — finished, and a hold in it needs a person.
    return Response.json({ dryRun: false, ...sweep }, { status: sweep.failed ? 207 : 200 })
  } catch (error) {
    console.error('[admin/security-holds] failed', error)
    return Response.json({ error: 'The security hold sweep failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
export const maxDuration = 120
