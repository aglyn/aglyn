/**
 * @license
 * Copyright 2026 Aglyn LLC
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *   http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Refuse a publishable package npm has never been told to trust (AGL-3201).
//
//   npm run check:package-trust
//   npm run check:package-trust -- --prune   # drop rows for packages that went
//   node tools/scripts/check-package-trust.mjs --fixture   # forced-red self-test
//
// ---------------------------------------------------------------------------
// WHAT THIS COSTS WHEN IT IS MISSING
// ---------------------------------------------------------------------------
// A new lib is a new npm package, and trusted publishing is configured PER
// PACKAGE — there is no scope-level setting. Until somebody runs
// `npm run trust:packages -- --set`, the release workflow's OIDC token cannot
// create that name and npm answers `E404 Not Found - PUT`.
//
// On 2026-09-23 that happened to `@aglyn/shared-util-first-touch`, a new lib
// from AGL-3289's sign-up attribution work. It cost FOUR production releases
// (beta.178, .179, .180, .181) and left ten unrelated packages three releases
// behind on the registry, because the publish loop sorted alphabetically and
// abandoned everything after the name that failed. Nothing about those ten
// was wrong, and nothing in the repo had said a word about it: the lib merged
// green, and the first sign was a red publish job on a production merge.
//
// The publish loop no longer abandons the tail. This is the other half — the
// PR that adds the lib goes red, days before a release is on the line.
//
// ---------------------------------------------------------------------------
// ⛔ A TRUST ROW CANNOT PRECEDE THE PACKAGE, so the remedy is TWO steps
// ---------------------------------------------------------------------------
// Measured 2026-09-24, and it settles the question this guard was written
// without an answer to: `npm trust github <name> …` is REFUSED `E404` for a
// name the registry does not hold. npm will not configure trusted publishing
// for a package that does not exist, even though the permission it grants is
// called `createPackage` — that permission lets the workflow publish a NEW
// VERSION of a package whose row already exists, not bring the name into
// being.
//
// So a brand-new lib needs its first publish by hand, from the owner's
// terminal, before any of this can be configured:
//
//   npm run publish:packages -- --only <name> --publish
//   npm run trust:packages -- --set
//
// ⚑ That first version goes out WITHOUT provenance — `publish-packages.mjs`
// passes `--provenance=false` outside GitHub Actions, because provenance is
// signed by the CI run's identity and there is none on a laptop. Every
// version after it is signed normally. A package whose `.0` is unattested
// while the rest are is expected, not a defect.
//
// ---------------------------------------------------------------------------
// WHY THIS DOES NOT ASK NPM
// ---------------------------------------------------------------------------
// ⛔ `npm trust list` IS NOT PUBLIC. It answers `EOTP` to anyone not signed in
// with the account's second factor, even for a public package, so a guard
// that asked the registry would be red on every machine but the owner's and
// in CI always. It would also put the account's security state behind a
// network call in the guard sweep.
//
// So the record is a FILE, written by the real sweep: `trust-packages.mjs`
// stamps `trusted-packages.json` with every package npm confirmed, in both
// its read and `--set` modes. This guard compares that record against the
// packages the repo actually publishes. The file is therefore evidence of a
// real `npm trust list` answer and not of anyone's intention — which is the
// whole difference between this and a hand-kept list.
//
// ⚑ It proves a row EXISTED when the sweep ran, not that it exists now. That
// is exactly the failure being prevented: a package nobody has ever
// configured. A row revoked at npm afterwards is a different problem, and the
// release job's own failure is what catches that one.
//
// Exit codes: 0 every publishable package has a record · 1 one does not (or a
// stale row) · 2 the self-test failed.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publishableEntries } from './trust-packages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const RECORD = join(ROOT, 'tools/scripts/trusted-packages.json')

/** The record as `{ [packageName]: { confirmedAt } }`, or `{}`. */
export function readRecord(path = RECORD) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed?.packages && typeof parsed.packages === 'object'
      ? parsed.packages
      : {}
  } catch {
    // A missing or unreadable record is not an empty one: every package would
    // read as unconfigured and the message would tell somebody to reconfigure
    // fifty-two that are already correct. Refusing says so instead.
    return null
  }
}

