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
 * Did any durable rate limiter fall back recently? (AGL-1693)
 *
 * `consumeRateLimit` fails soft: a Firestore blip drops EVERY durable limiter
 * — sign-in, passkeys, password reset, email verification, org create, form
 * submit, page-protection unlock and the public REST API's per-key quota —
 * to a per-instance cap for as long as it lasts. AGL-1679 made that findable
 * afterwards by writing one marker document per episode on recovery. Nobody
 * read it: the record only helped someone who already suspected something and
 * went looking in Firestore, so a degraded window during the beta would still
 * pass unnoticed in real time. This is the reader, spoken in the same 200/503
 * contract as the sibling health endpoints, so the AGL-1502 uptime check +
 * alert + email path that already watches serving also watches this.
 *
 * **A past degradation must go green again.** Markers live 30 days, so "does
 * a marker exist" would hold this red for a month after a thirty-second blip.
 * That is the deliberate opposite of `/api/health/backups`, which stays red
 * until the bad backup is gone because a missing restore point is a condition
 * that persists (DISASTER_RECOVERY.md gap 2). A degraded limiter window is an
 * event, not a condition: the trailing window in `rateLimitsHealth` is what
 * makes this self-clearing, and the reasoning for its size lives there.
 *
 * Same three rules as the sibling health endpoints — never cached, checks the
 * real thing, cost-bounded. The query reads the `rateLimits` collection
 * itself rather than a log line about it (Vercel Hobby stdout never reaches
 * GCP Logging — the AGL-1502 honest-gaps list), over the automatic
 * single-field `lastAtMs` index, capped and memoised for 5 minutes per
 * instance. The body carries COUNTS and an age — never limiter keys, which
 * are hashed client IPs, and never bucket ids.
 */
import { getApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
// Imported for its side effect too: guarantees the firebase-admin default app
// is initialized before `getApp()` runs, exactly like the sibling health route.
import {
  DEGRADATION_DOC_PREFIX,
  firebaseAdmin,
  RATE_LIMIT_COLLECTION,
} from '@aglyn/tenant-data-admin'
import {
  healthBody,
  healthHeaders,
  healthHttpStatus,
  healthStatus,
  memoizeWithTtl,
  RATE_LIMIT_DEGRADED_WINDOW_MINUTES,
  rateLimitsHealth,
  type RateLimitDegradationMarker,
  type RateLimitsCheck,
} from '@aglyn/aglyn/server'

// lockdown-423: exempt — infrastructure monitoring probe; no org-scoped action.

/** Never prerender, never revalidate. */

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Five minutes bounds the probe cost (the endpoint is public) without letting
 * an episode hide longer than one monitor interval. The trailing window is
 * sized against this plus the check period plus the alert's sustained-failure
 * window — see `RATE_LIMIT_DEGRADED_WINDOW_MINUTES`.
 */
const PROBE_TTL_MS = 5 * 60_000

/**
 * Documents read per probe. One marker per instance per episode per minute
 * bucket, so a wide fleet in a long outage can produce many — but the verdict
 * is "any at all", and 50 is far past the count that changes the answer. The
 * cap is what stops a bad hour turning a public endpoint into a read bill.
 */
const MARKER_READ_LIMIT = 50

/**
 * `RATE_LIMIT_ALARM_MAX_CALLS` overrides the shared default (0 — any fallback
 * is degraded) without a code change: the ops knob for muting a known-noisy
 * window during an incident, and the forced-failure knob this alert path can
 * be proven with (set to -1 and every probe, including a clean one, reports
 * degraded). Unset or unparsable means the default.
 */
function configuredThreshold(): number | undefined {
  const raw = process.env['RATE_LIMIT_ALARM_MAX_CALLS']
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

const rateLimitsProbe = memoizeWithTtl<RateLimitsCheck>(
  PROBE_TTL_MS,
  async () => {
    const startedAt = Date.now()
    try {
      // Touch the facade so the import above can never be tree-shaken into
      // skipping app initialization.
      void firebaseAdmin
      const db = getFirestore(getApp())
      const cutoff =
        Date.now() - RATE_LIMIT_DEGRADED_WINDOW_MINUTES * 60_000
      // A range on ONE field, ordered by the same field: served by the
      // automatic single-field index, so this needs no composite index and no
      // `firebase-firestore.indexes.json` change. `lastAtMs` exists only on
      // markers — the counter documents carry `count`, `windowStartMs` and
      // `expiresAt` — so the query cannot pick up a live bucket. Filtering on
      // the id prefix instead would have been index-free too, but the id is
      // bucketed on `firstAtMs`, which would miss precisely the long episodes.
      const snapshot = await db
        .collection(RATE_LIMIT_COLLECTION)
        .where('lastAtMs', '>=', cutoff)
        .orderBy('lastAtMs', 'desc')
        .limit(MARKER_READ_LIMIT)
        .get()
      const markers: RateLimitDegradationMarker[] = snapshot.docs
        // Belt and braces against a future field named `lastAtMs` on a
        // counter: markers are the only ids carrying the prefix, and this
        // costs nothing because the documents are already read.
        .filter((doc: { id: string }) =>
          doc.id.startsWith(DEGRADATION_DOC_PREFIX),
        )
        .map((doc: { data: () => RateLimitDegradationMarker }) => doc.data())
      return rateLimitsHealth(
        markers,
        Date.now() - startedAt,
        Date.now(),
        configuredThreshold(),
      )
    } catch {
      // A null marker list is degraded by contract (`markers-unavailable`):
      // this reads the very collection the limiter writes, so a query failure
      // here is itself evidence that the durable limiter may be down. The
      // error is dropped — the body is public and a Firestore error message
      // can carry project ids and paths.
      return rateLimitsHealth(
        null,
        Date.now() - startedAt,
        Date.now(),
        configuredThreshold(),
      )
    }
  },
)

export async function GET(): Promise<Response> {
  const checks = { rateLimits: await rateLimitsProbe() }
  const status = healthStatus(checks)
  return Response.json(
    healthBody({
      service: 'console-rate-limits',
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
