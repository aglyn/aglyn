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
 * Boot-time Firestore warm-up for the tenant runtime (AGL-1500).
 *
 * The first render of a fresh serverless instance paid every Firestore phase
 * at 3–6× its warm cost (AGL-1152's production read: `getHost` 550–820 ms cold
 * against ~95 ms warm). That penalty is not the queries — it is shared
 * transport establishment: creating the client, negotiating the connection and
 * exchanging credentials, all of which happened lazily inside the first
 * visitor's request because nothing touched Firestore before the render did.
 *
 * `register()` runs once when the server starts — on Vercel, during function
 * initialisation, before any request is served — which makes it the one place
 * this cost can be paid OFF the visitor's critical path. Two moves, both in
 * `utils/boot-warmup.ts` (a separate module because the nx boundary lint
 * treats a lib that is ever `import()`ed as lazy-loaded everywhere — the lib
 * import must stay static, so the dynamic seam is this relative import):
 *
 * 1. `preferRest: true` on the exact Firestore instance the render path uses.
 *    Measured across six fresh-process pairs, alternating arms against
 *    production Firestore: first read ~260 ms median over gRPC with
 *    410/523 ms tails, ~220 ms over REST with no tails; steady-state reads
 *    identical. Applied at register time rather than in the shared accessor,
 *    so the accessor lib stays untouched (AGL-1490 is threading `databaseId`
 *    through it concurrently).
 *
 * 2. A fire-and-forget warm read — the same key-only `hosts` projection shape
 *    `getHost` issues — so establishment overlaps the rest of boot instead of
 *    the first TTFB.
 *
 * One `AGL-1500:boot` JSON line reports uptime-at-register and the warm
 * read's duration, so the production effect reads out of Vercel runtime logs
 * next to the `AGL-1152:render` lines that motivated it.
 *
 * Runtime guard: the edge bundle (middleware) must never see firebase-admin,
 * so the helper is only imported inside the `nodejs` branch.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  try {
    const { warmFirestoreAtBoot } = await import('./utils/boot-warmup')
    warmFirestoreAtBoot()
  } catch (error) {
    // A boot-time failure here must never take the instance down — without
    // this file the first render simply pays establishment as it always did.
    console.error('AGL-1500: boot warm-up failed to start', error)
  }
}

/**
 * Server-side error reporting (AGL-1921).
 *
 * Until now the entire server tier was outside the alerting system. Eleven
 * policies over eight uptime checks, and not one could see a server error
 * rate: they answer "is `/api/health` up", so a route can 500 for every
 * paying visitor while every check stays green. Server errors lived only in
 * the Vercel runtime log, which retains ~60 minutes and drains nowhere
 * (AGL-1799), so there was nothing in `aglyn-main` for a policy to key on.
 *
 * `onRequestError` is Next's own hook for exactly this — it fires for an
 * uncaught error in any render or route handler — so the report is made from
 * inside the process that failed, with the route pattern Next resolved rather
 * than one we re-derive. Writing straight to Cloud Logging under the admin
 * credential, rather than POSTing to our own `/api/errors`, means an incident
 * that is already breaking our routes does not need one more of them to work.
 *
 * This is AGL-1921's FALLBACK arm and does not close the issue. It cannot see
 * an error that kills the process before the handler runs, or a platform-level
 * 5xx that never reaches our code. A Vercel log drain sees both and remains
 * the real fix; `docs/UPTIME_AND_SLA.md` carries the blind spots and the
 * runbook.
 *
 * Same runtime guard as `register`: the edge bundle must never see
 * firebase-admin, so the import lives inside the `nodejs` branch.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routePath?: string; routeType?: string },
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  try {
    // Deferred by RELATIVE path for the same reason `register` above defers
    // `./utils/boot-warmup` (AGL-1921) — the lib specifier that used to be
    // here made `@nx/enforce-module-boundaries` forbid all 41 static imports
    // of `@aglyn/tenant-data-admin` across this app.
    const { reportServerError } = await import('./utils/report-server-error')
    const err = error as { message?: unknown; stack?: unknown; digest?: unknown }
    await reportServerError(
      {
        message: typeof err?.message === 'string' ? err.message : String(error),
        stack: typeof err?.stack === 'string' ? err.stack : undefined,
        // The PATTERN, never `request.path` — the resolved path carries the
        // host slug and whatever a visitor typed, and this payload leaves
        // our origin.
        route: context.routePath,
        routeType: context.routeType,
        method: request.method,
        digest: typeof err?.digest === 'string' ? err.digest : undefined,
      },
      { service: 'tenant-web' },
    )
  } catch {
    // Never throw out of the error hook: this runs while a request is already
    // failing, and a throw here would replace the real error with this one.
  }
}
