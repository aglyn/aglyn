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
 * DRIVE THE SCHEDULED CHECKS FROM A SCHEDULER THAT HONORS A RATE (AGL-2723)
 *
 * GitHub serves `schedule` from a best-effort queue and drops most of what it
 * is asked for. Measured 2026-09-10: `uptime-probe.yml` asks every fifteen
 * minutes and fired at gaps of 1h55m to 4h38m; the whole repo went from 02:31Z
 * to 04:33Z with no scheduled run of anything while GitHub reported all
 * systems operational; and the signup canary, asking hourly and then twice
 * hourly, was never served at all in four hours.
 *
 * Cloud Scheduler does not drift, and this project already runs nine jobs on
 * it. AGL-1617 made exactly this move for two cron rows and tightened their
 * freshness windows from 90 minutes to 45 as a result — that is the precedent
 * this follows.
 *
 * GitHub Actions stays the RUNNER. The signup walk needs a real Chrome and a
 * hosted runner is the cheapest honest way to get one; only the trigger moves.
 *
 *   GITHUB_DISPATCH_TOKEN=<pat> node tools/scripts/setup-canary-scheduler.mjs
 *   GITHUB_DISPATCH_TOKEN=<pat> node tools/scripts/setup-canary-scheduler.mjs --dry-run
 *
 * ## The token
 *
 * A FINE-GRAINED personal access token, this repository only, with a single
 * permission: **Actions: read and write**. Nothing else — not contents, not
 * metadata beyond what fine-grained tokens include by default. It can only
 * start workflows that already exist on the default branch.
 *
 * ⛔ It is never printed, never committed, and never passed on a command line
 * this script builds. It is read from the environment and written straight
 * into the job's header.
 *
 * ## Why the header rather than Secret Manager
 *
 * A Cloud Scheduler HTTP target cannot resolve a secret reference; something
 * would have to sit in between and read it, which is a Cloud Function whose
 * only job is to hold a string. The job config is IAM-protected exactly as a
 * secret version is, and rotating means re-running this script.
 */

import { execFileSync } from 'node:child_process'

const PROJECT = process.env.GCP_PROJECT ?? 'aglyn-main'
const LOCATION = process.env.GCP_SCHEDULER_LOCATION ?? 'us-central1'
const REPO = process.env.GITHUB_REPOSITORY ?? 'aglyn/aglyn'
const DRY_RUN = process.argv.includes('--dry-run')

/**
 * What to drive, and how often to drive it.
 *
 * The cadence is now a WORK rate rather than a request rate, because the
 * scheduler honors it: each script keeps its own floor as a backstop, but
 * nothing here depends on being asked six times to be served once any more.
 */
const JOBS = [
  {
    name: 'signup-canary-dispatch',
    workflow: 'signup-canary.yml',
    schedule: '25 * * * *',
    why: 'the hourly production signup walk (AGL-2715)',
  },
  {
    name: 'edge-admission-dispatch',
    workflow: 'edge-admission.yml',
    schedule: '5,35 * * * *',
    why: 'the metered-traffic sample that watches the edge (AGL-2720)',
  },
]

function gcloud(args) {
  if (DRY_RUN) {
    // The token is in the arg list, so a dry run prints the SHAPE only.
    console.log(`  gcloud ${args.map(redact).join(' ')}`)
    return ''
  }
  return execFileSync('gcloud', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

const redact = (arg) =>
  /Authorization=Bearer/i.test(arg) ? 'Authorization=Bearer ***' : arg

function exists(name) {
  try {
    execFileSync(
      'gcloud',
      ['scheduler', 'jobs', 'describe', name, `--location=${LOCATION}`, `--project=${PROJECT}`],
      { stdio: 'ignore' },
    )
    return true
  } catch {
    return false
  }
}

function main() {
  const token = process.env.GITHUB_DISPATCH_TOKEN
  if (!token && !DRY_RUN) {
    console.error(
      'GITHUB_DISPATCH_TOKEN is not set.\n\n' +
        'Mint a FINE-GRAINED token at\n' +
        '  https://github.com/settings/personal-access-tokens/new\n' +
        `  Repository access: only ${REPO}\n` +
        '  Permissions: Actions = Read and write (nothing else)\n\n' +
        'Then re-run with it in the environment. It is never printed or stored\n' +
        'by this script beyond the Cloud Scheduler job it creates.',
    )
    process.exit(2)
  }

  for (const job of JOBS) {
    const verb = exists(job.name) ? 'update' : 'create'
    console.log(`${verb} ${job.name} — ${job.why} — ${job.schedule}`)
    gcloud([
      'scheduler',
      'jobs',
      verb,
      'http',
      job.name,
      `--location=${LOCATION}`,
      `--project=${PROJECT}`,
      `--schedule=${job.schedule}`,
      '--time-zone=Etc/UTC',
      `--uri=https://api.github.com/repos/${REPO}/actions/workflows/${job.workflow}/dispatches`,
      '--http-method=POST',
      `--message-body={"ref":"main"}`,
      '--headers=' +
        [
          'Content-Type=application/json',
          'Accept=application/vnd.github+json',
          'X-GitHub-Api-Version=2022-11-28',
          `Authorization=Bearer ${token ?? 'DRY-RUN'}`,
        ].join(','),
      // GitHub answers 204 with no body. Anything else is a real failure and
      // should be retried rather than swallowed.
      '--max-retry-attempts=3',
      '--attempt-deadline=30s',
    ])
  }

  console.log(
    `\n${DRY_RUN ? 'DRY RUN — nothing created.' : 'Done.'}\n` +
      'Verify with:\n' +
      `  gcloud scheduler jobs list --location=${LOCATION} --project=${PROJECT}\n` +
      'and confirm the next fire actually dispatches:\n' +
      `  gh run list --workflow=signup-canary.yml --limit 3`,
  )
}

main()
