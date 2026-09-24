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

// Point every published package at this repo's publish workflow, so npm will
// take a release from it with no token at all (AGL-3201).
//
//   npm run trust:packages            # READ ONLY: what each package trusts today
//   npm run trust:packages -- --set   # configures the ones that are missing it
//
// ---------------------------------------------------------------------------
// WHY
// ---------------------------------------------------------------------------
// The registry currently takes a release because `publish-packages.yml` hands
// it a granular token with the 2FA bypass. npm is removing direct publishing
// with those in JANUARY 2027, and ours expires before that on 2026-12-19 —
// after which the promotion's publish job fails by design. Trusted publishing
// is the replacement npm names: the workflow proves who it is with a
// short-lived OIDC token GitHub mints for that one run, and there is no
// long-lived secret to expire, leak or rotate.
//
// It also gets provenance for free. Under trusted publishing npm generates the
// attestation itself, which is the thing that lets anyone check that a version
// on the registry was built from the commit it claims.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A SCRIPT AND NOT A README STEP
// ---------------------------------------------------------------------------
// Trust is configured PER PACKAGE — there is no scope-level setting — and
// there are 51 of them. Fifty-one web forms, six fields each, is a job nobody
// finishes accurately; one of them quietly wrong is a release that publishes
// 50 packages and fails on the 51st, which is the shape this whole script
// exists to avoid (a published version cannot be replaced).
//
// ---------------------------------------------------------------------------
// WHAT IT CANNOT DO
// ---------------------------------------------------------------------------
// ⛔ NEITHER MODE RUNS WITHOUT THE OWNER'S LOGIN, and `--set` is theirs
// outright. `npm trust list` is not public: it answers `EOTP` to anyone who is
// not signed in with the account's second factor, even for a public package.
// And adding a trusted publisher is a change to the npm account's own security
// settings, which an agent may not make at all. So this runs in the OWNER'S
// terminal, under the owner's login, and never sees or handles a credential —
// `npm trust` does its own auth, in their browser.
//
// A signed-out run says so rather than reporting all 51 as missing, which
// would read as "nothing is configured" when the truth is "nobody asked".
//
// Exit codes: 0 every package trusts this workflow · 1 at least one does not
// (or a `--set` failed), which is also what makes this usable as a check.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPackageMap } from './lib/lib-boundaries.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * The workflow npm is asked to trust. `npm trust` wants the FILE NAME, not a
 * path: the repository is named separately and the file is looked for under
 * `.github/workflows/`.
 */
export const WORKFLOW_FILE = 'publish-packages.yml'

/** The repository whose runs may publish, in npm's `owner/repo` form. */
export const REPOSITORY = 'aglyn/aglyn'

/**
 * The npm that understands `npm trust`. Older ones do not have the command at
 * all, so a run under one fails with "Unknown command" — which reads like a
 * typo rather than like a version to upgrade.
 */
export const MIN_NPM = '11.15.0'

/** `a.b.c` compared as numbers, so `11.9.0` is not "above" `11.15.0`. */
export function atLeast(version, minimum) {
  const parse = (value) => String(value).trim().split('.').map((part) => Number.parseInt(part, 10) || 0)
  const [a, b, c] = parse(version)
  const [x, y, z] = parse(minimum)
  return a !== x ? a > x : b !== y ? b > y : c >= z
}

/** Every package `publish-packages.mjs` would publish, by npm name. */
export function publishablePackages(root = ROOT) {
  return publishableEntries(root).map((entry) => entry.name)
}

/**
 * The same set with the version each package carries.
 *
 * The version matters to a caller deciding whether a package is EXPECTED to
 * be on the registry at a given number: every lib moves together on the repo
 * version, and `@aglyn/cli` keeps its own. Told apart, "this package has no
 * such version" is a fact about the cli and a FAILURE about anything else.
 */
