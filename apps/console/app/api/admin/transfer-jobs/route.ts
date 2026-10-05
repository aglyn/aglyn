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
 * THE IMPORT SWEEP (AGL-3524), every fifteen minutes.
 *
 * The import wizard drives Apply from the browser, one budgeted request
 * after another; a tab that closes leaves the job `applying` with the cursor
 * where it stopped. This resumes every such job nobody has touched for two
 * minutes, under its own lease, through the same engine — the ledger makes a
 * returning browser harmless. A GET lists them and resumes nothing.
 */

// lockdown-423: exempt — server-internal cron (x-cron-secret), no user caller; it only resumes
// imports a member already started, each checked against the lockdown when it began.

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { sweepAbandonedTransferJobs } from '@aglyn/tenant-data-admin/server/transfer-jobs'
import { isCronAuthorized, isCronDryRun } from '../../../../utils/cron-auth'
import { recordCronBeat } from '../../../../utils/cron-beat'
import { transferEngineDeps } from '../../../../utils/server/transfer-gate'

/** The beat id `/api/health/crons` reads. */
export const TRANSFER_JOBS_JOB_ID = 'transfer-jobs'

/** How long one sweep resumes imports before it answers. */
const SWEEP_BUDGET_MS = 100_000

async function handler(request: Request): Promise<Response> {
  const startedAt = Date.now()
  const { method, body, headers: rawHeaders, query } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  if (!process.env.CRON_SECRET) {
    return Response.json({ error: 'The import sweep is not configured (CRON_SECRET).' }, { status: 501 })
  }
  if (!isCronAuthorized(headers)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  const dryRun = isCronDryRun({ method, body, query })
  if (method === 'POST') await recordCronBeat(TRANSFER_JOBS_JOB_ID)
  try {
    const sweep = await sweepAbandonedTransferJobs(transferEngineDeps(), {
      deadlineMs: startedAt + SWEEP_BUDGET_MS,
      dryRun,
    })
    const failed = sweep.skipped.filter((entry) => entry.reason !== 'dryRun' && entry.reason !== 'budget').length
    // 207 — finished, and an import in it could not be resumed.
    return Response.json({ dryRun, ...sweep }, { status: failed ? 207 : 200 })
  } catch (error) {
    console.error('[admin/transfer-jobs] failed', error)
    return Response.json({ error: 'The import sweep failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
export const maxDuration = 120
