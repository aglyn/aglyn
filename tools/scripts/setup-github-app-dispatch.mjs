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
 *
 * `signup-canary-dispatch` held a fine-grained PAT in its own headers and that
 * token expires 2026-12-09. The org policy is "fine-grained personal access
 * tokens must expire", capped at 366 days, so no PAT here can be permanent and
 * lifting the policy would loosen it for every member and every resource.
 *
 * A GitHub App sidesteps the policy entirely: the private key does not expire,
 * and what crosses the network hourly is a one-hour installation token minted
 * from it. The key lives in Secret Manager and is mounted into the job at run
 * time, so it is never in a scheduler header, a repo secret, or this repo.
 *
 * ## Why the canary could not move into GCP the way the sampler did
 *
 * `edge-admission` needed nothing but `firebase-admin`, so it became a Cloud
 * Run job authenticating as its own service account and lost BOTH credentials.
 * The canary walks a real signup through the Vercel checkpoint: it needs Chrome
 * and two secrets that are write-only in GitHub (`AGLYN_PROBE_TOKEN`,
 * `FIREBASE_APPCHECK_DEBUG_TOKEN`) which nobody can read back out. So the walk
 * stays on Actions, where minutes are free and those secrets already live, and
 * only the TRIGGER moves here.
 *
 * ## ⚠️ OAuth, not OIDC, again
 *
 * Scheduler starts a Cloud Run JOB through the Run admin API, which is a Google
 * API wanting an OAuth token. OIDC is for invoking a Cloud Run SERVICE and
 * yields a 401 that reads like a permissions problem.
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
const JOB = 'github-dispatch-signup-canary'
const SCHEDULER_JOB = 'signup-canary-dispatch-app'
/** The PAT-based row this replaces. Removed only under an explicit flag. */
const OLD_SCHEDULER_JOB = 'signup-canary-dispatch'
const SA_ID = 'github-dispatch'
const SA_EMAIL = `${SA_ID}@${PROJECT}.iam.gserviceaccount.com`
const SECRET = 'github-dispatch-app-key'
/** Non-secret identifiers of the App and its single installation. */
const APP_ID = process.env.GITHUB_APP_ID ?? '4901513'
const INSTALLATION_ID = process.env.GITHUB_APP_INSTALLATION_ID ?? '160694363'
const WORKFLOW = 'signup-canary.yml'
/** Unchanged from the row it replaces. */
const SCHEDULE = '25 * * * *'

const DRY_RUN = process.argv.includes('--dry-run')
const RETIRE = process.argv.includes('--retire-pat')

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

/** The dispatcher plus a package.json, and nothing else — it has no deps. */
function stageSource() {
  const dir = mkdtempSync(join(tmpdir(), 'github-dispatch-'))
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  cpSync(
    join(REPO_ROOT, 'tools/scripts/github-app-dispatch.mjs'),
    join(dir, 'scripts/github-app-dispatch.mjs'),
  )
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'github-app-dispatch',
        private: true,
        type: 'module',
        engines: { node: '>=22' },
        scripts: { start: 'node scripts/github-app-dispatch.mjs' },
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

function deployJob(sourceDir) {
  console.log(`  deploying Cloud Run job ${JOB}`)
  gcloud([
    'run',
    'jobs',
    'deploy',
    JOB,
    `--source=${sourceDir}`,
    `--region=${REGION}`,
    `--project=${PROJECT}`,
    `--service-account=${SA_EMAIL}`,
    `--set-secrets=GITHUB_APP_PRIVATE_KEY=${SECRET}:latest`,
    `--set-env-vars=GITHUB_APP_ID=${APP_ID},GITHUB_APP_INSTALLATION_ID=${INSTALLATION_ID},GITHUB_WORKFLOW_FILE=${WORKFLOW},GITHUB_REPOSITORY=aglyn/aglyn`,
    // A dispatch is not idempotent -- a retry would start a second walk.
    '--max-retries=0',
    '--task-timeout=120s',
    // 512Mi is the FLOOR, not a sizing judgement: the gen2 execution
    // environment refuses anything smaller when CPU is always allocated, and
    // 256Mi is rejected at deploy time after the container has already built.
    '--memory=512Mi',
    '--quiet',
  ])
  gcloud([
    'run',
    'jobs',
    'add-iam-policy-binding',
    JOB,
    `--region=${REGION}`,
    `--project=${PROJECT}`,
    `--member=serviceAccount:${SA_EMAIL}`,
    '--role=roles/run.invoker',
    '--quiet',
  ])
}

function ensureScheduler() {
  const uri =
    `https://run.googleapis.com/v2/projects/${PROJECT}` +
    `/locations/${REGION}/jobs/${JOB}:run`
  const exists = gcloud(
    [
      'scheduler',
      'jobs',
      'describe',
      SCHEDULER_JOB,
      `--project=${PROJECT}`,
      `--location=${REGION}`,
    ],
    { allowFail: true },
  )
  const verb = exists === null ? 'create' : 'update'
  console.log(`  ${verb} scheduler job ${SCHEDULER_JOB} (${SCHEDULE} UTC)`)
  gcloud([
    'scheduler',
    'jobs',
    verb,
    'http',
    SCHEDULER_JOB,
    `--project=${PROJECT}`,
    `--location=${REGION}`,
    `--schedule=${SCHEDULE}`,
    '--time-zone=Etc/UTC',
    `--uri=${uri}`,
    '--http-method=POST',
    `--oauth-service-account-email=${SA_EMAIL}`,
    '--quiet',
  ])
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
  deployJob(staged)
  ensureScheduler()

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
      `  gcloud scheduler jobs run ${SCHEDULER_JOB} --location=${REGION} --project=${PROJECT}\n` +
      `  gh run list --workflow=${WORKFLOW} --event workflow_dispatch --limit 3`,
  )
}

main()
