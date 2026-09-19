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
// Refuses a Firestore document named by an id the platform did not mint,
// outside a reasoned allowlist that only shrinks (AGL-3079).
//
//   npm run check:id-minting
//   npm run check:id-minting -- --list   # every site with its row's class
//
// Every tracked source file is parsed (tools/scripts/lib/id-minting.mjs says
// what counts as a site and what does not) and each site is set against
// tools/scripts/id-minting-allowlist.json, where it is RESOURCE (a debt,
// under the area issue that fixes it), RECORD or DELIBERATE, with a reason.
//
// Red for: a site no row covers; a row that covers no site; a malformed row;
// and a list whose size differs from `ID_MINTING_CEILING`, which is pinned so
// the list can only shrink.
//
// EXIT CODES: 0 clean, 1 a finding.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ID_MINTING_CEILING,
  allowlistSize,
  ceilingProblems,
  compareToAllowlist,
  findIdMintingSites,
  isIdMintingSource,
  siteKey,
} from './lib/id-minting.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ALLOWLIST = 'tools/scripts/id-minting-allowlist.json'

/** Ask git, never the filesystem: a build's output must not change the answer. */
function trackedSource() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter((path) => path && !path.split('/').includes('node_modules') && isIdMintingSource(path))
}

const files = trackedSource()
const found = []
for (const path of files) {
  let text
  try {
    text = readFileSync(join(ROOT, path), 'utf8')
  } catch {
    // Deleted in the working tree: not source any more.
    continue
  }
  found.push(...findIdMintingSites(path, text))
}

const allowlist = JSON.parse(readFileSync(join(ROOT, ALLOWLIST), 'utf8'))
const { unlisted, stale, invalid } = compareToAllowlist(found, allowlist)
const size = allowlistSize(allowlist)
const ceiling = ceilingProblems(size)

if (process.argv.includes('--list')) {
  const rows = new Map((allowlist.sites ?? []).map((row) => [row.site, row]))
  for (const site of found) {
    const row = rows.get(siteKey(site))
    const label = row ? `${row.class}${row.issue ? ` ${row.issue}` : ''}` : 'UNLISTED'
    console.log(`${label.padEnd(19)} ${site.kind.padEnd(10)} ${site.path}:${site.line}  ${site.site}`)
  }
}

console.log(
  `\nId-minting sites (AGL-3079): ${found.length} in ${files.length} tracked source files; ` +
    `allowlist ${size.sites} sites (${size.toFix} RESOURCE to fix), ceiling ${ID_MINTING_CEILING.sites} ` +
    `(${ID_MINTING_CEILING.toFix}).`,
)

let failed = false
if (unlisted.length) {
  failed = true
  console.error('\nA DOCUMENT NAMED BY AN ID THE PLATFORM DID NOT MINT, with no row in the allowlist:')
  for (const { key, found: sites, allowed } of unlisted) {
    const where = sites.map((site) => `${site.path}:${site.line}`).join(', ')
    console.error(`  ${key}`)
    console.error(`      ${sites[0].kind}; found ${sites.length}, listed ${allowed}; at ${where}`)
    for (const site of sites) if (site.via) console.error(`      via ${site.via}`)
  }
  console.error(
    '\nName the document with createResourceUid(), the id every console resource carries. An id\n' +
      'that must mean something (a day, a hash, a pair of ids) belongs in a named key function,\n' +
      'which is not a site. A row that only moved (a renamed file, a changed call) takes the new\n' +
      `site in ${ALLOWLIST}; a NEW row is refused: the list may only shrink.`,
  )
}
if (stale.length) {
  failed = true
  console.error('\nA ROW THAT NO SITE MATCHES any more:')
  for (const { key, have, allowed } of stale) console.error(`  ${key}  (found ${have}, listed ${allowed})`)
  console.error(
    '\nA site that was fixed takes its row out (and lowers the ceiling, below); one that moved or\n' +
      "whose call text changed keeps its row under the new site. A row that covers nothing is one\nnobody has read since it was written.",
  )
}
if (invalid.length) {
  failed = true
  console.error('\nA MALFORMED ROW:')
  for (const { site, problems } of invalid) console.error(`  ${site}: ${problems.join('; ')}`)
}
if (ceiling.length) {
  failed = true
  console.error('\nTHE CEILING:')
  for (const problem of ceiling) console.error(`  ${problem}`)
}

if (failed) process.exit(1)
console.log('Every site is classified, every row matches a site, and the list is at its ceiling.')
