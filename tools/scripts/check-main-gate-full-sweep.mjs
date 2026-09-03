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
// Decides whether Main Gate's `full` sweep is due (AGL-2552). The rule and its
// rationale live in `lib/main-gate-full-sweep.mjs`; this file is the network
// half — it turns recent Actions runs into the observations that rule grades.
//
//   node tools/scripts/check-main-gate-full-sweep.mjs
//   node tools/scripts/check-main-gate-full-sweep.mjs --explain   # no writes
//
// Writes `due=true|false` to $GITHUB_OUTPUT. ALWAYS exits 0: this decides
// whether to spend runner minutes, and a gate that went red because it could
// not decide would be a worse outcome than spending them.
import { execFile as execFileCb } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { DEFAULT_INTERVAL_MINUTES, decideFullSweep } from './lib/main-gate-full-sweep.mjs'

const execFile = promisify(execFileCb)

const args = process.argv.slice(2)
const EXPLAIN = args.includes('--explain')
const flag = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : ''
}

const say = (msg) => process.stderr.write(`full-sweep: ${msg}\n`)

const repo = flag('repo') || process.env['GITHUB_REPOSITORY'] || 'aglyn/aglyn'
const eventName = flag('event') || process.env['GITHUB_EVENT_NAME'] || 'push'
const headSha = flag('sha') || process.env['GITHUB_SHA'] || ''
const schedule = flag('schedule') || process.env['MAIN_GATE_SCHEDULE'] || ''
const inputsFull = (flag('inputs-full') || process.env['MAIN_GATE_INPUTS_FULL'] || '') === 'true'
const intervalMinutes =
  Number(process.env['MAIN_GATE_FULL_INTERVAL_MINUTES'] || '') || DEFAULT_INTERVAL_MINUTES

/** How far back to look for the newest `full` job before giving up. */
const RUN_SCAN_LIMIT = 25

const gh = (path) =>
  execFile('gh', ['api', path], { encoding: 'utf8' }).then(({ stdout }) => JSON.parse(stdout))

/** Runs fetched per round. Sized so the common answer needs exactly one. */
const BATCH = 8

/**
 * The Actions API has no "find this job across runs" query, so the newest
 * `full` job is found by walking runs newest-first. The walk stops at the first
 * run that actually RAN the sweep — `full` is skipped on most runs by design,
 * and a skipped job is not an observation of anything.
 *
 * The walk is ordered but the FETCHES are not: `full` runs roughly once in
 * seven runs, so one request at a time spent ~11 seconds of every push waiting
 * on serial round trips. Batching keeps the ordering that decides the answer
 * and drops the wait to about two seconds.
 */
async function collectObservations() {
  const runs =
    (await gh(`repos/${repo}/actions/workflows/main-gate.yml/runs?per_page=${RUN_SCAN_LIMIT}`))
      .workflow_runs ?? []
  const observations = []
  for (let i = 0; i < runs.length; i += BATCH) {
    const slice = runs.slice(i, i + BATCH)
    const jobsFor = await Promise.all(
      slice.map((run) => gh(`repos/${repo}/actions/runs/${run.id}/jobs`)),
    )
    for (const [n, run] of slice.entries()) {
      const full = (jobsFor[n].jobs ?? []).find((j) => String(j.name ?? '').startsWith('full'))
      if (!full || full.conclusion === 'skipped') continue
      observations.push({
        startedAt: full.started_at ?? run.created_at,
        status: full.status,
        conclusion: full.conclusion,
        headSha: run.head_sha,
      })
      // One completed sweep is enough to measure the interval. Anything older
      // cannot change the answer, so the walk stops rather than paging history.
      if (!['queued', 'in_progress', 'waiting'].includes(String(full.status))) return observations
    }
  }
  return observations
}

let decision
// A cheap event needs no network at all: a dispatch and a cron carry their own
// answer, so the API is only consulted on the push path that actually needs it.
if (eventName !== 'push') {
  decision = decideFullSweep({ eventName, schedule, inputsFull, intervalMinutes })
} else {
  try {
    decision = decideFullSweep({
      eventName,
      schedule,
      inputsFull,
      headSha,
      observations: await collectObservations(),
      now: Date.now(),
      intervalMinutes,
    })
  } catch (error) {
    // FAIL OPEN, on the same reasoning the `moved` guard states: the cost of
    // being wrong here is wasted minutes, and the cost of the other error is a
    // sweep that silently stops happening — which is the bug being fixed. The
    // blast radius is bounded by the job's `main-gate-full` concurrency group,
    // which holds one running plus one pending however many pushes land.
    decision = { due: true, reason: `could not read recent runs (${error.message}) — running the sweep` }
    say(`::warning::could not read recent runs, so the sweep runs unconditionally: ${error.message}`)
  }
}

say(`${decision.due ? 'DUE' : 'not due'} — ${decision.reason}`)

if (!EXPLAIN) {
  const out = process.env['GITHUB_OUTPUT']
  if (out) appendFileSync(out, `due=${decision.due}\nreason=${decision.reason}\n`)
  const summary = process.env['GITHUB_STEP_SUMMARY']
  if (summary) {
    appendFileSync(
      summary,
      `### full sweep\n\n${decision.due ? '**running**' : '**skipped**'} — ${decision.reason}\n\n`,
    )
  }
}

process.exit(0)
