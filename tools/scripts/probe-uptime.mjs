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
 * Probe the health endpoints and report (AGL-1102).
 *
 * The SLA work starts with measurement, not a percentage: there is no uptime
 * history to commit to yet, and a number published before there is one is a
 * promise nobody can check.
 *
 * Runs from GitHub's runners rather than our own infrastructure, which is the
 * only part of this that makes it a real probe — a monitor hosted on the thing
 * it monitors cannot observe its own outage. Its record is the workflow run
 * history: a failing run IS the incident marker.
 *
 * WHAT THIS IS NOT: a substitute for a real external monitor. GitHub's
 * scheduled runs are best-effort and can be delayed or dropped under load, so
 * a gap here is not evidence of an outage and 100% of runs passing is not
 * evidence of 100% uptime. It exists so that (a) the endpoints are exercised
 * continuously by something outside the deploy, and (b) there is a signal to
 * point a real monitor at when one is chosen. AGL-1148 tracks that.
 *
 * TWO KINDS OF ROW, and the second one is the whole of AGL-2709. A `health`
 * row reads one of our JSON health contracts. A `page` row fetches the URL a
 * visitor types and grades the response they would get. Every monitor on this
 * board was a health row until 2026-09-09, when every tenant page answered 500
 * for ten minutes and the two page-shaped monitors reported no downtime at
 * all: a health route answers from inside a route handler and never enters the
 * ISR path that was throwing. See `lib/front-door.mjs`.
 *
 *   node tools/scripts/probe-uptime.mjs
 *   node tools/scripts/probe-uptime.mjs console=https://app.aglyn.com
 *   node tools/scripts/probe-uptime.mjs http://localhost:4200
 *   node tools/scripts/probe-uptime.mjs front-door/site=http://localhost:4500 \
 *     --only front-door
 */

import {
  FRONT_DOOR_PREFIX,
  cacheNote,
  frontDoorPlan,
  gradeFrontDoor,
  readCacheState,
} from './lib/front-door.mjs'
import { withProbeHeaders } from './lib/probe-headers.mjs'
// WHAT is probed lives in a module of its own so a test can assert it without
// importing this file, which probes at load and exits (AGL-1617).
import {
  DEFAULT_TARGETS,
  buildPlan,
  markPendingDeployments,
} from './lib/uptime-targets.mjs'

const TIMEOUT_MS = 15_000

/**
 * Arguments are `name=url`, or a bare url.
 *
 * Names matter more than they look: the workflow log is the incident record,
 * and "target-2 is DOWN" makes whoever reads it at 3am go and work out which
 * service that was. `tenant=https://…` does not.
 *
 * Two argument shapes are not targets. `front-door/<name>=<base>` repoints one
 * front door, and `--only <substring>` narrows the plan to the rows whose name
 * matches. Both exist so this script can be aimed at a local production server
 * and watched to go red against real broken code — a monitor nobody has seen
 * fail is a monitor nobody has tested (AGL-2709).
 */
const argv = process.argv.slice(2)
const onlyAt = argv.findIndex((arg) => arg === '--only' || arg.startsWith('--only='))
const only =
  onlyAt === -1
    ? null
    : argv[onlyAt].includes('=')
      ? argv[onlyAt].slice('--only='.length)
      : argv[onlyAt + 1]
if (onlyAt !== -1 && !only) {
  console.error('--only needs a value: --only front-door')
  process.exit(2)
}
const args = argv.filter(
  (arg, index) =>
    !arg.startsWith('--') && !(onlyAt !== -1 && index === onlyAt + 1 && !argv[onlyAt].includes('=')),
)

const frontDoorOverrides = {}
const targetArgs = []
for (const arg of args) {
  const at = arg.indexOf('=')
  const name = at > 0 ? arg.slice(0, at) : ''
  if (name.startsWith(`${FRONT_DOOR_PREFIX}/`)) {
    frontDoorOverrides[name.slice(FRONT_DOOR_PREFIX.length + 1)] = arg.slice(at + 1)
  } else {
    targetArgs.push(arg)
  }
}

const targets = targetArgs.length
  ? targetArgs.map((arg, index) => {
      const at = arg.indexOf('=')
      return at > 0
        ? [arg.slice(0, at), arg.slice(at + 1)]
        : [DEFAULT_TARGETS[index]?.[0] ?? `target-${index + 1}`, arg]
    })
  : DEFAULT_TARGETS

