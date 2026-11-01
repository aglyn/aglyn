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
 * REPLACE THE EXPIRING DISPATCH TOKEN WITH A GITHUB APP (AGL-2758)
 *
 *   node tools/scripts/setup-github-app-dispatch.mjs --dry-run
 *   node tools/scripts/setup-github-app-dispatch.mjs
 *   node tools/scripts/setup-github-app-dispatch.mjs --retire-pat
 *   node tools/scripts/setup-github-app-dispatch.mjs --retire-jobs
 *
 * `signup-canary-dispatch` held a fine-grained PAT in its own headers and that
 * token expires 2026-12-09. The org policy is "fine-grained personal access
 * tokens must expire", capped at 366 days, so no PAT here can be permanent and
 * lifting the policy would loosen it for every member and every resource.
 *
 * A GitHub App sidesteps the policy entirely: the private key does not expire,
 * and what crosses the network hourly is a one-hour installation token minted
 * from it. The key lives in Secret Manager and is mounted into the service at
 * run time, so it is never in a scheduler header, a repo secret, or this repo.
 *
 * ## Why the canary could not move into GCP the way the sampler did
 *
 * `edge-admission` needed nothing but `firebase-admin`, so it became a Cloud
 * Run job authenticating as its own service account and lost BOTH credentials.
 * The canary walks a real signup through the Vercel checkpoint: it needs Chrome
 * and two secrets that are write-only in GitHub, which nobody can read back
 * out: `AGLYN_PROBE_TOKEN`, and the App Check debug token `signup-canary.yml`
 * binds (`app-check-debug-token.spec.ts` allows that variable's name only in
 * the files it lists). So the walk stays on Actions, where minutes are free and
 * those secrets already live, and only the TRIGGER moves here.
 *
 * ## ⚠️ A service, not a job, and OIDC, not OAuth
 *
 * This was two Cloud Run JOBS. A dispatch takes two seconds and a job bills at
 * least a minute at 1 vCPU, so `run-once-server.mjs` now serves the dispatcher
 * from one request-billed service on a quarter vCPU. Do not move it back.
 *
 * Scheduler calls a SERVICE directly, which wants an OIDC identity token whose
 * audience is the service URL. An OAuth token here yields a 401 that reads like
 * a permissions problem.
 */

import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../..')

const PROJECT = process.env.GCP_PROJECT ?? 'aglyn-main'
const REGION = process.env.GCP_RUN_REGION ?? 'us-central1'
const SERVICE = 'github-dispatch'
/** The jobs the service replaced. Removed only under an explicit flag. */
const RETIRED_JOBS = ['github-dispatch-signup-canary', 'github-dispatch-uptime-probe']
/** The PAT-based row the App replaced. Removed only under an explicit flag. */
const OLD_SCHEDULER_JOB = 'signup-canary-dispatch'
const SA_ID = 'github-dispatch'
const SA_EMAIL = `${SA_ID}@${PROJECT}.iam.gserviceaccount.com`
const SECRET = 'github-dispatch-app-key'
/** Non-secret identifiers of the App and its single installation. */
const APP_ID = process.env.GITHUB_APP_ID ?? '4901513'
const INSTALLATION_ID = process.env.GITHUB_APP_INSTALLATION_ID ?? '160694363'
/** One Scheduler row per workflow, each POSTing to its own route. */
const DISPATCHES = [
  {
    route: '/signup-canary',
    workflow: 'signup-canary.yml',
    schedulerJob: 'signup-canary-dispatch-app',
    schedule: '25 * * * *',
  },
  {
    route: '/uptime-probe',
    workflow: 'uptime-probe.yml',
    schedulerJob: 'uptime-probe-dispatch-app',
    schedule: '7,22,37,52 * * * *',
  },
]

const DRY_RUN = process.argv.includes('--dry-run')
const RETIRE = process.argv.includes('--retire-pat')
const RETIRE_JOBS = process.argv.includes('--retire-jobs')

