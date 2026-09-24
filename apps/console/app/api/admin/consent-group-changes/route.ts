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

// lockdown-423: exempt — server-internal cron (x-cron-secret) with no user
// caller and no org of its own; the executor asks the lockdown verdict for
// each workspace, and for the member who started its change, before it acts.

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { advanceDueConsentGroupChanges } from '@aglyn/tenant-data-admin'
import { registerPluginServerDeclarations } from '../../../../constants/plugins.declarations.server.generated'
import { isCronAuthorized, isCronDryRun } from '../../../../utils/cron-auth'
import { recordCronBeat } from '../../../../utils/cron-beat'

/**
 * EVERY CONSENT GROUP CHANGE IN FLIGHT, FINISHED (AGL-3320):
 * `POST /api/admin/consent-group-changes`.
 *
 * The editor's progress panel works a change while it is open, and nothing
 * requires it to stay open: an admin who closes the tab mid-carry has still
 * asked for the change. So `consoleFastCrons` posts this every fifteen
 * minutes, and it advances every organization whose `consentGroupsChange`
 * marker is set — the carry, the flip, the re-home and the delayed sweep —
 * for as long as its budget lasts. Each change is leased, so a tick beside an
 * open panel never works the same unit twice.
 *
 * A GET reports which changes are in flight and writes nothing; the cron
 * POSTs. A change that threw answers 207, which the scheduler logs as an
 * error: the change itself is already marked stalled on its job and retries
 * on the next tick.
 */

/**
 * How long the tick may start new work: well inside the scheduler's 240 s
 * wait, so a unit started at the budget's edge still answers before it.
 */
const CONSENT_GROUP_CHANGES_BUDGET_MS = 200_000

async function handler(request: Request): Promise<Response> {
  const { method, headers, query, body } = await pluginRequestFromWeb(request)
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  if (!process.env.CRON_SECRET) {
    return Response.json(
      { error: 'Consent group changes are not configured (CRON_SECRET).' },
      { status: 501 },
    )
  }
  if (!isCronAuthorized(headers as Partial<Record<string, string>>)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  // AGL-1955 — the mark `/api/health/crons` reads to notice this job going
  // AWAY: on the invocation, not the work, so a tick with nothing in flight
  // still proves the schedule is alive. POST only, because a human's GET is
  // not the scheduler.
  if (method === 'POST') await recordCronBeat('consent-group-changes')

  const dryRun = isCronDryRun({ method, query, body })
  const startedAt = Date.now()
  try {
    // The participants live in the plugins' declarations; a change must not
    // be worked in a process that could not register them.
    await registerPluginServerDeclarations()
    const changes = await advanceDueConsentGroupChanges({
      deadlineMs: startedAt + CONSENT_GROUP_CHANGES_BUDGET_MS,
      dryRun,
    })
    const failed = changes.filter((change) => change.error || change.status?.progress.stalled)
    return Response.json(
      { ok: failed.length === 0, dryRun, ms: Date.now() - startedAt, changes },
      { status: failed.length ? 207 : 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[consent-group-changes] tick failed', error)
    return Response.json({ error: 'Consent group changes could not be advanced' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'

/**
 * The scheduler waits 240 s for an answer, and the tick stops starting work
 * at `CONSENT_GROUP_CHANGES_BUDGET_MS`; this is the ceiling past both.
 */
export const maxDuration = 300

export { handler as GET, handler as POST }
