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
 * ## ⚠️ OAuth, not OIDC
 *
 * A Cloud Run JOB is started by calling the Run admin API, which is a Google
 * API and wants an OAuth token (`--oauth-service-account-email`). OIDC is for
 * invoking a Cloud Run SERVICE — your own endpoint checking an identity token.
 * Using OIDC here yields a 401 from `run.googleapis.com` that reads like a
 * permissions problem and is really the wrong token type.
 *
 * ## The staging directory
 *
 * Buildpacks want a small, self-contained source tree, and this repo is a
 * monorepo whose root `package.json` would drag the workspace in. So the two
 * files the sampler actually needs are copied to a temp tree at deploy time,
 * preserving the relative path the import uses. Copied rather than duplicated
 * in the repo, so `tools/e2e/edge-admission.mjs` stays the single source.
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
const JOB = 'edge-admission'
const SCHEDULER_JOB = 'edge-admission-run'
/** The GitHub-dispatch row this replaces. Removed only under an explicit flag. */
const OLD_SCHEDULER_JOB = 'edge-admission-dispatch'
const SA_ID = 'edge-admission'
const SA_EMAIL = `${SA_ID}@${PROJECT}.iam.gserviceaccount.com`
/** Unchanged from the workflow it replaces: the script's own floor decides work. */
const SCHEDULE = '5,35 * * * *'

const DRY_RUN = process.argv.includes('--dry-run')
const RETIRE = process.argv.includes('--retire-dispatch')

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

/** The two files the sampler needs, at the paths its imports expect. */
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
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'edge-admission-sampler',
        private: true,
        type: 'module',
        engines: { node: '>=22' },
        // Buildpacks run `npm start`; the job exits when the sampler does.
        scripts: { start: 'node e2e/edge-admission.mjs' },
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

function deployJob(sourceDir) {
  console.log(`  deploying Cloud Run job ${JOB} from ${sourceDir}`)
  gcloud([
    'run',
    'jobs',
    'deploy',
    JOB,
    `--source=${sourceDir}`,
    `--region=${REGION}`,
    `--project=${PROJECT}`,
    `--service-account=${SA_EMAIL}`,
    `--set-env-vars=GOOGLE_CLOUD_PROJECT=${PROJECT}`,
    // One attempt. A retry would re-read the marker this run just advanced and
    // decide "unchanged" against its own write.
    '--max-retries=0',
    '--task-timeout=300s',
    '--memory=512Mi',
    '--quiet',
  ])

  // Scheduler calls the Run ADMIN api, so the invoker binding goes on the job.
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
  const common = [
    `--project=${PROJECT}`,
    `--location=${REGION}`,
    `--schedule=${SCHEDULE}`,
    '--time-zone=Etc/UTC',
    `--uri=${uri}`,
    '--http-method=POST',
    `--oauth-service-account-email=${SA_EMAIL}`,
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
  deployJob(staged)
  ensureScheduler()

  if (RETIRE) {
    retireDispatch()
  } else {
    // Retiring before a real run has proved the new path would leave the check
    // with no trigger at all if the deploy were subtly wrong.
    console.log(
      `\n  ${OLD_SCHEDULER_JOB} left in place. Once this job has run and the` +
        `\n  marker has advanced, re-run with --retire-dispatch to remove it.`,
    )
  }

  console.log(
    `\nNext: force one run and confirm the marker moves.\n` +
      `  gcloud scheduler jobs run ${SCHEDULER_JOB} --location=${REGION} --project=${PROJECT}\n` +
      `  gcloud run jobs executions list --job=${JOB} --region=${REGION} --project=${PROJECT} --limit=3`,
  )
}

main()
