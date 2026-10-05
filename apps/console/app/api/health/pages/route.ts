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
 * Do published sites render real pages right now? (AGL-3580)
 *
 * The render monitor (`/api/admin/render-monitor`, every five minutes on
 * Cloud Scheduler) fetches pages no cache can answer from each watched site,
 * including real client pages with images. This door publishes its latest
 * verdict per site, so an external keyword monitor that cannot carry our
 * firewall bypass header can still watch real pages: the status page's
 * `Published sites` and `Marketing site` read it with `?site=`.
 *
 *   GET /api/health/pages                         every watched site
 *   GET /api/health/pages?site=aglyn.com          one site
 *   GET /api/health/pages?site=a.aglyn.app,b.aglyn.app
 *
 * On the CONSOLE, like the monitor: a door served by the runtime it reports
 * on goes down with it and reads as unreachable rather than as red.
 *
 * It reads stored state and fetches nothing, so a public caller cannot make
 * it render pages. It records no operator health state either, unlike its
 * siblings: the monitor already raises its own alert on the same edge, and a
 * `?site=` answer is a slice of the board, so recording one would flip the
 * stored state between whatever slices callers happened to ask for. The rules for what is red and what is a green with a
 * caveat are in `renderPagesHealth`.
 */
import {
  readRenderMonitorStates,
  renderPagesHealth,
  requestedRenderPagesHosts,
  resolveRenderMonitorTargets,
  type RenderPagesCheck,
} from '@aglyn/tenant-data-admin/server/render-monitor'
import {
  deploymentCommitRef,
  deploymentEnvironmentLabel,
  healthBody,
  healthHeadOf,
  healthHeaders,
  healthHttpStatus,
  healthStatus,
  HEALTH_PROBE_TTL_MS,
  memoizeWithTtl,
  platformVersion,
} from '@aglyn/aglyn/server'

// lockdown-423: exempt — infrastructure monitoring probe; no org-scoped action.

/** Never prerender, never revalidate. */

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * One read of every watched site's verdict per instance per memo window. A
 * `?site=` filters that read, so a public caller varying the query cannot
 * multiply Firestore reads.
 */
const statesProbe = memoizeWithTtl(HEALTH_PROBE_TTL_MS, async () => {
  const startedAt = Date.now()
  const watched = resolveRenderMonitorTargets(process.env)
  const states = await readRenderMonitorStates(watched.map((origin) => new URL(origin).host))
  return { watched, states, ms: Date.now() - startedAt }
})

export async function GET(request: Request): Promise<Response> {
  const { watched, states, ms } = await statesProbe()
  const hosts = requestedRenderPagesHosts(new URL(request.url).searchParams.get('site'), watched)
  const checks: Record<string, RenderPagesCheck> = renderPagesHealth(hosts, watched, states, ms)
  const status = healthStatus(checks)
  return Response.json(
    healthBody({
      service: 'console-pages',
      checks,
      commit: deploymentCommitRef(),
      version: platformVersion(),
      environment: deploymentEnvironmentLabel(),
      region: process.env['VERCEL_REGION'] ?? null,
    }),
    { status: healthHttpStatus(status), headers: healthHeaders(status) },
  )
}

/** HEAD answers exactly what GET would, minus the body (AGL-1148). */
export async function HEAD(request: Request): Promise<Response> {
  return healthHeadOf(() => GET(request))
}
