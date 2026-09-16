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
  resolvePluginApiMatch,
  runLegacyHandler,
  runPluginApiMatch,
} from '@aglyn/aglyn/server'
import { isCronAuthorized } from '../../../../utils/cron-auth'
import { serverPluginLoader } from '../../../../utils/server-plugin-loader'

/**
 * THE AI JOBS BEAT'S FUNCTION TIME (AGL-3026).
 *
 * The beat is the AI plugin's: `registerAiConsoleApi` registers its handler
 * at this path, and the handler holds everything it does — the cron secret,
 * the `ai-generate` switch, the sweep. This file exists for one setting the
 * plugin cannot carry. `maxDuration` is read from the App Router file that
 * serves a request, and the plugin dispatcher's is a door's; a sweep given
 * less time than its budget would be killed with a step's provider call in
 * flight, which is billed upstream and metered nowhere, and would leave the
 * step leased until its lease ran out. A named route wins over the
 * dispatcher at the same path, so the dispatcher never serves this one.
 *
 * It asks the cron secret before loading the plugin surfaces, so a request
 * without it costs nothing, and the handler asks it again: the registry is
 * shared with the dispatcher, and the handler does not trust its caller.
 *
 * `apps/console/specs/ai-jobs-beat-route.spec.ts` holds the arithmetic: the
 * sweep's budget and the route's own work inside `maxDuration`, and a lease
 * that outlasts it.
 */

/** The AI plugin's registered path for its beat; the URL of this route. */
const AI_JOBS_BEAT_PATH = 'admin/ai-jobs-beat'

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  if (!process.env.CRON_SECRET) {
    return Response.json(
      { error: 'The AI jobs beat is not configured (CRON_SECRET).' },
      { status: 501 },
    )
  }
  // The two headers the secret may arrive in, read without touching the body,
  // which the handler is handed as it came.
  const presented = {
    authorization: request.headers.get('authorization') ?? undefined,
    'x-cron-secret': request.headers.get('x-cron-secret') ?? undefined,
  }
  if (!isCronAuthorized(presented)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  await serverPluginLoader.ensureAll(['consoleApi'])
  const match = resolvePluginApiMatch(AI_JOBS_BEAT_PATH)
  if (!match) return Response.json({ error: 'Not found' }, { status: 404 })
  return runPluginApiMatch(
    match,
    request,
    { pluginApi: AI_JOBS_BEAT_PATH.split('/') },
    runLegacyHandler,
  )
}

export const dynamic = 'force-dynamic'

/**
 * `AI_JOB_SWEEP_BUDGET_MS` (280 s) and the route's work around the sweep.
 * 300 s is the longest Vercel's Pro plan runs a function without fluid
 * compute, so it holds however the project is set; a budget that needs more
 * needs that setting first.
 */
export const maxDuration = 300

export { handler as POST }
