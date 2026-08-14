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
 * Is the console actually serving? (AGL-1102)
 *
 * The SLA work starts here rather than at a percentage, because there is
 * nothing to commit to yet: no endpoint, no probe, no history. A number
 * published before any of that exists is a promise measured by nobody.
 *
 * Three things this has to get right, and each is a way health checks
 * routinely lie:
 *
 * 1. IT MUST NOT BE CACHED. A cached health check returns 200 from the edge
 *    while the origin is on fire, and every graph stays green through the
 *    outage. `force-dynamic` stops Next from caching the render;
 *    `Cache-Control: no-store` stops the CDN and any proxy in between. Three
 *    separate caches have faked a green check in this repo already
 *    (AGL-1062, AGL-1076, AGL-1088) — this one is worth over-defending.
 *
 * 2. IT MUST CHECK A DEPENDENCY. "The function booted" is a fact Vercel
 *    already knows and nobody is paged for. What actually takes the console
 *    down is Firestore, so that is what gets touched.
 *
 * 3. IT MUST NOT BECOME A BILL. It is public and unauthenticated, so an
 *    unthrottled dependency check is a free amplifier — anyone could turn a
 *    loop into Firestore reads on our account. The probe result is memoised
 *    per instance for `PROBE_TTL_MS`, which bounds the cost to roughly one
 *    read per instance per interval no matter how hard it is hit.
 *
 * The STATUS CODE is the contract. Most uptime monitors look at nothing else,
 * so a degraded dependency returns 503 rather than a 200 whose body says
 * "degraded" — a body nobody parses is not a signal.
 */
import {
  firebaseAdmin,
  probeMediaVariantSupport,
} from '@aglyn/tenant-data-admin'
import {
  healthBody,
  healthHeaders,
  healthHttpStatus,
  healthStatus,
  memoizeWithTtl,
  type HealthCheck,
} from '@aglyn/aglyn/server'

// lockdown-423: exempt — infrastructure liveness probe; unauthenticated by design.

/** Never prerender, never revalidate — property 1 above. */

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * How long a dependency result is reused within one instance: short enough
 * that a real outage surfaces within a probe interval, long enough that
 * request volume cannot drive cost.
 */
const PROBE_TTL_MS = 15_000

/** A slug that deliberately does not exist. */
const PROBE_DOC = 'console-health-probe-does-not-exist'

/**
 * Read a document that is meant to be missing.
 *
 * A missing document is a SUCCESSFUL read: it proves credentials, network and
 * the Firestore API all work, needs no fixture, cannot be broken by someone
 * renaming a workspace, and returns almost nothing.
 */
const firestoreHealth = memoizeWithTtl<HealthCheck>(PROBE_TTL_MS, async () => {
  const startedAt = Date.now()
  try {
    await firebaseAdmin.app().firestore().collection('orgSlugs').doc(PROBE_DOC).get()
    return { ok: true, ms: Date.now() - startedAt }
  } catch (error) {
    // The CODE only. This endpoint is public, and an error message can carry
    // project ids or paths.
    return {
      ok: false,
      ms: Date.now() - startedAt,
      code: String((error as { code?: string })?.code ?? 'unknown'),
    }
  }
})

/**
 * Can this deployment encode an image variant? (AGL-1468)
 *
 * Every WebP variant on the platform is produced by these functions, and
 * production went three weeks generating none of them: 1 of 180 media
 * documents has a non-empty `variants` array, and the last success was
 * 2026-07-19. The failure was environmental — the same source produced
 * variants before that date and stopped — and the only report was a
 * `console.error` in a log retained for about an hour, so by the time anyone
 * asked why, the answer was gone.
 *
 * An upload is a bad probe for that. It needs a session, an entitled org, a
 * bucket write and, in practice, a customer noticing their thumbnails are
 * full-size. This needs a GET, touches no storage and no database, and runs
 * in the same runtime with the same `import('sharp')`.
 *
 * DELIBERATELY NOT IN `checks`. `healthStatus` is "degraded if ANY check
 * failed" and drives a 503, which is the right rule for Firestore and the
 * wrong one here: variant generation being unavailable is a degraded
 * optimization, not an outage. Paging on it would teach everyone to ignore
 * the endpoint, which is how a health check starts lying.
 */
const imagingHealth = memoizeWithTtl<HealthCheck>(PROBE_TTL_MS, async () => {
  const startedAt = Date.now()
  const result = await probeMediaVariantSupport()
  return { ...result, ms: Date.now() - startedAt }
})

export async function GET(): Promise<Response> {
  const checks = { firestore: await firestoreHealth() }
  const status = healthStatus(checks)
  const body = healthBody({
    service: 'console',
    checks,
    // Which build answered. Without it a probe cannot tell a recovered
    // deploy from a rolled-back one, and an incident timeline has no anchor.
    commit: process.env['VERCEL_GIT_COMMIT_SHA']?.slice(0, 7) ?? null,
    environment: process.env['VERCEL_ENV'] ?? 'development',
    region: process.env['VERCEL_REGION'] ?? null,
  })
  return Response.json(
    // Reported alongside the body rather than merged into `checks`, so it is
    // readable by anything that wants it and cannot move the status code.
    { ...body, imaging: await imagingHealth() },
    { status: healthHttpStatus(status), headers: healthHeaders(status) },
  )
}

/**
 * Preflight, so a cross-origin reader that sets any header still works.
 *
 * A plain GET is a "simple request" and never preflights, so the status page
 * does not need this — but a monitor that adds one custom header would, and
 * discovering that during an incident is the wrong time.
 */
export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      ...healthHeaders('ok'),
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    },
  })
}

/** Cheap liveness for monitors that only issue HEAD. Touches nothing. */
export async function HEAD(): Promise<Response> {
  return new Response(null, {
    status: 200,
    headers: healthHeaders('ok'),
  })
}
