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
// ⛔ AN AGENT MUST NOT RUN `--set`. Adding a trusted publisher is a change to
// the npm account's own security settings and npm challenges it with the
// account's second factor. It runs in the OWNER'S terminal, under the owner's
// login, and this script never sees or handles a credential — `npm trust` does
// its own auth. The read-only default is the half an agent may run, and it
// needs no login at all for the packages that are public.
//
// Exit codes: 0 every package trusts this workflow · 1 at least one does not
// (or a `--set` failed), which is also what makes this usable as a check.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
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
  return readPackageMap(root)
    .filter((project) => project.projectType === 'library' && project.alias)
    .filter((project) => existsSync(join(root, project.root, 'package.json')))
    .map((project) => JSON.parse(readFileSync(join(root, project.root, 'package.json'), 'utf8')))
    .filter((pkg) => pkg.private !== true && typeof pkg.name === 'string')
    .map((pkg) => pkg.name)
    .sort()
}

/**
 * Does `listing` already name this repo's workflow?
 *
 * Matched on the two claims that decide who may publish — the repository and
 * the workflow file — and deliberately not on the whole row: npm prints the
 * configuration back with an id and a created date that are not ours to
 * predict, and a match on the printed text as a whole would go stale on the
 * first formatting change npm makes.
 */
export function trustsThisWorkflow(listing) {
  const text = String(listing ?? '')
  return text.includes(REPOSITORY) && text.includes(WORKFLOW_FILE)
}

function npmVersion() {
  return execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim()
}

function listTrust(name) {
  try {
    return execFileSync('npm', ['trust', 'list', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    return `ERROR ${`${error.stderr ?? ''}${error.stdout ?? ''}`.trim() || error.message}`
  }
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

  const missing = []
  for (const name of names) {
    const listing = listTrust(name)
    if (trustsThisWorkflow(listing)) {
      console.log(`  ok      ${name}`)
      continue
    }
    missing.push(name)
    console.log(`  MISSING ${name}`)
  }

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
    console.log('It needs an npm login with the account\'s second factor to hand, and it')
    console.log('is the owner\'s to run — an agent may not touch an account\'s security settings.')
    return 1
  }

  /*
   * BOTH permissions, deliberately. A configuration created after 2026-09-03
   * allows `npm stage publish` and nothing else unless publishing is asked for
   * explicitly, and `publish-packages.mjs` runs a plain `npm publish` — so
   * without `--allow-publish` every one of these would be configured, look
   * configured, and refuse the release. `--allow-stage-publish` goes with it
   * because staged publishing is the path npm is moving everyone to, and a
   * configuration that permits it costs nothing today.
   */
  let failed = 0
  for (const name of missing) {
    console.log(`  · ${name}`)
    try {
      execFileSync(
        'npm',
        ['trust', 'github', name, '--repo', REPOSITORY, '--file', WORKFLOW_FILE, '--allow-publish', '--allow-stage-publish', '--yes'],
        // Keeps the terminal: npm challenges this with the account's second
        // factor and cannot ask for it with no stdin.
        { cwd: ROOT, stdio: 'inherit' },
      )
    } catch (error) {
      failed += 1
      console.error(`    FAILED ${name} — ${error.message}`)
    }
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
