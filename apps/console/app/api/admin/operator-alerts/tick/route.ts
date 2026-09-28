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
 * THE OPERATOR ALERTS TICK (AGL-3377), every fifteen minutes: the health
 * sweep, the support SLA sweep and the once-a-day operator digest. See
 * `utils/server/operator-alerts-tick.ts`. A GET reports what is due and
 * probes, sends and raises nothing.
 */

// lockdown-423: exempt — server-internal cron (x-cron-secret), no user caller; it reads platform
// health and support tickets and alerts the operator, which no workspace lock may silence.

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { isCronAuthorized, isCronDryRun } from '../../../../../utils/cron-auth'
import { recordCronBeat } from '../../../../../utils/cron-beat'
import { runOperatorAlertsTick } from '../../../../../utils/server/operator-alerts-tick'

/** The beat id `/api/health/crons` reads. */
export const OPERATOR_ALERTS_JOB_ID = 'operator-alerts'

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders, query } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  if (!process.env.CRON_SECRET) {
    return Response.json(
      { error: 'Operator alerts are not scheduled (CRON_SECRET).' },
      { status: 501 },
    )
  }
  if (!isCronAuthorized(headers)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  const dryRun = isCronDryRun({ method, body, query })
  if (method === 'POST') await recordCronBeat(OPERATOR_ALERTS_JOB_ID)
  const report = await runOperatorAlertsTick({
    dryRun,
    requestOrigin: new URL(request.url).origin,
  })
  const failed = [report.health, report.sla, report.digest].some(
    (stage) => 'error' in stage,
  )
  return Response.json({ dryRun, ...report }, { status: failed ? 207 : 200 })
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
export const maxDuration = 120
