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
 * IS A PAGE ROUTE THROWING? — the question a 200 cannot answer (AGL-2709).
 *
 * `lib/front-door.mjs` closed "no monitor fetches a page". It did not close,
 * and says so in its own words, the state underneath it: **Next serves a
 * cached document while every fresh render fails.** A visitor gets 200 from
 * the ISR entry, `x-vercel-cache` says `HIT` or `STALE`, and the regeneration
 * that would replace it throws every time. A monitor that asks only "did a
 * visitor get a page" answers yes for as long as that entry survives, which
 * is not bounded by the route's `revalidate` — a stale entry Vercel cannot
 * replace is served indefinitely.
 *
 * The signal that DOES answer it already exists and already caught this. On
 * 2026-09-09 the Vercel log drain forwarded 22 entries reading
 * `route=/[host]/[[...slug]] status=500 project=aglyn-tenant` between 04:02:13
 * and 04:09:16 UTC, and GCP's log-match policy fired on them in about ninety
 * seconds. Every other check on the board — both render canaries, both page
 * monitors, all thirteen uptime checks — was green.
 *
 * This module is the reader that stream never had. It splits the drain's 5xx
 * by ROUTE, because the split is the whole of the value:
 *
 * ## A page-route 5xx is an incident. A health-route 503 is a health check.
 *
 * Measured over the 48 hours of production record to 2026-09-09, the drain
 * forwarded **251** entries. **229 of them were `/api/health/*` answering 503**
 * — `crons` (113), `funnel` (73), `server-errors` (18) — which is not a
 * failure at all: 503 is what `healthHttpStatus` returns when a health
 * contract reports degraded, and every one of those routes has a monitor
 * reading it already. The remaining **22** were the outage.
 *
 * So the one signal that saw the outage arrives in a stream that is **91%
 * deliberate 503s**, and the policy on it (`Server errors: Vercel runtime 5xx
 * via log drain`, filter `logName=~"vercel" AND severity>=ERROR`, rate-limited
 * to one notification an hour) emails about them for as long as any subsystem
 * is degraded. `/api/health/crons` was correctly reporting a broken job for six
 * hours on 2026-09-07; that is six hours of "server errors" mail about a
 * working health check, arriving in the same inbox that had to notice 04:02.
 *
 * `isHealthContractEntry` in `vercel-log-drain.ts` now declines to forward a
 * clean health-contract 503 at all, for the same reason and by the same rule
 * as the lockdown notice. This grader excuses it a second time, on the reading
 * side, so a window that spans deployments of the receiver still reads
 * correctly.
 *
 * ## Zero tolerated on a page route, and that is measured rather than brave
 *
 * `MAX_SERVER_ERRORS_PER_WINDOW = 5` is right where it lives: it counts every
 * uncaught error across both deployments, including route handlers, where one
 * cold-start deadline on a good day is not news. This counts 5xx on the routes
 * that render PAGES, and the production record above puts the organic rate of
 * those at exactly zero outside the incident. Same argument the rate-limiter
 * and billing alarms make for their own zero: a healthy deployment exercises
 * this exactly never.
 *
 * ⚠️ **What that means for false alarms, stated plainly.** At `tolerated = 0`
 * a single transient page 500 — one Firestore deadline inside one render —
 * reads red. That is correct for the triage tool this is (`check-render-
 * errors.mjs`, run over a window by a person or an agent who is asking the
 * question), and it is NOT correct for a pager, which is why nothing here is
 * wired to one. `docs/UPTIME_AND_SLA.md` carries the threshold to use, and the
 * IAM grant to apply, if it ever is.
 */

/**
 * Routes under this prefix are handlers, not pages.
 *
 * A PREFIX rather than a list of our page patterns, deliberately. The AGL-2708
 * fix moves the catch-all from `/[host]/[[...slug]]` to
 * `/[host]/[scheme]/[[...slug]]` — a check that named the route it was written
 * against would have gone blind the moment the bug it was written for was
 * fixed.
 */
const API_PREFIX = '/api/'

/**
 * The health contract's own routes, whose 503 is a verdict and not a fault.
 *
 * Matched as a path prefix rather than a string prefix, exactly as
 * `isHealthContractEntry` matches it on the writing side: a future
 * `/api/healthcheck` would be a different route with no such guarantee about
 * its status.
 */
const HEALTH_PREFIX = '/api/health'

/** `/api/health` itself, or anything beneath it. Never a sibling that shares letters. */
function isHealthRoute(route) {
  return route === HEALTH_PREFIX || route.startsWith(`${HEALTH_PREFIX}/`)
}

/**
 * Classifications, in the order the grader cares about them.
 *
 * `page` is the only one that grades. The other two are counted and printed —
 * a reader who cannot see what was excused cannot tell a quiet window from a
 * filter that swallowed everything, and a monitoring path that hides its own
 * lossiness is the bug shape this repo keeps rediscovering.
 */
export const PAGE = 'page'
export const HANDLER = 'handler'
export const HEALTH_CONTRACT = 'health-contract'

/** The fields this module reads out of one drained entry. */
function normalize(entry) {
  const payload = entry?.jsonPayload ?? entry ?? {}
  const status =
    typeof payload.statusCode === 'number'
      ? payload.statusCode
      : typeof payload.proxyStatusCode === 'number'
        ? payload.proxyStatusCode
        : null
  return {
    route: typeof payload.route === 'string' ? payload.route : null,
    project: typeof payload.project === 'string' ? payload.project : null,
    host: typeof payload.host === 'string' ? payload.host : null,
    environment:
      typeof payload.environment === 'string' ? payload.environment : null,
    level: typeof payload.level === 'string' ? payload.level : null,
    status,
    proxyStatus:
      typeof payload.proxyStatusCode === 'number'
        ? payload.proxyStatusCode
        : null,
    timestamp: entry?.timestamp ?? null,
  }
}

