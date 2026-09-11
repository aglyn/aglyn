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
// What a push can trip, decided from the pushed range alone (AGL-2837).
// `tools/scripts/prepush.mjs` is the git and process half; this module holds
// the decisions so they can be tested without a repository.
//
// ## Why these checks and no others
//
// From 2026-09-03 to 2026-09-11, 16 of the 44 breaks that reached `main` were
// static classes a check sees in seconds from the pushed files: an `AGL-nnnn`
// cited before Linear assigned it, the brand-literal and color ratchets, an
// unprovisioned address, a personal identifier, a `NEXT_PUBLIC_` bracket read,
// the page-view rate, a stale generated Next tsconfig, test wiring, and a spec
// still asserting copy the push changed. Every check here is one of those and
// runs only when a pushed path can change its answer. Tests, lint and the
// workspace typecheck take minutes on the shared Mac and stay in CI.

import {
  FABRICATED,
  classifyCitation,
  isExemptPath,
  isForgivenCommit,
  parseCitations,
} from './linear-ids.mjs'

const ZERO_SHA = /^0+$/
const JS = /\.[cm]?[jt]sx?$/
const SPEC = /\.(?:spec|test)\.[cm]?[jt]sx?$/

/**
 * The refs git hands a `pre-push` hook on stdin, one per line:
 * `<local ref> <local sha> <remote ref> <remote sha>`. A delete (an all-zero
 * local sha) carries no content and is dropped; a new remote branch has no
 * remote sha.
 */
export function parsePushedRefs(stdin) {
  return String(stdin ?? '')
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length === 4 && !ZERO_SHA.test(parts[1]))
    .map(([localRef, localSha, remoteRef, remoteSha]) => ({
      localRef,
      localSha,
      remoteRef,
      remoteSha: ZERO_SHA.test(remoteSha) ? null : remoteSha,
    }))
}

/**
 * Each check, the script that runs it, and the pushed paths that can change
 * its answer. A `scoped` check is handed only those paths, through
 * `--files-from`; the others read what they always read.
 */
export const CHECKS = Object.freeze([
  {
    name: 'check:brand-literals',
    script: 'tools/scripts/check-brand-literals.mjs',
    scoped: true,
    when: (path) => /^(?:apps|libs|cloud)\//.test(path) && JS.test(path) && !SPEC.test(path),
  },
  {
    name: 'check:hardcoded-colours',
    script: 'tools/scripts/check-hardcoded-colours.mjs',
    scoped: true,
    when: (path) => /^(?:apps|libs|tools|cloud)\//.test(path) && JS.test(path) && !SPEC.test(path),
  },
  {
    name: 'check:contact-addresses',
    script: 'tools/scripts/check-contact-addresses.mjs',
    scoped: true,
    when: (path) => /\.(?:tsx?|jsx?|mjs|cjs|md|mdx|json|ya?ml|html|txt)$/.test(path),
  },
  {
    name: 'check:personal-identifiers',
    script: 'tools/scripts/check-personal-identifiers.mjs',
    scoped: true,
    when: () => true,
  },
  {
    name: 'check:next-public-access',
    script: 'tools/scripts/check-next-public-access.mjs',
    scoped: true,
    when: (path) => /^(?:apps|libs|cloud)\//.test(path) && JS.test(path) && !SPEC.test(path),
  },
  {
    name: 'check:test-wiring',
    script: 'tools/scripts/check-test-wiring.mjs',
    scoped: false,
    when: (path) =>
      SPEC.test(path) ||
      /\.(?:spec|test)\.mjs$|(?:^|\/)project\.json$|^package\.json$|^\.github\/workflows\/|^tools\/.+\.sh$/.test(path),
  },
  {
    name: 'sync:next-tsconfigs:check',
    script: 'tools/scripts/sync-next-tsconfigs.mjs',
    args: ['--check'],
    scoped: false,
    when: (path) =>
      /^tsconfig\.base\.json$|^apps\/[^/]+\/tsconfig[^/]*\.json$|^tools\/scripts\/sync-next-tsconfigs\.mjs$/.test(path),
  },
  {
    name: 'check:page-view-rate',
    script: 'tools/scripts/check-page-view-rate.mjs',
    scoped: false,
    when: (path) => /^(?:apps\/tenant|libs)\//.test(path) && JS.test(path) && !SPEC.test(path),
  },
])

/** The checks the pushed paths can trip, each with the paths that trip it. */
export function checksFor(paths) {
  return CHECKS.map((check) => ({ ...check, paths: paths.filter((path) => check.when(path)) })).filter(
    (check) => check.paths.length > 0,
  )
}

/**
 * Added lines, with their file and new line number, from a `git diff -U0`.
 *
 * @returns {{ path: string, line: number, text: string }[]}
 */
export function addedLinesOf(diffText) {
  const added = []
  let path = ''
  let next = 0
  for (const raw of String(diffText).split('\n')) {
    if (raw.startsWith('+++ ')) {
      path = raw.startsWith('+++ b/') ? raw.slice(6) : ''
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (hunk) {
      next = Number(hunk[1])
      continue
    }
    if (path && raw.startsWith('+')) {
      added.push({ path, line: next, text: raw.slice(1) })
      next += 1
    }
  }
  return added
}

/**
 * Records from `git log --format=%H%x1f%B%x1e`.
 *
 * @returns {{ sha: string, message: string }[]}
 */
export function commitsOf(logText) {
  return String(logText)
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, message = ''] = record.split('\x1f')
      return { sha: sha.trim(), message }
    })
}

/**
 * How far above the checked-in ceiling an id has to be before it cannot be an
 * issue Linear assigned since the ceiling was last raised. The ceiling lags the
 * workspace by days and the workspace grows by tens of issues a day, so a gap
 * this large is a fixture or a typo: a four-nines placeholder in a test, or a
 * real id typed with an extra digit.
 */
export const IMPLAUSIBLE_MARGIN = 1000

/**
 * Every issue id a push cites above `ceiling`, in its commit messages and in
 * the lines it adds, with where each appears and whether it is `implausible`.
 * The same exemptions as `check:linear-ids`: the historical commits the ceiling
 * file forgives, and the files that write about ids rather than cite them.
 */
export function citationsAboveCeiling({ commits, addedLines, ceiling, forgiven = [] }) {
  const above = new Map()
  const note = (citation, where) => {
    if (classifyCitation(citation, ceiling) !== FABRICATED) return
    if (!above.has(citation.id)) {
      const implausible = citation.number <= 0 || citation.number - ceiling >= IMPLAUSIBLE_MARGIN
      above.set(citation.id, { ...citation, implausible, where: [] })
    }
    above.get(citation.id).where.push(where)
  }
  for (const { sha, message } of commits) {
    if (isForgivenCommit(sha, forgiven)) continue
    for (const citation of parseCitations(message)) note(citation, `commit ${sha.slice(0, 9)}`)
  }
  for (const { path, line, text } of addedLines) {
    if (isExemptPath(path)) continue
    for (const citation of parseCitations(text)) note(citation, `${path}:${line}`)
  }
  return [...above.values()].sort((a, b) => a.number - b.number)
}
