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

// Fails when a promotion range touches a manual deploy target and that deploy
// has not happened (AGL-2580).
//
// A promotion merge deploys VERCEL APP CODE ONLY. The Firebase rules, the
// Cloud Functions and the Firestore indexes each ship afterwards, by hand,
// from a checkout at the promoted sha. On 2026-09-04 one promotion touched all
// three, one third of it shipped, the merge reported success, and two
// production incidents followed inside fifteen minutes: publishing broke
// outright on a missing rule, and a scheduled job that production had already
// started judging never ran because `consoleFastCrons` was three days stale.
//
// The standing drift checks each answer "does live match?". This one answers
// the question a promotion asks — "does THIS range owe a deploy, and is it
// done?" — which is the version that can be a gate rather than an alarm.
//
//   npm run check:promotion-deploys                          # origin/production..HEAD
//   npm run check:promotion-deploys -- --range=<base>..<head>
//   npm run check:promotion-deploys -- --list                # what is owed, no network
//
// A range that touches none of the manual paths owes nothing and passes
// without a single network call, which is what keeps this cheap enough to run
// on every promotion.
//
// Each target delegates to the checker that already knows how to compare it
// (`check-rules-drift`, `check-functions-drift`, `check-index-drift`) and
// reads its exit code on the convention all three share. Their credentials are
// therefore this script's credentials — the Firebase service account for rules
// and indexes, ADC for functions, which is a different principal (the service
// account has no `cloudfunctions.functions.list`). A target whose credential
// is absent grades CANNOT CHECK, never clean.
//
// ⚠️ THE INDEX CHECKER READS THE WORKTREE, not a git ref, so this script must
// run from a checkout at the HEAD of the range. In CI that is what
// actions/checkout gives it.
//
// Exit codes:
//   0  nothing owed, or every owed deploy has happened
//   1  at least one owed deploy has NOT happened
//   2  at least one could not be checked and none failed — unverified is not
//      clean, and the caller decides how loud that is: on a promotion PR the
//      workflow warns (the deploys are legitimately not owed until the merge),
//      on a push to `production` it fails, because from that moment they are.

import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  CHECKER_EXIT,
  MANUAL_DEPLOY_TARGETS,
  describeResult,
  foldResults,
  targetsForChangedFiles,
} from './lib/promotion-deploys.mjs'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

let range = process.env.PROMOTION_RANGE || 'origin/production..HEAD'
let listOnly = false
let only = null
const args = process.argv.slice(2).filter((a) => a !== '--')
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  if (arg.startsWith('--range=')) {
    range = arg.slice('--range='.length)
    continue
  }
  if (arg === '--range') {
    range = args[i + 1]
    i += 1
    continue
  }
  if (arg.startsWith('--only=')) {
    only = arg.slice('--only='.length).split(',').filter(Boolean)
    continue
  }
  if (arg === '--list') {
    listOnly = true
    continue
  }
  console.error(
    `Unknown argument '${arg}'. Usage: check-promotion-deploys [--range=<base>..<head>] [--only=<id,...>] [--list]`,
  )
  process.exit(2)
}
if (!range || !range.includes('..')) {
  console.error(
    `Cannot check: --range must be '<base>..<head>', got '${range}'. Exiting 2 (cannot-check).`,
  )
  process.exit(2)
}
if (only) {
  const known = new Set(MANUAL_DEPLOY_TARGETS.map((t) => t.id))
  const unknown = only.filter((id) => !known.has(id))
  if (unknown.length > 0) {
    console.error(
      `Unknown target(s) ${unknown.join(', ')}. Valid: ${[...known].join(', ')}.`,
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

const [baseRef, headRef] = range.split('..')
let baseSha
let headSha
try {
  baseSha = git(['rev-parse', '--verify', `${baseRef}^{commit}`]).trim()
  headSha = git(['rev-parse', '--verify', `${(headRef || 'HEAD')}^{commit}`]).trim()
} catch (error) {
  console.error(
    [
      `Cannot check: the range '${range}' does not resolve.`,
      `  ${error.message.trim().split('\n')[0]}`,
      '',
      'A shallow clone cannot answer either end of a promotion range. Fetch the',
      'full history (actions/checkout fetch-depth: 0) and the promoted branch.',
      '',
      'Exiting 2 (cannot-check).',
    ].join('\n'),
  )
  process.exit(2)
}

let changed = []
try {
  changed = git(['diff', '--name-only', baseSha, headSha])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
} catch (error) {
  console.error(
    `Cannot check: git diff over ${range} failed: ${error.message.trim().split('\n')[0]}`,
  )
  process.exit(2)
}

let owed = targetsForChangedFiles(changed)
if (only) owed = owed.filter((entry) => only.includes(entry.target.id))

console.log(
  `Range: ${range} (${baseSha.slice(0, 9)}..${headSha.slice(0, 9)}), ${changed.length} file(s) changed.`,
)

if (owed.length === 0) {
  console.log(
    'This range touches no manual deploy target — the promotion merge ships all of it.',
  )
  process.exit(0)
}

console.log(`\nOwed by this range: ${owed.map((e) => e.target.label).join(', ')}`)
for (const { target, files } of owed) {
  console.log(`\n  ${target.label} (${target.id})`)
  for (const file of files) console.log(`    ${file}`)
  console.log(`    deploy: ${target.deployCommand}`)
  console.log(`    if skipped: ${target.cost}`)
}

if (listOnly) {
  console.log('\n--list: the ledger only, no deploy was verified.')
  process.exit(0)
}

// Each checker is run as its own process so its exit code — not a parsed
// string — is the answer, and so its own output reaches the log verbatim.
const results = []
for (const { target } of owed) {
  console.log(`\n--- verifying ${target.label} via ${target.checker} ---`)
  const checkerArgs = [target.checker]
  if (target.baselineFlag) checkerArgs.push(`--baseline=${headSha}`)
  const run = spawnSync(process.execPath, checkerArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  })
  const code = run.status === null ? 2 : run.status
  if (run.error) {
    console.error(`  the checker could not be started: ${run.error.message}`)
  }
  results.push({ target, code })
}

const verdict = foldResults(results)

console.log('\n=== Promotion deploy ledger ===')
for (const result of results) console.log(describeResult(result))

if (verdict.exitCode === CHECKER_EXIT.NOT_DEPLOYED) {
  console.error(
    [
      '',
      `${verdict.notDeployed.length} manual deploy(s) this range owes have not happened.`,
      'Run them from a checkout at the promoted SHA, then re-run this check.',
      'Nothing about the Vercel deployment tells you this: the merge shipped the',
      'app code and reported success, which is exactly how it read on 2026-09-04.',
    ].join('\n'),
  )
  process.exit(1)
}
if (verdict.exitCode === CHECKER_EXIT.CANNOT_CHECK) {
  console.error(
    `\n${verdict.cannotCheck.length} target(s) could not be verified. Exiting 2 — cannot-check is NOT clean.`,
  )
  process.exit(2)
}
console.log('\nEvery manual deploy this range owes has happened.')
