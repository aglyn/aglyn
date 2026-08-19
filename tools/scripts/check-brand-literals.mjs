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
 * Fail when source gains a hardcoded brand name in user-visible copy
 * (AGL-2170). The detector and its rationale — what counts, and the three
 * exclusions worth defending — live in `lib/brand-literals.mjs`; this file
 * walks the corpus and compares against the ratchet baseline.
 *
 * ```
 * npm run check:brand-literals              # the gate
 * npm run check:brand-literals -- --list    # every occurrence, with lines
 * npm run check:brand-literals -- --write   # re-baseline after a cleanup
 * npm run check:brand-literals -- --json
 * ```
 *
 * `--write` is how the debt shrinks: replace literals with
 * `PLATFORM_BRAND_NAME` (or the org's resolved `productName` where the surface
 * has an org), re-run, and commit the lowered baseline alongside. It only
 * writes what it measures, so a regression cannot be laundered in without the
 * diff showing a count going UP — which is what a reviewer can see.
 *
 * Exit codes: 0 clean · 1 a file gained a literal, or a baseline row is stale.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { compareToBaseline, findBrandLiterals } from './lib/brand-literals.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASELINE_PATH = join(
  REPO_ROOT,
  'tools',
  'scripts',
  'brand-literals-baseline.json',
)

/** Ships, or generates something that ships. Mirrors the colour ratchet. */
const SWEEP_ROOTS = ['apps', 'libs', 'cloud']


const SWEPT = /\.(?:tsx?|jsx?|mjs|cjs)$/

/**
 * Naming the brand is what these files are FOR — the specs that pin it in
 * both directions, and the detector that has to spell the word it detects.
 */
const EXEMPT = [
  /\.spec\.[cm]?[jt]sx?$/,
  /\.test\.[cm]?[jt]sx?$/,
  /^tools\/scripts\/lib\/brand-literals\.mjs$/,
  /^tools\/scripts\/check-brand-literals\.mjs$/,
  // The canonical definition states the default exactly once, on purpose.
  /^libs\/aglyn\/src\/lib\/app-utils\/platform-brand\.ts$/,
]

/**
 * Aglyn's own documentation, transcribed verbatim into shipped code by a
 * generator (AGL-2279).
 *
 * Every path here is an OUTPUT of `generate-docs-help.mjs` or
 * `generate-assist-docs-index.mjs`. Their contents are `apps/docs` frontmatter
 * and section text copied word for word: the tooltip excerpt beside a console
 * card, and the retrieval corpus Assist answers from.
 *
 * ## Why these are exempt rather than rewritten to read the configured brand
 *
 * An excerpt is one half of a help tooltip whose other half is a link labelled
 * *Open documentation*, pointing at the very page the excerpt is the
 * description OF. Excerpt and destination are the same sentence. Substituting
 * a brand into the excerpt does not rebrand anything; it makes the tooltip
 * misdescribe where it goes.
 *
 *  - **A white-label org.** `NEXT_PUBLIC_DOCS_ORIGIN` is a DEPLOYMENT value,
 *    not a per-org one, so every org on Aglyn's cloud — white-label included —
 *    gets `docs.aglyn.com`. Their admin clicking through lands on a site whose
 *    navbar, title and White-label page all say Aglyn. White-label is a claim
 *    about the ORG'S OWN surfaces — console chrome, published sites,
 *    transactional email — which `resolveBrandingProfile` covers and
 *    `branding-coverage.spec.ts` guards. Our product documentation is not one
 *    of them.
 *  - **A self-host install.** `NEXT_PUBLIC_DOCS_ORIGIN` retargets these links
 *    at the operator's own build of `apps/docs` — our markdown, which says
 *    Aglyn on every page by design. `lib/docs-self-host.mjs` already drew this
 *    line and states it plainly: that check is "deliberately NOT a blanket
 *    `aglyn` search … What must not survive is a value the software ACTS on."
 *    The link target is such a value and IS configurable. The prose is not.
 *
 * Rewriting the docs prose to drop the product name would make the
 * documentation worse to satisfy a linter, and the generator would put it
 * straight back on the next docs edit — a row here would measure `apps/docs`,
 * not the code, and would go red on an author who has no reason to know a code
 * gate reads their frontmatter.
 *
 * ## Why exact paths and not a directory
 *
 * This was `/(^|\/)constants\//` — a DIRECTORY rule that covered the docs
 * excerpts only because the generator happened to emit them into
 * `apps/console/constants/`. When AGL-2213 added a third output under
 * `libs/aglyn/src/lib/app-utils/`, it escaped, and the gate reported four
 * "new" hardcoded brand names that no one had written. The same rule was also
 * exempting every hand-written file under any `constants/` directory in the
 * repo — 4 further occurrences in 2 files the gate could not see at all.
 *
 * `libs/besigner/.../docs-help.generated.ts` carries paths and anchors but no
 * excerpts today, so it contributes nothing; it is listed because it is an
 * output of the same generator and the list is what a future output gets added
 * to.
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
 * This started as a `readdirSync` walk with a directory skip-list, which is
 * the same mistake the colour ratchet made and AGL-2025 corrected: a walk
 * sweeps whatever happens to be on disk, so the guard measures machine state
 * rather than the repo. `apps/docs/build/` and `apps/docs/.docusaurus/` are
 * untracked build OUTPUT, and minified Docusaurus bundles are saturated with
 * the product name — a developer who had built the docs saw 106 files "gain"
 * a brand literal off the same commit where a developer who had not saw a
 * clean run. Worse for a ratchet than for a plain scan: `--write` against a
 * built tree would have BAKED those files into the baseline, and every row
 * would then read as `stale` in CI, where they do not exist.
 *
 * Enumerating what git tracks makes the guard deterministic and means
 * generated output can never trip it.
 */