export function publishableEntries(root = ROOT) {
  return readPackageMap(root)
    .filter((project) => project.projectType === 'library' && project.alias)
    .filter((project) => existsSync(join(root, project.root, 'package.json')))
    .map((project) => JSON.parse(readFileSync(join(root, project.root, 'package.json'), 'utf8')))
    .filter((pkg) => pkg.private !== true && typeof pkg.name === 'string')
    .map((pkg) => ({ name: pkg.name, version: pkg.version }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The npm permission that allows a plain `npm publish`.
 *
 * ⚑ NOT the same as being configured. A configuration created after
 * 2026-09-03 permits `createStagedPackage` and nothing else unless publishing
 * was asked for explicitly, and `publish-packages.mjs` runs a plain
 * `npm publish` — so a stage-only row is a package that looks configured on
 * every listing and refuses the release.
 */
export const PUBLISH_PERMISSION = 'createPackage'

/**
 * Does `listing` name this repo's workflow AND let it publish?
 *
 * Matched on the three things that decide whether a release goes out — the
 * repository, the workflow file and the publish permission — and deliberately
 * not on the whole row: npm prints the configuration back with an id and a
 * created date that are not ours to predict, and a match on the printed text
 * as a whole would go stale on the first formatting change npm makes.
 *
 * The permission is checked because the first version of this did not, and a
 * stage-only configuration would have read as `ok` here right up until the
 * promotion that failed on it — after which nothing could be republished at
 * that version.
 */
export function trustsThisWorkflow(listing) {
  const text = String(listing ?? '')
  return (
    text.includes(REPOSITORY) &&
    text.includes(WORKFLOW_FILE) &&
    text.includes(PUBLISH_PERMISSION)
  )
}

function npmVersion() {
  return execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim()
}

/**
 * What `name` trusts today, as text — or an `auth` verdict when the registry
 * would not answer.
 *
 * ⛔ SIGNED OUT AND SECOND-FACTOR-NEEDED ARE DIFFERENT PROBLEMS WITH
 * DIFFERENT FIXES, and this told them apart only after conflating them cost
 * a session (2026-09-23). A lapsed `_authToken` in `~/.npmrc` answers `E401
 * "You must be logged in to publish packages"`, and the run reported that as
 * "npm wanted this account's second factor and did not get it" — so the
 * advice was to approve a browser prompt that never appears, for an account
 * that is not signed in. `npm login` is the fix there and no amount of
 * approving reaches it. Same shape as AGL-1094: a diagnosis that names the
 * wrong subsystem sends the person at the wrong subsystem.
 *
 * `--json`, so a match is made against npm's own field values rather than
 * against a table it renders for a person and may reformat. The error shape
 * is JSON too, which is what makes "not signed in" tellable from "configured
 * nothing" — and those two must never be confused: the second would send
 * somebody to reconfigure 51 packages that are already correct.
 */
export function readTrust(name, run = npmTrustList) {
  const raw = run(name)
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Not JSON at all: an npm too old for `--json` here, or a crash. Treat
    // the text as the listing; `trustsThisWorkflow` refuses anything that
    // does not name both claims.
    return { listing: raw }
  }
  const code = parsed?.error?.code
  // EOTP is npm saying "I know who you are, prove it again". ENEEDAUTH and
  // E401 are npm saying "I do not know who you are" — a credential that has
  // lapsed, been revoked, or was never there.
  if (code === 'EOTP') return { auth: 'second-factor', listing: '' }
  if (code === 'ENEEDAUTH' || code === 'E401') {
    return { auth: 'signed-out', listing: '' }
  }
  if (parsed?.error) return { listing: '', error: parsed.error.summary ?? code ?? 'unknown' }
  return { listing: JSON.stringify(parsed) }
}

function npmTrustList(name) {
  try {
    return execFileSync('npm', ['trust', 'list', name, '--json'], {
      encoding: 'utf8',
      /*
       * ⚑ STDIN AND STDERR STAY ON THE TERMINAL. npm answers a trust
       * operation with a browser handshake — it prints a URL, waits for the
       * approval, and only then does the work. With stdin closed it cannot
       * wait, so it fails `EOTP` instead of asking, and the run reads as
       * "not signed in" to somebody who signed in a minute ago. Only stdout
       * is captured, because that is where `--json` puts the answer.
       */
      stdio: ['inherit', 'pipe', 'inherit'],
    })
  } catch (error) {
    // npm exits non-zero AND prints the JSON error body on stdout.
    return `${error.stdout ?? ''}`.trim() || `${error.stderr ?? ''}`.trim() || '{}'
  }
}

/**
 * One fully-interactive trust read, so npm's browser handshake happens where
 * the person can see it.
 *
 * ⚑ ON DEMAND, never up front. The elevated token npm issues for a trust
 * operation lapses quickly, so whether one is needed is not knowable before
 * asking — and asking anyway would put a browser approval in front of a run
 * that did not need one.
 *
 * The ordinary reads capture stdout to parse `--json`, and a prompt npm chose
 * to write there would vanish into that pipe, leaving somebody staring at a
 * hung command with no URL. This one inherits all three streams: whatever npm
 * prints, they see, and whatever it asks, they can answer. Its OUTPUT is
 * thrown away — the caller reads the same package again from the token this
 * established.
 */
function warmUpTrustAuth(name) {
  console.log('')
  console.log("trust:packages: npm wants this account's second factor. Approve once in")
  console.log('the browser it opens — the rest of the run should then go through.')
  console.log('')
  try {
    execFileSync('npm', ['trust', 'list', name], { cwd: ROOT, stdio: 'inherit' })
    return true
  } catch {
    // Not fatal on its own: the caller reads again and reports properly.
    return false
  }
}

/**
 * The record `check:package-trust` reads, stamped from THIS run's answers.
 *
 * Written because the guard cannot ask npm itself: `npm trust list` is not
 * public, so a check that called it would be red on every machine but the
 * owner's. The file is the evidence that a real sweep saw a real answer, and
 * the guard compares it against the packages the repo publishes — which is
 * how a new lib with no trust row reds its own PR instead of a release
 * (AGL-3201, after the 2026-09-23 break).
 *
 * ⛔ MERGED, NEVER REPLACED. A run that stopped part way through — a lapsed
 * token, a person closing the browser — has confirmed a prefix of the list
 * and knows nothing about the rest. Writing only what it saw would drop every
 * package after the stop and red the guard on packages that are perfectly
 * configured. Rows leave by `check:package-trust --prune`, which is driven by
 * the repo's own package list and not by how far a sweep got.
 */
function writeRecord(confirmed) {
  if (!confirmed.length) return
  const path = join(ROOT, 'tools/scripts/trusted-packages.json')
  let held = { packages: {} }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed?.packages) held = parsed
  } catch {
    // No record yet, or one nobody can read: this run rebuilds what it saw.
  }
  const confirmedAt = new Date().toISOString().slice(0, 10)
  for (const name of confirmed) held.packages[name] = { confirmedAt }
  held.note =
    'Packages npm has confirmed trust a release from this repo\'s ' +
    'publish-packages.yml. Written by `npm run trust:packages` (either mode) ' +
    'from npm\'s own answers, and read by `check:package-trust`, which cannot ' +
    'ask npm itself because `npm trust list` is not public. A row records ' +
    'that a sweep saw a configuration, not that one exists this minute.'
  held.packages = Object.fromEntries(
    Object.entries(held.packages).sort(([a], [b]) => a.localeCompare(b)),
  )
  writeFileSync(path, `${JSON.stringify(held, null, 2)}\n`)
  console.log(
    `trust:packages: recorded ${confirmed.length} confirmed package(s) in ` +
      'tools/scripts/trusted-packages.json — commit it.',
  )
}