/**
 * Which kind of route produced this entry.
 *
 * A `fatal` line is never excused, whatever its route: `fatal` is the
 * edge-runtime and process-death shape, and a health route that dies is not a
 * health route reporting. Same narrowing as `isLockdownNoticeEntry`, for the
 * same reason — an exemption that swallows a crash makes the route
 * unwatchable.
 *
 * An entry with no route at all is a `handler`, never a `page`. Guessing
 * upward would let an unattributable line trip the strictest arm on the board.
 */
export function classifyEntry(entry) {
  const row = normalize(entry)
  if (row.level === 'fatal') return HANDLER
  if (row.route === null) return HANDLER
  if (isHealthRoute(row.route)) {
    const clean = row.status === 503 && (row.proxyStatus ?? 503) === 503
    return clean ? HEALTH_CONTRACT : HANDLER
  }
  return row.route.startsWith(API_PREFIX) ? HANDLER : PAGE
}

/**
 * Grade a window of drained 5xx entries.
 *
 * `entries` are Cloud Logging entries (the `jsonPayload` shape the drain
 * writes) or the bare payloads; both are accepted so a caller can hand this
 * either what `entries:list` returned or what a receiver saw.
 *
 * @param {Array<object>} entries
 * @param {{tolerated?: number}} options
 * @returns {{ok: boolean, pageErrors: number, byRoute: Array<object>,
 *   handlerErrors: number, healthContract: number, tolerated: number,
 *   detail: string}}
 */
export function gradeRenderErrors(entries, { tolerated = 0 } = {}) {
  const rows = (entries ?? []).map((entry) => ({
    ...normalize(entry),
    kind: classifyEntry(entry),
  }))

  const pages = rows.filter((row) => row.kind === PAGE)
  const handlers = rows.filter((row) => row.kind === HANDLER)
  const health = rows.filter((row) => row.kind === HEALTH_CONTRACT)

  // Keyed by the three facts an incident starts from: which deployment, which
  // route pattern, which status. Never the resolved path — that carries the
  // host slug and whatever a visitor typed, exactly as `reportServerError`
  // refuses to forward it.
  const grouped = new Map()
  for (const row of pages) {
    const key = `${row.project ?? '?'} ${row.route} ${row.status ?? '?'}`
    const seen = grouped.get(key)
    if (seen) {
      seen.count += 1
      if (row.timestamp && (!seen.first || row.timestamp < seen.first))
        seen.first = row.timestamp
      if (row.timestamp && (!seen.last || row.timestamp > seen.last))
        seen.last = row.timestamp
      if (row.host) seen.hosts.add(row.host)
    } else {
      grouped.set(key, {
        project: row.project,
        route: row.route,
        status: row.status,
        count: 1,
        first: row.timestamp,
        last: row.timestamp,
        hosts: new Set(row.host ? [row.host] : []),
      })
    }
  }

  const byRoute = [...grouped.values()]
    .map((group) => ({ ...group, hosts: [...group.hosts].sort() }))
    .sort((a, b) => b.count - a.count || String(a.route).localeCompare(b.route))

  const ok = pages.length <= tolerated
  const excused = [
    `${handlers.length} handler`,
    `${health.length} health-contract 503`,
  ].join(' · ')

  return {
    ok,
    pageErrors: pages.length,
    byRoute,
    handlerErrors: handlers.length,
    healthContract: health.length,
    tolerated,
    detail: ok
      ? `no page-route 5xx (${excused} not graded)`
      : `${pages.length} page-route 5xx on ${byRoute.length} route(s) — ` +
        `a cached 200 is not evidence the render works (${excused} not graded)`,
  }
}

/**
 * The Cloud Logging filter this check reads.
 *
 * Built here rather than inlined at the call site so the test can assert the
 * shape without a network, and so the `logName` matches
 * `VERCEL_RUNTIME_LOG_ID` in one place. `severity>=ERROR` mirrors the alert
 * policy's own filter: everything the drain writes is ERROR, and matching the
 * policy means this reader and the pager cannot disagree about what they saw.
 *
 * @param {{project?: string, sinceIso: string, untilIso?: string}} window
 */
export function renderErrorsFilter({
  project = 'aglyn-main',
  sinceIso,
  untilIso = null,
}) {
  const clauses = [
    `logName="projects/${project}/logs/vercel-runtime"`,
    'severity>=ERROR',
    `timestamp>="${sinceIso}"`,
  ]
  if (untilIso) clauses.push(`timestamp<"${untilIso}"`)
  return clauses.join(' AND ')
}

/** The lines a reader lands on. Pure, so the report is asserted, not eyeballed. */
export function renderErrorLines(verdict, { since, until }) {
  const lines = [
    `render errors · ${since} .. ${until ?? 'now'}`,
    `  ${verdict.ok ? 'CLEAN' : 'ERRORS'} ${verdict.detail}`,
  ]
  for (const group of verdict.byRoute) {
    lines.push(
      `  ${String(group.count).padStart(5)}x ${group.project ?? '?'} ` +
        `${group.route} status=${group.status ?? '?'}`,
      `        ${group.first ?? '?'} .. ${group.last ?? '?'}` +
        (group.hosts.length ? `  hosts: ${group.hosts.join(', ')}` : ''),
    )
  }
  return lines
}