function gcloud(args, { allowFail = false } = {}) {
  if (DRY_RUN && !args.includes('describe') && !args.includes('list')) {
    console.log(`  [dry run] gcloud ${args.join(' ')}`)
    return ''
  }
  try {
    return execFileSync('gcloud', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    }).trim()
  } catch (error) {
    if (allowFail) return null
    const detail = error.stderr?.toString?.() ?? error.message
    throw new Error(`gcloud ${args.slice(0, 3).join(' ')} failed:\n${detail}`, {
      cause: error,
    })
  }
}

/** The dispatcher, its server and a package.json. It has no dependencies. */
function stageSource() {
  const dir = mkdtempSync(join(tmpdir(), 'github-dispatch-'))
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  cpSync(
    join(REPO_ROOT, 'tools/scripts/github-app-dispatch.mjs'),
    join(dir, 'scripts/github-app-dispatch.mjs'),
  )
  cpSync(
    join(REPO_ROOT, 'tools/scripts/run-once-server.mjs'),
    join(dir, 'run-once-server.mjs'),
  )
  writeFileSync(
    join(dir, 'run-once-routes.json'),
    `${JSON.stringify({
      script: 'scripts/github-app-dispatch.mjs',
      routes: Object.fromEntries(
        DISPATCHES.map(({ route, workflow }) => [
          route,
          { GITHUB_WORKFLOW_FILE: workflow },
        ]),
      ),
    })}\n`,
  )
  // Straight to node: npm alone costs seconds of a quarter vCPU on a cold start.
  writeFileSync(join(dir, 'Procfile'), 'web: node run-once-server.mjs\n')
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'github-app-dispatch',
        private: true,
        type: 'module',
        engines: { node: '>=22' },
        scripts: { start: 'node run-once-server.mjs' },
      },
      null,
      2,
    )}\n`,
  )
  return dir
}

function ensureServiceAccount() {
  const exists = gcloud(
    ['iam', 'service-accounts', 'describe', SA_EMAIL, `--project=${PROJECT}`],
    { allowFail: true },
  )
  if (exists === null) {
    console.log(`  creating service account ${SA_EMAIL}`)
    gcloud([
      'iam',
      'service-accounts',
      'create',
      SA_ID,
      `--project=${PROJECT}`,
      '--display-name=GitHub App dispatcher (AGL-2758)',
    ])
  } else {
    console.log(`  service account ${SA_EMAIL} already exists`)
  }

  // Scoped to THIS secret rather than the project: the dispatcher has no
  // business reading any other secret, and a project-wide accessor role would
  // give it every one of them.
  console.log(`  granting accessor on ${SECRET} only`)
  gcloud([
    'secrets',
    'add-iam-policy-binding',
    SECRET,
    `--project=${PROJECT}`,
    `--member=serviceAccount:${SA_EMAIL}`,
    '--role=roles/secretmanager.secretAccessor',
    '--quiet',
  ])
}

function deployService(sourceDir) {
  console.log(`  deploying Cloud Run service ${SERVICE}`)
  gcloud([
    'run',
    'deploy',
    SERVICE,
    `--source=${sourceDir}`,
    `--region=${REGION}`,
    `--project=${PROJECT}`,
    `--service-account=${SA_EMAIL}`,
    `--set-secrets=GITHUB_APP_PRIVATE_KEY=${SECRET}:latest`,
    `--set-env-vars=GITHUB_APP_ID=${APP_ID},GITHUB_APP_INSTALLATION_ID=${INSTALLATION_ID},GITHUB_REPOSITORY=aglyn/aglyn`,
    // Private, and reachable only from Scheduler inside this project.
    '--no-allow-unauthenticated',
    '--ingress=internal',
    // A quarter vCPU needs a concurrency of one; two instances cover overlap.
    '--cpu=0.25',
    '--memory=256Mi',
    '--concurrency=1',
    '--min-instances=0',
    '--max-instances=2',
    '--no-cpu-boost',
    '--timeout=120',
    '--quiet',
  ])
  gcloud([
    'run',
    'services',
    'add-iam-policy-binding',
    SERVICE,
    `--region=${REGION}`,
    `--project=${PROJECT}`,
    `--member=serviceAccount:${SA_EMAIL}`,
    '--role=roles/run.invoker',
    '--quiet',
  ])
}

function serviceUrl() {
  if (DRY_RUN) return `https://${SERVICE}.example.run.app`
  return gcloud([
    'run',
    'services',
    'describe',
    SERVICE,
    `--region=${REGION}`,
    `--project=${PROJECT}`,
    '--format=value(status.url)',
  ])
}

