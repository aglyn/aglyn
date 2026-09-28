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
 * THE RISK NOTICE DIGEST SWEEP (AGL-3368), hourly.
 *
 * A workspace that crossed its hourly allowance of risk notices had the rest
 * folded into a pending digest (`notifyRiskEvent`). The next notice after the
 * hour closes sends that digest, but an attack that simply stops would leave
 * it unsent; this sends every digest whose hour has closed, so the summary
 * always arrives. A GET reports how many are due and sends nothing.
 */

// lockdown-423: exempt — server-internal cron (x-cron-secret), no user caller; it sends platform
// account mail about holds, which a locked workspace's owners must still receive.

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  flushRiskNoticeDigests,
  RISK_NOTICE_BURST,
  RISK_NOTICE_LEDGER_COLLECTION,
} from '@aglyn/tenant-data-admin'
import { isCronAuthorized, isCronDryRun } from '../../../../utils/cron-auth'
import { recordCronBeat } from '../../../../utils/cron-beat'

/** The beat id `/api/health/crons` reads. */
export const RISK_NOTICE_DIGESTS_JOB_ID = 'risk-notice-digests'

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders, query } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  if (!process.env.CRON_SECRET) {
    return Response.json(
      { error: 'Risk notice digests are not configured (CRON_SECRET).' },
      { status: 501 },
    )
  }
  if (!isCronAuthorized(headers)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  const dryRun = isCronDryRun({ method, body, query })
  if (method === 'POST') await recordCronBeat(RISK_NOTICE_DIGESTS_JOB_ID)
  try {
    if (dryRun) {
      const due = await firebaseAdmin
        .app()
        .firestore()
        .collection(RISK_NOTICE_LEDGER_COLLECTION)
        .where('windowStartedAtMs', '<=', Date.now() - RISK_NOTICE_BURST.windowMs)
        .where('windowStartedAtMs', '>', 0)
        .limit(200)
        .get()
      return Response.json({ dryRun: true, windowsClosed: due.size })
    }
    const result = await flushRiskNoticeDigests()
    return Response.json({ dryRun: false, ...result }, { status: result.failed ? 500 : 200 })
  } catch (error) {
    console.error('[risk-notices/digests] failed', error)
    return Response.json({ error: 'The digest sweep failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
export const maxDuration = 60
