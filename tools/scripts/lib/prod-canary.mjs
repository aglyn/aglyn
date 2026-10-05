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
 * THE POST-DEPLOY PRODUCTION CANARY: the decisions (AGL-3567).
 *
 * beta.222 deployed aglyn-tenant to production on 2026-10-05 and every
 * UNCACHED client-site page hung to Vercel's 60 s limit (504). Cached pages
 * and every `/api/*` route kept answering 200, so the health checks were
 * green, and a human found it eighteen minutes later. The tenant project
 * builds no Vercel previews, so a production deploy is the first time new
 * tenant code runs on Vercel at all — and nothing read it afterwards.
 *
 * `tools/scripts/prod-canary.mjs` is the network half. Everything that
 * DECIDES lives here, pure, so `prod-canary.test.mjs` can assert every
 * verdict with no network: how a response is classified, when a round is
 * red, when a run of rounds is a rollback rather than a flap, and which
 * deployment a rollback goes to.
 *
 * ## A query string does not bust the ISR cache — a fresh path does
 *
 * Measured 2026-10-05 against production with the probe bypass header:
 * `demo.aglyn.app/?__canary=<random>` answers `x-vercel-cache: HIT` with the
 * same `age` as `/`, because a prerendered route's cache key ignores the
 * query. A path nobody has requested before (`/__aglyn-canary-<nonce>`)
 * answers `404` with `x-vercel-cache: MISS`: the `[host]/[scheme]/[[...slug]]`
 * route ran during THIS request, through the tenant layout, and rendered the
 * site's not-found page. That `miss` row is the one that would have caught
 * beta.222. The real page paths are still requested (with the query, which is
 * harmless) because right after a deploy their ISR cache is empty too, and
 * because a routing break that 404s every real page must not read as green.
 */

import { gradeFrontDoor } from './front-door.mjs'

export const TEAM_ID = 'team_JFfQodGE8VhCAZM6usYTu54M'

/**
 * The Vercel projects the canary reads and may roll back. `environment` is
 * the GitHub deployment environment the Vercel integration writes — the same
 * strings `release-changelog-entry.mjs` reads — with an EN DASH.
 *
 * `alias` is the production domain whose deployment IS what production
 * serves. Not `targets.production` on the project: measured 2026-10-05, that
 * named the console's beta.222 deployment while it was still BUILDING and
 * `app.aglyn.com` served beta.221. The alias record answered correctly for
 * both projects, including the tenant after its rollback.
 */
export const PROJECTS = {
  tenant: {
    key: 'tenant',
    name: 'aglyn-tenant',
    id: 'QmVstR8xiYtabTkVo2t9NNsiYY72nSTbNr1MGDLffzZeLn',
    environment: 'Production – aglyn-tenant',
    alias: '*.aglyn.app',
  },
  console: {
    key: 'console',
    name: 'aglyn-console',
    id: 'prj_gEzxEXc0Lhs81rmaXIg2a1GbsDfl',
    environment: 'Production – aglyn-console',
    alias: 'app.aglyn.com',
  },
}

/**
 * Platform-owned hosts only. Customer sites are added through the
 * `CANARY_TENANT_HOSTS` repo variable, never hard-coded here, because a
 * customer host in source outlives the customer.
 *
 * `aglyn.com` is served by the tenant runtime through the custom-domain
 * path, and `demo.aglyn.app` through the `.aglyn.app` subdomain path: two
 * host-resolution paths, so a middleware break that spares one is caught by
 * the other (the reasoning `FRONT_DOORS` gives).
 */
export const DEFAULT_TENANT_HOSTS = 'demo.aglyn.app aglyn.com'
export const DEFAULT_CONSOLE_HOST = 'app.aglyn.com'

export const DEFAULTS = {
  /** Per request. The outage hung to 60 s; a healthy uncached render measured 0.6-1.5 s. */
  budgetMs: 15_000,
  /** Per check per round: a failure is retried once before it counts. */
  attempts: 2,
  retryDelayMs: 3_000,
  /** Rounds in a row that must be red before anything is rolled back. */
  consecutive: 3,
  maxRounds: 5,
  roundIntervalMs: 20_000,
  /** Distinct hosts that must fail in the SAME round for it to be red. */
  minFailingHosts: 2,
  /** How long a READY deployment may take to become the production target. */
  serveWaitMs: 300_000,
}

