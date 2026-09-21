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

// Point `latest` at the version this repo carries (AGL-3201).
//
//   npm run dist-tag:latest                       # READ ONLY: what each tag says
//   npm run dist-tag:latest -- --set              # moves the ones that are behind
//   npm run dist-tag:latest -- --version 1.0.0    # a version other than the repo's
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS AT ALL
// ---------------------------------------------------------------------------
// `publish-packages.mjs` puts a prerelease under its own label (`beta`) and
// never `latest`, so that a beta is not what `npm install` hands somebody who
// asked for nothing in particular. That rule assumes `latest` points at a
// release worth having.
//
// It does not. npm sets `latest` on a package's FIRST publish whatever `--tag`
// says, so all 50 libs pinned `latest` to `1.0.0-beta.143` — the version whose
// folder-subpath imports cannot be resolved by a consumer at all
// (plugins-marketing, plugins-ai and tenant-data-admin fail at load). A plain
// `npm i @aglyn/aglyn` gets the one build that is known broken.
//
// So until a NON-PRERELEASE ships, `latest` is moved forward by hand, which is
// what this does. When `1.0.0` goes out it sets `latest` itself and this script
// stops having a job.
//
// ---------------------------------------------------------------------------
// WHAT IT WILL NOT TOUCH
// ---------------------------------------------------------------------------
// `@aglyn/cli` is versioned independently and has no `beta` line, so the repo's
// version means nothing to it and its `latest` is already the right answer. It
// is skipped by the only test that matters: the version is not published for
// it.
//
// ⛔ AN AGENT MUST NOT RUN `--set`. Moving `latest` changes what every `npm
// install` of these packages hands out, and npm challenges it with the
// account's second factor. It runs in the OWNER'S terminal, under their login.
//
// Exit codes: 0 every tag is where it should be · 1 at least one is not (or a
// `--set` failed), which is what makes the read usable as a check.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publishablePackages } from './trust-packages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

/** The tag a plain `npm install` reads. */
export const TAG = 'latest'

/** The version this repo carries — what `release:prepare` wrote. */
export function repoVersion(root = ROOT) {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
}

/**
 * What the registry says about one package: its tags and whether it has the
 * version at all.
 *
 * ⚠️ `npm view` with MORE THAN ONE field answers with an ARRAY wrapping the
 * object, and with one field it answers the value bare. Reading the multi-field
 * answer as an object gives `undefined` for every field — which reads as "this
 * package has no tags", and would move `latest` on a package whose tags were
 * simply never read.
 */
export function readTags(name, run = npmView) {
  const raw = run(name)
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: 'could not read the registry' }
  }
  const body = Array.isArray(parsed) ? (parsed[0] ?? {}) : parsed
  if (body?.error) return { error: body.error.summary ?? body.error.code ?? 'error' }
  return {
    tags: body['dist-tags'] ?? {},
    versions: Array.isArray(body.versions) ? body.versions : [],
  }
}

function npmView(name) {
  try {
    return execFileSync('npm', ['view', name, 'dist-tags', 'versions', '--json'], {
      encoding: 'utf8',
      // See trust-packages.mjs: npm answers a challenge with a browser
      // handshake and must keep the terminal to wait for it.
      stdio: ['inherit', 'pipe', 'inherit'],
    })
  } catch (error) {
    return `${error.stdout ?? ''}`.trim() || '{}'
  }
}

/**
 * What to do about one package, given what the registry said.
 *
 * `skip` is the honest answer for a package the version was never published
 * for — `@aglyn/cli`, which carries its own number. Moving `latest` there
 * would point it at a version that does not exist, which npm refuses, and
 * treating that refusal as a failure would make every run of this red.
 */
export function verdictFor(answer, version) {
  if (answer.error) return { state: 'error', why: answer.error }
  if (!answer.versions.includes(version)) {
    return { state: 'skip', why: `${version} is not published for it` }
  }
  if (answer.tags[TAG] === version) return { state: 'ok' }
  return { state: 'move', why: `${TAG} is ${answer.tags[TAG] ?? '(none)'}` }
}

function main(argv) {
  const set = argv.includes('--set')
  const at = argv.indexOf('--version')
  const version = at >= 0 ? String(argv[at + 1] ?? '') : repoVersion()
  if (!version) {
    console.error('dist-tag:latest: no version — pass --version <v>')
    return 1
  }

  const names = publishablePackages()
  console.log(`dist-tag:latest: ${names.length} package(s); ${TAG} → ${version}`)

  const behind = []
  let moved = 0
  let failed = 0
  for (const name of names) {
    const verdict = verdictFor(readTags(name), version)
    if (verdict.state === 'ok') {
      console.log(`  ok    ${name}`)
      continue
    }
    if (verdict.state === 'skip') {
      console.log(`  skip  ${name} — ${verdict.why}`)
      continue
    }
    if (verdict.state === 'error') {
      failed += 1
      console.error(`  ERROR ${name} — ${verdict.why}`)
      continue
    }
    behind.push(name)
    if (!set) {
      console.log(`  BEHIND ${name} — ${verdict.why}`)
      continue
    }
    console.log(`  move  ${name} — ${verdict.why}`)
    try {
      execFileSync('npm', ['dist-tag', 'add', `${name}@${version}`, TAG], {
        cwd: ROOT,
        // Keeps the terminal: npm challenges this with the account's second
        // factor and cannot ask for it with no stdin.
        stdio: 'inherit',
      })
      moved += 1
    } catch (error) {
      failed += 1
      console.error(`    FAILED ${name} — ${error.message}`)
    }
  }

  if (failed) {
    console.error(
      `dist-tag:latest: ${failed} package(s) failed${moved ? `, ${moved} moved` : ''}. ` +
        'Re-run — the ones already moved are skipped.',
    )
    return 1
  }
  if (!behind.length) {
    console.log(`dist-tag:latest: every published package points ${TAG} at ${version}.`)
    return 0
  }
  if (!set) {
    console.log('')
    console.log(`${behind.length} package(s) are behind. The owner moves them:`)
    console.log('')
    console.log('  npm run dist-tag:latest -- --set')
    console.log('')
    console.log('It changes what every `npm install` of these packages hands out, and')
    console.log("npm challenges it with the account's second factor — an agent may not.")
    return 1
  }
  console.log(`dist-tag:latest: moved ${moved} package(s) to ${version}.`)
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (error) {
    console.error(`dist-tag:latest: FAILED — ${error.message}`)
    process.exit(1)
  }
}
