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
 * Which manual deploys a promotion range owes, and whether they have happened
 * (AGL-2580).
 *
 * A promotion merge deploys VERCEL APP CODE ONLY. Three other targets ship by
 * hand, from a checkout at the promoted sha, and each has its own script that
 * somebody has to remember to run. On 2026-09-04 one promotion touched all
 * three, one third of it shipped, the merge reported success, and two
 * production incidents followed inside fifteen minutes.
 *
 * The drift checkers answer "does live match?" continuously. This module
 * answers the narrower question a promotion actually asks — "does THIS range
 * owe a deploy, and is that deploy done?" — and it is the stronger one,
 * because it turns remembering into a gate. A range that touches none of these
 * paths owes nothing and passes without so much as a network call.
 *
 * REUSE, NOT REIMPLEMENTATION. Each target names the checker that already
 * knows how to compare it, and the CLI runs that checker as a child process
 * rather than growing a fourth comparison. Its exit code is the answer, on the
 * convention all three already share — 0 clean, 1 drift, 2 cannot-check — so
 * this file never has to agree separately about what "deployed" means.
 */

/** Node scripts are launched relative to the repo root. */
export const CHECKER_EXIT = {
  CLEAN: 0,
  NOT_DEPLOYED: 1,
  CANNOT_CHECK: 2,
}

/**
 * The deploy targets a promotion merge does NOT ship.
 *
 * `paths` are matched as exact files or, when they end in `/`, as directory
 * prefixes. The rules entries are exact because a stray `cloud/` file is not a
 * ruleset; `cloud/functions/` is a prefix because the whole package is packed
 * and shipped, lockfile and config included.
 */
export const MANUAL_DEPLOY_TARGETS = [
  {
    id: 'rules',
    label: 'Firebase security rules',
    paths: [
      'cloud/firebase-firestore.rules',
      'cloud/firebase-storage.rules',
      'cloud/firebase-database.rules.json',
    ],
    checker: 'tools/scripts/check-rules-drift.mjs',
    baselineFlag: true,
    deployCommand: 'node tools/scripts/deploy-firestore-rules.mjs (and the storage/database siblings)',
    cost:
      'A missing rule denies the write. The publish outbox entry is staged into the SAME atomic ' +
      'writeBatch as the routing map and the version pointer, so one denied create fails the whole ' +
      'batch and every publish in production fails outright.',
  },
  {
    id: 'functions',
    label: 'Cloud Functions',
    paths: ['cloud/functions/'],
    checker: 'tools/scripts/check-functions-drift.mjs',
    baselineFlag: true,
    deployCommand: 'npm --prefix cloud/functions run deploy',
    cost:
      'A stale function keeps doing yesterday\'s job silently. A new SCHEDULED_JOBS row is judged by ' +
      '/api/health/crons from the moment the promotion serves it, while the Cloud Scheduler job that ' +
      'drives it exists only after this deploy — so the monitor goes red inside the grace window.',
  },
  {
    id: 'indexes',
    label: 'Firestore indexes',
    paths: ['cloud/firebase-firestore.indexes.json'],
    checker: 'tools/scripts/check-index-drift.mjs',
    // The index checker compares live against the WORKTREE file, so it needs
    // the checkout to be at the head of the range rather than a --baseline ref.
    baselineFlag: false,
    deployCommand: 'node tools/scripts/deploy-firestore-indexes.mjs',
    cost:
      'A query that needs an undeployed index throws FAILED_PRECONDITION. When the caller is a cron ' +
      'the failure is swallowed into a 500 nobody reads (AGL-1793).',
  },
]

/** Does one changed path belong to this target? */
export function pathMatchesTarget(target, file) {
  const path = String(file ?? '').trim()
  if (!path) return false
  return target.paths.some((p) =>
    p.endsWith('/') ? path.startsWith(p) : path === p,
  )
}

/**
 * The targets a set of changed files owes a deploy for, each with the files
 * that put it there. Order follows MANUAL_DEPLOY_TARGETS so a report reads the
 * same way every time.
 */
export function targetsForChangedFiles(files) {
  const list = Array.isArray(files) ? files : []
  const owed = []
  for (const target of MANUAL_DEPLOY_TARGETS) {
    const touched = list.filter((file) => pathMatchesTarget(target, file))
    if (touched.length > 0) owed.push({ target, files: touched.sort() })
  }
  return owed
}

/**
 * Fold the per-target checker exits into one verdict.
 *
 * NOT-DEPLOYED beats CANNOT-CHECK when both occur: both are red, and one of
 * them names a deploy somebody can go and run. CANNOT-CHECK never folds into
 * clean — a promotion that could not be verified is a promotion nobody
 * verified, and the whole class of bug this guards against is the one that
 * reported success.
 */
export function foldResults(results) {
  const list = Array.isArray(results) ? results : []
  const notDeployed = list.filter((r) => r.code === CHECKER_EXIT.NOT_DEPLOYED)
  const cannotCheck = list.filter(
    (r) => r.code !== CHECKER_EXIT.CLEAN && r.code !== CHECKER_EXIT.NOT_DEPLOYED,
  )
  const clean = list.filter((r) => r.code === CHECKER_EXIT.CLEAN)
  let exitCode = CHECKER_EXIT.CLEAN
  if (notDeployed.length > 0) exitCode = CHECKER_EXIT.NOT_DEPLOYED
  else if (cannotCheck.length > 0) exitCode = CHECKER_EXIT.CANNOT_CHECK
  return { exitCode, notDeployed, cannotCheck, clean }
}

/** A one-line summary per target, for the job summary and the terminal. */
export function describeResult(result) {
  if (result.code === CHECKER_EXIT.CLEAN) {
    return `OK ${result.target.label} — deployed, live matches the range.`
  }
  if (result.code === CHECKER_EXIT.NOT_DEPLOYED) {
    return `NOT DEPLOYED ${result.target.label} — run: ${result.target.deployCommand}`
  }
  return `CANNOT CHECK ${result.target.label} — the checker exited ${result.code}; unverified is not clean.`
}
