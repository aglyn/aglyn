#!/usr/bin/env node
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

// The post-deploy production canary (AGL-3567) — the network half of
// `lib/prod-canary.mjs`, where every decision lives and is unit-tested.
//
//   node tools/scripts/prod-canary.mjs --project=tenant --dry-run
//   node tools/scripts/prod-canary.mjs --environment="Production – aglyn-tenant" \
//     --deployment-url=https://aglyn-tenant-abc-aglyn.vercel.app --record
//
// 1. Resolve the deployment under test (the event's, else current production)
//    and wait until production SERVES it.
// 2. Render uncached pages on every host, round after round, until the
//    verdict settles (see `decideVerdict`).
// 3. On `rollback`: pick the target, roll production back through the Vercel
//    REST API, wait for it to serve, and re-run the canary against it.
// 4. Record the verdict as a commit status (`--record`), post to Slack when
//    it is not green, and exit non-zero for anything a human must read.
//
// `--dry-run` makes no Vercel or GitHub write: it prints the rollback it
// WOULD make. Without a Vercel token it runs the canary alone and says so.
//
// Env: VERCEL_TOKEN (else the Vercel CLI's own auth file, for local runs),
// AGLYN_PROBE_TOKEN (the bot-protection bypass), CANARY_TENANT_HOSTS,
// CANARY_CONSOLE_HOST, SLACK_WEBHOOK_URL, GITHUB_TOKEN + GITHUB_REPOSITORY
// (reading and writing the canary's commit statuses), GITHUB_STEP_SUMMARY.
//
// Exit: 0 green/recovered · 1 rollback/degraded/not-serving · 2 operational
// error · 3 inconclusive (the canary could not see production).

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { readCacheState } from './lib/front-door.mjs'
import {
  DEFAULTS,
  DEFAULT_CONSOLE_HOST,
  DEFAULT_TENANT_HOSTS,
  EXIT,
  PROJECTS,
  TEAM_ID,
  canaryPlan,
  canaryRecord,
  classifyResponse,
  decideVerdict,
  formatReport,
  gradeRound,
  parseHostList,
  pickRollbackTarget,
  projectForEnvironment,
  servingState,
  slackPayload,
  statusContext,
} from './lib/prod-canary.mjs'
import { withProbeHeaders } from './lib/probe-headers.mjs'

const args = process.argv.slice(2)
const flag = (name, fallback = '') => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const has = (name) => args.includes(`--${name}`)
const num = (name, fallback) => {
  const value = Number(flag(name, ''))
  return Number.isFinite(value) && value > 0 ? value : fallback
}
const say = (message) => process.stderr.write(`prod-canary: ${message}\n`)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const DRY_RUN = has('dry-run')
const RECORD = has('record') && !DRY_RUN
const RUN_URL = flag('run-url')
const config = {
  budgetMs: num('budget-ms', DEFAULTS.budgetMs),
  attempts: num('attempts', DEFAULTS.attempts),
  retryDelayMs: DEFAULTS.retryDelayMs,
  consecutive: num('consecutive', DEFAULTS.consecutive),
  maxRounds: num('max-rounds', DEFAULTS.maxRounds),
  roundIntervalMs: num('interval-ms', DEFAULTS.roundIntervalMs),
  minFailingHosts: num('min-failing-hosts', DEFAULTS.minFailingHosts),
  serveWaitMs: num('serve-wait-ms', DEFAULTS.serveWaitMs),
}

// ---------------------------------------------------------------- project --

const environment = flag('environment')
let project = null
if (environment) {
  project = projectForEnvironment(environment)
  if (!project) {
    say(`${JSON.stringify(environment)} is not a canaried project; nothing to do`)
    process.exit(0)
  }
} else {
  project = PROJECTS[flag('project', 'tenant')]
  if (!project) {
    say(`--project must be one of ${Object.keys(PROJECTS).join(', ')}`)
    process.exit(EXIT.error)
  }
}

let tenantHosts
try {
  tenantHosts = parseHostList(
    flag('hosts') || process.env.CANARY_TENANT_HOSTS || DEFAULT_TENANT_HOSTS,
  )
} catch (error) {
  say(error.message)
  process.exit(EXIT.error)
}
const consoleHost = flag('console-host') || process.env.CANARY_CONSOLE_HOST || DEFAULT_CONSOLE_HOST

// ----------------------------------------------------------------- Vercel --

/** `VERCEL_TOKEN`, else the CLI's auth file — as verify-production-aliases.mjs reads it. */
function readVercelToken() {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN.trim()
  for (const path of [
    join(homedir(), 'Library', 'Application Support', 'com.vercel.cli', 'auth.json'),
    join(homedir(), '.local', 'share', 'com.vercel.cli', 'auth.json'),
    join(homedir(), '.config', 'com.vercel.cli', 'auth.json'),
  ]) {
    try {
      if (!existsSync(path)) continue
      const token = JSON.parse(readFileSync(path, 'utf8'))?.token
      if (token) return String(token).trim()
    } catch {
      // Unreadable or not JSON: try the next one.
    }
  }
  return null
}
const vercelToken = readVercelToken()

