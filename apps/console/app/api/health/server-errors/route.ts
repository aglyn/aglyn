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
 * Are server errors spiking? (AGL-1921)
 *
 * The reader the `onRequestError` hook never had. The hook forwards every
 * uncaught render/route-handler error to a `server-errors` log in
 * `aglyn-main`, which is the right sink for triage and a sink nothing in this
 * repo can read: measured 2026-08-24, the production credential is refused
 * `entries:list` on that log with `403 Permission denied for all log views`.
 * A signal written where only a hand-created GCP policy could ever see it is
 * the AGL-2486 failure one layer up — `/api/health/crons` was RIGHT about a
 * broken job for fifty-one hours and nobody asked it.
 *
 * So the hook also counts into `rateLimits/serverError_{minute}` markers, and
 * this grades them into the same 200/503 contract every sibling health
 * endpoint speaks. That hands the signal to readers that already exist and
 * already run: the 15-minute GitHub uptime probe (`.github/workflows/
 * uptime-probe.yml`, which fails the run on a 503), the external keyword
 * monitors, and `docs.aglyn.com/status`. None of them needs configuring in
 * GCP, which is what makes this shippable before the freeze.
 *
 * **ONE endpoint for BOTH deployments, deliberately** — the opposite choice
 * from `/api/health/error-beacon`, which is per deployment. That one probes a
 * CREDENTIAL, and the console's credential says nothing about the tenant's, so
 * it must run in each runtime. This reads a COUNT out of a shared store, and
 * both deployments write into it: a second copy on the tenant would read the
 * same documents and produce the same verdict, i.e. a second alert for one
 * event. `checks.serverErrors.byService` is what tells the two apart, and this
 * endpoint being on the console means a tenant runtime too broken to answer
 * anything still has its errors counted somewhere that answers.
 *
 * **What it cannot see**, unchanged by any of the above: an error that kills
 * the process before the hook runs, a platform-level 5xx that never reaches
 * our code (function timeout, OOM, cold-start 502), anything thrown in the
 * edge runtime. The Vercel log drain sees all three and is still the real fix.
 * `docs/UPTIME_AND_SLA.md` carries the list where an incident will read it.
 *
 * Same three rules as the sibling health endpoints — never cached, checks the
 * real thing (the markers themselves, not a log line about them), cost-bounded
 * via the automatic single-field `erroredAtMs` index, a read cap and a
 * five-minute memo. The body carries COUNTS and a deployment name; never a
 * message, a stack or a route pattern, all of which stay in the Logging entry.
 */
import { getApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
// Imported for its side effect too: guarantees the firebase-admin default app
// is initialized before `getApp()` runs, exactly like the sibling health route.
import {
  firebaseAdmin,
  RATE_LIMIT_COLLECTION,
  SERVER_ERROR_DOC_PREFIX,
} from '@aglyn/tenant-data-admin'
import {
  deploymentCommitRef,
  healthBody,
  healthHeadOf,
  healthHeaders,
  healthHttpStatus,
  healthStatus,
  memoizeWithTtl,
  platformVersion,
  SERVER_ERROR_WINDOW_MINUTES,
  serverErrorsHealth,
  type ServerErrorMarker,
  type ServerErrorsCheck,
} from '@aglyn/aglyn/server'

// lockdown-423: exempt — infrastructure monitoring probe; no org-scoped action.

/** Never prerender, never revalidate. */

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Five minutes bounds the probe cost (the endpoint is public) without letting
 * a spike hide longer than one monitor interval. The trailing window is sized
 * against this plus the check period plus the alert's sustained-failure
 * window — see `SERVER_ERROR_WINDOW_MINUTES`.
 */
const PROBE_TTL_MS = 5 * 60_000

/**
 * Documents read per probe. One marker per minute bucket per writing instance,
 * coalesced to at most twelve writes a minute each, so a wide fleet in a long
 * spike can produce many — but the verdict crosses its threshold in the first
 * few, and 60 covers a full 30-minute window at one marker a minute with room
 * over. The cap is what stops a bad half hour turning a public endpoint into a
 * read bill.
 */
const MARKER_READ_LIMIT = 60

/**
 * `SERVER_ERROR_ALARM_MAX_ERRORS` overrides the shared default without a code
 * change — the ops knob for muting a known-noisy window during an incident,
 * and the FORCED-FAILURE knob this alert path can be proven with in
 * production: set it to `-1` and every probe, including a clean one, reports
 * `server-error-spike`, so the monitor → email path can be observed firing
 * without anyone having to break a real route. An alarm nobody has seen fire
 * is an alarm nobody should trust. Unset or unparsable means the default.
 */
function configuredThreshold(): number | undefined {
  const raw = process.env['SERVER_ERROR_ALARM_MAX_ERRORS']
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

const serverErrorsProbe = memoizeWithTtl<ServerErrorsCheck>(
  PROBE_TTL_MS,
  async () => {
    const startedAt = Date.now()
    try {
      // Touch the facade so the import above can never be tree-shaken into
      // skipping app initialization.
      void firebaseAdmin
      const db = getFirestore(getApp())
      const cutoff = Date.now() - SERVER_ERROR_WINDOW_MINUTES * 60_000
      // A range on ONE field, ordered by the same field: served by the
      // automatic single-field index, so this needs no composite index and no
      // `firebase-firestore.indexes.json` change. `erroredAtMs` exists only on
      // these markers — the AGL-1679 degradation markers carry `lastAtMs`, the
      // AGL-1907 refusal markers carry `refusedAtMs`, and the live counters
      // carry neither — so the three probes' reads stay disjoint at the index
      // level and one signal's flood can never fill another's limit.
      const snapshot = await db
        .collection(RATE_LIMIT_COLLECTION)
        .where('erroredAtMs', '>=', cutoff)
        .orderBy('erroredAtMs', 'desc')
        .limit(MARKER_READ_LIMIT)
        .get()
      const markers: ServerErrorMarker[] = snapshot.docs
        // Belt and braces against a future document carrying `erroredAtMs`:
        // costs nothing, because the documents are already read.
        .filter((doc: { id: string }) =>
          doc.id.startsWith(SERVER_ERROR_DOC_PREFIX),
        )
        .map((doc: { data: () => ServerErrorMarker }) => doc.data())
      return serverErrorsHealth(
        markers,
        Date.now() - startedAt,
        Date.now(),
        configuredThreshold(),
      )
    } catch {
      // ⚠️ Null, NEVER an empty array. `serverErrorsHealth(null, …)` reports
      // `errors-unavailable` and degrades; `[]` would report a confident zero
      // errors — the swallowed-query-as-measured-zero shape, on the one check
      // where a false calm is the whole failure being guarded against. The
      // error itself is dropped: the body is public and a Firestore error
      // message can carry project ids and paths.
      return serverErrorsHealth(
        null,
        Date.now() - startedAt,
        Date.now(),
        configuredThreshold(),
      )
    }
  },
)

export async function GET(): Promise<Response> {
  const checks = { serverErrors: await serverErrorsProbe() }
  const status = healthStatus(checks)
  return Response.json(
    healthBody({
      service: 'console-server-errors',
      checks,
      commit: deploymentCommitRef(),
      // Which VERSION of the platform answered. The commit above is only
      // set off Vercel if the operator stamped it; this one is inlined
      // from package.json by every build, so a self-hoster always has
      // something to quote in a bug report (AGL-2091).
      version: platformVersion(),
      environment: process.env['VERCEL_ENV'] ?? 'development',
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
