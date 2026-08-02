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
 * Is the tenant runtime serving? (AGL-1102)
 *
 * The console being up is our convenience; THIS is the one customers notice.
 * A tenant outage takes every published site down at once, so uptime here is
 * the number an SLA would actually be measured on.
 *
 * Same three rules as the console's `/api/health`, for the same reasons — not
 * cached at any layer, checks a real dependency, and bounded so a public
 * endpoint cannot be turned into a bill. See that file for the full argument.
 *
 * One thing deliberately NOT done here: this does not resolve a host from the
 * request. Tenant routes normally do, and it would make the check richer — but
 * it would also make the endpoint's health depend on which hostname a monitor
 * happened to probe, so a single misconfigured domain would read as a total
 * outage. Uptime asks whether the runtime is serving, not whether one site is
 * configured.
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
const PROBE_DOC = 'tenant-health-probe-does-not-exist'

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
      service: 'tenant',
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
