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
 * Fail when customer-facing copy gains a British spelling (AGL-2763).
 *
 * The standing rule is American spelling on every customer-facing surface, and
 * until now nothing enforced it. The drift it was written about came straight
 * back: `colour` in the Besigner styling pages, one of them a HEADING whose
 * anchor had already been generated into two console registries, so a spelling
 * fix became a link-integrity change.
 *
 * The detector — and the two carve-outs the rule itself insists on, comments
 * and persisted values — lives in `lib/british-spellings.mjs`. This file walks
 * the corpus and compares against the ratchet baseline.
 *
 * ```
 * npm run check:british-spellings              # the gate
 * npm run check:british-spellings -- --list    # every occurrence, with lines
 * npm run check:british-spellings -- --json
 * npm run check:british-spellings -- --write   # re-baseline after a cleanup
 * ```
 *
 * ## Why a ratchet rather than a bare zero
 *
 * The same argument AGL-2025 makes for colours and AGL-2170 for brand
 * literals. The published docs alone carry ~50 further occurrences in prose
 * that is correct English but the wrong dialect — `safe harbour` in the DMCA
 * pages, `behaviour` in the API reference, `recognise` in the rate-limit
 * caution. Cleaning all of them is a copy edit with its own review; failing
 * the build on every one of them today would get the gate switched off before
 * that edit was scheduled. The baseline is a per-file CEILING, so a page may
 * lose spellings freely and only GAINS go red.
 *
 * Exit codes: 0 clean · 1 a file gained a spelling, or a baseline row is stale.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  compareToBaseline,
  findInMarkdown,
  findInSource,
} from './lib/british-spellings.mjs'
import { remedy } from './lib/ratchet-baseline.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASELINE_PATH = join(
  REPO_ROOT,
  'tools',
  'scripts',
  'british-spellings-baseline.json',
)

/**
 * The PUBLISHED docs content roots, and nothing else under `apps/docs`.
 *
 * `docusaurus.config.ts` mounts exactly these four — `docs` at `/`, plus the
 * `api`, `learn` and `help` plugin instances. `SCREENSHOT_PLAN.md` and
 * `CONTRIBUTING.md` sit at the app root and are never served, so they are
 * internal notes and out of scope by the same reasoning that excludes
 * comments.
 */
const MARKDOWN_ROOTS = [
  'apps/docs/docs',
  'apps/docs/api',
  'apps/docs/learn',
  'apps/docs/help',
]

/** Ships as UI: the console, and the docs site's own React components. */
const SOURCE_ROOTS = ['apps/console', 'apps/docs/src']

const MARKDOWN = /\.mdx?$/
const SOURCE = /\.(?:tsx?|jsx?|mjs|cjs)$/

/**
 * Naming the spellings is what these files are FOR, and a spec that pins a
 * British spelling is usually pinning it on purpose.
 *
 * `assist-deflection.spec.ts` is the case worth stating: its fixture queries
 * include *"how do I edit my theme colours and fonts"* and *"how do I
 * customise the error screens"* because REAL USERS TYPE THAT. The corpus is
 * American and the queries are not, which is precisely the retrieval the suite
 * exists to measure. Americanising those fixtures would delete the test.
 */
const EXEMPT = [
  /\.spec\.[cm]?[jt]sx?$/,
  /\.test\.[cm]?[jt]sx?$/,
  /^tools\/scripts\/lib\/british-spellings\.mjs$/,
  /^tools\/scripts\/check-british-spellings\.mjs$/,
]

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const write = args.includes('--write')
const list = args.includes('--list')

/**
 * TRACKED files only, via `git ls-files` — never a filesystem walk.
 *
 * `apps/docs/build/` and `apps/docs/.docusaurus/` are untracked Docusaurus
 * OUTPUT containing every page's prose twice over. A developer who had built
 * the docs would otherwise measure a different repo from one who had not, and
 * `--write` against a built tree would bake those files into the baseline —
 * where every row then reads as `stale` in CI. Same defect, same fix, as the
 * colour and brand ratchets.
 */
function trackedFiles(roots, pattern) {
  const out = execFileSync('git', ['ls-files', '-z', '--', ...roots], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return out
    .split('\0')
    .filter((path) => path && pattern.test(path))
    // An index entry does not promise a file on disk: `git status` calls the
    // gap `AD`, and it appears mid-merge and mid-rebase.
    .filter((path) => existsSync(join(REPO_ROOT, path)))
}

const corpus = [
  ...trackedFiles(MARKDOWN_ROOTS, MARKDOWN).map((path) => ({
    path,
    prose: true,
  })),
  ...trackedFiles(SOURCE_ROOTS, SOURCE).map((path) => ({ path, prose: false })),
]

const counts = {}
const occurrences = {}
for (const { path, prose } of corpus) {
  if (EXEMPT.some((pattern) => pattern.test(path))) continue
  const source = readFileSync(join(REPO_ROOT, path), 'utf8')
  // The path selects the parse dialect for source — `.ts` and `.tsx` disagree
  // about `<T>value`, so the detector must be told which it is holding.
  const found = prose ? findInMarkdown(source) : findInSource(source, path)
  if (!found.length) continue
  counts[path] = found.length
  occurrences[path] = found
}

const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  : {}
const verdict = compareToBaseline(counts, baseline)

if (write) {
  const ordered = Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
  )
  writeFileSync(BASELINE_PATH, `${JSON.stringify(ordered, null, 2)}\n`)
  console.log(
    `wrote ${relative(REPO_ROOT, BASELINE_PATH).split(sep).join('/')} · ` +
      `${Object.keys(ordered).length} files`,
  )
  process.exit(0)
}

if (asJson) {
  console.log(
    JSON.stringify(
      {
        swept: corpus.length,
        files: Object.keys(counts).length,
        counts,
        occurrences,
        verdict,
      },
      null,
      2,
    ),
  )
  process.exit(verdict.clean ? 0 : 1)
}

const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
console.log(
  `British spelling census · ${corpus.length} files swept · ` +
    `${total} occurrences in ${Object.keys(counts).length} files`,
)

if (list)
  for (const [path, found] of Object.entries(occurrences).sort())
    for (const one of found)
      console.log(`  ${path}:${one.line}  ${one.word} → ${one.suggestion}`)

for (const one of verdict.improvements)
  console.log(
    `  ↓ ${one.file} now has ${one.count} (baseline ${one.allowed}) — lower the row`,
  )

if (verdict.clean) {
  console.log('\nNo file gained a British spelling.')
  process.exit(0)
}

for (const one of verdict.regressions) {
  console.error(
    `\n⛔ ${one.file} has ${one.count} British spelling(s), baseline allows ${one.allowed}`,
  )
  for (const hit of occurrences[one.file])
    console.error(`     ${one.file}:${hit.line}  ${hit.word} → ${hit.suggestion}`)
}

for (const one of verdict.stale)
  console.error(
    `\n⛔ ${one.file} is clean or gone but the baseline still allows ${one.allowed} — delete the row`,
  )

if (verdict.regressions.length)
  console.error(
    remedy(
      verdict.regressions,
      relative(REPO_ROOT, BASELINE_PATH).split(sep).join('/'),
      'a persisted value, or prose quoting a British source verbatim',
    ),
  )

process.exit(1)
