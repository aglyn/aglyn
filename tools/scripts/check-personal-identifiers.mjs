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
 * Fails if a named individual's account identifiers reappear in tracked source.
 *
 *   npm run check:personal-identifiers
 *
 * ## Why this exists, and why the guards already here did not catch it
 *
 * This repository is PUBLIC. One person's work mailbox reached **60 tracked
 * files**: shipped source comments, twenty-five spec fixtures, six operational
 * runbooks and two published documentation pages. A personal consumer Google
 * account was named on `docs.aglyn.com` as the permanent `super` break-glass
 * identity — which is to say, published as the one account outside Workspace
 * MFA, offboarding and session revocation. A production Firebase uid for a real
 * person sat in eight files as a test fixture.
 *
 * Three guards were already watching adjacent things and every one of them was
 * green:
 *
 *  - `check-contact-addresses` reads `@aglyn.com` addresses, but it EXEMPTS
 *    every `*.spec.*`, `*.test.*` and `specs/` path — fixtures name people, and
 *    that exemption is right for its own question. It is why twenty-five spec
 *    files were invisible. It also carried a standing exemption for the
 *    owner's local-part, since removed.
 *  - `check-no-tax-identifiers` guards Comptroller registration numbers.
 *  - `check-residential-address` guards one street address.
 *
 * Each is narrow by design. Nothing owned "an identifier belonging to a
 * person", so nothing failed, for months, while the count grew.
 *
 * ## Why it matches by digest and not by grep
 *
 * Same reasoning as `check-no-tax-identifiers`, and it is not about secrecy —
 * these values are not credentials, and they are already in this repository's
 * git history where no guard can reach them. It is that a guard which spells
 * out the literal it forbids is itself a tracked file containing that literal.
 * It would re-add, in the fixing commit, one instance of every value it exists
 * to remove, and be exempted from itself forever after.
 *
 * So it matches by SHAPE — an address, a Firebase uid, a home-directory path —
 * and compares SHA-256 digests. False positives from the shape match are free:
 * an ordinary address hashes to something else and is ignored.
 *
 * ## What it deliberately does not do
 *
 *  - **It does not forbid names.** The account owner's name is in the author
 *    field of every commit and in `CODEOWNERS`; sweeping it from display-name
 *    fixtures would touch a dozen files and remove nothing that is not already
 *    published irreducibly.
 *  - **It does not forbid the GitHub handle.** `@zgover` in `CODEOWNERS` is
 *    load-bearing, and `zgover.aglyn.com` is a real workspace host that CORS
 *    reconciliation is tested against. Only the HOME-DIRECTORY form is a
 *    finding, because that one names a machine layout and never a subject.
 *  - **It does not read history.** Only the working tree at HEAD. A value
 *    already committed stays reachable in the object store whatever this
 *    reports, and rewriting history is the repository owner's decision.
 *  - **It does not read commit messages.** This walks file CONTENT. A message
 *    carrying an identifier is just as public and is not scanned here.
 *
 * ## Forcing it red
 *
 *   node tools/scripts/check-personal-identifiers.mjs --selftest
 *
 * asserts the comparator end to end against a synthetic value, so the proof
 * that the mechanism bites does not require the mechanism's real inputs.
 *
 * Exit codes: 0 clean · 1 an identifier is present.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * The values that must never return, as digests.
 *
 * `label` is what a failure prints, and it never prints the matched value: CI
 * logs are public artifacts on a public repo, so a guard that echoes what it
 * found to prove it found it has published it again.
 *
 * `fix` is the substitution that keeps the sentence's meaning. It is here
 * because the failure everybody reaches for first — delete the sentence — is
 * worse than the leak: these strings sit inside comments explaining real,
 * subtle bugs, and the property is what mattered, never the identity.
 */
