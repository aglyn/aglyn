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
// caller and no org of its own; each plugin job asks the lockdown verdict
// for the workspace and the member it acts for before it acts.

import { runPluginConsoleCrons } from '@aglyn/aglyn/plugin-manager/plugin-console-crons'
import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { registerPluginServerDeclarations } from '../../../../constants/plugins.declarations.server.generated'
import { isCronAuthorized } from '../../../../utils/cron-auth'
import { recordCronBeat } from '../../../../utils/cron-beat'
import { serverPluginLoader } from '../../../../utils/server-plugin-loader'

/**
 * EVERY PLUGIN'S CONSOLE JOBS, ON ONE TICK (AGL-2981): `POST /api/admin/plugin-crons`.
 *
 * `consoleFastCrons` in `cloud/functions` posts this every fifteen minutes,
 * like the platform's own sweeps beside it, carrying the console's
 * `CRON_SECRET`. What it runs is whatever the plugins declared on
 * `plugin-console-crons` — a plugin's job needs no route of its own, no line
 * in the scheduler's list and no firewall rule: the path sits under
 * `/api/admin/`, which the console's edge already lets a request carrying the
 * cron header through.
 *
 * Why the CONSOLE runs them: a job declared here holds what only the console
 * may hold — a provider key, a sealed grant to a person's mailbox — so it
 * cannot run on the tenant's job beat, which serves the public internet.
 *
 * ## Order of work
 *
 *  1. The secret: 405 to anything but a POST, 501 while it is unset, 401
 *     without it.
 *  2. The runner's own mark, `plugin-console-crons`: the route was posted.
 *  3. The plugins' declarations, which is where the jobs are declared, and
 *     their server surfaces, which is where a job finds the services other
 *     plugins register — a record writer, a reader. Boot has usually loaded
 *     both; a process that has not still runs every job.
 *  4. Every job, concurrently, each after its own mark — or the one named by
 *     `{"job": "<id>"}` (or `?job=`), a manual re-run.
 *
 * ## The answer
 *
 * 200 with each job's report, or 207 when a job threw: the tick finished and
 * something in it needs a person, which the scheduler logs as an error
 * rather than as success.
 */

/** How long the jobs may start new work, inside the scheduler's 240 s wait. */
const PLUGIN_CONSOLE_CRONS_BUDGET_MS = 200_000

async function handler(request: Request): Promise<Response> {
  const { method, headers, query, body } = await pluginRequestFromWeb(request)
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } })
  }
  if (!process.env.CRON_SECRET) {
    return Response.json(
      { error: 'Plugin console jobs are not configured (CRON_SECRET).' },
      { status: 501 },
    )
  }
  if (!isCronAuthorized(headers as Partial<Record<string, string>>)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  // The mark `/api/health/crons` reads for the runner itself (AGL-1955):
  // stamped on the invocation, before the work, like every console cron.
  // Spelled out, as every route spells its row's id, so the beat-wiring
  // scan finds it; `PLUGIN_CONSOLE_CRONS_JOB_ID` is the same string.
  await recordCronBeat('plugin-console-crons')

  const startedAt = Date.now()
  try {
    await registerPluginServerDeclarations()
  } catch (error) {
    console.error('[plugin-crons] plugin declarations failed', error)
  }
  // The services a job resolves are registered by other plugins' server
  // surfaces, which the dispatcher loads per request and a cron never
  // reaches otherwise.
  await serverPluginLoader.ensureAll(['consoleApi'])

  const named =
    typeof (body as { job?: unknown } | null)?.job === 'string'
      ? String((body as { job: string }).job)
      : typeof query['job'] === 'string'
        ? String(query['job'])
        : ''
  const reports = await runPluginConsoleCrons({
    nowMs: startedAt,
    deadlineMs: startedAt + PLUGIN_CONSOLE_CRONS_BUDGET_MS,
    jobIds: named ? [named] : null,
    beat: (jobId) => recordCronBeat(jobId),
  })
  if (named && !(named in reports)) {
    return Response.json({ error: `No plugin declares a console job "${named}".` }, { status: 404 })
  }
  const failed = Object.entries(reports)
    .filter(([, report]) => report === null)
    .map(([jobId]) => jobId)
  if (failed.length) console.error(`[plugin-crons] ${failed.length} job(s) failed: ${failed.join(', ')}`)
  return Response.json(
    { ok: failed.length === 0, ms: Date.now() - startedAt, jobs: reports, failed },
    { status: failed.length ? 207 : 200, headers: { 'Cache-Control': 'no-store' } },
  )
}

export const dynamic = 'force-dynamic'

/**
 * The scheduler waits 240 s for an answer; the jobs stop starting work at
 * `PLUGIN_CONSOLE_CRONS_BUDGET_MS`, and this is the ceiling past both.
 */
export const maxDuration = 300

export { handler as POST }
