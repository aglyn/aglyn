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
 * Fails if the pre-move residential address reappears in tracked source
 * (AGL-1491).
 *
 *   npm run check:residential-address
 *
 * The detector, the digests, and the long form of why it hashes token windows
 * instead of grepping a literal, live in `lib/residential-address.mjs`. This
 * file walks tracked files and reports.
 *
 * ## Why this exists
 *
 * On 2026-08-24 three tracked spec files were found publishing the address —
 * one of them the full street line — in `platformRevenue` fixtures copied
 * verbatim from a live Stripe invoice. A fourth had been fixed the same
 * morning (AGL-1963, commit a175e0619). Four findings in one day, all the same
 * mechanism: real Stripe data pasted into a test as sample data.
 *
 * Nothing was watching. `check-no-tax-identifiers` guards the Comptroller
 * identifiers and never looked at an address; `check-contact-addresses` guards
 * `@aglyn.com` mailboxes. The address had no guard at all, and this repo is
 * PUBLIC, so a reintroduction is permanent — git history does not forget.
 *
 * ## What it cannot see, stated plainly
 *
 * - **Commit messages.** This walks file CONTENT. A message carrying the
 *   address is just as public and is not scanned here.
 * - **History.** Only the working tree at HEAD. A value already committed
 *   stays reachable in the object store whatever this reports.
 * - **Everything outside the checkout** — Stripe, Firestore, the shared Drive,
 *   the Texas Comptroller record. The live inventory lives on AGL-1491; those
 *   surfaces are dashboards and filings, and no repo guard reaches them.
 *
 * Exit codes: 0 clean · 1 the address is present.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { scanText } from './lib/residential-address.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const asJson = process.argv.includes('--json')

/**
 * TRACKED files only, via `git ls-files` — never a filesystem walk. The
 * concern is what is PUBLISHED: an untracked scratch file or a gitignored
 * `.env` holding the real value is correct, not a violation.
 *
 * Deliberately NO extension filter and NO test/fixture exemption. Every one of
 * the four findings was in a `.spec.ts`, so exempting specs would have made
 * this guard structurally unable to catch the thing it was written for.
 */
function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return out.split('\0').filter(Boolean)
}

const violations = []
let scanned = 0

for (const file of trackedFiles()) {
  let text
  try {
    text = readFileSync(join(REPO_ROOT, file), 'utf8')
  } catch {
    continue // unreadable — no string literal to leak
  }
  if (text.includes('\0')) continue // binary
  scanned += 1
  for (const label of scanText(text)) violations.push({ file, label })
}

if (asJson) {
  console.log(JSON.stringify({ scanned, violations }, null, 2))
  process.exit(violations.length ? 1 : 0)
}

if (!violations.length) {
  console.log(
    `check-residential-address: OK — the pre-move residential address is in none of ${scanned} tracked files.`,
  )
  process.exit(0)
}

console.error(
  'check-residential-address: RESIDENTIAL ADDRESS IN TRACKED SOURCE\n',
)
for (const { file, label } of violations) {
  console.error(`  ${file}\n    ${label}`)
}
console.error(
  [
    '',
    'This repository is PUBLIC and git history does not forget, so this must not',
    'be committed. If it came from a live Stripe invoice or a real Firestore row,',
    'the fix is fictional sample data, not a redaction of the real value:',
    '',
    "  line1: '1 Directory Row'   city: 'Testville'   postalCode: '00000'",
    '',
    'The literal values are load-bearing for nothing in these fixtures — the',
    'assertions compare against the same constants, so they hold identically',
    'whatever the strings say. What the tests prove is the SHAPE (AGL-1963).',
    '',
    'The live, non-repo surfaces are inventoried on AGL-1491.',
    '',
  ].join('\n'),
)
process.exit(1)
