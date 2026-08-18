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
 * Is org creation running at wave volume? (AGL-1536)
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
 * (zero documents read), memoised for 5 minutes per instance. The body
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
} from '@aglyn/tenant-data-admin'
import {
  healthBody,
  healthHeaders,
  healthHttpStatus,
  healthStatus,
  memoizeWithTtl,
  ORG_CREATION_WINDOW_MINUTES,
  SIGNUP_REFUSAL_WINDOW_MINUTES,
  signupRefusalsHealth,
  signupsHealth,
  type SignupRefusalMarker,
  type SignupRefusalsCheck,
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

const signupsProbe = memoizeWithTtl<SignupsCheck>(PROBE_TTL_MS, async () => {
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
    return signupsHealth(
      snapshot.data().count,
      Date.now() - startedAt,
      configuredThreshold(),
    )
  } catch {
    // A null count is degraded by contract (`count-unavailable`) — an alarm
    // that cannot see the thing it watches must not report calm. The code is
    // stable and the error is dropped: this body is public, and a Firestore
    // error message can carry project ids and paths.
    return signupsHealth(null, Date.now() - startedAt, configuredThreshold())
  }
})

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

export async function GET(): Promise<Response> {
  // Both probes, in parallel — each memoises independently, so a warm one
  // costs nothing and the endpoint's worst case stays one round trip.
  const [signups, signupRefusals] = await Promise.all([
    signupsProbe(),
    refusalsProbe(),
  ])
  const checks = { signups, signupRefusals }
  const status = healthStatus(checks)
  return Response.json(
    healthBody({
      service: 'console-signups',
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
