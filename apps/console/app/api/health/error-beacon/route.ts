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
 * Is the error beacon still able to report? (AGL-1923)
 *
 * The dead-man's switch for AGL-1538. The `Client error beacon` alert policy
 * is a log-match, so it can only report the PRESENCE of an error entry — if
 * the beacon stops writing, the policy goes quiet, and quiet is the same
 * reading it gives on a healthy day. Every failure path in
 * `reportClientErrors` ends in a `console.warn` to a log that retains about
 * an hour and drains nowhere (AGL-1799), so a beacon that has been dead for
 * days presents as "zero errors" in Error Reporting and silence in
 * Monitoring — indistinguishable from a clean launch.
 *
 * This probe writes one heartbeat entry through the beacon's OWN credential
 * and OWN transport and grades the result, so the existing uptime check +
 * alert + email path (AGL-1502) becomes the listener for beacon silence. The
 * uptime probe is what winds the switch: there is no separate cron that could
 * itself stop without anyone noticing.
 *
 * PER DEPLOYMENT, deliberately. `/api/errors` exists in both the console and
 * the tenant runtime, each with its own admin credential and its own env, so
 * a console heartbeat proves nothing about the tenant one. The sibling route
 * in `apps/tenant` is the other half.
 *
 * Same three rules as every sibling health endpoint — never cached, checks
 * the real thing (an actual Logging write, not a reachability ping), and
 * cost-bounded: the write is memoised per instance, which also bounds how
 * many heartbeat entries a public unauthenticated endpoint can be made to
 * generate. The body carries a CODE and a log id — never the credential, the
 * project id or a Google error message.
 *
 * SELF-CLEARING. A failed write degrades; the next successful write clears
 * it, within one probe TTL. Nothing here latches, which is the AGL-1843 rule
 * applied before the fact rather than after an incident.
 */
import { BEACON_HEARTBEAT_LOG_ID, writeBeaconHeartbeat } from '@aglyn/tenant-data-admin'
import {
  beaconHealth,
  healthBody,
  healthHeaders,
  healthHttpStatus,
  healthStatus,
  memoizeWithTtl,
  type BeaconCheck,
} from '@aglyn/aglyn/server'

// lockdown-423: exempt — infrastructure monitoring probe; no org-scoped action.

/** Never prerender, never revalidate. */

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Five minutes bounds both the Logging write volume and the probe cost
 * without letting a dead beacon hide longer than one monitor interval. The
 * uptime check runs every 15 minutes (a beacon that died needs finding within
 * the hour, not the minute), so this TTL is never the limiting factor.
 */
const PROBE_TTL_MS = 5 * 60_000

/**
 * The service name stamped on the heartbeat, matching the `serviceContext`
 * the console's real beacon reports under, so a query for one deployment's
 * heartbeats reads the same way as a query for its errors.
 */
const SERVICE = 'console-web'

const beaconProbe = memoizeWithTtl<BeaconCheck>(PROBE_TTL_MS, async () => {
  const startedAt = Date.now()
  try {
    const write = await writeBeaconHeartbeat({ service: SERVICE })
    return beaconHealth(write, BEACON_HEARTBEAT_LOG_ID, SERVICE, Date.now() - startedAt)
  } catch {
    // `writeBeaconHeartbeat` is documented never to throw; this is the belt
    // that keeps a monitoring probe from ever being the outage it reports.
    // A null result is degraded by contract — "we could not determine whether
    // the beacon works" IS the condition this endpoint exists to catch.
    return beaconHealth(null, BEACON_HEARTBEAT_LOG_ID, SERVICE, Date.now() - startedAt)
  }
})

export async function GET(): Promise<Response> {
  const checks = { beacon: await beaconProbe() }
  const status = healthStatus(checks)
  return Response.json(
    healthBody({
      service: 'console-error-beacon',
      checks,
      commit: process.env['VERCEL_GIT_COMMIT_SHA']?.slice(0, 7) ?? null,
      environment: process.env['VERCEL_ENV'] ?? 'development',
      region: process.env['VERCEL_REGION'] ?? null,
    }),
    { status: healthHttpStatus(status), headers: healthHeaders(status) },
  )
}

/** Cheap liveness for monitors that only issue HEAD. Touches nothing. */
export async function HEAD(): Promise<Response> {
  return new Response(null, {
    status: 200,
    headers: healthHeaders('ok'),
  })
}
