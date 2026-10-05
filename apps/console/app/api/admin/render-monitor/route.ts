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
 * THE RENDER MONITOR (AGL-3568), every five minutes on Cloud Scheduler
 * (`consoleRenderMonitor`): fetches pages no cache can answer from each
 * published site it watches, and alerts the operator when one stops
 * rendering. See `@aglyn/tenant-data-admin/server/render-monitor`.
 *
 * On the CONSOLE on purpose: a monitor deployed with the site runtime it
 * watches goes down with it. A GET fetches and grades and writes nothing.
 */

// lockdown-423: exempt — server-internal cron (x-cron-secret), no user caller; it fetches published
// pages and alerts the operator when they stop rendering, which no workspace lock may silence.

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { runRenderMonitor } from '@aglyn/tenant-data-admin/server/render-monitor'
import { isCronAuthorized, isCronDryRun } from '../../../../utils/cron-auth'
import { recordCronBeat } from '../../../../utils/cron-beat'

/**
 * The headers that get our own request past our own edge, when configured.
 *
 * The bypass falls back to `VERCEL_AUTOMATION_BYPASS_SECRET`, the system
 * variable Vercel exposes to a project that generated one (AGL-3571). The
 * console and the tenant hold the SAME value by design (SECRET_ROTATION.md
 * row 15; measured equal 2026-10-05), and the monitor's `page` probe needs it
 * to reach the tenant's protected `*.vercel.app` production domain.
 */
function edgeBypassHeaders(): Record<string, string> {
  const probe = String(process.env['AGLYN_PROBE_TOKEN'] ?? '').trim()
  const bypass = String(
    process.env['AGLYN_VERCEL_BYPASS'] || process.env['VERCEL_AUTOMATION_BYPASS_SECRET'] || '',
  ).trim()
  return {
    ...(probe ? { 'x-aglyn-probe': probe } : {}),
    ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}),
  }
}

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders, query } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  if (!process.env.CRON_SECRET) {
    return Response.json(
      { error: 'The render monitor is not scheduled (CRON_SECRET).' },
      { status: 501 },
    )
  }
  if (!isCronAuthorized(headers)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  const dryRun = isCronDryRun({ method, body, query })
  if (method === 'POST') await recordCronBeat('render-monitor')
  const report = await runRenderMonitor({ dryRun, headers: edgeBypassHeaders() })
  // 207 only when the run itself could not record a site: a site that fails
  // to render is what the alert is for, not a fault of this job.
  const unrecorded = report.sites.some((site) => site.error)
  return Response.json(report, { status: unrecorded ? 207 : 200 })
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
// Each page fetch gives up at 25 s and every fetch runs at once.
export const maxDuration = 60
