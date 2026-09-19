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
 * Budget the JavaScript a published page downloads before it settles, read
 * from a tenant production build (AGL-3082).
 *
 * ```
 * npx nx run tenant:build:production
 * npm run check:tenant-wire-weight                 # the gate
 * npm run check:tenant-wire-weight -- --list       # the chunks, per group
 * npm run check:tenant-wire-weight -- --json
 * npm run check:tenant-wire-weight -- --write      # re-baseline, deliberately
 * node tools/scripts/check-tenant-wire-weight.mjs --if-built
 * node tools/scripts/check-tenant-wire-weight.mjs --next <dir> --budget <path>
 * ```
 *
 * The measurement and the verdict live in `lib/tenant-wire-weight.mjs`, with
 * the reasoning; the forced reds are in its test file. The groups, and the
 * imports that define them, are declared in `tools/tenant-wire-budget.json`.
 *
 * `--if-built` is for a CI job whose build step is affected-scoped: when the
 * tenant was not built there is nothing that could have changed its bytes,
 * and the gate says so and passes. Without it, a missing build is a red — a
 * gate that weighed nothing has proved nothing.
 *
 * `--write` records a DECISION, the way the source-weight gate's does: the
 * number moves in the same diff as the change that moved it.
 *
 * Exit codes: 0 within budget (or no build under `--if-built`) · 1 over
 * budget, or a declared import not in the build · 2 no build to read.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  budgetFor,
  evaluateWireWeight,
  explainWireVerdict,
  measureWireWeight,
  PUBLISHED_ROUTE,
} from './lib/tenant-wire-weight.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DEFAULT_BUDGET_PATH = join(REPO_ROOT, 'tools', 'tenant-wire-budget.json')

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = args.indexOf(name)
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback
}
const NEXT_DIR = resolve(REPO_ROOT, flag('--next', 'dist/apps/tenant/.next'))
const BUDGET_PATH = resolve(REPO_ROOT, flag('--budget', DEFAULT_BUDGET_PATH))
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`

function main() {
  if (!existsSync(join(NEXT_DIR, 'build-manifest.json'))) {
    if (args.includes('--if-built')) {
      console.log(
        `check:tenant-wire-weight — no tenant production build at ` +
          `${relative(REPO_ROOT, NEXT_DIR)}: the tenant was not built in this ` +
          'run, so nothing here could have changed its bytes. Skipped.',
      )
      return 0
    }
    console.error(
      `check:tenant-wire-weight — no tenant production build at ` +
        `${relative(REPO_ROOT, NEXT_DIR)}. Run \`npx nx run ` +
        'tenant:build:production` first. A gate with nothing to read is a ' +
        'red, never a pass.',
    )
    return 2
  }

  const budget = JSON.parse(readFileSync(BUDGET_PATH, 'utf8'))
  const io = {
    readJson: (path) => JSON.parse(readFileSync(join(NEXT_DIR, path), 'utf8')),
    readText: (path) => readFileSync(join(NEXT_DIR, path), 'utf8'),
    readBuffer: (path) => readFileSync(join(NEXT_DIR, path)),
    exists: (path) => existsSync(join(NEXT_DIR, path)),
  }

  let measured
  try {
    measured = measureWireWeight({
      route: budget.route ?? PUBLISHED_ROUTE,
      groups: budget.groups ?? [],
      io,
    })
  } catch (error) {
    console.error(
      `check:tenant-wire-weight — cannot read the build: ${error.message}. ` +
        'An unreadable build is a red, never a pass.',
    )
    return 1
  }

  if (args.includes('--write')) {
    const unresolved = measured.groups.filter((group) => group.missing.length)
    if (unresolved.length) {
      for (const reason of explainWireVerdict(evaluateWireWeight(measured, budget))) {
        console.error(`check:tenant-wire-weight — ${reason}`)
      }
      console.error('Refusing to re-baseline a group that cannot find its imports.')
      return 1
    }
    const next = budgetFor(measured, budget)
    writeFileSync(BUDGET_PATH, `${JSON.stringify(next, null, 2)}\n`)
    console.log(`Wrote ${relative(REPO_ROOT, BUDGET_PATH)}`)
    for (const group of next.groups) {
      console.log(
        `  ${group.name}: ${kb(group.baselineBytes)} (budget ${kb(group.budgetBytes)})`,
      )
    }
    return 0
  }

  if (args.includes('--json')) console.log(JSON.stringify(measured, null, 2))

  if (args.includes('--list')) {
    for (const group of measured.groups) {
      console.log(`${group.name} — ${kb(group.bytes)} on the wire, ${kb(group.raw)} raw`)
      for (const chunk of group.chunks) console.log(`    ${chunk}`)
    }
  }

  const verdict = evaluateWireWeight(measured, budget)
  if (!verdict.ok) {
    for (const reason of explainWireVerdict(verdict)) {
      console.error(`check:tenant-wire-weight — ${reason}`)
    }
    return 1
  }

  if (!args.includes('--json')) {
    const planned = new Map((budget.groups ?? []).map((group) => [group.name, group]))
    console.log(
      'check:tenant-wire-weight — ' +
        measured.groups
          .map(
            (group) =>
              `${group.name}: ${kb(group.bytes)} (budget ` +
              `${kb(planned.get(group.name)?.budgetBytes ?? 0)})`,
          )
          .join(' · '),
    )
  }
  return 0
}

process.exit(main())
