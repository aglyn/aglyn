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
 * RUN THE EDGE SAMPLER WITH NO LONG-LIVED CREDENTIAL AT ALL (AGL-2758)
 *
 * The sampler used to reach GitHub Actions the long way round: Cloud Scheduler
 * held a GitHub PAT, dispatched a workflow, and the workflow ran a script
 * against Firestore using a service-account key held as a repository secret.
 * Two permanent credentials, one of them on a clock.
 *
 *   node tools/scripts/setup-edge-admission-run.mjs --dry-run
 *   node tools/scripts/setup-edge-admission-run.mjs
 *   node tools/scripts/setup-edge-admission-run.mjs --retire-dispatch
 *   node tools/scripts/setup-edge-admission-run.mjs --retire-job
 *
 * ## Why this one could move and the signup canary could not
 *
 * `edge-admission.mjs` needs no browser. It reads metered page-view totals out
 * of Firestore and stamps a marker; `firebase-admin` is its only dependency.
 * The canary's other half walks a real signup through the Vercel checkpoint and
 * genuinely needs Chrome, which is why GitHub Actions stays its runner and why
 * only this half moves.
 *
 * ## What that removes
 *
 * Inside GCP the runtime service account arrives from the metadata server, so
 * `readServiceAccount()` finds nothing and the sampler falls through to the
 * ambient identity. Scheduler authenticates to the Run admin API with OAuth
 * minted per call. Nothing here has an expiry date, because nothing here is a
 * stored secret:
 *
 *   before   GitHub PAT (expires) + FIREBASE_PRIVATE_KEY (repo secret)
 *   after    a service account with roles/datastore.user
 *
 * ## ⚠️ A service, not a job, and OIDC, not OAuth
 *
 * This was a Cloud Run JOB. A sample takes seconds and a job bills at least a
 * minute at 1 vCPU, so `run-once-server.mjs` now serves it from a request-billed
 * service on a quarter vCPU. Do not move it back.
 *
 * Scheduler calls a SERVICE directly with an OIDC identity token whose audience
 * is the service URL (`--oidc-service-account-email`). An OAuth token here
 * yields a 401 that reads like a permissions problem and is really the wrong
 * token type.
 *
 * ## The staging directory
 *
 * Buildpacks want a small, self-contained source tree, and this repo is a
 * monorepo whose root `package.json` would drag the workspace in. So the two
 * files the sampler actually needs are copied to a temp tree at deploy time,
 * preserving the relative path the import uses, along with the small server
 * that runs it. Copied rather than duplicated in the repo, so
 * `tools/e2e/edge-admission.mjs` stays the single source.
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
const SERVICE = 'edge-admission'
/** The job the service replaced. Removed only under an explicit flag. */
const RETIRED_JOB = 'edge-admission'
const SCHEDULER_JOB = 'edge-admission-run'
/** The GitHub-dispatch row this replaces. Removed only under an explicit flag. */
const OLD_SCHEDULER_JOB = 'edge-admission-dispatch'
const SA_ID = 'edge-admission'
const SA_EMAIL = `${SA_ID}@${PROJECT}.iam.gserviceaccount.com`
/** Unchanged from the workflow it replaces: the script's own floor decides work. */
const SCHEDULE = '5,35 * * * *'

const DRY_RUN = process.argv.includes('--dry-run')
const RETIRE = process.argv.includes('--retire-dispatch')
const RETIRE_JOB = process.argv.includes('--retire-job')

function gcloud(args, { allowFail = false } = {}) {
  if (DRY_RUN && !args.includes('list') && !args.includes('describe')) {
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

/** The sampler's two files at their import paths, plus the server that runs it. */
function stageSource() {
  const dir = mkdtempSync(join(tmpdir(), 'edge-admission-'))
  mkdirSync(join(dir, 'e2e'), { recursive: true })
  mkdirSync(join(dir, 'scripts/lib'), { recursive: true })
  cpSync(
    join(REPO_ROOT, 'tools/e2e/edge-admission.mjs'),
    join(dir, 'e2e/edge-admission.mjs'),
  )
  cpSync(
    join(REPO_ROOT, 'tools/scripts/lib/firebase-rules-api.mjs'),
    join(dir, 'scripts/lib/firebase-rules-api.mjs'),
  )
  cpSync(
    join(REPO_ROOT, 'tools/scripts/run-once-server.mjs'),
    join(dir, 'run-once-server.mjs'),
  )
  writeFileSync(
    join(dir, 'run-once-routes.json'),
    `${JSON.stringify({ script: 'e2e/edge-admission.mjs', routes: { '/': {} } })}\n`,
  )
  // Straight to node: npm alone costs seconds of a quarter vCPU on a cold start.
  writeFileSync(join(dir, 'Procfile'), 'web: node run-once-server.mjs\n')
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'edge-admission-sampler',
        private: true,
        type: 'module',
        engines: { node: '>=22' },
        scripts: { start: 'node run-once-server.mjs' },
        dependencies: { 'firebase-admin': '^13' },
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
      '--display-name=Edge admission sampler (AGL-2758)',
    ])
  } else {
    console.log(`  service account ${SA_EMAIL} already exists`)
  }

  // Firestore read plus the one marker document it writes. `datastore.user` is
  // the narrowest role that covers both; `datastore.viewer` cannot stamp.
  gcloud([
    'projects',
    'add-iam-policy-binding',
    PROJECT,
    `--member=serviceAccount:${SA_EMAIL}`,
    '--role=roles/datastore.user',
    '--condition=None',
    '--quiet',
  ])
}

