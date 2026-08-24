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
 * WHAT the uptime probe watches — separated from the probing itself so it can
 * be asserted without running it (AGL-1617).
 *
 * `probe-uptime.mjs` is a script: it probes at import time and calls
 * `process.exit`. A test that imported it to read its target list would fire
 * a real production sweep as a side effect, so the list it sweeps lives here
 * instead and the script imports it.
 */

/**
 * The two deployments, and the hostname each is measured through.
 *
 * ⚠️ The tenant entry is `.app`, and the distinction is not cosmetic
 * (AGL-1617). `demo.aglyn.com` is a WORKSPACE-subdomain shape: the tenant
 * middleware resolves `*.aglyn.com` names as custom domains via the `cname--`
 * sentinel, there is no host doc named `demo.aglyn.com`, and its root
 * therefore `404`s — documented as such in
 * `docs/design/agl-1311-primary-domain-model.md`. Published sites live on the
 * `*.aglyn.app` tenant apex, where the middleware strips the apex and
 * resolves the label.
 *
 * The probe read only `/api/health` on that hostname, and health routes are
 * host-independent — so for as long as the target was wrong the probe was
 * green on a hostname that served no page at all. Fixing the TLD is half the
 * repair; `SUBSYSTEM_HEALTH` below is the other half, and the one that makes
 * the mistake self-correcting.
 */
export const DEFAULT_TARGETS = [
  ['console', 'https://app.aglyn.com'],
  ['tenant', 'https://demo.aglyn.app'],
]

/**
 * The SUBSYSTEM health endpoints, per target name.
 *
 * ⚠️ These existed for weeks with no reader, which is the whole reason this
 * list is here (AGL-2486). `/api/health` aggregates exactly one check —
 * `firestore` — so a probe that reads only the root answers "is the console
 * serving requests", and every subsystem detector built on top of it
 * (AGL-1490 backups, AGL-1955 cron beats, the billing webhook, the signup
 * funnel, rate limits, the error beacon) reported into nothing.
 *
 * The cost of that was measured, not hypothesised: `campaigns-process-
 * scheduled` was answered with a 429 firewall challenge on every run for
 * FIFTY-ONE HOURS. `/api/health/crons` had it right the whole time —
 * `job-silent`, 503 — and no reader ever asked. Meanwhile `Uptime probe` was
 * green every fifteen minutes, which is worse than no board at all.
 *
 * ## The render canaries are on this list for exactly that reason
 *
 * `/api/health/render/{site,marketing}` were built (AGL-2486) to replace the
 * two dead GCP uptime checks that fetched a REAL PAGE and had been answered
 * with a 429 Bot Protection checkpoint since 2026-08-21. They work. Nothing
 * read them: this list named only `error-beacon`, and the docs status page's
 * `DOCS_STATUS_TARGETS` was unset in production, so the page reported "not
 * configured to check any services". The replacement for two dead checks was
 * itself dark — the same written-but-never-read shape one layer up.
 *
 * Both readers exist as of 2026-08-24 (AGL-2496): this list names them, and
 * `DOCS_STATUS_TARGETS` is now set on the `aglyn-docs` Vercel project so
 * `docs.aglyn.com/status` renders a card per target. There is also an external
 * keyword monitor per target. **None of that is asserted by this file** — the
 * env var lives in a Vercel project and a build agent cannot read it, so the
 * only in-repo signal remains the build-time warning in
 * `apps/docs/docusaurus.config.ts`, which is a log line nobody is obliged to
 * read. Re-confirm the page renders targets before quoting it as monitoring;
 * `docs/UPTIME_AND_SLA.md` says how.
 *
 * A page render reached through `/api/*` is also the only way to observe "a
 * site still renders" from outside, since page routes are challenged for
 * non-JS clients — which is what killed the GCP checks. So the probe now
 * measures a render rather than mere liveness.
 *
 * ⚠️ It does NOT thereby validate the hostname it was reached through, and
 * assuming otherwise is the trap this whole issue is about. The canary
 * resolves its OWN subject from `AGLYN_CANARY_SITE_HOST || AGLYN_TENANT_DEMO
 * || 'demo'`, internally, with no HTTP round trip — measured 2026-08-23,
 * `https://demo.aglyn.com/api/health/render/site` answers `200 host=demo
 * nodeCount=107` while `https://demo.aglyn.com/` answers `404` to the same
 * client carrying the same bypass token. Every route on this list is
 * host-independent in exactly that way. Nothing the probe fetches can tell
 * you the base is a hostname that serves pages — that line is held by
 * `uptime-targets.test.mjs`, at review time rather than at runtime.
 *
 * A name with no entry contributes no extra requests, so a bare-URL or
 * localhost invocation still probes only the root.
 */
export const SUBSYSTEM_HEALTH = {
  console: [
    '/api/health/crons',
    '/api/health/backups',
    '/api/health/billing',
    '/api/health/signups',
    '/api/health/rate-limits',
    '/api/health/error-beacon',
    // Are server errors spiking (AGL-1921)? ONE entry for BOTH deployments:
    // the check reads a shared Firestore counter that the console and the
    // tenant hooks both write into, so a tenant copy would read the same
    // documents and produce a second alert for one event. The body's
    // `byService` is what tells the two apart.
    '/api/health/server-errors',
  ],
  // The tenant app ships the beacon and both render canaries; the rest are
  // console-side.
  tenant: [
    '/api/health/error-beacon',
    '/api/health/render/site',
    '/api/health/render/marketing',
  ],
}

