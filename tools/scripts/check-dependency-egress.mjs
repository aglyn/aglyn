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
 * AGL-1692 — re-run the subprocessor sweep from the DEPENDENCY CLOSURE, and
 * fail when something egresses that no decision covers.
 *
 * `/legal/subprocessors` is SCC Annex III by incorporation. The sentence "No
 * other vendor that touches customer data was found" was produced by grepping
 * OUR SOURCE, and `gravatar` (AGL-1683) — which shipped an MD5 of every
 * console member's email to Automattic — is invisible to that method by
 * construction. The 2026-08-14 re-sweep walked the closure by hand and was
 * never repeatable. This is the repeatable form.
 *
 * ```
 * npm run check:dependency-egress            # the gate
 * npm run check:dependency-egress -- --list  # every finding, with evidence
 * npm run check:dependency-egress -- --json
 * npm run check:dependency-egress -- --write # re-baseline AFTER deciding
 * ```
 *
 * `--write` records what is currently found as `undecided` in the register
 * file, with a null decision. It never invents a decision — a human writes
 * the `decision` and `note` for each row, and the gate keeps failing until
 * they do. That is the difference between a ratchet and a rubber stamp.
 *
 * The detector, the two classes it distinguishes, and — importantly — the
 * five things it still cannot see live in `lib/dependency-egress.mjs`. Read
 * the coverage limits before treating a clean run as a negative result.
 *
 * Exit codes: 0 clean · 1 an undecided egress, or a stale register row.
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  classifyPackageEgress,
  compareToRegister,
} from './lib/dependency-egress.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const REGISTER_PATH = join(
  REPO_ROOT,
  'tools',
  'scripts',
  'dependency-egress-register.json',
)

/** A vendor file bigger than this is a bundle; reading it whole is fine but
 * the cap keeps one pathological package from dominating the run. */
const MAX_FILE_BYTES = 4 * 1024 * 1024

const args = new Set(process.argv.slice(2))
const wantList = args.has('--list')
const wantJson = args.has('--json')
const wantWrite = args.has('--write')

/**
 * The PRODUCTION closure, not the manifest. A direct dependency list would
 * have missed `undici` entirely — it arrived transitively long before
 * AGL-2480 made it direct, and it was already on a production network path.
 */
function productionClosure() {
  // `npm ls` exits non-zero on ELSPROBLEMS — an unmet optional peer is enough,
  // and this tree currently has one. The tree it PRINTS is still complete and
  // is what the sweep needs, so the listing is read from stdout either way.
  // Throwing here would turn a peer-range warning into "the privacy sweep
  // cannot run", which is the wrong failure to inherit.
  // No initialiser: BOTH paths below assign before anything reads `out`, so
  // a `''` seed here is a dead store (`no-useless-assignment`, AGL-1692).
  let out
  try {
    out = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    })
  } catch (error) {
    out = String(error?.stdout ?? '')
    if (!out.trim()) throw error
  }
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line.includes(`${sep}node_modules${sep}`))
}

function packageNameFor(dir) {
  const marker = `${sep}node_modules${sep}`
  return dir.slice(dir.lastIndexOf(marker) + marker.length).split(sep).join('/')
}

function* walk(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    // Never descend into a nested node_modules: that package is its own row
    // in the closure and gets classified on its own.
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else if (entry.isFile()) {
      yield full
    }
  }
}

function readPackage(dir) {
  const files = []
  for (const full of walk(dir)) {
    // No initialiser: the catch `continue`s, so a seed value is never read.
    let size
    try {
      size = statSync(full).size
    } catch {
      continue
    }
    if (size > MAX_FILE_BYTES) continue
    // Same shape as `size` above — the catch `continue`s.
    let source
    try {
      source = readFileSync(full, 'utf8')
    } catch {
      continue
    }
    files.push({ path: relative(dir, full).split(sep).join('/'), source })
  }
  return { name: packageNameFor(dir), files }
}

function loadRegister() {
  try {
    return JSON.parse(readFileSync(REGISTER_PATH, 'utf8'))
  } catch {
    return {}
  }
}

const register = loadRegister()
const dirs = productionClosure()
const findings = []
for (const dir of dirs) {
  const found = classifyPackageEgress(readPackage(dir))
  if (found.class !== 'inert') findings.push(found)
}
findings.sort((a, b) => String(a.name).localeCompare(String(b.name)))

const result = compareToRegister(findings, register)

if (wantJson) {
  console.log(JSON.stringify({ findings, ...result }, null, 2))
} else if (wantList) {
  for (const finding of findings) {
    console.log(`\n${finding.name}  [${finding.class}]`)
    if (finding.hosts.length) console.log(`  hosts: ${finding.hosts.join(', ')}`)
    if (finding.primitives.length) {
      console.log(`  via:   ${finding.primitives.join(', ')}`)
    }
    for (const item of finding.evidence.slice(0, 4)) {
      const how = item.direct ? 'egress' : 'url-only'
      console.log(`    ${item.path}  (${how})`)
    }
  }
}

if (wantWrite) {
  const next = { ...register }
  for (const row of result.undecided) {
    next[row.key] = {
      decision: null,
      class: row.class,
      package: row.package,
      note: 'UNDECIDED — a human must record what this is and whether it is an Annex III recipient.',
    }
  }
  writeFileSync(
    REGISTER_PATH,
    `${JSON.stringify(
      Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b))),
      null,
      2,
    )}\n`,
  )
  console.log(
    `Wrote ${result.undecided.length} undecided row(s) to ${relative(REPO_ROOT, REGISTER_PATH)}.`,
  )
}

const nulls = Object.entries(register)
  .filter(([, row]) => !row?.decision)
  .map(([key]) => key)

console.log(
  `\nSwept ${dirs.length} production packages: ` +
    `${findings.filter((f) => f.class === 'vendor-host').length} vendor-host, ` +
    `${findings.filter((f) => f.class === 'caller-host').length} caller-host.`,
)

if (result.undecided.length) {
  console.error(`\nUNDECIDED egress (${result.undecided.length}):`)
  for (const row of result.undecided) {
    console.error(`  ${row.key}  [${row.class}]  via ${row.package}`)
  }
}
if (result.stale.length) {
  console.error(`\nSTALE register rows — no longer in the closure (${result.stale.length}):`)
  for (const key of result.stale) console.error(`  ${key}`)
}
if (nulls.length) {
  console.error(`\nRows awaiting a human decision (${nulls.length}):`)
  for (const key of nulls) console.error(`  ${key}`)
}

const failed = result.undecided.length > 0 || result.stale.length > 0 || nulls.length > 0
if (!wantWrite && failed) process.exit(1)
