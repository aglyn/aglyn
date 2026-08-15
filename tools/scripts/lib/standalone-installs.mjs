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

// The pure half of the standalone-install guard (AGL-1781).
//
// This repo has no npm `workspaces` key, deliberately: apps/docs pins React 18
// against the root's React 19 and says so in its own package.json, and
// cloud/functions is packed and uploaded by `firebase deploy` as a
// self-contained package. Hoisting either into the root install would break
// the thing that makes it standalone.
//
// The cost of that choice is that a root `npm ci` reaches neither, so CI must
// install each one explicitly. Both have already cost a red: cloud/functions
// broke `npm run typecheck` with three TS2307s (AGL-1776, fixed in ba31af92a)
// and apps/docs broke `nx build docs` with `docusaurus: command not found`
// (AGL-1781). Both were invisible locally, because every dev checkout carries
// a nested install left over from a past deploy or docs build.
//
// A third one will be invisible in exactly the same way. This module is the
// thing that notices: it derives the set of standalone packages from the tree
// and checks each has a matching install step in the CI workflow.

/** A nested package with its OWN lockfile installs separately, by definition. */
export const LOCKFILE = 'package-lock.json'

/**
 * Decide the guard from already-read inputs, so the test can drive it without
 * a filesystem.
 *
 * @param {object} args
 * @param {string[]} args.packageDirs
 *   Repo-relative dirs of every tracked nested package that carries its own
 *   lockfile (never the root, never anything under node_modules).
 * @param {string} args.workflow  Text of the workflow expected to install them.
 * @param {unknown} args.rootWorkspaces  The root package.json `workspaces` key.
 * @returns {{ok: boolean, missing: string[], unexpectedWorkspaces: boolean}}
 */
export function evaluateStandaloneInstalls({
  packageDirs,
  workflow,
  rootWorkspaces,
}) {
  // If the root ever grows a `workspaces` key, the premise of this guard has
  // changed and its verdict is no longer meaningful. Report that rather than
  // passing — a guard whose premise silently expired is the failure mode the
  // whole AGL-1776 audit was about.
  const unexpectedWorkspaces =
    rootWorkspaces !== undefined && rootWorkspaces !== null

  const missing = packageDirs
    .filter((dir) => !hasInstallStep(workflow, dir))
    .sort()

  return {
    ok: missing.length === 0 && !unexpectedWorkspaces,
    missing,
    unexpectedWorkspaces,
  }
}

/**
 * True when `workflow` runs an npm install scoped to `dir`.
 *
 * Accepts the two spellings that actually install into the nested package —
 * `npm ci --prefix <dir>` and a `working-directory:`-scoped `npm ci`. A bare
 * `npm ci` at the root does NOT count, which is the entire point.
 */
export function hasInstallStep(workflow, dir) {
  const quoted = escapeForRegExp(dir)
  const prefixed = new RegExp(
    `npm\\s+(?:ci|install)\\s+(?:[^\\n]*\\s)?--prefix[=\\s]+['"]?\\.?/?${quoted}['"]?`,
  )
  if (prefixed.test(workflow)) return true

  // `working-directory: <dir>` on a step whose run is an npm install.
  const scoped = new RegExp(
    `working-directory:\\s*['"]?\\.?/?${quoted}['"]?[\\s\\S]{0,200}?npm\\s+(?:ci|install)`,
  )
  return scoped.test(workflow)
}

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Render the failure the CLI prints. Kept here so the test pins the message —
 * a guard that fails without saying what to add gets worked around.
 */
export function formatFailure({ missing, unexpectedWorkspaces }, workflowPath) {
  const lines = []
  if (unexpectedWorkspaces) {
    lines.push(
      'The root package.json now declares `workspaces`.',
      '',
      'This guard assumes it does not: it exists because a root `npm ci`',
      'reaches no nested package, and it cannot tell which of those a',
      'workspaces install now covers. Re-derive the policy and update',
      'tools/scripts/lib/standalone-installs.mjs — do not delete the check.',
    )
  }
  if (missing.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push(
      `${missing.length} standalone package(s) have their own lockfile and no`,
      `install step in ${workflowPath}:`,
      '',
      ...missing.map((dir) => `  ${dir}`),
      '',
      'A root `npm ci` installs nothing for them, so any CI step that builds,',
      'type-checks or tests one fails with a missing-module error that looks',
      'like a source defect and is not (AGL-1776, AGL-1781). Add, next to the',
      'existing install steps:',
      '',
      ...missing.map((dir) => `  - run: npm ci --prefix ${dir}`),
      '',
      'Skipping the package instead would delete the coverage rather than fix',
      'it — that trade was already made once, deliberately, in ba31af92a.',
    )
  }
  return lines.join('\n')
}