async function vercel(path, { method = 'GET' } = {}) {
  const url = new URL(`https://api.vercel.com${path}`)
  url.searchParams.set('teamId', TEAM_ID)
  const response = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${vercelToken}` },
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Vercel ${method} ${path} → HTTP ${response.status} ${text.slice(0, 200)}`)
  }
  return text ? JSON.parse(text) : null
}

const readProject = () => vercel(`/v9/projects/${project.id}`)
const readServing = async () => ({
  alias: await vercel(`/v4/aliases/${encodeURIComponent(project.alias)}?projectId=${project.id}`),
  project: await readProject(),
})
const readDeployment = (idOrHost) => vercel(`/v13/deployments/${encodeURIComponent(idOrHost)}`)

/** Poll until production serves `deploymentId`, or `waitMs` passes. */
async function waitUntilServing(deploymentId, waitMs) {
  const deadline = Date.now() + waitMs
  for (;;) {
    const state = servingState(await readServing(), deploymentId)
    if (state.serving || Date.now() >= deadline) return state
    await sleep(10_000)
  }
}

// ----------------------------------------------------------------- GitHub --

const githubRepo = process.env.GITHUB_REPOSITORY || 'aglyn/aglyn'
async function github(path, { method = 'GET', body } = {}) {
  const token = process.env.GITHUB_TOKEN
  if (!token) return null
  const response = await fetch(`https://api.github.com/repos/${githubRepo}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`GitHub ${method} ${path} → HTTP ${response.status}`)
  return response.json()
}

/** The canary's own green/red record per commit, for the rollback picker. */
async function canaryRecords(shas) {
  const greenShas = new Set()
  const redShas = new Set()
  for (const commit of shas) {
    try {
      const statuses = await github(`/commits/${commit}/statuses?per_page=100`)
      const record = canaryRecord(statuses, statusContext(project))
      if (record === 'green') greenShas.add(commit)
      if (record === 'red') redShas.add(commit)
    } catch (error) {
      say(`could not read the canary record for ${commit.slice(0, 10)}: ${error.message}`)
    }
  }
  return { greenShas, redShas }
}

async function record(commit, state, description) {
  if (!RECORD || !commit) return
  try {
    await github(`/statuses/${commit}`, {
      method: 'POST',
      body: {
        state,
        context: statusContext(project),
        description: description.slice(0, 140),
        ...(RUN_URL ? { target_url: RUN_URL } : {}),
      },
    })
  } catch (error) {
    say(`could not record ${state} on ${commit.slice(0, 10)}: ${error.message}`)
  }
}

// ----------------------------------------------------------------- canary --

async function fetchOnce(row) {
  const startedAt = Date.now()
  try {
    const response = await fetch(row.url, {
      redirect: 'manual',
      headers: withProbeHeaders({
        'user-agent': 'aglyn-prod-canary',
        accept: row.kind === 'health' ? 'application/json' : 'text/html,application/xhtml+xml',
        'cache-control': 'no-cache',
      }),
      signal: AbortSignal.timeout(config.budgetMs),
    })
    const body = await response.text()
    const verdict = classifyResponse({
      kind: row.kind,
      status: response.status,
      contentType: response.headers.get('content-type'),
      body,
      location: response.headers.get('location'),
      budgetMs: config.budgetMs,
    })
    const cache = readCacheState({
      vercelCache: response.headers.get('x-vercel-cache'),
      nextCache: response.headers.get('x-nextjs-cache'),
      age: response.headers.get('age'),
    })
    return { ...row, ...verdict, status: response.status, ms: Date.now() - startedAt, cache: cache.state }
  } catch (error) {
    // A body that stalls past the budget aborts here too, which is right:
    // a page that never finishes is the outage.
    const verdict = classifyResponse({
      kind: row.kind,
      error: { name: error?.name, code: error?.cause?.code },
      budgetMs: config.budgetMs,
    })
    return { ...row, ...verdict, ms: Date.now() - startedAt }
  }
}

async function check(row) {
  let result = await fetchOnce(row)
  for (let attempt = 2; attempt <= config.attempts && result.outcome !== 'ok'; attempt++) {
    await sleep(config.retryDelayMs)
    result = await fetchOnce(row)
  }
  return result
}

async function runCanary(label) {
  const rounds = []
  for (let index = 0; index < config.maxRounds; index++) {
    if (index > 0) await sleep(config.roundIntervalMs)
    const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const plan = canaryPlan({ project, tenantHosts, consoleHost, nonce })
    const results = await Promise.all(plan.map(check))
    const round = { ...gradeRound(results, config), results }
    rounds.push(round)
    say(`${label} round ${index + 1}: ${round.status}`)
    const verdict = decideVerdict(rounds, { consecutive: config.consecutive })
    if (verdict !== 'pending') return { verdict, rounds }
  }
  return { verdict: decideVerdict(rounds, { consecutive: config.consecutive, final: true }), rounds }
}

// ------------------------------------------------------------------ report --

function report({ verdict, deployment, rounds, rollback = null, note = null }) {
  const lines = formatReport({ project, verdict, deployment, rounds, rollback, note, dryRun: DRY_RUN })
  console.log(lines.join('\n'))
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Production canary — ${project.name}\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`,
    )
  }
  const resultsPath = flag('results')
  if (resultsPath) {
    writeFileSync(resultsPath, JSON.stringify({ project: project.name, verdict, deployment: deployment?.id ?? null, rollback, rounds }, null, 2))
  }
}