function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z', '--', ...SWEEP_ROOTS], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return out
    .split('\0')
    .filter((path) => path && SWEPT.test(path))
    .map((path) => join(REPO_ROOT, path))
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
  const found = findBrandLiterals(readFileSync(file, 'utf8'))
  if (!found.length) continue
  counts[path] = found.length
  occurrences[path] = found
}

/**
 * An exemption that matches nothing is the `stale` row in another costume: the
 * generator's output moved, the rule kept passing, and nobody read it again.
 * The directory rule this replaced failed exactly that way and stayed silent
 * about it, so the list is checked against what the sweep actually saw.
 */
const missingProse = GENERATED_DOCS_PROSE.filter((path) => !proseSeen.has(path))
if (missingProse.length) {
  console.error(
    'FAIL: GENERATED_DOCS_PROSE exempts paths the sweep never reached:\n' +
      missingProse.map((path) => `  ${path}`).join('\n') +
      '\n\nThe generator moved or renamed an output. Update the list in ' +
      'tools/scripts/check-brand-literals.mjs rather than leaving an ' +
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
      console.log(`  ${String(one.line).padStart(5)}  ${one.text.slice(0, 90)}`)
  }
} else {
  console.log(
    `brand literal census · ${files.length} files swept · ` +
      `${total} occurrences in ${Object.keys(counts).length} files`,
  )
  // Guard the premise. A walk that reached nothing would report zero
  // regressions and read as a pass — the failure mode this repo keeps hitting
  // (AGL-1776, AGL-2004). Anything near zero means the sweep is broken, not
  // that the repo is clean.
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
      `${verdict.regressions.length} file(s) gained a hardcoded brand name. ` +
        'User-visible copy must read the configured brand — ' +
        '`PLATFORM_BRAND_NAME` from `@aglyn/aglyn`, or the org\'s resolved ' +
        '`productName` where the surface has an org (AGL-2153). A self-host ' +
        'operator cannot edit source to rename the product, and a white-label ' +
        'org must not see ours.',
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
    console.log('No file gained a hardcoded brand name.')
}

process.exit(verdict.clean ? 0 : 1)
