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

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  compareToBaseline,
  findHardcodedColours,
} from './lib/hardcoded-colours.mjs'
import { remedy } from './lib/ratchet-baseline.mjs'

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

/**
 * Aglyn's own documentation, transcribed verbatim into shipped code by a
 * generator — the same list, for the same reason, as the brand ratchet's
 * `GENERATED_DOCS_PROSE` (AGL-2279, applied here by AGL-2354).
 *
 * These files contain no style slot at all. What they contain is `apps/docs`
 * prose, and a sentence of prose can say `hex color: #1a73e8` — the White-label
 * page does, explaining what the Primary color field accepts. The detector's
 * key regex cannot tell that sentence from `color:` in emitted CSS, so the
 * generated index reported a GAINED colour that nobody authored and that no
 * theme token could replace: rewriting the docs to dodge a linter would make
 * the documentation worse, and the next docs edit would put it straight back.
 *
 * `.md` is already outside `SWEPT` for exactly this reason — prose is not
 * code. These are that same prose, generated into a `.ts` module. Listing them
 * applies the existing rule rather than widening it.
 *
 * Exact paths, never a directory: AGL-2279 is the record of what a directory
 * rule costs. `/(^|\/)constants\//` exempted the docs excerpts only because
 * the generator happened to emit them there, so a new output escaped, and it
 * silently exempted every hand-written file under any `constants/` directory
 * as well.
 */
const GENERATED_DOCS_PROSE = [
  'apps/console/constants/assist-docs-index.generated.ts',
  'apps/console/constants/docs-help.generated.ts',
  'libs/aglyn/src/lib/app-utils/docs-help.generated.ts',
  'libs/besigner/feature/designer/src/lib/utils/docs-help.generated.ts',
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
    // `git ls-files` enumerates the INDEX, and an index entry does not
    // promise a file on disk. `git status` calls the gap `AD` — added to the
    // index, then deleted from the working tree — and it happens routinely
    // mid-merge, mid-rebase, and to anyone running mutation tests, which
    // stage a generated `*.mutant.ts` and remove it again. Found exactly that
    // way: the sweep died on an unhandled ENOENT for a file another agent had
    // staged and deleted seconds earlier.
    //
    // Skipping is the correct reading, not a papering-over. The ratchet
    // measures what the working tree CONTAINS, and a file that is not there
    // contains no colours. A checkout broken badly enough to matter is caught
    // by the corpus-size premise check below, which is the assertion that
    // stops an empty sweep reading as a pass.
    .filter((path) => existsSync(path))
}

const files = trackedFiles()

const exemptProse = new Set(GENERATED_DOCS_PROSE)
const proseSeen = new Set()

const counts = {}
const occurrences = {}
for (const file of files) {
  const path = relative(REPO_ROOT, file).split(sep).join('/')
  if (exemptProse.has(path)) {
    proseSeen.add(path)
    continue
  }
  if (EXEMPT.some((pattern) => pattern.test(path))) continue
  // The path selects the parse dialect — `.ts` and `.tsx` disagree about
  // `<T>value`, so the detector must be told which it is holding.
  const found = findHardcodedColours(readFileSync(file, 'utf8'), path)
  if (!found.length) continue
  counts[path] = found.length
  occurrences[path] = found
}

/**
 * An exemption that matches nothing is the `stale` row in another costume: the
 * generator's output moved, the rule kept passing, and nobody read it again.
 * Checked against what the sweep actually saw, the same way AGL-2279 made the
 * brand ratchet check its copy of this list.
 */
const missingProse = GENERATED_DOCS_PROSE.filter((path) => !proseSeen.has(path))
if (missingProse.length) {
  console.error(
    'FAIL: GENERATED_DOCS_PROSE exempts paths the sweep never reached:\n' +
      missingProse.map((path) => `  ${path}`).join('\n') +
      '\n\nThe generator moved or renamed an output. Update the list in ' +
      'tools/scripts/check-hardcoded-colours.mjs rather than leaving an ' +
      'exemption that excludes nothing.',
  )
  process.exit(1)
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
  if (verdict.regressions.length) {
    console.log(
      `${verdict.regressions.length} file(s) gained a hardcoded colour. Use a ` +
        'theme token — `sx: { color: \'primary.main\' }` — which is the fix in ' +
        'almost every case.',
    )
    console.log(
      remedy(
        verdict.regressions,
        BASELINE_PATH,
        'the value genuinely cannot be themed, as in email HTML, which has ' +
          'no CSS vars',
      ),
    )
  }
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
