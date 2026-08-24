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
