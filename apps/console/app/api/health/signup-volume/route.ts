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
 * SIGNUP VOLUME — a wave, a refusal wave, and a drought (AGL-1536, AGL-2583).
 *
 * ## The name is the fix
 *
 * This lived at `/api/health/signups` and answered one question: is org
 * creation running at WAVE volume? It answers it well. But "signups: ok" reads
 * to every human being as "people can sign up", and it means nothing of the
 * kind — zero creations in an hour is this check's healthiest possible score,
 * so the monitor named "signups" reported green through the three days
 * (AGL-2581) when account creation was refused for every visitor on the
 * platform. The path is now `/api/health/signup-volume`, which is what the
 * original check measures; `/api/health/signups` still answers, forwarding
 * here, so no monitor had to be reconfigured to keep working.
 *
 * Three checks now share the endpoint and the one org-creation count:
 *
 *  - `signupVolume` — too MANY creations (AGL-1536), the abuse wave.
 *  - `signupRefusals` — refusals, and any fail-closed `unreadable` one
 *    (AGL-1907, AGL-2583).
 *  - `signupDrought` — traffic arrived at the signup page and NOT ONE
 *    account came out of it (AGL-2583). This is the one that would have
 *    caught AGL-2581 on its first hour.
 *
 * ## Below: the wave check, as it was
 *
 * The detection layer over the AGL-1534 rate limit. The limiter bounds each
 * uid (3/h) and each IP (10/h); a distributed farm holding every actor under
 * both caps is invisible to it until someone happens to look at the orgs
 * list. This makes the aggregate observable: one indexed COUNT of orgs
 * created in the trailing hour, spoken in the same 200/503 contract as the
 * sibling health endpoints, so the AGL-1502 uptime check + alert + email
 * path that already watches serving also watches signup volume. The manual
 * response is the AGL-1510 signups feature-lock (staff runbook).
 *
 * Why an endpoint and not a log-based metric: Vercel Hobby has no log
 * drains, so nothing this route family writes to stdout ever reaches GCP
 * Logging — the AGL-1502 honest-gaps list. Counting the `orgs` collection
 * directly also watches the thing itself rather than a log line about it: a
 * creation path that skips the log line still moves the count.
 *
 * Same three rules as the sibling health endpoints — never cached (the
 * response), checks the real thing, cost-bounded (the probe). The count is
 * one aggregation query over the automatic single-field `createdAt` index
 * (zero documents read), memoized for 5 minutes per instance. The body
 * carries a COUNT and the rule it was judged by — never org names, slugs or
 * owners, because this is public like its siblings.
 *
 * The verdict logic is `signupsHealth` in the shared health lib,
 * spec-covered branch by branch; the threshold reasoning lives on
 * `MAX_ORG_CREATIONS_PER_WINDOW` there.
 */
import { getApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
// Imported for its side effect too: guarantees the firebase-admin default app
// is initialized before `getApp()` runs, exactly like the sibling health route.
import {
  firebaseAdmin,
  RATE_LIMIT_COLLECTION,
  SIGNUP_REFUSAL_DOC_PREFIX,
  SIGNUP_SERVED_DOC_PREFIX,
} from '@aglyn/tenant-data-admin'
import {
  deploymentCommitRef,
  deploymentEnvironmentLabel,
  healthBody,
  healthHeadOf,
  healthHeaders,
  healthHttpStatus,
  healthStatus,
  memoizeWithTtl,
  ORG_CREATION_WINDOW_MINUTES,
  platformVersion,
  SIGNUP_DROUGHT_WINDOW_MINUTES,
  SIGNUP_REFUSAL_WINDOW_MINUTES,
  signupDroughtHealth,
  signupRefusalsHealth,
  signupsHealth,
  type SignupDroughtCheck,
  type SignupRefusalMarker,
  type SignupRefusalsCheck,
  type SignupServedMarker,
  type SignupsCheck,
} from '@aglyn/aglyn/server'

// lockdown-423: exempt — infrastructure monitoring probe; no org-scoped action.

/** Never prerender, never revalidate. */

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Five minutes bounds the probe cost (the endpoint is public) without letting
 * a wave hide longer than one monitor interval. Detection latency worst case:
 * one TTL + one check period + the alert's sustained-failure window.
 */
const PROBE_TTL_MS = 5 * 60_000

/**
 * `SIGNUP_ALARM_MAX_PER_HOUR` overrides the shared default (10/h) without a
 * code change — the ops knob for tightening during an incident, and the
 * forced-failure knob the alert path was proven with (set to -1, every count
 * is over). Unset or unparsable means the default.
 */
function configuredThreshold(): number | undefined {
  const raw = process.env['SIGNUP_ALARM_MAX_PER_HOUR']
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Orgs created in the trailing hour — the number BOTH volume checks read.
 *
 * One query, memoized once, because the wave verdict and the drought verdict
 * disagree about which direction is bad but agree entirely about the count.
 * Two probes would have doubled a public endpoint's cost to ask the same
 * question twice, and — worse — could have answered from two different
 * moments, so a body could have reported "0 created" beside "not a drought".
 */
const orgCreationsProbe = memoizeWithTtl<{ count: number | null; ms: number }>(
  PROBE_TTL_MS,
  async () => {
    const startedAt = Date.now()
    try {
      // Touch the facade so the import above can never be tree-shaken into
      // skipping app initialization.
      void firebaseAdmin
      const db = getFirestore(getApp())
      const cutoff = Timestamp.fromMillis(
        Date.now() - ORG_CREATION_WINDOW_MINUTES * 60_000,
      )
      // An aggregation, not a list: the server counts against the automatic
      // single-field `createdAt` index and returns one integer — no org
      // documents are read, so there is nothing here to leak or to pay for.
      const snapshot = await db
        .collection('orgs')
        .where('createdAt', '>', cutoff)
        .count()
        .get()
      return { count: snapshot.data().count, ms: Date.now() - startedAt }
    } catch {
      // A null count is degraded by contract (`count-unavailable`) — an alarm
      // that cannot see the thing it watches must not report calm. The error
      // is dropped: this body is public, and a Firestore error message can
      // carry project ids and paths.
      return { count: null, ms: Date.now() - startedAt }
    }
  },
)

/**
 * `SIGNUP_REFUSAL_ALARM_MAX_PER_HOUR` overrides the shared default (50/h),
 * the same knob shape as the sibling above — the ops lever for tightening
 * during an incident, and the forced-failure lever this check's red path was
 * proven with (set to -1 and every count is over).
 */
function configuredRefusalThreshold(): number | undefined {
  const raw = process.env['SIGNUP_REFUSAL_ALARM_MAX_PER_HOUR']
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * One minute-bucketed marker can be written per instance per minute, so a
 * 60-minute window is bounded by (minutes × instances). 240 is four times the
 * single-instance ceiling and keeps the probe's cost flat under a flood.
 */
const REFUSAL_MARKER_READ_LIMIT = 240

/**
 * Refused org creations in the trailing hour (AGL-1907).
 *
 * A range on ONE field ordered by the same field — served by the automatic
 * single-field index, so no composite index and no
 * `firebase-firestore.indexes.json` change. `refusedAtMs` exists only on
 * refusal markers: the live counters carry `count`/`windowStartMs` and the
 * AGL-1679 degradation markers carry `lastAtMs`, so this query cannot pick up
 * either, and — the reason for the distinct field name — the AGL-1693
 * degradation probe's `lastAtMs` range cannot pick up these.
 */
const refusalsProbe = memoizeWithTtl<SignupRefusalsCheck>(
  PROBE_TTL_MS,
  async () => {
    const startedAt = Date.now()
    try {
      void firebaseAdmin
      const db = getFirestore(getApp())
      const cutoff = Date.now() - SIGNUP_REFUSAL_WINDOW_MINUTES * 60_000
      const snapshot = await db
        .collection(RATE_LIMIT_COLLECTION)
        .where('refusedAtMs', '>=', cutoff)
        .orderBy('refusedAtMs', 'desc')
        .limit(REFUSAL_MARKER_READ_LIMIT)
        .get()
      const markers: SignupRefusalMarker[] = snapshot.docs
        // Belt and braces against a future field named `refusedAtMs` on some
        // other document in this collection; free, the docs are already read.
        .filter((doc: { id: string }) =>
          doc.id.startsWith(SIGNUP_REFUSAL_DOC_PREFIX),
        )
        .map((doc: { data: () => SignupRefusalMarker }) => doc.data())
      return signupRefusalsHealth(
        markers,
        Date.now() - startedAt,
        Date.now(),
        configuredRefusalThreshold(),
      )
    } catch {
      // Null is degraded by contract (`refusals-unavailable`) — same rule as
      // the sibling. The error is dropped: this body is public and a Firestore
      // error message can carry project ids and paths.
      return signupRefusalsHealth(
        null,
        Date.now() - startedAt,
        Date.now(),
        configuredRefusalThreshold(),
      )
    }
  },
)

/**
 * `SIGNUP_DROUGHT_MIN_TRAFFIC` overrides the shared default (5 serves), the
 * same knob shape as the two above.
 *
 * It is also this check's forced-failure lever, and it works the opposite way
 * round from its siblings: set it to **0** and any hour with zero accounts
 * created — including a perfectly healthy quiet one — reports a drought, so
 * the alert path can be proven end to end without breaking signup for anyone.
 * Unset or unparsable means the default.
 */
function configuredMinimumTraffic(): number | undefined {
  const raw = process.env['SIGNUP_DROUGHT_MIN_TRAFFIC']
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * One marker per instance per minute bucket, so a 60-minute window is bounded
 * by (minutes × instances) exactly as the refusal listing is. The verdict only
 * needs to know whether traffic cleared a single-digit floor, so a cap far
 * above that floor changes no answer while keeping the probe's cost flat under
 * a launch-day rush.
 */
const SERVED_MARKER_READ_LIMIT = 240

/**
 * Signup pages served in the trailing hour — the drought DENOMINATOR.
 *
 * The same index-free shape as its siblings: a range on ONE field ordered by
 * the same field, served by the automatic single-field index.
 * `servedAtMs` exists only on serve markers, so this query cannot pick up a
 * live counter, a degradation marker, a refusal marker or a server-error
 * marker — and none of their range queries can pick up these.
 */
const servedProbe = memoizeWithTtl<{
  markers: SignupServedMarker[] | null
  ms: number
}>(PROBE_TTL_MS, async () => {
  const startedAt = Date.now()
  try {
    void firebaseAdmin
    const db = getFirestore(getApp())
    const cutoff = Date.now() - SIGNUP_DROUGHT_WINDOW_MINUTES * 60_000
    const snapshot = await db
      .collection(RATE_LIMIT_COLLECTION)
      .where('servedAtMs', '>=', cutoff)
      .orderBy('servedAtMs', 'desc')
      .limit(SERVED_MARKER_READ_LIMIT)
      .get()
    const markers: SignupServedMarker[] = snapshot.docs
      // Belt and braces against a future field named `servedAtMs` on some
      // other document in this collection; free, the docs are already read.
      .filter((doc: { id: string }) =>
        doc.id.startsWith(SIGNUP_SERVED_DOC_PREFIX),
      )
      .map((doc: { data: () => SignupServedMarker }) => doc.data())
    return { markers, ms: Date.now() - startedAt }
  } catch {
    // Null markers are degraded by contract (`traffic-unavailable`): with no
    // denominator this check has no opinion, and a check with no opinion must
    // not spend it saying everything is fine.
    return { markers: null, ms: Date.now() - startedAt }
  }
})

export async function GET(): Promise<Response> {
  // Every probe in parallel — each memoizes independently, so a warm one
  // costs nothing and the endpoint's worst case stays one round trip.
  const [orgCreations, signupRefusals, served] = await Promise.all([
    orgCreationsProbe(),
    refusalsProbe(),
    servedProbe(),
  ])
  const signupVolume: SignupsCheck = signupsHealth(
    orgCreations.count,
    orgCreations.ms,
    configuredThreshold(),
  )
  const signupDrought: SignupDroughtCheck = signupDroughtHealth(
    served.markers,
    orgCreations.count,
    served.ms,
    configuredMinimumTraffic(),
  )
  const checks = { signupVolume, signupRefusals, signupDrought }
  const status = healthStatus(checks)
  return Response.json(
    healthBody({
      service: 'console-signup-volume',
      checks,
      commit: deploymentCommitRef(),
      // Which VERSION of the platform answered. The commit above is only
      // set off Vercel if the operator stamped it; this one is inlined
      // from package.json by every build, so a self-hoster always has
      // something to quote in a bug report (AGL-2091).
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
 * It used to return a hardcoded 200 and "touches nothing" — which made it a
 * check that could not go red, for the monitors most likely to use it. See
 * `healthHeadOf`. The probe memo is what keeps this cheap.
 */
export async function HEAD(): Promise<Response> {
  return healthHeadOf(GET)
}
