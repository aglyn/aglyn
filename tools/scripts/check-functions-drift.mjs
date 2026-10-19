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

// Fails when a DEPLOYED Cloud Function does not run the promoted
// `cloud/functions` source (AGL-2580, AGL-3968).
//
// Each deploy stamps the checkout's sha onto every function as the
// `AGLYN_SOURCE_SHA` environment variable (the functions predeploy hook,
// `cloud/functions/scripts/stamp-source.mjs`). This check reads the stamp off
// each deployed function and compares the package TREE at that commit with the
// baseline's. A function with no stamp is UNKNOWN and fails: a deploy time
// later than the last commit is not evidence that the deploy carried it.
//
// The third of the three manual deploy targets, and the one that had no check
// at all until two production incidents in fifteen minutes on 2026-09-04 made
// the gap expensive. A promotion merge deploys the Vercel apps; rules, indexes
// and Cloud Functions each ship by hand afterwards. Rules drift was caught by
// `check:rules-drift` within the hour. The functions half was invisible: the
// deployed `consoleFastCrons` had been built on 2026-09-01 and never learned
// the `drain-publish-outbox` route the promotion added, so a `SCHEDULED_JOBS`
// row production was already judging never ran, `/api/health/crons` returned
// `job-never-reported`, and the Scheduled jobs monitor went red.
//
//   npm run check:functions-drift
//   npm run check:functions-drift -- --baseline=origin/production
//
// BASELINE — which commit's `cloud/functions` SHOULD be live:
//   --baseline=<ref>, or FUNCTIONS_DRIFT_BASELINE. Default HEAD.
// Unlike the rules deploy, a functions deploy is not run from a pinned
// checkout — `npm --prefix cloud/functions run deploy` packs the WORKTREE. But
// the deploy is owed AT the promotion, so the commit that should be live is
// still the promoted one, and CI passes `origin/production` for the same
// reason rules-drift.yml does: a check that goes red for the whole promotion
// window is one people mute, and a muted alarm misses the real drift. Commits
// on this checkout that the baseline does not carry are printed as a PENDING
// DEPLOY ledger — information, never a failure.
//
// ⚠️ CREDENTIALS: ADC, NOT THE FIREBASE SERVICE ACCOUNT. Every other drift
// checker here authenticates as the service account in the root `.env`, and
// copying that is the first thing anyone tries. It does not work — that
// principal has no `cloudfunctions.functions.list` and the API answers 403.
// Use ADC:
//
//   FUNCTIONS_CHECK_ACCESS_TOKEN=$(gcloud auth print-access-token) \
//     npm run check:functions-drift
//
// A live `gcloud` session is found without the variable. In CI, where there is
// no gcloud, the cheapest fix is one IAM grant on the service account that
// already has repo secrets — see the cannot-check message below.
//
// Exit codes — cannot-check must NEVER masquerade as clean:
//   0  every deployed function is stamped with source whose package tree
//      equals the baseline's
//   1  at least one is stale, ahead, unstamped, dirty, of unknown source,
//      never deployed, orphaned, or not ACTIVE — each is fixed by a deploy
//   2  the comparison could not be made (no credential, auth, network, a
//      baseline ref that does not resolve, or a region the API could not
//      answer for) and nothing drifted; drift wins when both occur — both are
//      red, and drift is the more actionable signal.

import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadLocalEnv } from './lib/firebase-rules-api.mjs'
import {
  fetchDeployedFunctions,
  resolveFunctionsToken,
} from './lib/cloud-functions-api.mjs'
import {
  FUNCTIONS_ENTRY_FILE,
  FUNCTIONS_SOURCE_PATH,
  FUNCTIONS_SOURCE_PATHSPECS,
  SOURCE_STAMP_ENV,
  classifyFunctionsDrift,
  functionRegion,
  parseFunctionExports,
  renderFunctionLines,
} from './lib/functions-drift.mjs'

loadLocalEnv()

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

let baselineRef = process.env.FUNCTIONS_DRIFT_BASELINE || 'HEAD'
const args = process.argv.slice(2).filter((a) => a !== '--')
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  if (arg.startsWith('--baseline=')) {
    baselineRef = arg.slice('--baseline='.length)
    continue
  }
  if (arg === '--baseline') {
    baselineRef = args[i + 1]
    i += 1
    continue
  }
  console.error(
    `Unknown argument '${arg}'. Usage: check-functions-drift [--baseline=<ref>]`,
  )
  process.exit(2)
}
if (!baselineRef) {
  console.error(
    'Cannot check: --baseline was given without a ref. Exiting 2 (cannot-check).',
  )
  process.exit(2)
}

