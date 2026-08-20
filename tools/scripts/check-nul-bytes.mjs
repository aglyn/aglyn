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
 * Fail when a tracked source file contains a raw NUL byte (AGL-1890).
 *
 * ```
 * npm run check:nul-bytes           # the gate
 * npm run check:nul-bytes -- --json
 * ```
 *
 * A NUL in the first 8000 bytes makes the file BINARY to git — no diff, no
 * blame, no `git log -p`, and `grep` skips it — which means no change to it
 * has ever been reviewed, including whatever is in it right now. AGL-1323
 * removed the repo's one instance and asserted it was the only one; two more
 * arrived within fifteen days because nothing stopped them. This is the thing
 * that stops them. What the failure means and how to fix it live in
 * `lib/nul-bytes.mjs`.
 *
 * Deliberately NOT a jest spec: the corpus is the whole repo including
 * `tools/` and `cloud/`, which no jest `rootDir` covers, and the subject is
 * BYTES — a spec that read a file through a UTF-8 string decoder is reading
 * the thing after the property it is asserting about has already been lost.
 *
 * Exit codes: 0 clean · 1 a swept file contains a NUL, or the sweep is broken.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { evaluateNulBytes, formatFailure, isSwept } from './lib/nul-bytes.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const asJson = process.argv.slice(2).includes('--json')

/**
 * TRACKED files only, via `git ls-files` — never a filesystem walk.
 *
 * The same reason every other guard here gives, with one that is specific to
 * this one: an untracked `node_modules`, `.next`, or `dist` tree is full of
 * minified bundles and source maps, and a walk would spend minutes reading
 * them to report on files git does not have and nobody can review.
 */
const tracked = execFileSync('git', ['ls-files', '-z'], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
  .split('\0')
  .filter(Boolean)
  .filter(isSwept)
  .sort()

const files = []
for (const path of tracked) {
  const absolute = join(REPO_ROOT, path)
  // A tracked path can be absent from the working tree — a submodule gitlink,
  // or a sparse checkout. Missing is not an offence; unreadable bytes are
  // simply not evidence either way.
  let stats
  try {
    stats = statSync(absolute)
  } catch {
    continue
  }
  if (!stats.isFile()) continue
  files.push({ path, bytes: readFileSync(absolute) })
}

const verdict = evaluateNulBytes(files)

if (asJson) {
  process.stdout.write(
    `${JSON.stringify(
      {
        swept: files.length,
        ok: verdict.ok,
        offenders: verdict.offenders.map((one) => ({
          path: one.path,
          count: one.count,
          binaryToGit: one.binaryToGit,
          offsets: one.hits.map((hit) => hit.offset),
        })),
      },
      null,
      2,
    )}\n`,
  )
  process.exit(verdict.ok ? 0 : 1)
}

console.log(`NUL-byte sweep · ${files.length} tracked source files read`)

/**
 * Guard the premise. A sweep that reached nothing finds no NULs and reads as
 * a pass — the false green this repo keeps being bitten by (AGL-1776,
 * AGL-2004, AGL-2025). The floor is a fact about the corpus, not a tuning
 * knob: the repo tracks over 17,000 files and more than 9,000 of them are
 * swept extensions, so anything near this number means the walk is broken.
 */
if (files.length < 5000) {
  console.error(
    `\nFAIL: swept only ${files.length} files — the sweep is not reaching the ` +
      'corpus, so a clean verdict would be meaningless.',
  )
  process.exit(1)
}

if (verdict.ok) {
  console.log('No tracked source file contains a raw NUL byte.')
  process.exit(0)
}

console.error(
  `\nFAIL: ${verdict.offenders.length} tracked source file(s) contain a raw ` +
    `NUL byte.${formatFailure(verdict)}`,
)
process.exit(1)
