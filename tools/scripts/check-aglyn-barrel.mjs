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
 * Fail when `libs/aglyn/src/index.ts` reaches a third-party package it did
 * not reach before (AGL-2486).
 *
 * `check-jsx-barrel.mjs` guards the OTHER barrel a published customer page
 * imports statically. This one guards `@aglyn/aglyn`, which
 * `apps/tenant/app/[host]/[[...slug]]/catch-all-client.tsx` opens with — and
 * which had no guard at all, which is how `firebase/auth` and `acorn` each
 * came to ship to anonymous visitors of every customer site. Same detector,
 * same two pins, same `--write` discipline; only the allowlist and the
 * failure text differ.
 *
 * ```
 * npm run check:aglyn-barrel             # the gate
 * npm run check:aglyn-barrel -- --list   # the full measurement
 * npm run check:aglyn-barrel -- --write  # re-baseline, deliberately
 * npm run check:aglyn-barrel -- --json
 * ```
 *
 * `--write` is not a way to make a red go away. It records a DECISION: the
 * allowlist moves in the same diff as the import that moved it, so a reviewer
 * sees the line and can weigh the cost the failure message just quoted.
 *
 * Exit codes: 0 clean · 1 the barrel drifted from the allowlist.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  AGLYN_BARREL,
  WHY_AGLYN,
  evaluateBarrel,
  measureBarrel,
} from './lib/jsx-barrel.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASELINE_PATH = join(
  REPO_ROOT,
  'tools',
  'scripts',
  'aglyn-barrel-baseline.json',
)

const asJson = process.argv.includes('--json')
const list = process.argv.includes('--list')
const write = process.argv.includes('--write')

const read = (file) => readFileSync(file, 'utf8')
const measured = measureBarrel(REPO_ROOT, read, AGLYN_BARREL)
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
const verdict = evaluateBarrel(measured, baseline)

if (write) {
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify(
      {
        $comment: baseline.$comment,
        specifiers: measured.specifiers,
        packages: measured.packages,
      },
      null,
      2,
    ) + '\n',
  )
  console.log(
    `Wrote ${relative(REPO_ROOT, BASELINE_PATH)} — ` +
      `${measured.specifiers.length} specifier(s), ` +
      `${measured.packages.length} package(s).`,
  )
  console.log('')
  console.log(WHY_AGLYN)
  process.exit(0)
}

if (asJson) {
  console.log(
    JSON.stringify(
      {
        clean: verdict.clean,
        specifiers: measured.specifiers,
        packages: measured.packages,
        moduleCount: measured.moduleCount,
        drift: { specifiers: verdict.specifiers, packages: verdict.packages },
      },
      null,
      2,
    ),
  )
  process.exit(verdict.clean ? 0 : 1)
}

const blame = (name) => {
  const file = measured.firstImporter.get(name)
  return file ? ` — first reached from ${relative(REPO_ROOT, file)}` : ''
}

if (list) {
  console.log(`${AGLYN_BARREL}`)
  console.log(
    `  ${measured.specifiers.length} specifier(s), ` +
      `${measured.packages.length} third-party package(s), ` +
      `${measured.moduleCount} module(s) in the transitive graph.`,
  )
  console.log('')
  for (const one of measured.specifiers) console.log(`  EXPORT   ${one}`)
  console.log('')
  for (const one of measured.packages)
    console.log(`  PACKAGE  ${one}${blame(one)}`)
  console.log('')
}

for (const one of verdict.specifiers.added)
  console.log(
    `  ADDED    ${one} — re-exported by ${AGLYN_BARREL}, not on the allowlist`,
  )
for (const one of verdict.specifiers.removed)
  console.log(`  DROPPED  ${one} — on the allowlist, no longer re-exported`)
for (const one of verdict.packages.added)
  console.log(`  PULLED   ${one} — now reachable from the barrel${blame(one)}`)
for (const one of verdict.packages.removed)
  console.log(`  FREED    ${one} — on the allowlist, no longer reachable`)

console.log('')

if (verdict.specifiers.added.length || verdict.packages.added.length) {
  console.log(WHY_AGLYN)
  console.log('')
  console.log(
    'If a published page genuinely needs it, re-run with `--write` and land ' +
      'the allowlist change in THIS commit, so the cost is a line a reviewer ' +
      'can see.',
  )
} else if (
  verdict.specifiers.removed.length ||
  verdict.packages.removed.length
) {
  console.log(
    'The barrel got LIGHTER than the allowlist allows. That is a win, and it ' +
      'is red on purpose: an allowlist row nobody has read is read as ' +
      'permission. Re-run with `--write` to bank it in this commit.',
  )
} else {
  console.log(
    `${AGLYN_BARREL} matches the allowlist — ` +
      `${measured.specifiers.length} specifier(s), ` +
      `${measured.packages.length} package(s).`,
  )
}

process.exit(verdict.clean ? 0 : 1)
