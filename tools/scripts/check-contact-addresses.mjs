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

// Fail when the corpus publishes an `@aglyn.com` address that is not
// provisioned to receive mail (AGL-2400).
//
//   npm run check:contact-addresses
//   npm run check:contact-addresses -- --list   # the registry and open gaps
//   npm run check:contact-addresses -- --json
//
// The registry, and the long form of why it is a hand-kept list rather than a
// probe, live in `lib/contact-addresses.mjs`. This file walks tracked files and
// compares.
//
// ## WHY THIS EXISTS
//
// A `@aglyn.com` address that was never created does not bounce — a Google
// default routing rule accepts it and suppresses the bounce (AGL-1577). So the
// usual way a wrong address announces itself is unavailable to us: publishing
// `helo@aglyn.com` for a typo, or an address somebody meant to create and
// didn't, produces mail that is accepted and discarded, with a sender who
// believes they have reached us. `docs/EMAIL_SETUP.md` states the same thing
// about verification: "I sent it and it didn't bounce" is exactly as true of an
// address that was never created, so that check cannot fail and proves nothing.
//
// The corpus has form here. `support@` acquired a legal obligation on
// 2026-08-18 — it became the SCC Clause 9 objection route — and the runbook
// table said "No legal document" for four days until a human found it by
// reading (AGL-1648). Nothing could have noticed, because nothing was looking.
//
// ## NO CREDENTIAL, AND NO NETWORK
//
// Deliberate, and the same call `check:legal-index-dates` makes: the failure
// this catches is somebody forgetting, so it must not itself depend on somebody
// remembering a secret. It reads tracked files and a list.
//
// ## WHAT IT CANNOT SEE, STATED PLAINLY
//
// The legal pages and the marketing site are **besigner** content and are not
// in this repo, so an address published only there is invisible here. That is
// not a gap this script can close — a fetch would need the bot-protection probe
// token, and would still be comparing against the same hand-kept list. What
// covers that half is `UNVERIFIED_PROVISIONING` in the lib, measured from the
// live site by hand and printed by `--list`.
//
// Exit codes: 0 clean · 1 an unprovisioned address is published.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  findUnprovisionedAddresses,
  PROVISIONED_CONTACT_ADDRESSES,
  STATUTORY_INTAKE_ADDRESSES,
  UNVERIFIED_PROVISIONING,
} from './lib/contact-addresses.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Extensions that can carry prose or a constant a person will read. */
const SWEPT = /\.(?:tsx?|jsx?|mjs|cjs|md|mdx|json|ya?ml|html|txt)$/

/**
 * Fixtures name people, and those people need email addresses. `alice@`,
 * `bob@`, `editor@` and `ops@` are actors in a test, not published contacts,
 * and sweeping them would bury the one finding that matters under a hundred
 * that do not.
 */
const EXEMPT_PATH = [
  /\.(?:spec|test)\.[cm]?[jt]sx?$/,
  /(?:^|\/)(?:specs|__tests__|__mocks__|fixtures)\//,
  /(?:^|\/)e2e\//,
  // Seed and demo data invents a whole cast.
  /(?:^|\/)tools\/scripts\/seed-[^/]+\.mjs$/,
  // This guard and its registry have to spell what they detect.
  /^tools\/scripts\/check-contact-addresses\.mjs$/,
  /^tools\/scripts\/lib\/contact-addresses(?:\.test)?\.mjs$/,
]

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const list = args.includes('--list')

/** TRACKED files only, via `git ls-files` — never a filesystem walk. */
function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return out
    .split('\0')
    .filter(Boolean)
    .filter((p) => SWEPT.test(p))
    .filter((p) => !EXEMPT_PATH.some((re) => re.test(p)))
}

function read(path) {
  try {
    return readFileSync(join(REPO_ROOT, path), 'utf8')
  } catch {
    return null
  }
}

const files = []
for (const path of trackedFiles()) {
  const text = read(path)
  if (text !== null) files.push({ path, text })
}

const findings = findUnprovisionedAddresses(files)

if (asJson) {
  console.log(
    JSON.stringify(
      { scanned: files.length, findings, unverified: UNVERIFIED_PROVISIONING },
      null,
      2,
    ),
  )
  process.exit(findings.length ? 1 : 0)
}

if (list) {
  console.log(`Provisioned to receive (${PROVISIONED_CONTACT_ADDRESSES.length}):`)
  for (const a of PROVISIONED_CONTACT_ADDRESSES) {
    const statutory = STATUTORY_INTAKE_ADDRESSES.includes(a)
    console.log(`  ${a.padEnd(26)} ${statutory ? 'statutory intake' : ''}`)
  }
  console.log('')
}

// Printed on EVERY run, clean or not. These are published addresses whose
// provisioning carries no verification date and which no auto-reply covers —
// the guard passing is not a statement that they are fine.
if (UNVERIFIED_PROVISIONING.length) {
  console.log(
    `⚠️  ${UNVERIFIED_PROVISIONING.length} published address(es) outside the verified six (AGL-2400):`,
  )
  for (const row of UNVERIFIED_PROVISIONING) {
    console.log(`  ${row.address} — ${row.publishedAt}`)
    if (list) console.log(`      ${row.why}`)
  }
  console.log('')
}

console.log(`Scanned ${files.length} tracked files.`)

if (!findings.length) {
  console.log('✅ Every @aglyn.com address published in the repo is provisioned.')
  process.exit(0)
}

console.error(
  `\n❌ ${findings.length} unprovisioned @aglyn.com address(es) published:\n`,
)
for (const f of findings) {
  console.error(`  ${f.path}:${f.line}  ${f.address}`)
}
console.error(
  '\nAn address that does not exist ACCEPTS mail and suppresses the bounce'
  + '\n(AGL-1577), so this cannot be verified by sending to it. Either:'
  + '\n  • create the Group and add it to PROVISIONED_CONTACT_ADDRESSES in'
  + '\n    tools/scripts/lib/contact-addresses.mjs — verify FIRST, at'
  + '\n    https://groups.google.com/a/aglyn.com/g/<name>/members (a real group'
  + '\n    renders its members; a missing one 404s), or'
  + '\n  • stop publishing it.\n',
)
process.exit(1)
