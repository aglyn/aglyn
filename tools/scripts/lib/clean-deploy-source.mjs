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
 * Dirty-tree refusal for the rules deploy scripts (AGL-1489).
 *
 * The deploy scripts read the WORKTREE copy of a rules file and ship it
 * wholesale — every byte in the file goes live, not just the change the
 * operator has in mind. On 2026-08-13 that almost shipped another session's
 * uncommitted, unreviewed `legalAcceptances` rule block to production as a
 * silent side effect of an unrelated security deploy: the main checkout was
 * dirty with concurrent work, and nothing in the script knew or cared. The
 * deploy only went out clean because it was re-run from an isolated
 * worktree.
 *
 * So: if the source file has any uncommitted difference from HEAD, refuse
 * and say why. `--allow-dirty` is the deliberate escape hatch — deploying a
 * work-in-progress rule to a dev project is a real workflow — but it must
 * be typed, never defaulted.
 *
 * Split like disk-space.mjs: `evaluateDeploySource` is a pure function of a
 * porcelain string and is testable; `assertCleanDeploySource` owns the one
 * `git status` call. One polarity choice is the OPPOSITE of disk-space's
 * rule 1, on purpose: there, an unreadable measurement never blocks, because
 * refusing to start a dev loop over a failed statfs is worse than the
 * runaway cache it guards against. Here an unreadable measurement DOES
 * block: "I could not determine what these bytes are" is not an acceptable
 * state to deploy production security rules from, and the operator holds an
 * explicit override for the cases where it truly is (no git, tarball
 * checkout).
 */

import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'

/**
 * Decide whether a deploy may proceed, from evidence alone.
 *
 * @param {object} input
 * @param {string | null} input.porcelain `git status --porcelain` output for
 *   the source file, or null when git could not answer.
 * @param {boolean} input.allowDirty the typed escape hatch.
 * @param {string} input.fileLabel how to name the file in messages.
 * @returns {{ ok: boolean, warning?: string, reason?: string }}
 */
export function evaluateDeploySource({ porcelain, allowDirty, fileLabel }) {
  if (porcelain === null) {
    if (allowDirty) {
      return {
        ok: true,
        warning:
          `Could not verify ${fileLabel} against git; deploying anyway ` +
          `because --allow-dirty was passed.`,
      }
    }
    return {
      ok: false,
      reason:
        `Refusing to deploy: could not verify that ${fileLabel} matches a ` +
        `committed state (git status failed). The deploy ships the worktree ` +
        `bytes wholesale, so an unverifiable file may carry unreviewed ` +
        `edits. Re-run with --allow-dirty to override deliberately.`,
    }
  }
  if (porcelain.trim() === '') {
    return { ok: true }
  }
  if (allowDirty) {
    return {
      ok: true,
      warning:
        `${fileLabel} has uncommitted modifications; deploying anyway ` +
        `because --allow-dirty was passed.`,
    }
  }
  return {
    ok: false,
    reason:
      `Refusing to deploy: ${fileLabel} has uncommitted modifications ` +
      `(git status: ${porcelain.trim()}). The deploy ships the worktree ` +
      `copy wholesale, so this would put every pending edit in the file ` +
      `live — including another session's work-in-progress (the AGL-1489 ` +
      `near-miss). Commit the file first, or re-run with --allow-dirty to ` +
      `deploy uncommitted rules deliberately.`,
  }
}

/**
 * Refuse (throw) when the file at `filePath` differs from its committed
 * state, unless `allowDirty`. Returns the evaluation so callers can print
 * the warning on an overridden deploy.
 *
 * @param {string} filePath absolute path to the deploy source file.
 * @param {{ allowDirty?: boolean, fileLabel?: string }} [options]
 */
export function assertCleanDeploySource(filePath, options = {}) {
  const { allowDirty = false, fileLabel = filePath } = options
  let porcelain = null
  try {
    // cwd is the file's own directory so the check hits the repo (and, in a
    // worktree, the WORKTREE) that actually owns the file, wherever the
    // operator happens to run the script from.
    porcelain = execFileSync(
      'git',
      ['status', '--porcelain', '--', filePath],
      { cwd: dirname(filePath), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
  } catch {
    porcelain = null
  }
  const verdict = evaluateDeploySource({ porcelain, allowDirty, fileLabel })
  if (!verdict.ok) {
    throw new Error(verdict.reason)
  }
  return verdict
}
