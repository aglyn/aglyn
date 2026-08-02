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
 *   node tools/scripts/probe-uptime.mjs
 *   node tools/scripts/probe-uptime.mjs https://app.aglyn.com https://demo.aglyn.com
 */

const DEFAULT_TARGETS = [
  ['console', 'https://app.aglyn.com'],
  ['tenant', 'https://demo.aglyn.com'],
]

const TIMEOUT_MS = 15_000

const targets = process.argv.slice(2).length
  ? process.argv.slice(2).map((base, index) => [`target-${index + 1}`, base])
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
async function probe(name, base) {
  const url = `${base.replace(/\/$/, '')}/api/health`
  const startedAt = Date.now()
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      headers: { 'user-agent': 'aglyn-uptime-probe' },
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

const results = await Promise.all(targets.map(([name, base]) => probe(name, base)))

console.log(`uptime probe · ${new Date().toISOString()}`)
for (const r of results) {
  const build = r.commit ? ` build=${r.commit}` : ''
  const region = r.region ? ` region=${r.region}` : ''
  console.log(
    `  ${r.ok ? 'UP  ' : 'DOWN'} ${r.name.padEnd(9)} ${String(r.ms).padStart(5)}ms  ${r.detail}${build}${region}`,
  )
  console.log(`       ${r.url}`)
}

const down = results.filter((r) => !r.ok)
console.log(`\n${results.length - down.length}/${results.length} up`)
// Non-zero so the workflow run itself is the record. A passing history is the
// uptime series; a failed run is where an incident starts.
process.exit(down.length ? 1 : 0)
