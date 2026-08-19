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
 * Fail when source gains a hardcoded colour (AGL-2025). The detector and its
 * rationale live in `lib/hardcoded-colours.mjs`; this file walks the corpus
 * and compares against the ratchet baseline.
 *
 * ```
 * npm run check:hardcoded-colours          # the gate
 * npm run check:hardcoded-colours -- --list      # every occurrence, with lines
 * npm run check:hardcoded-colours -- --write     # re-baseline after a cleanup
 * npm run check:hardcoded-colours -- --json
 * ```
 *
 * `--write` is how the debt shrinks: remove literals, re-run it, commit the
 * lowered baseline alongside. It only ever writes what is measured, so it
 * cannot be used to launder a regression in without the diff showing a count
 * going UP — which is the thing a reviewer can see.
 *
 * Exit codes: 0 clean · 1 a file gained a colour, or a baseline row is stale.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  compareToBaseline,
  findHardcodedColours,
} from './lib/hardcoded-colours.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASELINE_PATH = join(
  REPO_ROOT,
  'tools',
  'scripts',
  'hardcoded-colours-baseline.json',
)

/** Ships, or generates something that ships. Mirrors the census's sweep. */
const SWEEP_ROOTS = ['apps', 'libs', 'tools', 'cloud']


/**
 * Code only. The census also sweeps `.md`/`.json` because prose can instruct
 * an author to re-mint a retired colour; here the question is what a style
 * slot in shipped code contains, so documentation is out.
 */
const SWEPT = /\.(?:tsx?|jsx?|mjs|cjs)$/

/**
 * Pinning a colour is what these files are FOR — a spec asserting a rendered
 * value, and the detectors that have to name the thing they detect.
 */
const EXEMPT = [
  /\.spec\.[cm]?[jt]sx?$/,
  /\.test\.[cm]?[jt]sx?$/,
  /^tools\/scripts\/lib\/hardcoded-colours\.mjs$/,
  /^tools\/scripts\/lib\/retired-colours(?:-nodes)?\.mjs$/,
  /^tools\/scripts\/check-hardcoded-colours\.mjs$/,
  /^tools\/scripts\/audit-retired-colours-data\.mjs$/,
]

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const write = args.includes('--write')
const list = args.includes('--list')

/**
 * TRACKED files only, via `git ls-files` — never a filesystem walk.
 *
 * The walk this replaces used `readdirSync` with a directory skip-list, so it
 * swept whatever happened to be on disk. That made the ratchet depend on
 * machine state rather than on the repo: `apps/docs/build/`,
 * `apps/docs/.docusaurus/` and the vendored `apps/console/public/monaco/`
 * bundles are build OUTPUT, untracked and full of minified colour literals.
 * A developer who had built the docs saw 21 files "gain" a colour; one who had
 * not saw a clean run, off the same commit. CI went red for the same reason.
 *
 * Enumerating what git tracks makes the guard deterministic and means
 * generated output can never trip it — the same correction AGL-2002 applied to
 * the emulator specs, for the same reason.
 */
function trackedFiles() {
  const out = execFileSync(
    'git',
    ['ls-files', '-z', '--', ...SWEEP_ROOTS],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  return out
    .split('\0')
    .filter((path) => path && SWEPT.test(path))
    .map((path) => join(REPO_ROOT, path))
}

const files = trackedFiles()

const counts = {}
const occurrences = {}
for (const file of files) {
  const path = relative(REPO_ROOT, file).split(sep).join('/')
  if (EXEMPT.some((pattern) => pattern.test(path))) continue
  const found = findHardcodedColours(readFileSync(file, 'utf8'))
  if (!found.length) continue
  counts[path] = found.length
  occurrences[path] = found
}

const sortedCounts = Object.fromEntries(
  Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])),
)

if (write) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(sortedCounts, null, 2)}\n`)
  const total = Object.values(sortedCounts).reduce((a, b) => a + b, 0)
  console.log(
    `wrote baseline: ${Object.keys(sortedCounts).length} files, ${total} occurrences`,
  )
  process.exit(0)
}

let baseline
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
} catch (error) {
  console.error(`cannot read baseline ${BASELINE_PATH}: ${error.message}`)
  process.exit(1)
}

const verdict = compareToBaseline(counts, baseline)
const total = Object.values(counts).reduce((a, b) => a + b, 0)

if (asJson) {
  process.stdout.write(
    `${JSON.stringify({ total, files: Object.keys(counts).length, ...verdict, counts: sortedCounts }, null, 2)}\n`,
  )
} else if (list) {
  for (const [path, found] of Object.entries(occurrences).sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    console.log(`\n${path}  (${found.length})`)
    for (const one of found)
      console.log(
        `  ${String(one.line).padStart(5)}  ${one.property.padEnd(18)} ${one.hex}   ${one.text.slice(0, 70)}`,
      )
  }
} else {
  console.log(
    `hardcoded colour census · ${files.length} files swept · ` +
      `${total} occurrences in ${Object.keys(counts).length} files`,
  )
  // Guard the premise. A walk that reached nothing would report zero
  // regressions and read as a pass — the failure mode this repo keeps hitting
  // (AGL-1776, AGL-2004). The corpus is ~15.5k files; anything near zero
  // means the sweep is broken, not that the repo is clean.
  if (files.length < 3000) {
    console.error(
      `\nFAIL: swept only ${files.length} files — the walk is not reaching ` +
        'the corpus, so a clean verdict would be meaningless.',
    )
    process.exit(1)
  }

  for (const one of verdict.regressions)
    console.log(
      `  GAINED  ${one.file} — ${one.count}, baseline allows ${one.allowed}`,
    )
  for (const one of verdict.stale)
    console.log(
      `  STALE   ${one.file} — baseline allows ${one.allowed}, file has none`,
    )
  for (const one of verdict.improvements)
    console.log(
      `  BETTER  ${one.file} — ${one.count}, baseline allows ${one.allowed}`,
    )

  console.log('')
  if (verdict.regressions.length)
    console.log(
      `${verdict.regressions.length} file(s) gained a hardcoded colour. Use a ` +
        'theme token — `sx: { color: \'primary.main\' }` — or, if the value ' +
        'genuinely cannot be themed (email HTML, which has no CSS vars), ' +
        're-baseline with `--write` and say why in the commit.',
    )
  if (verdict.stale.length)
    console.log(
      `${verdict.stale.length} baseline row(s) are stale — the file is clean ` +
        'now. Re-run with `--write` so the ratchet records the win.',
    )
  if (verdict.improvements.length && verdict.clean)
    console.log(
      `${verdict.improvements.length} file(s) improved. Re-run with ` +
        '`--write` to lower the baseline in this commit.',
    )
  if (verdict.clean && !verdict.improvements.length)
    console.log('No file gained a hardcoded colour.')
}

process.exit(verdict.clean ? 0 : 1)