function deployService(sourceDir) {
  console.log(`  deploying Cloud Run service ${SERVICE} from ${sourceDir}`)
  gcloud([
    'run',
    'deploy',
    SERVICE,
    `--source=${sourceDir}`,
    `--region=${REGION}`,
    `--project=${PROJECT}`,
    `--service-account=${SA_EMAIL}`,
    `--set-env-vars=GOOGLE_CLOUD_PROJECT=${PROJECT},RUN_ONCE_TIMEOUT_MS=280000`,
    // Private, and reachable only from Scheduler inside this project.
    '--no-allow-unauthenticated',
    '--ingress=internal',
    // A quarter vCPU needs a concurrency of one. One instance is enough: a
    // second run at once would read the marker this run is about to advance.
    '--cpu=0.25',
    '--memory=512Mi',
    '--concurrency=1',
    '--min-instances=0',
    '--max-instances=1',
    '--no-cpu-boost',
    '--timeout=300',
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

function ensureScheduler(url) {
  const common = [
    `--project=${PROJECT}`,
    `--location=${REGION}`,
    `--schedule=${SCHEDULE}`,
    '--time-zone=Etc/UTC',
    `--uri=${url}/`,
    '--http-method=POST',
    `--oidc-service-account-email=${SA_EMAIL}`,
    `--oidc-token-audience=${url}`,
    '--quiet',
  ]
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
  gcloud(['scheduler', 'jobs', verb, 'http', SCHEDULER_JOB, ...common])
}

function retireJob() {
  const exists = gcloud(
    ['run', 'jobs', 'describe', RETIRED_JOB, `--project=${PROJECT}`, `--region=${REGION}`],
    { allowFail: true },
  )
  if (exists === null) {
    console.log(`  ${RETIRED_JOB} is already gone`)
    return
  }
  console.log(`  deleting job ${RETIRED_JOB}`)
  gcloud([
    'run',
    'jobs',
    'delete',
    RETIRED_JOB,
    `--project=${PROJECT}`,
    `--region=${REGION}`,
    '--quiet',
  ])
}

function retireDispatch() {
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
  console.log(`  deleting ${OLD_SCHEDULER_JOB} (the GitHub-dispatch row)`)
  gcloud([
    'scheduler',
    'jobs',
    'delete',
    OLD_SCHEDULER_JOB,
    `--project=${PROJECT}`,
    `--location=${REGION}`,
    '--quiet',
  ])
}

function main() {
  console.log(`project ${PROJECT} · region ${REGION}${DRY_RUN ? ' · DRY RUN' : ''}`)
  ensureServiceAccount()
  const staged = stageSource()
  console.log(`  staged sampler at ${staged}`)
  deployService(staged)
  ensureScheduler(serviceUrl())

  if (RETIRE_JOB) retireJob()
  if (RETIRE) {
    retireDispatch()
  } else {
    // Retiring before a real run has proved the new path would leave the check
    // with no trigger at all if the deploy were subtly wrong.
    console.log(
      `\n  ${OLD_SCHEDULER_JOB} left in place. Once this has run and the` +
        `\n  marker has advanced, re-run with --retire-dispatch to remove it.`,
    )
  }

  console.log(
    `\nNext: force one run and confirm the marker moves.\n` +
      `  gcloud scheduler jobs run ${SCHEDULER_JOB} --location=${REGION} --project=${PROJECT}\n` +
      `  gcloud logging read 'resource.labels.service_name="${SERVICE}"' --project=${PROJECT} --limit=5`,
  )
}

main()
