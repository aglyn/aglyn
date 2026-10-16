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
// caller; it reads each workspace's figures to report them to its owners and
// admins and writes nothing a locked org could lose.

import { isCronAuthorized } from '@aglyn/tenant-data-admin/server/cron-auth'
import { weeklySummaryRoute } from '@aglyn/tenant-data-admin/server/weekly-summary'
import { registerPluginServerDeclarations } from '../../../../constants/plugins.declarations.server.generated'
import { serverPluginLoader } from '../../../../utils/server-plugin-loader'

/**
 * THE WEEKLY SUMMARY (AGL-3867): `POST /api/admin/weekly-summary`, Mondays
 * at 13:00 UTC from `scheduled-crons.yml`. The sweep and its sends live in
 * `@aglyn/tenant-data-admin/server/weekly-summary`; this route only loads
 * what the sweep reads.
 *
 * The figures come from readers that each plugin registers from its server
 * surface, which the plugin API dispatcher loads per request and a cron never
 * reaches otherwise — so they are loaded here first, the way
 * `/api/admin/plugin-crons` loads them for the jobs it runs.
 */
async function handler(request: Request): Promise<Response> {
  // Refused before the plugins load, so an unauthenticated caller costs
  // nothing; `weeklySummaryRoute` asks the same of the request again.
  if (process.env['CRON_SECRET'] && !isCronAuthorized(Object.fromEntries(request.headers.entries()))) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  try {
    await registerPluginServerDeclarations()
  } catch (error) {
    console.error('[weekly-summary] plugin declarations failed', error)
  }
  await serverPluginLoader.ensureAll(['consoleApi'])
  return weeklySummaryRoute(request)
}

export const dynamic = 'force-dynamic'

/** One chunk stops starting work at 45 s; this is the ceiling past it. */
export const maxDuration = 60

export { handler as GET, handler as POST }