function main(argv) {
  const set = argv.includes('--set')
  const version = npmVersion()
  if (!atLeast(version, MIN_NPM)) {
    console.error(`trust:packages: npm ${version} has no \`npm trust\`; ${MIN_NPM} or later does.`)
    console.error('  npm install -g npm@latest    # or run this script under `npx npm@latest`')
    return 1
  }

  const names = publishablePackages()
  console.log(`trust:packages: ${names.length} package(s); ${REPOSITORY} → .github/workflows/${WORKFLOW_FILE}`)
  /*
   * One approval, offered once. `warmedUp` makes the interactive call happen
   * at most once per run: if the token it establishes lapses part way through
   * 51 packages, the run stops and says how far it got rather than asking for
   * a fiftieth approval nobody expected.
   */
  let warmedUp = false

  /*
   * ONE PASS, reading and configuring each package in turn (AGL-3201).
   *
   * ⚑ npm challenges EVERY trust operation with the account's second factor,
   * `trust list` included. Reading all 51 first and then writing would ask
   * for up to 51 approvals before a single package was configured, and the
   * person approving would have nothing to show for any of them. Interleaved,
   * the first package proves whether one approval carries the rest — and if
   * it does not, that is known at package one rather than at fifty-one.
   *
   * BOTH permissions on the write, deliberately. A configuration created
   * after 2026-09-03 allows `npm stage publish` and nothing else unless
   * publishing is asked for explicitly, and `publish-packages.mjs` runs a
   * plain `npm publish` — so without `--allow-publish` every one of these
   * would be configured, look configured, and refuse the release.
   * `--allow-stage-publish` goes with it because staged publishing is the
   * path npm is moving everyone to, and permitting it costs nothing today.
   */
  const missing = []
  const confirmed = []
  let configured = 0
  let failed = 0
  for (const name of names) {
    let answer = readTrust(name)
    // The warm-up is only for a second factor. A signed-out account has
    // nothing to approve, so offering it a browser handshake wastes a round
    // trip and then reports the wrong problem.
    if (answer.auth === 'second-factor' && !warmedUp) {
      warmedUp = true
      warmUpTrustAuth(name)
      answer = readTrust(name)
    }
    if (answer.auth === 'signed-out') {
      console.error('')
      console.error('trust:packages: npm does not know who you are.')
      console.error(`\`npm trust list ${name}\` came back 401 — a credential that has`)
      console.error('lapsed or been revoked, not a second factor waiting to be approved.')
      console.error('')
      console.error('Sign in first, then run this again:')
      console.error('')
      console.error('  npm login')
      console.error(`  npm run trust:packages${set ? ' -- --set' : ''}`)
      console.error('')
      console.error('⚑ A stale `//registry.npmjs.org/:_authToken=` in ~/.npmrc answers 401')
      console.error('  exactly like having none at all, so "I am logged in" is worth')
      console.error('  checking with `npm whoami` rather than believing.')
      console.error('')
      console.error(`${configured} package(s) were configured before this; re-running skips them.`)
      return 1
    }
    if (answer.auth === 'second-factor') {
      console.error('')
      console.error("trust:packages: npm wanted this account's second factor for")
      console.error(`\`npm trust list ${name}\` and did not get it.`)
      console.error('')
      console.error('Being logged in is NOT enough — npm challenges every trust operation')
      console.error('on its own, and `npm trust list` is not public even for a public')
      console.error('package. If no browser opened just now, run this once by hand and')
      console.error('approve it, then run this script again:')
      console.error('')
      console.error(`  npm trust list ${name}`)
      console.error(`  npm run trust:packages${set ? ' -- --set' : ''}`)
      console.error('')
      console.error(`${configured} package(s) were configured before this; re-running skips them.`)
      return 1
    }
    if (trustsThisWorkflow(answer.listing)) {
      console.log(`  ok      ${name}`)
      confirmed.push(name)
      continue
    }
    missing.push(name)
    if (!set) {
      console.log(`  MISSING ${name}${answer.error ? ` (${answer.error})` : ''}`)
      continue
    }
    console.log(`  set     ${name}`)
    try {
      execFileSync(
        'npm',
        ['trust', 'github', name, '--repo', REPOSITORY, '--file', WORKFLOW_FILE, '--allow-publish', '--allow-stage-publish', '--yes'],
        // Keeps the terminal: npm challenges this with the account's second
        // factor and cannot ask for it with no stdin.
        { cwd: ROOT, stdio: 'inherit' },
      )
      configured += 1
      confirmed.push(name)
    } catch (error) {
      failed += 1
      console.error(`    FAILED ${name} — ${error.message}`)
      /*
       * ⛔ A TRUST ROW CANNOT PRECEDE THE PACKAGE (measured 2026-09-24).
       *
       * npm refuses `npm trust github` with `E404` for a name the registry
       * does not hold, and says only "Not Found" — which reads like the
       * COMMAND is wrong rather than like the package is missing. The
       * permission being granted is called `createPackage`, which actively
       * suggests the opposite: it lets the workflow publish a new VERSION of
       * a package whose row exists, it does not bring the name into being.
       *
       * So the remedy is a manual first publish, and it is named here rather
       * than left to be worked out. This is the message somebody reads at the
       * exact moment they are stuck on it.
       */
      if (/\bE404\b|Not Found/i.test(error.message ?? '')) {
        console.error('')
        console.error(`    ${name} is not on the registry, and npm will not trust a name`)
        console.error('    that does not exist. Publish it once by hand first, then re-run:')
        console.error('')
        console.error(`      npm run publish:packages -- --only ${name} --publish`)
        console.error(`      npm run trust:packages -- --set`)
        console.error('')
        console.error('    That first version has no provenance — it is signed by a CI run')
        console.error('    identity and there is none on a laptop. Every later one does.')
        console.error('')
      }
    }
  }

  writeRecord(confirmed)

  if (!missing.length) {
    console.log('trust:packages: every package trusts this workflow.')
    return 0
  }

  if (!set) {
    console.log('')
    console.log(`${missing.length} package(s) do not trust this workflow yet. The owner configures them:`)
    console.log('')
    console.log('  npm run trust:packages -- --set')
    console.log('')
    console.log("It needs an npm login with the account's second factor to hand, and it")
    console.log("is the owner's to run — an agent may not touch an account's security settings.")
    return 1
  }

  if (failed) {
    console.error(`trust:packages: ${failed} of ${missing.length} could not be configured. Re-run — the ones that worked are skipped.`)
    return 1
  }
  console.log(`trust:packages: configured ${missing.length} package(s).`)
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (error) {
    console.error(`trust:packages: FAILED — ${error.message}`)
    process.exit(1)
  }
}