/**
 * What the record and the repo disagree about.
 *
 * `missing` is the defect this exists for. `stale` is the ratchet's other
 * half — a row for a package the repo no longer publishes is a record of
 * something that cannot be checked any more, and a list that may only shrink
 * cannot be allowed to outlive what it describes.
 */
export function judge(packages, record) {
  const names = new Set(packages.map((entry) => entry.name))
  return {
    missing: packages
      .map((entry) => entry.name)
      .filter((name) => !record[name])
      .sort(),
    stale: Object.keys(record)
      .filter((name) => !names.has(name))
      .sort(),
  }
}

/** The forced red: a package the record does not name must be refused. */
function selfTest() {
  const verdict = judge(
    [{ name: '@aglyn/known' }, { name: '@aglyn/brand-new' }],
    { '@aglyn/known': { confirmedAt: '2026-01-01' }, '@aglyn/gone': {} },
  )
  const ok =
    verdict.missing.length === 1 &&
    verdict.missing[0] === '@aglyn/brand-new' &&
    verdict.stale.length === 1 &&
    verdict.stale[0] === '@aglyn/gone'
  console.log(
    ok
      ? 'check:package-trust: self-test passed'
      : `check:package-trust: SELF-TEST FAILED — ${JSON.stringify(verdict)}`,
  )
  return ok ? 0 : 2
}

function main(argv) {
  if (argv.includes('--fixture')) return selfTest()
  const prune = argv.includes('--prune')

  const record = readRecord()
  if (record === null) {
    console.error('check:package-trust: could not read tools/scripts/trusted-packages.json.')
    console.error('  The owner rebuilds it by running the real sweep:')
    console.error('')
    console.error('    npm run trust:packages')
    return 1
  }

  const packages = publishableEntries(ROOT)
  if (!packages.length) {
    // Deriving zero packages is a failure, not a clean run — the same refusal
    // `run-guards` makes about deriving zero guards.
    console.error('check:package-trust: found NO publishable packages, which cannot be right.')
    return 1
  }

  const { missing, stale } = judge(packages, record)

  if (stale.length && prune) {
    const parsed = JSON.parse(readFileSync(RECORD, 'utf8'))
    for (const name of stale) delete parsed.packages[name]
    writeFileSync(RECORD, `${JSON.stringify(parsed, null, 2)}\n`)
    console.log(`check:package-trust: pruned ${stale.length} row(s) for packages that no longer exist`)
    return main(argv.filter((arg) => arg !== '--prune'))
  }

  for (const name of stale) {
    console.error(`  STALE ROW ${name}: the repo no longer publishes it; run with --prune`)
  }
  for (const name of missing) {
    console.error(`  NO TRUST RECORD ${name}`)
  }

  if (missing.length) {
    console.error('')
    console.error(`check:package-trust: ${missing.length} publishable package(s) have never been`)
    console.error('confirmed with npm. The release workflow cannot create a package it has')
    console.error('not been trusted for — it answers E404 on the publish, and that is a')
    console.error('production release failing rather than this check failing.')
    console.error('')
    console.error("The owner does this, in a terminal they are sitting at — npm")
    console.error("challenges every trust operation with the account's second factor in")
    console.error('a browser, and an interrupted handoff kills the command:')
    console.error('')
    console.error('  npm whoami                       # 401 means signed out, not 2FA')
    console.error('  npm login                        # if it did')
    console.error('')
    console.error('⛔ A package the registry has never held needs its FIRST publish by')
    console.error('  hand before it can be trusted at all — `npm trust` answers E404 for')
    console.error('  a name that does not exist (measured 2026-09-24). So, per package:')
    console.error('')
    for (const name of missing) {
      console.error(`  npm run publish:packages -- --only ${name} --publish`)
    }
    console.error('')
    console.error('  npm run trust:packages -- --set  # configures them, skips the rest')
    console.error('')
    console.error('It rewrites this record, so committing what it changes closes this.')
  }

  if (missing.length || stale.length) return 1
  console.log(
    `check:package-trust: ${packages.length} publishable package(s), all with a trust record.`,
  )
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (error) {
    console.error(`check:package-trust: FAILED — ${error.message}`)
    process.exit(1)
  }
}
