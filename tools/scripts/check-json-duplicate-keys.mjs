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
 * Fail when a tracked JSON file writes one key twice in an object (AGL-3553).
 *
 * ```
 * npm run check:json-duplicate-keys             # every tracked .json/.jsonc
 * node tools/scripts/check-json-duplicate-keys.mjs --staged   # the index (pre-commit)
 * ```
 *
 * `JSON.parse` keeps the last of two equal keys without a word, so the first
 * vanishes from every reader — `plugins.config.json` merged two lanes'
 * `transferResources` for one plugin that way and one lane's resources would
 * have disappeared. See `lib/json-duplicate-keys.mjs`.
 *
 * The corpus is EVERY tracked `.json`/`.jsonc`, not a list of the hand-edited
 * ones. A duplicate is never intended in any of them; the list of files two
 * branches might both edit (plugin configs, every `package.json`, the
 * Firestore indexes, project.json targets, tsconfig paths, the Remote Config
 * template) is the list that drifts; and the whole corpus reads in well under
 * a second.
 *
 * `--staged` reads the INDEX copy of each staged JSON file, so the pre-commit
 * hook judges what is being committed and not a peer's unstaged edit in the
 * shared checkout.
 *
 * Exit codes: 0 clean · 1 a duplicate key, an unreadable file, or a broken sweep.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { evaluateDuplicateKeys, formatFailure, isSwept } from './lib/json-duplicate-keys.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const staged = process.argv.slice(2).includes('--staged')

const git = (args) =>
  execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

/** @type {Array<{ path: string, text: string }>} */
const files = []
if (staged) {
  const paths = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    .split('\0')
    .filter(Boolean)
    .filter(isSwept)
  // A staged symlink's blob is its target path, not JSON; the file it points
  // at is swept under its own name.
  const links = new Set(
    git(['ls-files', '--stage', '-z'])
      .split('\0')
      .filter((entry) => entry.startsWith('120000 '))
      .map((entry) => entry.slice(entry.indexOf('\t') + 1)),
  )
  for (const path of paths) {
    if (!links.has(path)) files.push({ path, text: git(['show', `:${path}`]) })
  }
} else {
  const paths = git(['ls-files', '-z']).split('\0').filter(Boolean).filter(isSwept).sort()
  for (const path of paths) {
    const absolute = join(REPO_ROOT, path)
    // A tracked path can be absent from the working tree (a sparse checkout,
    // a deletion not yet staged); there is nothing to read.
    try {
      if (!statSync(absolute).isFile()) continue
    } catch {
      continue
    }
    files.push({ path, text: readFileSync(absolute, 'utf8') })
  }
  /**
   * The premise. A sweep that reached nothing finds no duplicates and reads as
   * a pass. The repo tracks over 500 JSON files, among them the root
   * `plugins.config.json` this guard exists for.
   */
  if (files.length < 300 || !files.some((file) => file.path === 'plugins.config.json')) {
    console.error(
      `FAIL: read only ${files.length} JSON files, or not plugins.config.json — the sweep ` +
        'is not reaching the corpus, so a clean verdict would be meaningless.',
    )
    process.exit(1)
  }
}

const verdict = evaluateDuplicateKeys(files)

if (verdict.ok) {
  console.log(
    `JSON duplicate-key sweep · ${files.length} ${staged ? 'staged' : 'tracked'} JSON file(s) · no key written twice.`,
  )
  process.exit(0)
}

console.error(
  `FAIL: ${verdict.offenders.length} JSON file(s) write a key twice in one object, ` +
    `or do not read as JSON.${formatFailure(verdict)}`,
)
process.exit(1)