function ensureScheduler(url, { route, schedulerJob, schedule }) {
  const exists = gcloud(
    [
      'scheduler',
      'jobs',
      'describe',
      schedulerJob,
      `--project=${PROJECT}`,
      `--location=${REGION}`,
    ],
    { allowFail: true },
  )
  const verb = exists === null ? 'create' : 'update'
  console.log(`  ${verb} scheduler job ${schedulerJob} (${schedule} UTC)`)
  gcloud([
    'scheduler',
    'jobs',
    verb,
    'http',
    schedulerJob,
    `--project=${PROJECT}`,
    `--location=${REGION}`,
    `--schedule=${schedule}`,
    '--time-zone=Etc/UTC',
    `--uri=${url}${route}`,
    '--http-method=POST',
    `--oidc-service-account-email=${SA_EMAIL}`,
    `--oidc-token-audience=${url}`,
    '--quiet',
  ])
}

function retireJobs() {
  for (const job of RETIRED_JOBS) {
    const exists = gcloud(
      ['run', 'jobs', 'describe', job, `--project=${PROJECT}`, `--region=${REGION}`],
      { allowFail: true },
    )
    if (exists === null) {
      console.log(`  ${job} is already gone`)
      continue
    }
    console.log(`  deleting ${job}`)
    gcloud([
      'run',
      'jobs',
      'delete',
      job,
      `--project=${PROJECT}`,
      `--region=${REGION}`,
      '--quiet',
    ])
  }
}

function retirePat() {
  const exists = gcloud(
    [
      'scheduler',
      'jobs',
      'describe',
      OLD_SCHEDULER_JOB,
      `--project=${PROJECT}`,
      `--location=${REGION}`,
    ],
    { allowFail: true },
  )
  if (exists === null) {
    console.log(`  ${OLD_SCHEDULER_JOB} is already gone`)
    return
  }
  console.log(`  deleting ${OLD_SCHEDULER_JOB} (the PAT-bearing row)`)
  gcloud([
    'scheduler',
    'jobs',
    'delete',
    OLD_SCHEDULER_JOB,
    `--project=${PROJECT}`,
    `--location=${REGION}`,
    '--quiet',
  ])
  console.log(
    '\n  ⛔ The PAT itself still exists on GitHub. Delete it by hand at\n' +
      '     https://github.com/settings/personal-access-tokens — nothing here\n' +
      '     can, and a token nobody uses is still a token that can be stolen.',
  )
}

function main() {
  console.log(
    `project ${PROJECT} · region ${REGION} · app ${APP_ID}/${INSTALLATION_ID}` +
      `${DRY_RUN ? ' · DRY RUN' : ''}`,
  )
  ensureServiceAccount()
  const staged = stageSource()
  console.log(`  staged dispatcher at ${staged}`)
  deployService(staged)
  const url = serviceUrl()
  for (const dispatch of DISPATCHES) ensureScheduler(url, dispatch)

  if (RETIRE_JOBS) retireJobs()
  if (RETIRE) {
    retirePat()
  } else {
    console.log(
      `\n  ${OLD_SCHEDULER_JOB} left in place. Both rows now ask for the same` +
        `\n  workflow, and the canary's own 45-minute floor means the second` +
        `\n  ask does no work. Once a dispatch from the App has been seen,` +
        `\n  re-run with --retire-pat.`,
    )
  }

  console.log(
    `\nNext: force one run and look for a workflow_dispatch within seconds.\n` +
      `  gcloud scheduler jobs run ${DISPATCHES[0].schedulerJob} --location=${REGION} --project=${PROJECT}\n` +
      `  gh run list --workflow=${DISPATCHES[0].workflow} --event workflow_dispatch --limit 3`,
  )
}

main()