const FORBIDDEN = [
  {
    label: "the account owner's work mailbox",
    sha256: 'a57504720403b4a1dc084dc6a5b46e880e32a03454a067d83d52a218fe713364',
    fix: 'Name the property: "an SSO account in the `aglyn-org-y5v14` tenant", '
      + '"the account owner\'s mailbox", "a single human recipient". In a '
      + 'fixture use `staff@aglyn.com` where the aglyn.com DOMAIN is what the '
      + 'test is about, and an `example.com` address where it is not.',
  },
  {
    label: "a second address on the account owner's work domain",
    sha256: '7989174c8c9cf375729e49967d9c09d144aa84760079d5c38ccf97deef85eaf9',
    fix: 'Describe what made it matter — "an identity on a consumer provider" '
      + '— rather than which identity it was.',
  },
  {
    label: "the account owner's personal consumer account",
    sha256: 'c7dbe178b03826ca93740b4de355405cc14d3711bb05f686115b4a3066c9e7ef',
    fix: 'This one is the permanent break-glass `super` identity. Naming it '
      + 'publishes the single account that sits outside Workspace MFA, '
      + 'offboarding and session revocation. Say "a consumer Google account '
      + 'outside the Workspace domain"; which account it is belongs in the '
      + 'password manager.',
  },
  {
    label: 'a third consumer account belonging to the same person',
    sha256: 'bbda5fc29f9d1d441d65404a5083aecf7f93c74938cd8c79fd2b1d63277bb1f3',
    fix: 'Refer to it by its role in the story — "a third consumer account" — '
      + 'not by address.',
  },
  {
    label: "a production Firebase uid belonging to a real person",
    sha256: '5454408a5eaaf7a3ec6433b7b47d3035ceddc2beb306986565697c9b501af724',
    fix: 'A uid is a stronger identifier than an address, and no observation '
      + 'here needs the value: "a tenant uid is not in the project pool" is '
      + 'the point. In a fixture use a synthetic 28-character uid.',
  },
  {
    label: "a developer's home directory path (macOS)",
    sha256: 'd77b0ea442b3ebfbd4ec64ada95dd9a08c78bf8407b9129e8934a7e20c930c95',
    fix: 'A workstation path is not a repository constant. Read it from an '
      + 'environment variable and skip the work when it is unset — '
      + '`AGLYN_DRIVE_MOUNT` and `tools/scripts/lib/drive-mount.mjs` are the '
      + 'worked example.',
  },
  {
    label: "a developer's home directory path (Linux)",
    sha256: '45f44baa083f2177bbed2fe97ac4dea1427504beaafe0616b11a74ddf9d47470',
    fix: 'Same as above — an environment variable, and a documented skip when '
      + 'it is absent.',
  },
]

/**
 * Candidate shapes. Deliberately broad — the digest is the real filter, and a
 * shape too narrow to match a reintroduction is the only way this guard can
 * silently pass.
 *
 * `lower` marks a shape whose candidates are compared case-insensitively.
 * Addresses are: `ZACH@AGLYN.COM` is the same mailbox and appeared that way in
 * a spec. Uids and paths are case-SENSITIVE and must not be folded, or a
 * lowercased uid would stop matching its own digest.
 */
const SHAPES = [
  { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, lower: true },
  { re: /\b[A-Za-z0-9_-]{28}\b/g, lower: false },
  { re: /\/(?:Users|home)\/[A-Za-z0-9._-]+/g, lower: false },
]

/**
 * Paths this guard does not read, each with the reason it would be wrong to.
 *
 * Short on purpose. An exemption is a hole, and the reason has to be that the
 * file's PURPOSE is to carry the value, not that removing it is inconvenient.
 */
const EXEMPT_PATH = [
  {
    re: /^tools\/scripts\/check-personal-identifiers\.mjs$/,
    why: 'this file — it names the digests',
  },
  {
    re: /^\.mailmap$/,
    why: '.mailmap exists to MAP the historical author addresses onto a '
      + 'noreply address, so `git log` stops showing them. Deleting the '
      + 'mapping does not remove those addresses from the commits that carry '
      + 'them — it puts them back in everybody\'s log output.',
  },
]

const digest = (value) => createHash('sha256').update(value).digest('hex')

/**
 * Every forbidden entry found in `text`.
 *
 * `forbidden` is a parameter so the self-test can drive the comparator with a
 * synthetic list, which is what lets this guard prove it bites without ever
 * containing the values it forbids.
 */
