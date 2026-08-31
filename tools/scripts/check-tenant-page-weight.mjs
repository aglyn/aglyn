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
 * Budget the first-load weight of a published tenant page.
 *
 * ```
 * npm run check:tenant-page-weight             # the gate
 * npm run check:tenant-page-weight -- --list   # what is in the graph
 * npm run check:tenant-page-weight -- --write  # re-baseline, deliberately
 * npm run check:tenant-page-weight -- --json
 * npm run check:tenant-page-weight -- --budget <path>   # against another
 * npm run check:tenant-page-weight -- --entry <path> --list
 * ```
 *
 * `--budget` weighs this tree against a budget file from somewhere else — a
 * branch's, a release tag's — without checking that branch out. It is also
 * the only way to drive this script to a red without editing the repo, which
 * is what the self-test uses: the exit code is the whole product here, and an
 * exit code no test ever saw go to 1 is an exit code nothing is holding.
 *
 * `check:aglyn-barrel` and `check:jsx-barrel` pin WHICH third-party packages a
 * published page can reach. Neither can see the failure this one exists for:
 * first-party code growing without adding a single new dependency, which is the
 * same bill at the end of the month. The measurement, the verdict and the
 * reasoning behind both live in `lib/tenant-page-weight.mjs`; the forced reds
 * are in its test file.
 *
 * `--write` is not a way to make a red go away. It records a DECISION: the
 * number moves in the same diff as the import that moved it, so a reviewer sees
 * the new figure next to the change that bought it.
 *
 * Exit codes: 0 within budget · 1 over budget, the entry moved, or a
 * forbidden barrel is statically reachable again.
 */

import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createResolver } from '../lint-rules/lib/app-router-graph.mjs'
import {
  TENANT_PAGE_ENTRY,
  budgetFor,
  evaluatePageWeight,
  explainVerdict,
  measurePageWeight,
} from './lib/tenant-page-weight.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DEFAULT_BUDGET_PATH = join(REPO_ROOT, 'tools', 'tenant-page-budget.json')

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = args.indexOf(name)
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback
}
const BUDGET_PATH = flag('--budget', DEFAULT_BUDGET_PATH)
/**
 * The client root to weigh, repo-relative.
 *
 * `TENANT_PAGE_ENTRY` unless asked otherwise. The tenant app has other
 * published client roots that nothing budgets — `[host]/search/
 * search-results.component.tsx` is 305.4 KB across 135 modules — so being able
 * to point this at one is worth having. It is also what lets the self-test
 * drive the unmeasurable-entry red, which is otherwise unreachable without
 * deleting a file from the tree.
 *
 * Aim it at a client root, not at a `page.tsx`. An App Router page without
 * `'use client'` is a SERVER component, and its graph is server modules that
 * no visitor downloads — a number that looks alarming and bills nothing on
 * the wire.
 *
 * `--write` refuses to run beside it: `budgetFor` records `TENANT_PAGE_ENTRY`
 * whatever was measured, so re-baselining here would pin one page's budget to
 * another page's weight.
 */
const ENTRY = flag('--entry', TENANT_PAGE_ENTRY)
const kb = (n) => `${(n / 1024).toFixed(1)} KB`

function main() {
  let measured
  try {
    const entry = join(REPO_ROOT, ENTRY)
    // Stat the entry first. A resolver handed a path that does not exist walks
    // no edges and reports zero bytes, and zero bytes is under every budget —
    // so an entry that moved would PASS this gate while measuring nothing.
    statSync(entry)
    measured = measurePageWeight({
      entry,
      read: (file) => readFileSync(file, 'utf8'),
      resolve: createResolver(REPO_ROOT),
      size: (file) => statSync(file).size,
    })
  } catch (error) {
    console.error(
      `check:tenant-page-weight — cannot measure ${ENTRY}: ` +
        `${error.message}\n` +
        "If the published page's client root moved, point TENANT_PAGE_ENTRY " +
        'at the new one and re-baseline in the same commit. An unmeasurable ' +
        'entry is a red, never a pass.',
    )
    return 1
  }

  if (args.includes('--write') && ENTRY !== TENANT_PAGE_ENTRY) {
    console.error(
      `check:tenant-page-weight — refusing to re-baseline from ${ENTRY}. ` +
        `The budget file records ${TENANT_PAGE_ENTRY} whatever was measured, ` +
        "so this would pin one page's budget to another page's weight.",
    )
    return 1
  }

  if (args.includes('--write')) {
    // Always the checked-in file. `--budget` points at something to COMPARE
    // against, and re-baselining onto it would silently rewrite whatever it
    // was — the release tag's budget, another branch's — rather than this one.
    const budget = budgetFor(measured)
    writeFileSync(DEFAULT_BUDGET_PATH, `${JSON.stringify(budget, null, 2)}\n`)
    console.log(
      `Wrote ${relative(REPO_ROOT, DEFAULT_BUDGET_PATH)}\n` +
        `  ${kb(budget.baselineBytes)} of first-party source across ` +
        `${budget.baselineModules} modules (budget ${kb(budget.budgetBytes)})`,
    )
    return 0
  }

  const budget = JSON.parse(readFileSync(BUDGET_PATH, 'utf8'))

  if (args.includes('--json')) {
    console.log(
      JSON.stringify(
        {
          entry: ENTRY,
          bytes: measured.bytes,
          moduleCount: measured.moduleCount,
          budgetBytes: budget.budgetBytes,
          packages: measured.packages,
        },
        null,
        2,
      ),
    )
  }

  if (args.includes('--list')) {
    console.log(
      `First-load first-party graph of ${ENTRY}\n` +
        `  ${kb(measured.bytes)} across ${measured.moduleCount} modules\n`,
    )
    for (const [file, size] of measured.files.slice(0, 60)) {
      console.log(`  ${kb(size).padStart(9)}  ${relative(REPO_ROOT, file)}`)
    }
    console.log(`\n  third-party packages reached: ${measured.packages.length}`)
  }

  const verdict = evaluatePageWeight(measured, budget)

  if (!verdict.ok) {
    for (const reason of explainVerdict(verdict, measured, budget)) {
      console.error(`check:tenant-page-weight — ${reason}`)
    }
    return 1
  }

  if (!args.includes('--list') && !args.includes('--json')) {
    console.log(
      `check:tenant-page-weight — ${kb(measured.bytes)} of first-party ` +
        `source across ${measured.moduleCount} modules ` +
        `(budget ${kb(budget.budgetBytes)})`,
    )
  }
  return 0
}

process.exit(main())