/**
 * Expand targets into the flat list of probes to run.
 *
 * Root first, then each subsystem, named so the log line says WHICH one is
 * out — `console/crons` rather than a second `console` row the reader has to
 * disambiguate by URL.
 */
export function buildPlan(targets, subsystems = SUBSYSTEM_HEALTH) {
  return targets.flatMap(([name, base]) => [
    [name, base, '/api/health'],
    ...(subsystems[name] ?? []).map((path) => [
      `${name}/${path.slice('/api/health/'.length)}`,
      base,
      path,
    ]),
  ])
}

/**
 * Every render canary the tenant app ships must have a reader here.
 *
 * `canaryRoutes` are the route names found under
 * `apps/tenant/app/api/health/render/` — read from the filesystem by the
 * test, never enumerated by hand, so adding a third canary fails this until
 * somebody points a monitor at it. That is the guard: the defect it exists
 * for was not a wrong path, it was a working endpoint nobody ever fetched,
 * and a hand-written list cannot notice the next one.
 */
export function evaluateCanaryReaders(
  canaryRoutes,
  subsystems = SUBSYSTEM_HEALTH,
) {
  const watched = new Set(Object.values(subsystems).flat())
  const unread = [...canaryRoutes]
    .map((name) => `/api/health/render/${name}`)
    .filter((path) => !watched.has(path))
    .sort()
  return { ok: unread.length === 0, unread }
}

/**
 * Reclassify a subsystem 404 as PENDING PROMOTION rather than DOWN (AGL-1921).
 *
 * This list lives on `main`; the URLs it names are PRODUCTION, promoted
 * separately. So between merging a new health endpoint and promoting it, the
 * probe asks production for a route that build does not serve and gets a 404 —
 * and calling that DOWN fails a run every fifteen minutes over a fact about
 * the deploy queue. That is exactly the "fails for reasons unrelated to what it
 * monitors" failure `.github/workflows/uptime-probe.yml`'s own header warns
 * about, and every false alarm makes the next real one easier to ignore.
 *
 * Narrow on purpose, and each clause is load-bearing:
 *
 *  - a SUBSYSTEM row only (the root is never pending — a base URL that 404s is
 *    a wrong base URL, which is the AGL-786 defect);
 *  - a 404 only (a 500 or a 503 from a route that DOES exist stays DOWN);
 *  - only while that target's own ROOT is UP. A deployment that is actually
 *    down does not 404 selectively, it fails everything — so this can never
 *    launder a real outage into a green board.
 *
 * The hole it would otherwise open — a path left on the list after its route
 * was deleted, reporting PENDING forever, which is silence wearing a monitor's
 * clothes — is closed at REVIEW time by `evaluateSubsystemReaders`'s `missing`
 * arm. Do not remove one without the other.
 *
 * Mutates and returns `results`; a row it changes carries `pending: true`.
 */
export function markPendingDeployments(results) {
  const rootUp = new Map(
    results.filter((r) => !r.name.includes('/')).map((r) => [r.name, r.ok]),
  )
  for (const result of results) {
    const target = result.name.split('/')[0]
    if (
      result.name.includes('/') &&
      result.status === 404 &&
      rootUp.get(target) === true
    ) {
      result.pending = true
      result.ok = true
      result.detail =
        'PENDING — this deployment does not serve it yet (promote main)'
    }
  }
  return results
}

/**
 * Every subsystem health endpoint EITHER app ships must have a reader here
 * (AGL-1921).
 *
 * The generalisation of `evaluateCanaryReaders`, and it exists because that
 * guard was too narrow twice over. It watches `/api/health/render/*` only, so
 * the six console subsystem endpoints it does not cover could each have been
 * built dark — which is precisely what happened to all of them for weeks
 * (AGL-2486), and to `/api/health/crons` for the fifty-one hours it was
 * correctly reporting a broken job that nobody asked it about. A hand-written
 * list cannot notice the next one; this is derived from the FILESYSTEM, so the
 * NEXT health endpoint anybody adds fails this suite until a monitor points at
 * it.
 *
 * `routesByTarget` maps a target name to the route paths that target's app
 * actually serves under `/api/health/` — read from disk by the test, never
 * enumerated by hand. The root `/api/health` is excluded by the caller: it is
 * probed unconditionally by `buildPlan` and so has a reader by construction.
 *
 * ## It checks BOTH directions, and the second one is load-bearing
 *
 * `unread` is an endpoint on disk that nothing probes — the AGL-2486 defect.
 * `missing` is the inverse: a path on the watch list that no app serves. That
 * matters because `probe-uptime.mjs` tolerates a 404 on a subsystem path while
 * the target's root is up, reporting it PENDING rather than DOWN — main can
 * name an endpoint days before production is promoted to serve it, and a red
 * board for a fact about the deploy queue is the false alarm that gets a
 * monitor ignored. That tolerance would be a hole if a path could stay on the
 * list after the route was deleted or renamed: it would report PENDING
 * forever, which is silence. This is what closes it, at review time.
 */
export function evaluateSubsystemReaders(
  routesByTarget,
  subsystems = SUBSYSTEM_HEALTH,
) {
  const unread = []
  const missing = []
  for (const [target, routes] of Object.entries(routesByTarget)) {
    const watched = new Set(subsystems[target] ?? [])
    for (const path of routes) {
      if (!watched.has(path)) unread.push(`${target}${path}`)
    }
    const onDisk = new Set(routes)
    for (const path of watched) {
      if (!onDisk.has(path)) missing.push(`${target}${path}`)
    }
  }
  unread.sort()
  missing.sort()
  return { ok: unread.length === 0 && missing.length === 0, unread, missing }
}
