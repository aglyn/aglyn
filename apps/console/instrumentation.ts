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
 * Server-side error reporting for the console runtime (AGL-1921).
 *
 * PER DEPLOYMENT, deliberately — the same reason the AGL-1923 beacon
 * heartbeat is per deployment. The console and the tenant are separate
 * Vercel projects with separate admin credentials and separate env, so a
 * tenant hook proves nothing about the console one. This file is the console
 * half; `apps/tenant/instrumentation.ts` is the other, and it also carries
 * the AGL-1500 boot warm-up that this runtime has no equivalent of.
 *
 * Why this exists at all: the `aglyn-main` alerting surface had no server
 * error signal whatsoever. Every policy is a liveness probe on one URL, so
 * `/api/billing/checkout` could 500 for every paying customer while
 * `/api/health` stayed green — the single most likely shape of a launch-day
 * incident, and the one nothing could page on. Server errors lived only in
 * the Vercel runtime log, which retains ~60 minutes and drains nowhere
 * (AGL-1799).
 *
 * This is the FALLBACK arm of AGL-1921, not the fix. It cannot see an error
 * that kills the process before the handler runs, nor a platform-level 5xx
 * that never reaches our code. The Vercel log drain sees both and stays the
 * real answer; `docs/UPTIME_AND_SLA.md` carries the blind spots in writing
 * and the runbook for buying it.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routePath?: string; routeType?: string },
): Promise<void> {
  // The edge bundle (middleware) must never see firebase-admin, so the
  // import stays inside the nodejs branch.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  try {
    const { reportServerError } = await import('@aglyn/tenant-data-admin')
    const err = error as { message?: unknown; stack?: unknown; digest?: unknown }
    await reportServerError(
      {
        message: typeof err?.message === 'string' ? err.message : String(error),
        stack: typeof err?.stack === 'string' ? err.stack : undefined,
        // The route PATTERN, never `request.path`: a console path carries the
        // org slug, host id and document ids, and this payload leaves our
        // origin for a Google log.
        route: context.routePath,
        routeType: context.routeType,
        method: request.method,
        digest: typeof err?.digest === 'string' ? err.digest : undefined,
      },
      // Matches the `serviceContext.service` the console's client beacon and
      // its heartbeat already report under, so one deployment's errors group
      // together in Error Reporting regardless of which side threw.
      { service: 'console-web' },
    )
  } catch {
    // Never throw out of the error hook: this runs while a request is already
    // failing, and a throw here would replace the real error with this one.
  }
}
