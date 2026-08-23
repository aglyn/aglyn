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

/**
 * Where the continuous gate's verdict lands (AGL-2486).
 *
 * ## Why this is not the tracking issue it was written as
 *
 * The first version opened a GitHub issue on red and closed it on green. That
 * mechanism cannot work here, and the check was one API call:
 *
 *     $ gh issue list --search 'main gate: RED in:title'
 *     the 'aglyn/aglyn' repository has disabled issues
 *
 *     $ gh api repos/aglyn/aglyn --jq '{has_issues, has_discussions}'
 *     {"has_discussions":false,"has_issues":false}
 *
 * Issues and discussions are both off. Every red would have failed at
 * `gh issue create`, so the sink the whole "a red is impossible to miss" claim
 * rested on was structurally dead — and it would have looked like a broken
 * workflow step rather than like a missing verdict.
 *
 * COMMIT STATUSES replace it, and they are a better fit than the issue was.
 * A status attaches to the exact SHA that was gated, so the red belongs to the
 * commit that caused it rather than to a document describing it. It shows as a
 * red mark beside that commit in the branch view and the commit list, it
 * persists until something supersedes it, and the surface is currently unused
 * (`total_count: 0` on main's head — nx-ci only runs on `production` now).
 *
 * ## Two contexts, deliberately
 *
 * `main-gate/fast` and `main-gate/full` are written SEPARATELY, because they
 * make different claims: fast is typecheck plus the guards, full adds the test
 * sweep and the production builds. With one shared context, a fast green at
 * 01:22 would overwrite a full red from 01:11 and hide a real failure behind a
 * cheaper check that never looked at it. Separate contexts make that
 * impossible by construction rather than by care.
 *
 * ## `inconclusive` is not `green`
 *
 * The bug this exists to prevent: the fast job skips its own steps when `main`
 * has not moved since the last verdict. A skipped job REPORTS SUCCESS. The
 * first version read that as green and would have cleared the red — so a
 * broken `main` that nobody was pushing to would have marked itself healthy,
 * which is the exact opposite of the property being built. A run that did not
 * look must leave the previous verdict alone.
 *
 *   node tools/scripts/gate-report.mjs --sha <sha> --fast success --full skipped \
 *     --fast-verified true [--dry-run]
 *   node tools/scripts/gate-report.mjs --self-test
 */

import { execFileSync } from 'node:child_process'

/**
 * What one job's result means for its own status context.
 *
 * `verified` is whether that job actually ran its checks. It is a separate
 * input from the result precisely because GitHub reports a job that skipped
 * every step as `success`.
 */
export function decide(result, verified) {
  if (result === 'failure') return 'red'
  if (result === 'skipped' || result === 'cancelled') return 'inconclusive'
  if (result === 'success') return verified ? 'green' : 'inconclusive'
  return 'inconclusive'
}

/** GitHub commit-status states. `inconclusive` writes nothing at all. */
export function stateFor(verdict) {
  return verdict === 'red' ? 'failure' : verdict === 'green' ? 'success' : null
}

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const val = (n, d = '') => {
  const i = argv.indexOf(n)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d
}

const CONTEXTS = { fast: 'main-gate/fast', full: 'main-gate/full' }
const DESCRIPTIONS = {
  fast: { green: 'typecheck + guards clean', red: 'typecheck or a guard FAILED' },
  full: { green: 'tests + production builds clean', red: 'a test or production build FAILED' },
}

/* ---------------------------------------------------------------- self-test */
if (flag('--self-test')) {
  let pass = 0
  let fail = 0
  const ok = (label, cond) => {
    if (cond) { console.log('ok  ', label); pass++ }
    else { console.error('FAIL', label); fail++ }
  }

  ok('a failed job is red', decide('failure', true) === 'red')
  ok('a failed job is red even if it did not finish verifying', decide('failure', false) === 'red')
  ok('a job that ran and passed is green', decide('success', true) === 'green')

  // THE BUG. A job that skipped every step reports `success`. Reading that as
  // green would clear a red on a `main` nobody is pushing to — the tracking
  // state marking itself healthy precisely because nothing was checked.
  ok('a SKIPPED job is inconclusive, never green', decide('skipped', false) === 'inconclusive')
  ok('a success with nothing verified is inconclusive', decide('success', false) === 'inconclusive')
  ok('a cancelled job is inconclusive', decide('cancelled', false) === 'inconclusive')
  ok('an unknown result is inconclusive', decide('weird', true) === 'inconclusive')

  // An inconclusive verdict must write NOTHING, so the previous status stands.
  ok('inconclusive writes no status', stateFor('inconclusive') === null)
  ok('red writes failure', stateFor('red') === 'failure')
  ok('green writes success', stateFor('green') === 'success')

  // Separate contexts are what stop a cheap green from hiding an expensive red.
  ok('fast and full use DIFFERENT contexts', CONTEXTS.fast !== CONTEXTS.full)
  ok('both contexts are namespaced', Object.values(CONTEXTS).every((c) => c.startsWith('main-gate/')))

  // Every state a real job can report must map to something.
  for (const r of ['success', 'failure', 'cancelled', 'skipped']) {
    ok(`'${r}' maps to a verdict`, ['red', 'green', 'inconclusive'].includes(decide(r, true)))
  }

  console.log(`\ngate-report self-test: ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

/* --------------------------------------------------------------------- main */
const sha = val('--sha')
const dryRun = flag('--dry-run')
if (!sha) {
  console.error('gate-report: --sha is required')
  process.exit(64)
}

const repo = process.env.GITHUB_REPOSITORY || 'aglyn/aglyn'
const runUrl = process.env.RUN_URL || ''
const jobs = [
  { key: 'fast', result: val('--fast', 'skipped'), verified: val('--fast-verified', 'false') === 'true' },
  { key: 'full', result: val('--full', 'skipped'), verified: val('--full-verified', 'false') === 'true' },
]

let wrote = 0
let anyRed = 0
const lines = []

for (const { key, result, verified } of jobs) {
  const verdict = decide(result, verified)
  const state = stateFor(verdict)
  lines.push(`${CONTEXTS[key]}: result=${result} verified=${verified} -> ${verdict}${state ? '' : ' (no status written)'}`)
  if (verdict === 'red') anyRed++
  if (!state) continue
  const description = DESCRIPTIONS[key][verdict]
  if (dryRun) {
    console.log(`[dry-run] POST statuses/${sha} context=${CONTEXTS[key]} state=${state} "${description}"`)
    wrote++
    continue
  }
  try {
    execFileSync(
      'gh',
      [
        'api', '-X', 'POST', `repos/${repo}/statuses/${sha}`,
        '-f', `state=${state}`,
        '-f', `context=${CONTEXTS[key]}`,
        '-f', `description=${description}`,
        ...(runUrl ? ['-f', `target_url=${runUrl}`] : []),
      ],
      { stdio: 'pipe' },
    )
    console.log(`wrote ${CONTEXTS[key]} = ${state} on ${sha.slice(0, 9)}`)
    wrote++
  } catch (err) {
    // A sink that cannot write must be loud. This is the failure mode that hid
    // behind `gh issue create` on a repo with issues disabled.
    console.error(`gate-report: FAILED to write ${CONTEXTS[key]} on ${sha}`)
    console.error(String(err.stderr || err.message).trim())
    console.error('The gate ran but its verdict did not land anywhere. Treat this as a RED.')
    process.exit(2)
  }
}

for (const l of lines) console.log(l)
console.log(`gate-report: ${wrote} status(es) written, ${anyRed} red`)
process.exit(anyRed ? 1 : 0)
