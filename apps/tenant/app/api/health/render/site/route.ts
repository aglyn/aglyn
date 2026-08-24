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
 * Does a real customer-shaped tenant site still render? (AGL-2486).
 *
 * Runs the real catch-all loader for the platform demonstration site's home page. The demo host is Aglyn's own, so this cannot go red because a customer edited or unpublished something — and the assertion is structural, never a string from the page.
 *
 * Replaces the dead `customer-site` GCP uptime check, which fetched
 * `demo.aglyn.app/` and had been answered with a 429 Vercel Security
 * Checkpoint since 2026-08-21. This path rides the `/api/health` firewall
 * bypass, so Google's checkers reach it without an IP allowlist and without
 * being handed a shared secret.
 *
 * Same contract as every sibling: the STATUS CODE is the signal (200 / 503),
 * never cached, no page content in the body — a code and a node COUNT — and
 * HEAD runs the same probe as GET.
 *
 * SELF-CLEARING. Nothing latches; a page that renders again clears the red
 * within one probe TTL.
 */
import {
  deploymentCommitRef,
  deploymentEnvironmentLabel,
  healthBody,
  healthHeadOf,
  healthHeaders,
  healthHttpStatus,
  healthStatus,
  memoizeWithTtl,
  platformVersion,
  type RenderCheck,
} from '@aglyn/aglyn/server'

import { siteHost, PROBE_TTL_MS, probeRender } from '../canary'

// lockdown-423: exempt — infrastructure monitoring probe; no org-scoped action.

/** Never prerender, never revalidate. */

export const dynamic = 'force-dynamic'
export const revalidate = 0

// The host is resolved INSIDE the probe, not captured at module load, so a
// configuration change takes effect on the next probe rather than needing a
// cold instance.
const renderProbe = memoizeWithTtl<RenderCheck>(PROBE_TTL_MS, () =>
  probeRender(siteHost()),
)

export async function GET(): Promise<Response> {
  const checks = { render: await renderProbe() }
  const status = healthStatus(checks)
  return Response.json(
    healthBody({
      service: 'tenant-render-site',
      checks,
      commit: deploymentCommitRef(),
      version: platformVersion(),
      environment: deploymentEnvironmentLabel(),
      region: process.env['VERCEL_REGION'] ?? null,
    }),
    { status: healthHttpStatus(status), headers: healthHeaders(status) },
  )
}

/**
 * HEAD answers exactly what GET would, minus the body (AGL-1148).
 *
 * A HEAD that returns a hardcoded 200 is a check that cannot go red, which is
 * how `/api/health/crons` stayed green through fifty-one hours at 503. The
 * probe memo is what keeps delegating to GET cheap.
 */
export async function HEAD(): Promise<Response> {
  return healthHeadOf(GET)
}
