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
// A guard sweep limited to named files (AGL-2837).
//
// ## Why a guard needs a scoped mode
//
// The file-content guards sweep every tracked file, which is right for CI and
// too slow for a push. On the shared Mac at load 34-43 `check:hardcoded-colours`
// took 22.4 s, `check:brand-literals` 11.8 s, `check:personal-identifiers` 9.2 s
// and `check:contact-addresses` 8.6 s. Between them they reached `main` seven
// times in eight days, each time over a finding the pushed files already
// contained. `tools/scripts/prepush.mjs` runs them over the pushed files only.
//
// ## What a scoped run must never do
//
//  - Read as the sweep. Every scoped run prints `scopeNote`, and CI passes no
//    `--files-from`, so the verdict of record is always the whole tree.
//  - Rewrite a ratchet baseline. A baseline written from a partial sweep would
//    drop every row outside the scope, so `--write` with a scope is refused.
//  - Call a baseline row stale because it was not swept. `scopeBaseline`
//    keeps only the rows for files inside the scope.
//  - Fail a corpus-size premise check. Those catch a walk that reached nothing;
//    a scope is small on purpose.

import { readFileSync } from 'node:fs'

export const FILES_FROM = '--files-from'

/**
 * The repo-relative paths named by `--files-from <list>`, or `null` for a full
 * sweep. A flag without a path throws, because falling back to the full sweep
 * would be silently slow and scoping to nothing would be silently green.
 *
 * @param {string[]} argv
 * @param {(path: string) => string} [read]
 * @returns {Set<string> | null}
 */
export function scopeFromArgv(argv, read = (path) => readFileSync(path, 'utf8')) {
  const at = argv.indexOf(FILES_FROM)
  if (at < 0) return null
  const listPath = argv[at + 1]
  if (!listPath || listPath.startsWith('--')) {
    throw new Error(`${FILES_FROM} needs the path of a file that lists repo-relative paths, one per line`)
  }
  return new Set(
    read(listPath)
      .split('\n')
      .map((line) => line.trim().replace(/^\.\//, ''))
      .filter(Boolean),
  )
}

/** Whether a repo-relative path is swept. Every path is, without a scope. */
export function inScope(scope, path) {
  return scope === null || scope.has(path)
}

/** The baseline rows a scoped comparison may judge: only the swept ones. */
export function scopeBaseline(baseline, scope) {
  if (scope === null) return baseline
  return Object.fromEntries(Object.entries(baseline).filter(([file]) => scope.has(file)))
}

/** The line a scoped run prints, so it can never be read as the full sweep. */
export function scopeNote(scope) {
  return scope === null ? '' : `SCOPED to ${scope.size} named file(s); this is not the full sweep`
}
