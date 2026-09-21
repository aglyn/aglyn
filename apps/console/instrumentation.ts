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

// STATIC, unlike the deferred relative imports below. Deferring a lib by its
// own specifier makes nx treat it as lazy-loaded everywhere, which is what
// the AGL-1921 note below describes costing this app its 181 static imports
// of `@aglyn/tenant-data-admin`. Nothing in this subpath touches
// firebase-admin, so the edge bundle is unaffected.
import { registerPluginDeclarationsRepair } from '@aglyn/aglyn/plugin-manager/record-captured-contact'
import { registerPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'

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
/**
 * Boot (AGL-2939): the plugins' declarations — billing and access keys,
 * activity codes, settings schemas, platform-event subscriptions — are
 * registered once per server instance, before the first request, so a core
 * route that never loads a plugin's API surface still folds its add-on and
 * raises its events into a subscribed handler. The manifest is generated
 * and loads each plugin's light declarations module; nothing heavy runs
 * here.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  /*
   * The same boot step, offered to a capture door that finds nobody keeping
   * people (AGL-3080).
   *
   * The `catch` below is deliberate, and it means a bad boot leaves a process
   * where every capture answers "this workspace keeps no records", no contact
   * is ever written, and nothing is red. Core cannot run the step itself: the
   * manifest names every plugin, which is the one import core may not make.
   * So it is handed over, here, before the step it repairs.
   */
  registerPluginDeclarationsRepair(async () => {
    const { registerPluginServerDeclarations } = await import(
      './constants/plugins.declarations.server.generated'
    )
    await registerPluginServerDeclarations()
  })

  /*
   * And the one capability this app offers plugins on the server (AGL-3080):
   * dropping a site's cached pages.
   *
   * A marketplace revocation is the caller. The plugin knows WHICH sites —
   * its own install pins, its own tiers — and this app knows HOW to drop
   * one, because that takes the tenant's revalidation paths and cache tags.
   * Neither half is guessable from the other side.
   *
   * Installed HERE rather than inside a route, because a route that
   * registered it would leave every other route in the process resolving
   * "no cache to drop" — which is exactly the zero that reads as an answer
   * (AGL-3025), and on this path it means a revoked plugin quietly kept
   * serving. The deferred imports keep firebase-admin out of the edge
   * bundle, as everything else in this file does.
   */
  registerPluginSiteCache(
    {
      drop: async ({ hostIds, reason }) => {
        const [{ dropSiteCaches }, { firebaseAdmin }] = await Promise.all([
          import('./utils/server/tenant-revalidate'),
          import('@aglyn/tenant-data-admin'),
        ])
        const { hosts, hostsDropped } = await dropSiteCaches(
          firebaseAdmin.app().firestore(),
          { hostIds, reason },
        )
        return {
          dropped: hosts.length,
          skipped: hostsDropped,
          // The fan-out never throws and each site is best effort, so
          // reaching the end IS the completion this contract means: every
          // site we were given was attempted.
          complete: true,
        }
      },
    },
    { pluginId: 'console' },
  )

  // Logged, not thrown: a declaration that fails to load costs its plugin's
  // keys and events, and a boot that throws costs every route.
  try {
    const { registerPluginServerDeclarations } = await import(
      './constants/plugins.declarations.server.generated'
    )
    await registerPluginServerDeclarations()
  } catch (error) {
    console.error('[instrumentation] plugin declarations failed', error)
  }
}

export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routePath?: string; routeType?: string },
): Promise<void> {
  // The edge bundle (middleware) must never see firebase-admin, so the
  // import stays inside the nodejs branch.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  try {
    // Deferred by RELATIVE path, never as `@aglyn/tenant-data-admin` directly
    // (AGL-1921): nx treats a lib that is ever `import()`ed as lazy-loaded
    // everywhere, and the lib specifier here made
    // `@nx/enforce-module-boundaries` forbid all 181 static imports of it
    // across this app. `utils/report-server-error.ts` holds the static import;
    // deferring that file keeps firebase-admin out of the edge bundle just the
    // same, and registers no lib-level lazy edge.
    const { reportServerError } = await import('./utils/report-server-error')
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
