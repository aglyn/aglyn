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

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
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

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  'coverage',
  '.nx',
  'tmp',
  '.turbo',
  '.git',
  // Generated FROM apps/docs frontmatter and served as in-console Assist
  // content. It is saturated with the brand because the documentation is
  // about a product called Aglyn, and re-running the generator would put
  // every one of them straight back — a ratchet row here would measure the
  // docs, not the code.
  'constants',
])

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

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const write = args.includes('--write')
const list = args.includes('--list')

function sweptFiles(dir, found = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) sweptFiles(full, found)
      continue
    }
    if (SWEPT.test(entry.name)) found.push(full)
  }
  return found
}

const files = SWEEP_ROOTS.flatMap((root) => sweptFiles(join(REPO_ROOT, root)))

const counts = {}
const occurrences = {}
for (const file of files) {
  const path = relative(REPO_ROOT, file).split(sep).join('/')
  if (EXEMPT.some((pattern) => pattern.test(path))) continue
  const found = findBrandLiterals(readFileSync(file, 'utf8'))
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
