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
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  healthBody,
  healthHeaders,
  healthHttpStatus,
  healthStatus,
  memoizeWithTtl,
  type HealthCheck,
} from '@aglyn/aglyn/server'

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

export async function GET(): Promise<Response> {
  const checks = { firestore: await firestoreHealth() }
  const status = healthStatus(checks)
  return Response.json(
    healthBody({
      service: 'console',
      checks,
      // Which build answered. Without it a probe cannot tell a recovered
      // deploy from a rolled-back one, and an incident timeline has no anchor.
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