/**
 * Probe one base URL.
 *
 * `redirect: 'manual'`, deliberately. A base that 3xxes to the real host would
 * otherwise be followed silently and report the redirect target's health under
 * the wrong name — and pointing a monitor at a redirecting hostname is a
 * mistake this repo has already made once, when CONSOLE_BASE_URL kept pointing
 * at aglyn.io after the domain move and every cron run failed for a week
 * before anyone read the logs. Name it instead of following it.
 */
async function probe(name, base, path = '/api/health') {
  const url = `${base.replace(/\/$/, '')}${path}`
  const startedAt = Date.now()
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      // Our own bot protection challenges automated clients, so without this
      // header the probe gets a 429 Vercel Security Checkpoint and reports the
      // site as DOWN when it is perfectly healthy — the exact "fails for
      // reasons unrelated to what it monitors" failure this workflow's own
      // comment warns about. The token matches a Bypass rule on the tenant and
      // docs projects. Absent (local runs, forks), the header is simply not
      // sent and the probe behaves as before.
      headers: withProbeHeaders({ 'user-agent': 'aglyn-uptime-probe' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const ms = Date.now() - startedAt

    if (response.status >= 300 && response.status < 400) {
      return {
        name, url, ms, ok: false,
        detail: `redirects to ${response.headers.get('location') ?? '?'} — probe the host that SERVES it`,
      }
    }

    // A cached health check is a health check that lies. If an edge ever
    // starts caching this, the probe should say so rather than quietly
    // reporting whatever was stored.
    const cacheControl = response.headers.get('cache-control') ?? ''
    const cacheable = !cacheControl.includes('no-store')

    let body = null
    try {
      body = await response.json()
    } catch {
      // Not JSON: an edge error page or a proxy. That is itself a failure.
    }

    const ok = response.status === 200 && body?.status === 'ok' && !cacheable
    const notes = []
    if (response.status !== 200) notes.push(`HTTP ${response.status}`)
    if (body?.status && body.status !== 'ok') notes.push(`status=${body.status}`)
    if (cacheable) notes.push(`CACHEABLE (${cacheControl || 'no cache-control'})`)
    for (const [check, result] of Object.entries(body?.checks ?? {})) {
      if (!result?.ok) notes.push(`${check}=${result?.code ?? 'failed'}`)
    }

    return {
      name, url, ms, ok,
      status: response.status,
      commit: body?.commit ?? null,
      region: body?.region ?? null,
      detail: notes.join(' · ') || 'healthy',
    }
  } catch (error) {
    const aborted = error?.name === 'TimeoutError' || error?.name === 'AbortError'
    return {
      name, url, ms: Date.now() - startedAt, ok: false,
      detail: aborted ? `no response in ${TIMEOUT_MS}ms` : `unreachable (${error?.cause?.code ?? error?.name ?? 'error'})`,
    }
  }
}

/**
 * Probe one PAGE the way a visitor does (AGL-2709).
 *
 * Separate from `probe()` because the two ask different questions and grade
 * different things. `probe()` reads our own JSON contract — `status: "ok"`,
 * `no-store`, a per-subsystem `checks` map. A page has none of that: what
 * matters is the status a browser would get, that the bytes are a complete
 * document our app rendered, and that a bot-protection challenge is called by
 * its own name rather than reported as an outage.
 *
 * No `accept: application/json`, no JSON parse, and the browser-shaped
 * `accept` header on purpose — the point is to travel the visitor's path
 * through the ISR cache, which is the path every `/api/health*` route skips.
 */
async function probePage(name, base, path) {
  const url = `${base.replace(/\/$/, '')}${path}`
  const startedAt = Date.now()
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      headers: withProbeHeaders({
        'user-agent': 'aglyn-uptime-probe',
        accept: 'text/html,application/xhtml+xml',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await response.text()
    const verdict = gradeFrontDoor({
      status: response.status,
      contentType: response.headers.get('content-type'),
      body,
      location: response.headers.get('location'),
    })
    // Recorded, never graded. Next serves a stale ISR document while a fresh
    // render fails, so a HIT is the one state a green row here cannot rule an
    // outage out from — the log line has to say which state it saw.
    //
    // ⛔ It read `x-nextjs-cache`, and Vercel does not send that header
    // (AGL-2709). Measured 2026-09-09 against both front doors: the edge
    // answers `x-vercel-cache` and `age`, so the one note on this board that
    // acknowledged the ISR cache was absent from every production row. The
    // note `cacheNote` writes is the closure of the REPORTING half — a green
    // row that says nothing implies it verified the render, and it did not.
    const cache = readCacheState({
      vercelCache: response.headers.get('x-vercel-cache'),
      nextCache: response.headers.get('x-nextjs-cache'),
      age: response.headers.get('age'),
    })
    const note = cacheNote(cache)
    return {
      name,
      url,
      ms: Date.now() - startedAt,
      kind: 'page',
      ok: verdict.ok,
      challenged: verdict.challenged,
      status: response.status,
      cache: cache.state,
      rendered: cache.rendered,
      ageSeconds: cache.ageSeconds,
      detail: note ? `${verdict.detail} · ${note}` : verdict.detail,
    }
  } catch (error) {
    const aborted = error?.name === 'TimeoutError' || error?.name === 'AbortError'
    return {
      name,
      url,
      ms: Date.now() - startedAt,
      kind: 'page',
      ok: false,
      detail: aborted
        ? `no response in ${TIMEOUT_MS}ms`
        : `unreachable (${error?.cause?.code ?? error?.name ?? 'error'})`,
    }
  }
}

// Root first, then each subsystem — see `lib/uptime-targets.mjs` for what is
// on the list and why. The front doors come last: they are the only rows that
// answer "does a visitor get a page", and reading them at the bottom of the
// log puts the visitor's verdict beside the summary line.
const plan = [
  ...buildPlan(targets).map((row) => [...row, 'health']),
  ...frontDoorPlan(frontDoorOverrides).map((row) => [...row, 'page']),
].filter(([name]) => !only || name.includes(only))

// A filter that matches nothing must never read as a clean sweep.
if (!plan.length) {
  console.error(`--only ${only} matched no row; nothing was probed`)
  process.exit(2)
}

const results = await Promise.all(
  plan.map(([name, base, path, kind]) =>
    kind === 'page' ? probePage(name, base, path) : probe(name, base, path),
  ),
)

// A subsystem path that 404s while its target's root is UP is a fact about the
// deploy queue, not an outage — `main` names endpoints before production is
// promoted to serve them. The rule, and the review-time guard that keeps it
// from hiding a deleted route, live in `lib/uptime-targets.mjs`.
markPendingDeployments(results)

console.log(`uptime probe · ${new Date().toISOString()}`)
for (const r of results) {
  const build = r.commit ? ` build=${r.commit}` : ''
  const region = r.region ? ` region=${r.region}` : ''
  // CHAL is neither UP nor DOWN: bot protection answered instead of the app,
  // so the row is red because the check could not see the site, not because
  // the site is broken. It reads as its own word so that distinction survives
  // into the log a reader lands on at 3am.
  const state = r.pending ? 'PEND' : r.challenged ? 'CHAL' : r.ok ? 'UP  ' : 'DOWN'
  console.log(
    `  ${state} ${r.name.padEnd(22)} ${String(r.ms).padStart(5)}ms  ${r.detail}${build}${region}`,
  )
  console.log(`       ${r.url}`)
}

/*
 * HAND THE RESULTS TO THE REPORTER (AGL-2586).
 *
 * Written only when `UPTIME_RESULTS_PATH` names a file, so a local run and a
 * fork behave exactly as before. The alternative — a reporter that probes
 * again — would double every request and could disagree with the run it is
 * reporting on, which is the worst possible property for an alert.
 *
 * Best effort: a probe that failed because it could not write its own log
 * would be worse than the silence the reporter exists to end.
 */
const resultsPath = process.env.UPTIME_RESULTS_PATH
if (resultsPath) {
  try {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(resultsPath, JSON.stringify(results, null, 2))
  } catch (error) {
    console.error(`could not write ${resultsPath}: ${error?.message ?? error}`)
  }
}

const down = results.filter((r) => !r.ok)
const pending = results.filter((r) => r.pending)
console.log(`\n${results.length - down.length - pending.length}/${results.length} up`)
if (pending.length) {
  console.log(
    `${pending.length} pending promotion: ${pending.map((r) => r.name).join(', ')}`,
  )
}
// Non-zero so the workflow run itself is the record. A passing history is the
// uptime series; a failed run is where an incident starts.
process.exit(down.length ? 1 : 0)
