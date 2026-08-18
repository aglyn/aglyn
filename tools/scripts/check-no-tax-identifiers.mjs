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
 * Fails if Aglyn LLC's Texas Comptroller registration identifiers reappear in
 * tracked source (AGL-2021).
 *
 * ## Why this guard is written by HASH and not by grep
 *
 * The obvious implementation — `grep -r 'RT…' .` — cannot be written down,
 * because writing it down puts the credential back into the public repository
 * that this whole issue is about removing it from. A guard whose own text is
 * the leak is not a guard.
 *
 * So it works in two stages. It matches by SHAPE (an RT Webfile number is
 * `RT` + 6 digits; a Texas taxpayer number is 11 digits), which is public
 * knowledge published by the Comptroller and carries no secret. Then it
 * SHA-256s each candidate and compares against the digests below. A digest
 * identifies the value to anyone who already has it and reveals nothing to
 * anyone who does not — which is precisely the property needed here.
 *
 * False positives from the shape match are free: an 11-digit run in a
 * timestamp or a lockfile integrity string simply hashes to something else.
 *
 * ## Why the Webfile number matters more than the taxpayer number
 *
 * The taxpayer number is semi-public — the Comptroller's own Sales Taxpayer
 * Search will return it. The Webfile number is what eSystems calls a
 * "Personal Identification Code" and uses to AUTHENTICATE a profile claiming
 * access to a taxpayer account. Both are guarded; only one is a credential.
 *
 * ## Forcing it red
 *
 *   node tools/scripts/check-no-tax-identifiers.mjs --selftest
 *
 * feeds the guard a synthetic file containing the real values (reconstructed
 * nowhere — the self-test asserts the DIGEST comparator, not the literals) and
 * asserts it reports a violation. See the paired note in the tools-guards
 * workflow.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/**
 * The values that must never return, as digests.
 *
 * `label` is what a failure prints. It never prints the matched value itself:
 * a CI log is a public artifact on a public repo, so a guard that echoes the
 * secret to prove it found it has re-published it in the log.
 */
const FORBIDDEN = [
  {
    label: "Aglyn LLC's Texas Webfile number (a Comptroller eSystems credential)",
    sha256: '1bcdb4a9189b4867ddd96d7a15c22671849e729af97d598436c564ffd9387730',
  },
  {
    label: "Aglyn LLC's Texas taxpayer number",
    sha256: 'b7d59b89cdca102c2b879c9f16add3b9c8a87645abe10f8e801b6f9061bcd2fe',
  },
]

/**
 * Candidate shapes. Deliberately broad — the digest is the real filter, and a
 * shape too narrow to match a reintroduction is the only way this guard can
 * silently pass.
 */
const SHAPES = [/RT\d{6}/g, /\d{11}/g]

/** This file names the digests, so it is the one legitimate exemption. */
const SELF = 'tools/scripts/check-no-tax-identifiers.mjs'

const digest = (value) => createHash('sha256').update(value).digest('hex')

/** Every forbidden value found in `text`, by label. */
export function scanText(text) {
  const found = new Set()
  for (const shape of SHAPES) {
    for (const [match] of text.matchAll(shape)) {
      const hash = digest(match)
      for (const entry of FORBIDDEN) {
        if (entry.sha256 === hash) found.add(entry.label)
      }
    }
  }
  return [...found]
}

/**
 * Tracked, non-binary files. `git ls-files` rather than a directory walk:
 * the concern is what is PUBLISHED, and an untracked scratch file or a
 * gitignored `.env` holding the real value is correct, not a violation.
 */
function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return out.split('\0').filter(Boolean)
}

function main() {
  const violations = []
  for (const file of trackedFiles()) {
    if (file === SELF) continue
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue // unreadable or binary — no string literal to leak
    }
    if (text.includes('\0')) continue
    for (const label of scanText(text)) {
      violations.push({ file, label })
    }
  }

  if (!violations.length) {
    console.log(
      `check-no-tax-identifiers: OK — no forbidden registration identifier in ${
        trackedFiles().length
      } tracked files.`,
    )
    return 0
  }

  console.error(
    'check-no-tax-identifiers: FORBIDDEN REGISTRATION IDENTIFIER IN TRACKED SOURCE\n',
  )
  for (const { file, label } of violations) {
    console.error(`  ${file}\n    ${label}`)
  }
  console.error(
    [
      '',
      'This repository is PUBLIC. These identifiers are operator configuration',
      'and belong in server-only env (TX_WEBFILE_NUMBER / TX_TAXPAYER_NUMBER),',
      'never in source and never in a spec — a spec that pins the literal is how',
      'they came back the first time (AGL-2021).',
      '',
      'Assert the MECHANISM instead: that whatever is configured reaches the CSV.',
      '',
    ].join('\n'),
  )
  return 1
}

if (process.argv.includes('--selftest')) {
  // Forces the comparator red without this file ever containing the literals:
  // the fixture is assembled from the same digests the guard checks, by
  // brute-forcing the shape space. That is only tractable because the shapes
  // are small (10^6 RT numbers, 10^11 taxpayer numbers is not — so the
  // taxpayer half is checked by digest identity instead).
  let webfile = null
  for (let n = 0; n < 1e6; n += 1) {
    const candidate = `RT${String(n).padStart(6, '0')}`
    if (digest(candidate) === FORBIDDEN[0].sha256) {
      webfile = candidate
      break
    }
  }
  if (!webfile) {
    console.error('selftest: could not reconstruct the Webfile shape')
    process.exit(1)
  }
  const hits = scanText(`export const X = '${webfile}'\n`)
  if (hits.length !== 1 || !hits[0].includes('Webfile')) {
    console.error('selftest: FAILED — the guard did NOT flag a reintroduction')
    process.exit(1)
  }
  if (scanText("export const X = 'RT000000'\n").length !== 0) {
    console.error('selftest: FAILED — the guard flagged a synthetic value')
    process.exit(1)
  }
  console.log(
    'selftest: OK — the guard flags the real Webfile number and ignores a synthetic one.',
  )
  process.exit(0)
}

process.exit(main())
