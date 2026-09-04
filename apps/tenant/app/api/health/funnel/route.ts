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
 * Can a prospect still reach us — contact, sales enquiry, demo request?
 * (AGL-2586)
 *
 * Two checks, and both are about the journey rather than a component:
 *
 *  - `intake` — would the next submission be ACCEPTED, and is there anybody
 *    to tell? Every gate `/api/forms/submit` clears before its first write,
 *    asked of the real documents through the real functions.
 *  - `routing` — do the site's lead-routing forms still file a lead, record
 *    consent through a field that exists, and belong to a campaign? And are
 *    there still as many of them as there are supposed to be, which is the
 *    only way a form that stopped routing can be seen at all.
 *
 * NOTHING IS WRITTEN. See `funnel-probe.ts` for why a synthetic submission
 * would have been an abuse vector of our own making, and for what this
 * therefore does not prove.
 *
 * Same contract as every sibling: the STATUS CODE is the signal (200 / 503),
 * never cached, cost-bounded by the probe memo, and the body carries codes
 * and counts — never a form name, a slug, a uid or a submission.
 *
 * SELF-CLEARING. Nothing latches; a funnel that is wired correctly again
 * clears the red within one probe TTL.
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
} from '@aglyn/aglyn/server'

import {
  funnelHost,
  probeFunnel,
  PROBE_TTL_MS,
  type FunnelProbeResult,
} from './funnel-probe'

// lockdown-423: exempt — infrastructure monitoring probe; no org-scoped action.

/** Never prerender, never revalidate. */

export const dynamic = 'force-dynamic'
export const revalidate = 0

// The host is resolved INSIDE the probe, not captured at module load, so a
// configuration change takes effect on the next probe rather than needing a
// cold instance.
const funnelProbe = memoizeWithTtl<FunnelProbeResult>(PROBE_TTL_MS, () =>
  probeFunnel(funnelHost()),
)

export async function GET(): Promise<Response> {
  const { intake, routing } = await funnelProbe()
  const checks = { intake, routing }
  const status = healthStatus(checks)
  return Response.json(
    healthBody({
      service: 'tenant-funnel',
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
 * A HEAD that returns a literal 200 is a check that cannot go red for the
 * monitors most likely to use it. See `healthHeadOf`. The probe memo is what
 * keeps this cheap.
 */
export async function HEAD(): Promise<Response> {
  return healthHeadOf(GET)
}
