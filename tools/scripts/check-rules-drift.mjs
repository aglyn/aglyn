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

// Fails when the LIVE Firebase security rules drift from the BASELINE ref
// (AGL-1509; baseline added by AGL-1690).
//
// Rules deploy manually (deploy-*-rules.mjs), outside the git pipeline, so a
// merged commit touching cloud/firebase-*.rules is NOT evidence the ruleset
// shipped: AGL-1489 found production Firestore rules a day behind HEAD with
// `mediaTombstones` missing from the deny-lists, and only a manual sweep
// noticed. This script IS that sweep, runnable: it fetches the live rules for
// all three surfaces and diffs each against `git show <baseline>:cloud/...`.
//
//   npm run check:rules-drift              # all three surfaces
//   npm run check:rules-drift -- storage   # a subset: firestore|storage|database
//
// BASELINE — which commit's rules file *should* be live (AGL-1690):
//   --baseline=<ref>, or RULES_DRIFT_BASELINE. Default HEAD.
// Rules deploy from a checkout pinned to the PROMOTED SHA, never from `main`,
// so on `main` the correct baseline is `origin/production` — the ruleset live
// is the one at the last promotion, and `main` being ahead of it between a
// rules commit and the next promotion is the DESIGNED state, not a fault. CI
// compares against origin/production for exactly that reason; a check that
// goes red on every rules commit for the whole promotion window is one people
// mute, and a muted alarm misses the real drift (a console hot-fix, or a
// deploy silently skipped at promotion). In a pinned checkout — which is
// where the deploy scripts run — HEAD *is* the promoted SHA, so the default
// needs no flag.
//
// When the baseline is not HEAD, commits in `<baseline>..HEAD` that touch a
// rules file are listed as PENDING DEPLOY. That is information, never a
// failure: it is the ledger of what is owed at the next promotion.
//
// Auth: the deploy scripts' exact pattern, shared via lib/firebase-rules-api
// — service account from the root .env (FIREBASE_PROJECT_ID,
// FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY; self-loaded, already-set env
// wins). RULES_CHECK_ACCESS_TOKEN skips minting (e.g.
// `RULES_CHECK_ACCESS_TOKEN=$(gcloud auth print-access-token)`).
//
// Exit codes — cannot-check must NEVER masquerade as clean:
//   0  every checked surface matches the baseline
//   1  drift on at least one surface (unified diff printed, direction named)
//   2  at least one surface could not be checked (missing creds, auth,
//      network, or a baseline ref that does not resolve) and none drifted;
//      drift wins when both occur — both are red, and drift is the more
//      actionable signal. An unresolvable baseline is exit 2, never a silent
//      fallback to HEAD: falling back would quietly restore the very
//      comparison the flag was passed to replace.
//
// Trailing-newline-only and line-ending-only differences are NOT drift, and
// RTDB JSON that deep-equals after parsing is formatting-only — see
// lib/rules-drift.mjs for why crying wolf would defeat the check.

import { basename } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  fetchLiveDatabaseRules,
  fetchLiveRulesetContent,
  getServiceAccountToken,
  loadLocalEnv,
  readServiceAccount,
  resolveDatabaseUrl,
  resolveStorageBucket,
} from './lib/firebase-rules-api.mjs'
import { compareRules, renderUnifiedDiff } from './lib/rules-drift.mjs'

loadLocalEnv()

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

const SURFACES = {
  firestore: {
    file: 'cloud/firebase-firestore.rules',
    jsonAware: false,
    fetchLive: ({ token, projectId }) =>
      fetchLiveRulesetContent({ token, projectId, releaseId: 'cloud.firestore' }),
    describeLive: ({ projectId }) =>
      `release cloud.firestore (project ${projectId})`,
  },
  storage: {
    file: 'cloud/firebase-storage.rules',
    jsonAware: false,
    fetchLive: ({ token, projectId }) =>
      fetchLiveRulesetContent({
        token,
        projectId,
        releaseId: `firebase.storage/${resolveStorageBucket(projectId)}`,
      }),
    describeLive: ({ projectId }) =>
      `release firebase.storage/${resolveStorageBucket(projectId)}`,
  },
  database: {
    file: 'cloud/firebase-database.rules.json',
    jsonAware: true,
    fetchLive: ({ token, projectId }) =>
      fetchLiveDatabaseRules({
        token,
        databaseUrl: resolveDatabaseUrl(projectId),
      }),
    describeLive: ({ projectId }) =>
      `${resolveDatabaseUrl(projectId)}/.settings/rules.json`,
  },
}

const args = process.argv.slice(2).filter((a) => a !== '--')

// --baseline=<ref> / --baseline <ref>, else RULES_DRIFT_BASELINE, else HEAD.
let baselineRef = process.env.RULES_DRIFT_BASELINE || 'HEAD'
const positional = []
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
  positional.push(arg)
}
if (!baselineRef) {
  console.error(
    'Cannot check: --baseline was given without a ref. Exiting 2 (cannot-check).',
  )
  process.exit(2)
}

