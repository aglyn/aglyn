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
 * Can a person still get IN? (AGL-2586)
 *
 * Six checks — `passwordSignIn`, `passwordReset`, `emailVerification`,
 * `googleOauth`, `sso`, `passkey` — over every way a person gets in. Signup
 * was dead for every visitor from launch day to 2026-09-04 with every
 * component check green, because a platform can have every dependency working
 * and still be one nobody can get into. `/api/health/signup-volume` watches
 * account CREATION and `/api/health/journeys` watches what a customer does
 * once inside; this is the way in.
 *
 * `passwordSignIn` joined the five later (AGL-2583). The original set was
 * deliberately the doors that are NOT email and password, on the reading that
 * the password door was already watched — it was not: the check named
 * "signups" measures creation volume, and no endpoint anywhere asserted that
 * an existing customer can get back into their account.
 *
 * What each check asserts, what is deliberately left uncovered, and why
 * nothing is created, is in `auth-doors-probe.ts`. The verdicts are in
 * `auth-doors-verdict.ts`, where a spec drives every red branch with no
 * network and no admin credential.
 *
 * ONE endpoint for the six rather than six, because they share a subject and
 * a first responder: the body's `checks` says which door is shut, and six
 * separate URLs would put five more rows on the uptime board for one
 * question.
 *
 * Same contract as every sibling: the STATUS CODE is the signal (200 / 503),
 * never cached, cost-bounded by the probe memo, and the body carries codes
 * and fixed prose — never a provider message, a tenant id, an address or a
 * client id.
 *
 * SELF-CLEARING. Nothing latches; a provider config restored, or an
 * authorized domain put back, clears the red within one probe TTL.
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
  probeAuthDoors,
  PROBE_TTL_MS,
  type AuthDoorsProbeResult,
} from './auth-doors-probe'

// lockdown-423: exempt — infrastructure monitoring probe; no org-scoped action.

/** Never prerender, never revalidate. */

export const dynamic = 'force-dynamic'
export const revalidate = 0

const authDoorsProbe = memoizeWithTtl<AuthDoorsProbeResult>(PROBE_TTL_MS, () =>
  probeAuthDoors(),
)

export async function GET(): Promise<Response> {
  const {
    passwordSignIn,
    passwordReset,
    emailVerification,
    googleOauth,
    sso,
    passkey,
  } = await authDoorsProbe()
  const checks = {
    passwordSignIn,
    passwordReset,
    emailVerification,
    googleOauth,
    sso,
    passkey,
  }
  const status = healthStatus(checks)
  return Response.json(
    healthBody({
      service: 'console-auth-doors',
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