/** The commit-status context the canary records its verdict under. */
export const statusContext = (project) => `prod-canary/${project.name}`

/**
 * Which canaried project a GitHub deployment environment names, or null.
 * Previews, docs and plugins deploy too and are not this canary's.
 */
export function projectForEnvironment(environment) {
  const value = String(environment ?? '')
  return (
    Object.values(PROJECTS).find((project) => project.environment === value) ??
    null
  )
}

/**
 * `"demo.aglyn.app, edr-construction.aglyn.app/services https://x.aglyn.app/a"`
 * → `[{host, paths}]`. Entries split on commas or whitespace; an entry may
 * carry a scheme (dropped) and a path (added to that host's list). Every
 * host is always probed at `/`.
 */
export function parseHostList(text) {
  const byHost = new Map()
  for (const raw of String(text ?? '').split(/[\s,]+/)) {
    const entry = raw.trim().replace(/^https?:\/\//i, '')
    if (!entry) continue
    const slash = entry.indexOf('/')
    const host = (slash === -1 ? entry : entry.slice(0, slash)).toLowerCase()
    const path = slash === -1 ? '/' : entry.slice(slash).replace(/\/+$/, '') || '/'
    if (!/^[a-z0-9.-]+$/.test(host)) {
      throw new Error(`not a hostname: ${JSON.stringify(raw)}`)
    }
    const paths = byHost.get(host) ?? ['/']
    if (!paths.includes(path)) paths.push(path)
    byHost.set(host, paths)
  }
  return [...byHost].map(([host, paths]) => ({ host, paths }))
}

/**
 * The checks one round makes.
 *
 * `counts` marks the rows that grade THIS project. The console's health is
 * requested on a tenant run (and is part of the summary) but a console
 * failure must never roll the tenant back.
 *
 * @param {{project: object, tenantHosts: Array<{host: string, paths: string[]}>,
 *   consoleHost: string, nonce: string}} input
 */
export function canaryPlan({ project, tenantHosts, consoleHost, nonce }) {
  const bust = (path) => `${path}${path.includes('?') ? '&' : '?'}__canary=${nonce}`
  const miss = `/__aglyn-canary-${nonce}`
  const rows = []
  if (project.key === 'tenant') {
    for (const { host, paths } of tenantHosts) {
      for (const path of paths) {
        rows.push({ kind: 'page', host, url: `https://${host}${bust(path)}`, counts: true })
      }
      rows.push({ kind: 'miss', host, url: `https://${host}${miss}`, counts: true })
    }
    if (tenantHosts[0]) {
      rows.push({
        kind: 'health',
        host: tenantHosts[0].host,
        url: `https://${tenantHosts[0].host}/api/health`,
        counts: true,
      })
    }
    rows.push({
      kind: 'health',
      host: consoleHost,
      url: `https://${consoleHost}/api/health`,
      counts: false,
    })
  } else {
    rows.push(
      { kind: 'health', host: consoleHost, url: `https://${consoleHost}/api/health`, counts: true },
      { kind: 'page', host: consoleHost, url: `https://${consoleHost}${bust('/')}`, counts: true },
      // `/[orgSlug]` on the console: an unknown slug renders the shell at 200.
      { kind: 'miss', host: consoleHost, url: `https://${consoleHost}${miss}`, counts: true },
    )
  }
  return rows
}

/**
 * Network errors that say nothing about the server. A TIMEOUT is not on this
 * list: hanging until the budget is the outage this canary exists for.
 */
const TIMEOUT_ERRORS = new Set(['TimeoutError', 'AbortError'])

/**
 * Classify one response.
 *
 *  - `ok`        the deployment served it.
 *  - `server`    the deployment failed it: a 5xx, a timeout, a page that is
 *                not a complete render of our app. Only these can roll back.
 *  - `canary`    the canary could not see: a bot challenge, a rate limit, a
 *                DNS/TLS/connection error, a redirect (a host-list mistake),
 *                a 401/403. Never a reason to roll back, never a pass.
 *  - `degraded`  a health route answered in JSON but reported a dependency
 *                down. The code rendered; a rollback would not fix Firestore.
 *
 * @param {{kind: 'page'|'miss'|'health', status?: number,
 *   contentType?: string|null, body?: string, location?: string|null,
 *   error?: {name?: string, code?: string}|null, budgetMs?: number}} response
 * @returns {{outcome: 'ok'|'server'|'canary'|'degraded', detail: string}}
 */
export function classifyResponse({
  kind,
  status,
  contentType = null,
  body = '',
  location = null,
  error = null,
  budgetMs = DEFAULTS.budgetMs,
}) {
  if (error) {
    if (TIMEOUT_ERRORS.has(error.name)) {
      return { outcome: 'server', detail: `no response in ${budgetMs} ms` }
    }
    return {
      outcome: 'canary',
      detail: `unreachable from the canary (${error.code ?? error.name ?? 'error'})`,
    }
  }

  if (kind === 'health') return classifyHealth({ status, contentType, body })

  // The not-found render is the point of a `miss` row, so its 404 grades as
  // the page it is. Every other check `gradeFrontDoor` makes still applies.
  const notFoundRender = kind === 'miss' && status === 404
  const verdict = gradeFrontDoor({
    status: notFoundRender ? 200 : status,
    contentType,
    body,
    location,
  })
  if (verdict.challenged) return { outcome: 'canary', detail: verdict.detail }
  if (verdict.ok) {
    return {
      outcome: 'ok',
      detail: notFoundRender ? 'rendered the not-found page through the layout' : verdict.detail,
    }
  }
  if (status >= 500) return { outcome: 'server', detail: verdict.detail }
  if (status === 429) return { outcome: 'canary', detail: 'HTTP 429 — rate limited, not a verdict' }
  if (status >= 300 && status < 400) return { outcome: 'canary', detail: verdict.detail }
  if (status === 401 || status === 403) {
    return { outcome: 'canary', detail: `HTTP ${status} — the canary was refused, not a verdict` }
  }
  // A 200/404 that is not a complete render of our app, or a real page that
  // 404s: either is what a visitor would get, so it is the deployment's.
  return { outcome: 'server', detail: verdict.detail }
}

function classifyHealth({ status, contentType, body }) {
  if (/Vercel Security Checkpoint/i.test(body)) {
    return { outcome: 'canary', detail: `CHALLENGED (HTTP ${status}) — not a verdict` }
  }
  let json = null
  if (/json/i.test(contentType ?? '')) {
    try {
      json = JSON.parse(body)
    } catch {
      json = null
    }
  }
  if (json && typeof json.status === 'string') {
    const where = json.commit ? ` (commit ${json.commit})` : ''
    if (status === 200 && json.status === 'ok') {
      return { outcome: 'ok', detail: `healthy${where}` }
    }
    return {
      outcome: 'degraded',
      detail: `HTTP ${status} status=${json.status}${where} — the route ran; a dependency is reporting down`,
    }
  }
  if (status === 429) return { outcome: 'canary', detail: 'HTTP 429 — rate limited, not a verdict' }
  if (status >= 500 || status === 200) {
    return { outcome: 'server', detail: `HTTP ${status} without a health body` }
  }
  return { outcome: 'canary', detail: `HTTP ${status} — not a health answer` }
}

/**
 * Grade one round. Red needs SERVER failures on `minFailingHosts` distinct
 * hosts at once (capped at the hosts in the plan), so one customer site that
 * broke its own content cannot roll the platform back; that is `isolated`.
 */
export function gradeRound(results, { minFailingHosts = DEFAULTS.minFailingHosts } = {}) {
  const counted = results.filter((row) => row.counts)
  const hosts = new Set(counted.map((row) => row.host))
  const failing = new Set(
    counted.filter((row) => row.outcome === 'server').map((row) => row.host),
  )
  const seen = counted.filter((row) => row.outcome === 'ok' || row.outcome === 'degraded')
  const need = Math.max(1, Math.min(minFailingHosts, hosts.size))
  let status
  if (failing.size >= need) status = 'red'
  else if (failing.size > 0) status = 'isolated'
  else if (seen.length > 0) status = 'green'
  else status = 'inconclusive'
  return { status, failingHosts: [...failing].sort(), need }
}

/**
 * The verdict over the rounds so far. `pending` means run another round.
 *
 *  - `rollback`     `consecutive` red rounds in a row. Nothing less acts.
 *  - `green`        the last round was green and every round before it too.
 *  - `recovered`    the last round was green after a red/isolated one — a
 *                   flap, reported and not acted on.
 *  - `degraded`     failures persisted but never on enough hosts at once.
 *  - `inconclusive` the canary could not see the deployment.
 *
 * With `final`, a still-pending run settles: any failure seen is `degraded`,
 * otherwise `inconclusive`.
 */
export function decideVerdict(rounds, { consecutive = DEFAULTS.consecutive, final = false } = {}) {
  if (!rounds.length) return final ? 'inconclusive' : 'pending'
  const trailing = (predicate) => {
    let count = 0
    for (let i = rounds.length - 1; i >= 0 && predicate(rounds[i].status); i--) count++
    return count
  }
  if (trailing((s) => s === 'red') >= consecutive) return 'rollback'
  const last = rounds[rounds.length - 1].status
  if (last === 'green') {
    return rounds.every((round) => round.status === 'green' || round.status === 'inconclusive')
      ? 'green'
      : 'recovered'
  }
  if (trailing((s) => s === 'red' || s === 'isolated') >= consecutive) return 'degraded'
  if (trailing((s) => s === 'inconclusive') >= consecutive) return 'inconclusive'
  if (!final) return 'pending'
  return rounds.some((round) => round.status === 'red' || round.status === 'isolated')
    ? 'degraded'
    : 'inconclusive'
}

/** What each verdict exits with. Anything a human must read is non-zero. */
export const EXIT = {
  green: 0,
  recovered: 0,
  rollback: 1,
  degraded: 1,
  'not-serving': 1,
  error: 2,
  inconclusive: 3,
}

const sha = (deployment) => deployment?.meta?.githubCommitSha ?? null
const created = (deployment) => deployment?.createdAt ?? deployment?.created ?? 0
const idOf = (deployment) => deployment?.uid ?? deployment?.id ?? null

/**
 * Which deployment a rollback goes to.
 *
 * The newest READY production deployment OLDER than the bad one, that is not
 * the bad one, not a redeploy of the bad commit, not marked unusable by
 * Vercel, and not a commit the canary (or a human) already recorded as red.
 * Among those, a commit the canary recorded GREEN wins over a newer one it
 * never verified — so a deployment that was rolled back by hand, which is
 * newer than the one that replaced it and was never recorded, is skipped
 * whenever a verified one exists.
 *
 * @param {{deployments: object[], bad: object, redShas?: Set<string>,
 *   greenShas?: Set<string>}} input
 * @returns {{target: object|null, reason: string}}
 */
export function pickRollbackTarget({ deployments, bad, redShas = new Set(), greenShas = new Set() }) {
  const badId = idOf(bad)
  const badSha = sha(bad)
  const candidates = (deployments ?? [])
    .filter((d) => (d.readyState ?? d.state) === 'READY')
    .filter((d) => d.target === 'production')
    .filter((d) => idOf(d) !== badId)
    .filter((d) => created(d) < created(bad))
    .filter((d) => d.isRollbackCandidate !== false)
    .filter((d) => !badSha || sha(d) !== badSha)
    .filter((d) => !redShas.has(sha(d)))
    .sort((a, b) => created(b) - created(a))
  if (!candidates.length) {
    return { target: null, reason: 'no READY production deployment older than the failing one qualifies' }
  }
  const verified = candidates.find((d) => greenShas.has(sha(d)))
  if (verified) {
    return { target: verified, reason: 'newest older deployment the canary recorded green' }
  }
  return {
    target: candidates[0],
    reason: 'newest older READY production deployment (none recorded green yet)',
  }
}

/** Split a commit's statuses into the canary's green and red records. */
export function canaryRecord(statuses, context) {
  // GitHub lists newest first; the newest record for the context wins.
  const mine = (statuses ?? []).find((s) => s?.context === context)
  return mine?.state === 'success' ? 'green' : mine?.state === 'failure' ? 'red' : null
}

/**
 * Is production serving this deployment yet? `alias` is GET /v4/aliases for
 * the project's production domain; `project` is GET /v9/projects.
 *
 * After any rollback Vercel turns `autoAssignCustomDomains` OFF, and every
 * later deployment builds READY and serves nothing until it is promoted by
 * hand — which is what the `not-serving` verdict says in words.
 */
export function servingState({ alias, project }, deploymentId) {
  const productionId = alias?.deploymentId ?? null
  return {
    serving: Boolean(deploymentId) && productionId === deploymentId,
    productionId,
    autoAssign: project?.autoAssignCustomDomains !== false,
  }
}

const describe = (deployment) =>
  deployment
    ? `${idOf(deployment)} (${(sha(deployment) ?? '?').slice(0, 10)})`
    : '—'

/** The lines the run prints and writes to the job summary. */
export function formatReport({ project, verdict, deployment, rounds, rollback = null, note = null, dryRun = false }) {
  const lines = [
    `prod-canary ${project.name}: ${verdict.toUpperCase()}${dryRun ? ' (dry run)' : ''}`,
    `deployment under test: ${describe(deployment)}`,
  ]
  if (note) lines.push(note)
  rounds.forEach((round, index) => {
    lines.push(
      `round ${index + 1}: ${round.status}` +
        (round.failingHosts?.length ? ` — failing hosts: ${round.failingHosts.join(', ')}` : ''),
    )
    for (const row of round.results ?? []) {
      const mark = { ok: '✓', server: '✗', canary: '?', degraded: '~' }[row.outcome] ?? '·'
      lines.push(
        `  ${mark} ${row.kind.padEnd(6)} ${row.url} — ${row.detail}` +
          `${row.ms === undefined ? '' : ` (${row.ms} ms)`}${row.cache ? ` cache=${row.cache}` : ''}` +
          `${row.counts ? '' : ' [informational]'}`,
      )
    }
  })
  if (rollback) {
    lines.push(
      `rollback: ${rollback.action} → ${describe(rollback.target)} — ${rollback.reason}`,
    )
    if (rollback.after) lines.push(`after the rollback: ${rollback.after.toUpperCase()}`)
  }
  return lines
}

/**
 * The Slack message. Sent for every verdict that is not green, labeled when
 * it is a dry run in the headline AND the body, because a dry-run alert that
 * reads as a rollback in either place has false-alarmed.
 */
export function slackPayload({ project, verdict, deployment, rollback = null, runUrl = '', dryRun = false, note = null }) {
  const label = dryRun ? '[DRY RUN — nothing was rolled back] ' : ''
  const what = {
    rollback: rollback?.action === 'rolled-back'
      ? `production was ROLLED BACK to ${describe(rollback.target)}`
      : rollback?.action === 'would-roll-back'
        ? `production WOULD be rolled back to ${describe(rollback.target)}`
        : `production is failing and was NOT rolled back (${rollback?.reason ?? 'no target'})`,
    degraded: 'pages are failing on some hosts; not enough at once to roll back',
    inconclusive: 'the canary could not see production (challenged or unreachable)',
    'not-serving': 'the new deployment is READY but production is not serving it',
    recovered: 'failed, then recovered within the run',
  }[verdict] ?? verdict
  const headline = `${label}Prod canary ${project.name}: ${what}`
  const body = [
    `*<${runUrl || 'https://github.com/aglyn/aglyn/actions'}|${headline}>*`,
    `Deployment under test: \`${describe(deployment)}\``,
    note,
    rollback?.after ? `After the rollback the canary reads: *${rollback.after}*` : null,
    verdict === 'rollback' && rollback?.action === 'rolled-back'
      ? 'Vercel has turned production auto-assign OFF. The next good deployment must be promoted by hand — docs/RELEASING.md step 0.'
      : null,
    'Runbook: docs/RELEASING.md → "The production canary".',
  ].filter(Boolean)
  return {
    text: headline,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: body.join('\n') } }],
  }
}