const selected = positional.length > 0 ? positional : Object.keys(SURFACES)
for (const name of selected) {
  if (!SURFACES[name]) {
    console.error(
      `Unknown surface '${name}'. Valid: ${Object.keys(SURFACES).join(', ')}.`,
    )
    process.exit(2)
  }
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
// HEAD — that fallback would report the promotion window as drift again and
// look like a real failure.
let baselineSha
try {
  baselineSha = git(['rev-parse', '--verify', `${baselineRef}^{commit}`]).trim()
} catch (error) {
  console.error(
    [
      `Cannot check: baseline ref '${baselineRef}' does not resolve to a commit.`,
      `  ${error.message.trim().split('\n')[0]}`,
      '',
      'The baseline is the commit whose rules file SHOULD be live — the',
      'promoted SHA. In CI, fetch it first (actions/checkout fetch-depth: 0),',
      'or point --baseline / RULES_DRIFT_BASELINE at a ref that exists.',
      '',
      'Exiting 2 (cannot-check). Falling back to HEAD would silently restore',
      'the wrong comparison, so this is deliberately not a warning.',
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

const projectId = process.env.FIREBASE_PROJECT_ID
const serviceAccount = readServiceAccount()
const tokenOverride = process.env.RULES_CHECK_ACCESS_TOKEN
if (!projectId || (!serviceAccount && !tokenOverride)) {
  console.error(
    [
      'Cannot check: missing Firebase service-account credentials.',
      '',
      'This check compares LIVE security rules against HEAD; without',
      'credentials it cannot see live, and reporting success here would be',
      'the silent-drift failure mode it exists to prevent (AGL-1489).',
      '',
      'Locally: the repo .env supplies FIREBASE_PROJECT_ID,',
      'FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY (self-loaded).',
      'In CI: create the repo secrets once —',
      "  gh secret set FIREBASE_CLIENT_EMAIL --body '<client_email from the service-account JSON>'",
      '  gh secret set FIREBASE_PRIVATE_KEY --body "$(jq -r .private_key service-account.json)"',
      'Alternatively set RULES_CHECK_ACCESS_TOKEN (e.g. gcloud auth',
      'print-access-token) together with FIREBASE_PROJECT_ID.',
      '',
      'Exiting 2 (cannot-check). Cannot-check is NOT clean.',
    ].join('\n'),
  )
  process.exit(2)
}

let token
try {
  token = tokenOverride || (await getServiceAccountToken(serviceAccount))
} catch (error) {
  console.error(`Cannot check: minting an access token failed: ${error.message}`)
  process.exit(2)
}

function baselineContent(file) {
  return git(['show', `${baselineSha}:${file}`])
}

let sawDrift = false
let sawCannotCheck = false

for (const name of selected) {
  const surface = SURFACES[name]
  let head
  try {
    head = baselineContent(surface.file)
  } catch (error) {
    console.error(
      `CANNOT CHECK ${name}: git show ${baselineRef}:${surface.file} failed: ${error.message}`,
    )
    sawCannotCheck = true
    continue
  }
  let live
  try {
    live = await surface.fetchLive({ token, projectId })
  } catch (error) {
    console.error(
      `CANNOT CHECK ${name} (${surface.describeLive({ projectId })}): ${error.message}`,
    )
    sawCannotCheck = true
    continue
  }
  const verdict = compareRules({
    liveText: live.content,
    headText: head,
    jsonAware: surface.jsonAware,
    baselineLabel: baselineRef,
  })
  const liveId = live.rulesetName ? ` [live ${live.rulesetName}]` : ''
  if (!verdict.drift) {
    const note = verdict.formattingOnly
      ? ' (JSON formatting differs, content identical)'
      : ''
    console.log(
      `OK ${name}: live matches ${baselineRef}:${surface.file}${note}${liveId}`,
    )
    continue
  }
  sawDrift = true
  console.error(
    `DRIFT ${name}: live differs from ${baselineRef}:${surface.file}${liveId}`,
  )
  console.error(`  ${verdict.summary}`)
  console.error(
    `  Diff is live -> ${baselineRef}: \`+\` lines are committed but NOT live; \`-\` lines are live but in no commit.`,
  )
  console.error(
    renderUnifiedDiff(live.content, head, {
      fileName: basename(surface.file),
      baselineLabel: baselineRef,
    }),
  )
}

// The pending-deploy ledger: rules commits this checkout carries that the
// baseline does not. NOT a failure — with baseline=origin/production this is
// exactly the promotion window, the state the deploy process is designed to
// pass through. Printed so the signal survives without blocking (AGL-1690).
if (!baselineIsHead) {
  const files = selected.map((name) => SURFACES[name].file)
  let pending = ''
  try {
    pending = git([
      'log',
      '--oneline',
      '--no-decorate',
      `${baselineSha}..HEAD`,
      '--',
      ...files,
    ]).trim()
  } catch (error) {
    console.log(
      `\n(Could not list pending rules commits: ${error.message.trim().split('\n')[0]})`,
    )
  }
  if (pending) {
    const lines = pending.split('\n')
    console.log(
      `\nPENDING DEPLOY — ${lines.length} rules commit(s) in ${baselineRef}..HEAD, owed at the next promotion:`,
    )
    for (const line of lines) console.log(`  ${line}`)
    console.log(
      '  Not a failure: rules ship WITH the promotion, from a checkout pinned',
    )
    console.log(
      `  to the promoted SHA. These go live when ${baselineRef} advances to include them.`,
    )
  }
}

if (sawDrift) {
  console.error(
    '\nDrift detected. To converge: review the diff, then run the matching',
  )
  console.error(
    `tools/scripts/deploy-*-rules.mjs (${baselineRef} ahead) or commit the live`,
  )
  console.error(
    'edits first (live ahead). Never blind-deploy over a divergence.',
  )
  if (!baselineIsHead) {
    console.error(
      `Note the deploy script reads the WORKTREE, not a ref: pin the checkout to ${baselineRef} first.`,
    )
  }
  process.exit(1)
}
if (sawCannotCheck) {
  console.error('\nAt least one surface could not be checked — exiting 2, not 0.')
  process.exit(2)
}
console.log(`All checked surfaces match ${baselineRef}.`)