function git(gitArgs) {
  return execFileSync('git', gitArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

// Resolve the baseline BEFORE touching the network. An unfetched
// `origin/production` must be a loud cannot-check, never a quiet fall back to
// HEAD — that fallback would compare against the wrong tree and look like a
// genuine verdict.
let baselineSha
try {
  baselineSha = git(['rev-parse', '--verify', `${baselineRef}^{commit}`]).trim()
} catch (error) {
  console.error(
    [
      `Cannot check: baseline ref '${baselineRef}' does not resolve to a commit.`,
      `  ${error.message.trim().split('\n')[0]}`,
      '',
      'The baseline is the commit whose cloud/functions SHOULD be deployed —',
      'the promoted SHA. In CI, fetch it first (actions/checkout fetch-depth: 0).',
      '',
      'Exiting 2 (cannot-check).',
    ].join('\n'),
  )
  process.exit(2)
}
const baselineIsHead =
  baselineRef === 'HEAD' ||
  (() => {
    try {
      return git(['rev-parse', '--verify', 'HEAD^{commit}']).trim() === baselineSha
    } catch {
      return false
    }
  })()
if (!baselineIsHead) {
  console.log(
    `Baseline: ${baselineRef} (${baselineSha.slice(0, 9)}) — the promoted SHA, not this checkout's HEAD.`,
  )
}

// The newest commit AT THE BASELINE that touched the deployed package. It is
// printed for context and never grades anything (the source stamp does); its
// absence is how a shallow clone shows itself, and a shallow clone cannot
// answer the tree comparison either.
let commit = null
try {
  const line = git([
    'log',
    '-1',
    '--format=%H%x00%ct%x00%s',
    baselineSha,
    '--',
    ...FUNCTIONS_SOURCE_PATHSPECS,
  ]).trim()
  if (line) {
    const [sha, seconds, subject] = line.split('\0')
    commit = { sha, timestampMs: Number(seconds) * 1000, subject }
  }
} catch (error) {
  console.error(
    `Cannot check: reading the last ${FUNCTIONS_SOURCE_PATH} commit failed: ${error.message.trim().split('\n')[0]}`,
  )
  process.exit(2)
}
if (!commit) {
  console.error(
    [
      `Cannot check: no commit in ${baselineRef} touches ${FUNCTIONS_SOURCE_PATH}.`,
      'A shallow clone reports exactly this, because its graft commit has no',
      'history to search. Fetch the full history (fetch-depth: 0) and re-run.',
      '',
      'Exiting 2 (cannot-check) — a history this shallow cannot hold the commits',
      'the deployed functions are stamped with, so no comparison it made would',
      'mean anything.',
    ].join('\n'),
  )
  process.exit(2)
}

let declared = []
try {
  declared = parseFunctionExports(git(['show', `${baselineSha}:${FUNCTIONS_ENTRY_FILE}`]))
} catch (error) {
  console.error(
    `Cannot check: git show ${baselineRef}:${FUNCTIONS_ENTRY_FILE} failed: ${error.message.trim().split('\n')[0]}`,
  )
  process.exit(2)
}

const auth = await resolveFunctionsToken()
if (auth.error) {
  console.error(
    [
      `Cannot check: ${auth.error}`,
      '',
      'This check reads the DEPLOYED functions of the project; without a',
      'credential it cannot see them, and reporting success would be the exact',
      'silent-drift failure mode it exists to prevent (AGL-2580).',
      '',
      'Locally — ADC, not the Firebase service account:',
      '  FUNCTIONS_CHECK_ACCESS_TOKEN=$(gcloud auth print-access-token) \\',
      '    npm run check:functions-drift',
      'A live `gcloud auth login` session is picked up with no variable at all.',
      '',
      'In CI there is no gcloud. The cheapest path needs NO new secret — grant',
      'the service account the repo already holds the Cloud Functions read role',
      'once, and FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY start working here:',
      '  gcloud projects add-iam-policy-binding aglyn-main \\',
      '    --member="serviceAccount:$FIREBASE_CLIENT_EMAIL" \\',
      '    --role="roles/cloudfunctions.viewer"',
      '',
      'Exiting 2 (cannot-check). Cannot-check is NOT clean.',
    ].join('\n'),
  )
  process.exit(2)
}

let deployed
let unreachable = []
try {
  const listed = await fetchDeployedFunctions(auth)
  deployed = listed.functions
  unreachable = listed.unreachable
} catch (error) {
  console.error(
    `Cannot check: listing the deployed functions failed: ${error.message}`,
  )
  process.exit(2)
}

/**
 * Is the package at the stamped commit the package at the baseline? Tree
 * equality decides it (`git diff --quiet`), so a squashed promotion that
 * carries the same content matches; the two commit lists only explain a
 * mismatch.
 */
function compareSource(stampSha) {
  if (!/^[0-9a-f]{7,40}$/i.test(stampSha)) {
    return { known: false, same: false, missing: [], extra: [] }
  }
  const exists = spawnSync('git', ['cat-file', '-e', `${stampSha}^{commit}`], {
    cwd: repoRoot,
    stdio: 'ignore',
  })
  if (exists.status !== 0) return { known: false, same: false, missing: [], extra: [] }
  const diff = spawnSync(
    'git',
    ['diff', '--quiet', stampSha, baselineSha, '--', ...FUNCTIONS_SOURCE_PATHSPECS],
    { cwd: repoRoot, stdio: 'ignore' },
  )
  if (diff.status === 0) return { known: true, same: true, missing: [], extra: [] }
  if (diff.status !== 1) return { known: false, same: false, missing: [], extra: [] }
  const commitsIn = (range) =>
    git(['log', '--oneline', '--no-decorate', range, '--', ...FUNCTIONS_SOURCE_PATHSPECS])
      .trim()
      .split('\n')
      .filter(Boolean)
  return {
    known: true,
    same: false,
    missing: commitsIn(`${stampSha}..${baselineSha}`),
    extra: commitsIn(`${baselineSha}..${stampSha}`),
  }
}

const regions = new Set(deployed.map((fn) => functionRegion(fn.name)))
const verdict = classifyFunctionsDrift({
  deployed,
  declared,
  baselineSha,
  compareSource,
  unreachable,
})

console.log(
  `Promoted: ${commit.sha.slice(0, 9)} ${new Date(commit.timestampMs).toISOString()} — ${commit.subject}`,
)
console.log(
  `Deployed: ${deployed.length} function(s) in ${regions.size} region(s) (${[...regions].join(', ')}), credential: ${auth.source}.`,
)

if (unreachable.length > 0) {
  console.error(
    `Unreachable: ${unreachable.join(', ')} — any function there runs unknown source.`,
  )
  for (const entry of verdict.unverifiable) {
    console.error(`  UNVERIFIABLE ${entry.id}: ${entry.detail}`)
  }
}

if (!verdict.drifted) {
  console.log(
    `\nEvery function the API could see runs ${baselineRef}'s ${FUNCTIONS_SOURCE_PATH} (source stamp tree-equal to ${baselineSha.slice(0, 9)}).`,
  )
  for (const line of renderFunctionLines(verdict.current)) console.log(line)
} else {
  const label = {
    stale: 'STALE',
    ahead: 'AHEAD',
    unstamped: 'UNSTAMPED',
    dirty: 'DIRTY',
    'unknown-source': 'UNKNOWN SOURCE',
    'never-deployed': 'NEVER DEPLOYED',
    orphaned: 'ORPHANED',
    'not-active': 'NOT ACTIVE',
  }
  console.error(
    `\nDRIFT: ${verdict.findings.length} of ${deployed.length + verdict.neverDeployed.length} function(s) do not match ${baselineRef}.`,
  )
  for (const finding of verdict.findings) {
    console.error(
      `  ${label[finding.verdict]} ${finding.id} [${finding.region}] ${finding.updateTime ?? ''}`.trimEnd(),
    )
    console.error(`    ${finding.detail}`)
  }
  if (verdict.current.length > 0) {
    console.error(`\n  Running ${baselineRef}'s source:`)
    for (const line of renderFunctionLines(verdict.current)) console.error(line)
  }
}

// The pending-deploy ledger: functions commits this checkout carries that the
// baseline does not. NOT a failure — with baseline=origin/production this is
// exactly the promotion window, the state the process is designed to pass
// through. Printed so the signal survives without blocking.
if (!baselineIsHead) {
  let pending
  try {
    pending = git([
      'log',
      '--oneline',
      '--no-decorate',
      `${baselineSha}..HEAD`,
      '--',
      FUNCTIONS_SOURCE_PATH,
    ]).trim()
  } catch {
    pending = ''
  }
  if (pending) {
    const lines = pending.split('\n')
    console.log(
      `\nPENDING DEPLOY — ${lines.length} functions commit(s) in ${baselineRef}..HEAD, owed at the next promotion:`,
    )
    for (const line of lines) console.log(`  ${line}`)
  }
}

if (verdict.drifted) {
  console.error(
    [
      '',
      'To converge, from a CLEAN checkout at the promoted SHA:',
      '  npm --prefix cloud/functions run deploy   # firebase deploy --only functions',
      `Its predeploy hook stamps every function with that checkout's sha as ${SOURCE_STAMP_ENV},`,
      'which is what this check compares; a full deploy, so every function gets the stamp.',
      '',
      'Then confirm the scheduler agrees, which is the half a stale deploy does',
      'not change:',
      // Both lines name the operator's OWN project and console through the
      // variables the scripts already read, never a literal. A self-hosted
      // deployment reading a hardcoded host would be told to curl a service it
      // has no account on, and the answer it got would be about somebody
      // else's crons.
      '  gcloud scheduler jobs list --location=us-central1 --project="$GCLOUD_PROJECT"',
      '  curl -s "$AGLYN_CONSOLE_URL/api/health/crons"',
    ].join('\n'),
  )
  process.exit(1)
}
if (unreachable.length > 0) {
  console.error(
    `\nCannot check: the API could not answer for ${unreachable.join(', ')}. ` +
      'A function in an unreachable region runs unknown source, and unknown is not clean.',
  )
  process.exit(2)
}
console.log(`\nAll deployed functions match ${baselineRef}.`)