/** Never throws: a canary that failed because it could not post is worse than none. */
async function notify(input) {
  const webhook = process.env.SLACK_WEBHOOK_URL
  if (!webhook) {
    say('SLACK_WEBHOOK_URL is not set — this verdict is NOT being announced')
    return
  }
  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(slackPayload({ project, runUrl: RUN_URL, dryRun: DRY_RUN, ...input })),
      signal: AbortSignal.timeout(15_000),
    })
    say(response.ok ? 'announced to Slack' : `Slack refused the message (HTTP ${response.status})`)
  } catch (error) {
    say(`could not reach Slack: ${error?.message ?? error}`)
  }
}

async function finish(input) {
  report(input)
  if (input.verdict !== 'green') await notify(input)
  process.exit(EXIT[input.verdict] ?? EXIT.error)
}

// ------------------------------------------------------------------- main --

let deployment = null
let note = null
if (!vercelToken) {
  note = 'No Vercel token: canary only, no deployment resolved and no rollback possible.'
  say(note)
} else {
  try {
    const deploymentUrl = flag('deployment-url')
    if (deploymentUrl) {
      deployment = await readDeployment(new URL(deploymentUrl).host)
      if (deployment?.projectId && deployment.projectId !== project.id) {
        say(`${deploymentUrl} belongs to ${deployment.projectId}, not ${project.name}`)
        process.exit(EXIT.error)
      }
      const state = await waitUntilServing(deployment.id, config.serveWaitMs)
      if (!state.serving) {
        await finish({
          verdict: 'not-serving',
          deployment,
          rounds: [],
          note:
            `Production still serves ${state.productionId}. ` +
            (state.autoAssign
              ? `It did not switch within ${config.serveWaitMs / 1000} s.`
              : 'Auto-assign is OFF (a rollback happened): promote the deployment by hand — docs/RELEASING.md step 0 — then run this canary from the Actions tab.'),
        })
      }
    } else {
      const { productionId } = servingState(await readServing(), null)
      deployment = productionId ? await readDeployment(productionId) : null
    }
  } catch (error) {
    say(error.message)
    process.exit(EXIT.error)
  }
}

const canary = await runCanary('canary')
const commit = deployment?.meta?.githubCommitSha ?? null

if (canary.verdict !== 'rollback') {
  if (canary.verdict === 'green' || canary.verdict === 'recovered') {
    await record(commit, 'success', `canary ${canary.verdict} on ${deployment?.id ?? 'production'}`)
  }
  await finish({ ...canary, deployment, note })
}

// ---------------------------------------------------------------- rollback --

if (!vercelToken || !deployment) {
  await finish({
    ...canary,
    deployment,
    note,
    rollback: { action: 'not-rolled-back', target: null, reason: 'no Vercel token or deployment to roll back from' },
  })
}

let rollback
try {
  const listing = await vercel(
    `/v6/deployments?projectId=${project.id}&target=production&state=READY&limit=20`,
  )
  const deployments = listing?.deployments ?? []
  const shas = [...new Set(deployments.map((d) => d?.meta?.githubCommitSha).filter(Boolean))]
  const { greenShas, redShas } = await canaryRecords(shas)
  const pick = pickRollbackTarget({ deployments, bad: deployment, greenShas, redShas })
  rollback = { action: 'not-rolled-back', target: pick.target, reason: pick.reason }
} catch (error) {
  rollback = { action: 'not-rolled-back', target: null, reason: error.message }
}

if (rollback.target && DRY_RUN) {
  rollback.action = 'would-roll-back'
} else if (rollback.target) {
  const targetId = rollback.target.uid ?? rollback.target.id
  try {
    // Re-read first: if a human (or a peer run) already moved production,
    // rolling "back" from a deployment that no longer serves would undo them.
    const before = servingState(await readServing(), deployment.id)
    if (!before.serving) {
      rollback.reason = `production already moved to ${before.productionId}; not touching it`
    } else {
      const description = encodeURIComponent(`prod-canary: ${deployment.id} failed (${RUN_URL || 'local'})`)
      await vercel(`/v1/projects/${project.id}/rollback/${targetId}?description=${description}`, { method: 'POST' })
      rollback.action = 'rolled-back'
      await record(commit, 'failure', `canary red; rolled back to ${targetId}`)
      const after = await waitUntilServing(targetId, 180_000)
      if (!after.serving) {
        rollback.after = `not serving yet (production is ${after.productionId})`
      } else {
        const recheck = await runCanary('after-rollback')
        rollback.after = recheck.verdict
        canary.rounds.push(...recheck.rounds.map((round) => ({ ...round, status: `after-rollback ${round.status}` })))
      }
    }
  } catch (error) {
    rollback.reason = `rollback failed: ${error.message}`
  }
}

await finish({ ...canary, deployment, note, rollback })
