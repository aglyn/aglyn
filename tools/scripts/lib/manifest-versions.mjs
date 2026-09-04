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
 * Does each `package-lock.json` agree with the `package.json` beside it about
 * what version this is (AGL-2108)?
 *
 * THIS IS A DRIFT NO EXISTING CHECK READS. `npm ci` validates that a lockfile
 * satisfies the DEPENDENCY SET in its manifest; it never compares the root
 * `version` field. So AGL-2089 bumped `package.json` to `1.0.0-beta.1`,
 * `package-lock.json` carried `1.0.0-alpha.0` in both its top-level `version`
 * and its `packages[""]` entry, and Vercel builds and the promotion gate were
 * green throughout — the standing lesson that a green check only proves what
 * it reads, with nothing reading this one at all.
 *
 * The lockfile is the artifact most likely to be read as the authority on
 * what version an install actually IS: an SBOM, a release-note generator, a
 * self-host image tag. Every one of them gets the wrong answer, silently.
 *
 * `evaluateManifestVersions` is pure so it can be tested without a
 * filesystem. `readManifestPairs` below is the one seam that touches disk,
 * shared by `check-manifest-versions.mjs` and `release-prepare.mjs` so both
 * judge the same set of manifests.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @typedef {object} ManifestPair
 * @property {string} dir            Repo-relative directory, '' for the root.
 * @property {unknown} packageJson   Parsed package.json.
 * @property {unknown} lockJson      Parsed package-lock.json.
 */

/**
 * @param {ManifestPair[]} pairs
 * @returns {{ ok: boolean, checked: number, drifts: Array<{ dir: string, field: string, expected: unknown, actual: unknown }> }}
 */
export function evaluateManifestVersions(pairs) {
  const drifts = []
  for (const pair of pairs ?? []) {
    const dir = pair?.dir ?? ''
    const expected = pair?.packageJson?.version
    // A manifest with no version at all is not drift — `cloud/functions` has
    // never carried one, and inventing an expectation for it would make this
    // check fail on a shape that is deliberate. Only a DISAGREEMENT is a
    // finding.
    if (expected === undefined) continue
    if (pair?.lockJson?.version !== expected) {
      drifts.push({
        dir,
        field: 'version',
        expected,
        actual: pair?.lockJson?.version,
      })
    }
    // npm writes the version in TWO places and AGL-2089 left both stale.
    // Checking only the top-level one would pass a lockfile half-repaired by
    // hand — which is exactly the repair somebody reaches for first.
    const rootEntry = pair?.lockJson?.packages?.['']
    if (rootEntry && rootEntry.version !== expected) {
      drifts.push({
        dir,
        field: 'packages[""].version',
        expected,
        actual: rootEntry.version,
      })
    }
  }
  return { ok: drifts.length === 0, checked: (pairs ?? []).length, drifts }
}

/**
 * Splits manifest drift into "the root lockfile a release just rewrote" and
 * "everything else" (AGL-2565).
 *
 * `release:prepare` needs the distinction because the two answers lead to
 * different actions. Root drift means the regeneration did not land and the
 * commit must not claim a lockfile. Drift anywhere else was already there
 * before the bump and is not that step's to repair — reporting it as a failed
 * regeneration would send someone chasing the wrong file — but it still reds
 * the promotion gate, so it is worth saying while someone is looking.
 *
 * @param {ManifestPair[]} pairs
 * @returns {{ rootOk: boolean, rootDrifts: object[], otherDrifts: object[] }}
 */
export function lockfileVersionVerdict(pairs) {
  const { drifts } = evaluateManifestVersions(pairs)
  const rootDrifts = drifts.filter((drift) => drift.dir === '')
  return {
    rootOk: rootDrifts.length === 0,
    rootDrifts,
    otherDrifts: drifts.filter((drift) => drift.dir !== ''),
  }
}

/** @param {ReturnType<typeof evaluateManifestVersions>} result */
export function formatManifestVersionFailure(result) {
  const lines = [
    'package-lock.json disagrees with package.json about the version (AGL-2108).',
    '',
  ]
  for (const drift of result.drifts) {
    const where = drift.dir === '' ? '<root>' : drift.dir
    lines.push(
      `  ${where}/package-lock.json  ${drift.field}` +
        `\n    package.json says  ${JSON.stringify(drift.expected)}` +
        `\n    lockfile says      ${JSON.stringify(drift.actual)}`,
    )
  }
  lines.push(
    '',
    '  Fix: run `npm install --package-lock-only --ignore-scripts` in that',
    '  directory and commit the lockfile alongside package.json.',
    '  `npm run release:prepare -- --write` now does this for the root',
    '  automatically.',
    '',
    '  Keep --ignore-scripts. Without node_modules — a temp worktree, a fresh',
    '  clone — the postinstall hook is missing, npm exits 127, and the install',
    '  abandons the lockfile it was asked to repair (AGL-2565).',
  )
  return lines.join('\n')
}

/**
 * Every tracked `package-lock.json` in the repo, paired with the
 * `package.json` beside it — the filesystem seam that feeds the pure
 * evaluator above.
 *
 * Ask git, not the filesystem: an UNTRACKED lockfile is somebody's local
 * experiment and a nested node_modules is full of them — the same reasoning
 * `check-standalone-installs.mjs` records. Derived rather than hard-coded so
 * a fourth manifest is covered the day it lands.
 *
 * @param {string} repoRoot
 * @returns {ManifestPair[]}
 */
export function readManifestPairs(repoRoot) {
  const tracked = execFileSync(
    'git',
    ['ls-files', 'package-lock.json', '*/package-lock.json'],
    { cwd: repoRoot, encoding: 'utf8' },
  )
  return tracked
    .split('\n')
    .filter(Boolean)
    .map((file) =>
      file.slice(0, -'package-lock.json'.length).replace(/\/$/, ''),
    )
    .filter((dir) => !dir.split('/').includes('node_modules'))
    .map((dir) => ({
      dir,
      packageJson: JSON.parse(
        readFileSync(join(repoRoot, dir, 'package.json'), 'utf8'),
      ),
      lockJson: JSON.parse(
        readFileSync(join(repoRoot, dir, 'package-lock.json'), 'utf8'),
      ),
    }))
}
