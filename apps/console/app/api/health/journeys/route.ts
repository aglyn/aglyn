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
 * Can a customer create and publish? (AGL-2586)
 *
 * Three checks — `create`, `publishRules`, `publishAnnounce` — over the four
 * journeys a paying customer buys: create an org, create a site, create a
 * screen, publish it and see it live. What each one asserts, why nothing is
 * written, and what is deliberately left to the tenant render canaries, is
 * in `journeys-probe.ts`.
 *
 * ONE endpoint for the three rather than three, because they share a subject
 * and a first responder: the body's `checks` says which half is out, and
 * three separate URLs would put three more rows on the uptime board for one
 * question.
 *
 * Same contract as every sibling: the STATUS CODE is the signal (200 / 503),
 * never cached, cost-bounded by the probe memo, and the body carries codes,
 * counts and our own rule-block names — never an org, a site, a slug or a uid.
 *
 * SELF-CLEARING. Nothing latches; a rules deploy that lands, or a drained
 * outbox, clears the red within one probe TTL.
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
  probeJourneys,
  PROBE_TTL_MS,
  type JourneysProbeResult,
} from './journeys-probe'

// lockdown-423: exempt — infrastructure monitoring probe; no org-scoped action.

/** Never prerender, never revalidate. */

export const dynamic = 'force-dynamic'
export const revalidate = 0

const journeysProbe = memoizeWithTtl<JourneysProbeResult>(PROBE_TTL_MS, () =>
  probeJourneys(),
)

export async function GET(): Promise<Response> {
  const { create, publishRules, publishAnnounce } = await journeysProbe()
  const checks = { create, publishRules, publishAnnounce }
  const status = healthStatus(checks)
  return Response.json(
    healthBody({
      service: 'console-journeys',
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