export function scanText(text, forbidden = FORBIDDEN) {
  const byHash = new Map(forbidden.map((entry) => [entry.sha256, entry]))
  const found = new Map()
  for (const { re, lower } of SHAPES) {
    for (const [match] of text.matchAll(re)) {
      const hit = byHash.get(digest(lower ? match.toLowerCase() : match))
      if (hit) found.set(hit.sha256, hit)
    }
  }
  return [...found.values()]
}

/** Tracked, non-binary files. `git ls-files`, never a filesystem walk: the
 * concern is what is PUBLISHED, so an untracked scratch file or a gitignored
 * `.env` holding a real value is correct, not a violation. */
function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean)
}

function main() {
  const files = trackedFiles()
  const violations = []
  let scanned = 0
  for (const file of files) {
    if (EXEMPT_PATH.some(({ re }) => re.test(file))) continue
    let text
    try {
      text = readFileSync(join(REPO_ROOT, file), 'utf8')
    } catch {
      continue // unreadable or binary — no string literal to leak
    }
    if (text.includes('\0')) continue
    scanned += 1
    for (const entry of scanText(text)) {
      violations.push({ file, entry })
    }
  }

  if (!violations.length) {
    console.log(
      `check-personal-identifiers: OK — no personal identifier in ${scanned} tracked files.`,
    )
    return 0
  }

  console.error('check-personal-identifiers: PERSONAL IDENTIFIER IN TRACKED SOURCE\n')
  for (const { file, entry } of violations) {
    console.error(`  ${file}\n    ${entry.label}\n    → ${entry.fix}\n`)
  }
  console.error(
    [
      'This repository is PUBLIC, and a commit is permanent: git history does',
      'not forget, so a reintroduction cannot be taken back by a later edit.',
      '',
      'These comments and fixtures are load-bearing — they explain real bugs.',
      'Do NOT delete the explanation to remove the name. Name the PROPERTY that',
      'mattered instead; it is what the sentence meant, and it reads better.',
      '',
    ].join('\n'),
  )
  return 1
}

if (process.argv.includes('--selftest')) {
  // Drives the comparator end to end against a value this file may safely
  // contain, proving shape-match → digest → report without the real inputs.
  const CANARY = 'canary@selftest.example'
  const synthetic = [{ label: 'a synthetic canary', sha256: digest(CANARY), fix: 'n/a' }]

  const hit = scanText(`const owner = '${CANARY}'\n`, synthetic)
  if (hit.length !== 1 || hit[0].label !== 'a synthetic canary') {
    console.error('selftest: FAILED — the guard did NOT flag a reintroduction')
    process.exit(1)
  }
  if (scanText("const owner = 'someone@example.com'\n", synthetic).length !== 0) {
    console.error('selftest: FAILED — the guard flagged an unrelated address')
    process.exit(1)
  }
  // Case folding is part of the contract for the address shape.
  if (scanText(CANARY.toUpperCase(), synthetic).length !== 1) {
    console.error('selftest: FAILED — an uppercased address slipped past')
    process.exit(1)
  }
  // Anti-vacuity: the uid and path shapes must really match something, or a
  // regex that silently stopped matching would make this guard pass forever.
  const uid = [{ label: 'uid', sha256: digest('AbcdefghijklmnopqrstuvwxyZ12'), fix: 'n/a' }]
  if (scanText("uid: 'AbcdefghijklmnopqrstuvwxyZ12'", uid).length !== 1) {
    console.error('selftest: FAILED — the uid shape matches nothing')
    process.exit(1)
  }
  const home = [{ label: 'home', sha256: digest('/Users/someone'), fix: 'n/a' }]
  if (scanText("const p = '/Users/someone/Library'", home).length !== 1) {
    console.error('selftest: FAILED — the home-path shape matches nothing')
    process.exit(1)
  }
  console.log(
    'selftest: OK — flags a synthetic reintroduction in all three shapes, ignores an unrelated address.',
  )
  process.exit(0)
}

process.exit(main())
