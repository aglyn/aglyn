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

// Point every dist-tag the repo's version should own at that version
// (AGL-3201).
//
//   npm run dist-tags                       # READ ONLY: what each tag says
//   npm run dist-tags -- --set              # moves the ones that are behind
//   npm run dist-tags -- --version 1.0.0    # a version other than the repo's
//   npm run dist-tags -- --probe            # can this runner move a tag at all?
//
// ---------------------------------------------------------------------------
// THE TWO TAGS, AND WHY NEITHER IS AUTOMATIC
// ---------------------------------------------------------------------------
// `publish-packages.mjs` chooses ONE tag when it publishes, because `npm
// publish --tag` takes one. While no non-prerelease exists it gives a
// prerelease `latest` — so the default install is the newest good build
// instead of `1.0.0-beta.143`, the one build a consumer cannot load at all.
// That leaves the prerelease's OWN label (`beta`) unmoved, and this closes it.
//
// After a release ships, the same job runs the other way round: the publish
// takes `beta` and `latest` is the one left behind. Either way there is a
// second tag, and npm has no way to set it during a publish.
//
// ⛔ AND OIDC CANNOT SET IT AFTERWARDS. A trusted-publisher token authorizes
// `npm publish` and `npm stage publish`; npm's documentation is explicit that
// everything else "requires traditional authentication methods". So this runs
// EITHER in CI with `NODE_AUTH_TOKEN`, or in the owner's terminal against
// their login — never on the OIDC identity that published.
//
// ---------------------------------------------------------------------------
// WHAT IT WILL NOT TOUCH
// ---------------------------------------------------------------------------
// A package the version was never published for: `@aglyn/cli` is versioned
// independently, so the repo's version means nothing to it. Skipped, not
// failed — npm would refuse the move, and counting that as a failure would
// make every run of this red.
//
// ⛔ AN AGENT MUST NOT RUN `--set` LOCALLY. It changes what an `npm install`
// of these packages hands out, and npm challenges it with the account's second
// factor. In CI the credential is the workflow's, and no agent handles it.
//
// Exit codes: 0 every tag is where it should be · 1 at least one is not (or a
// `--set` failed), which is what makes the read usable as a check.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { distTagFor, prereleaseLabelOf } from './publish-packages.mjs'
import { publishablePackages } from './trust-packages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

/** The tag a plain `npm install` reads. */
export const TAG = 'latest'

/**
 * Every tag `version` should own for a package whose registry holds
 * `published`.
 *
 * `latest` by the same rule the publish uses, so the two can never disagree
 * about which tag a version belongs on — and the prerelease's own label as
 * well, which is the one the publish could not also set.
 */
export function tagsFor(version, published) {
  const tags = [distTagFor(version, published)]
  const label = prereleaseLabelOf(version)
  if (label && !tags.includes(label)) tags.push(label)
  return tags
}

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
  const behind = tagsFor(version, answer.versions).filter(
    (tag) => answer.tags[tag] !== version,
  )
  if (!behind.length) return { state: 'ok' }
  return {
    state: 'move',
    tags: behind,
    why: behind.map((tag) => `${tag} is ${answer.tags[tag] ?? '(none)'}`).join(', '),
  }
}

/**
 * A tag name no consumer reads, for proving this runner may write tags at all.
 *
 * Deliberately not `latest` or a prerelease label: the probe must not be able
 * to change what a single `npm install` hands out, even if it is interrupted
 * between the add and the remove. It names itself, so a stray one left by a
 * killed run is obviously debris and obviously safe to delete.
 */
export const PROBE_TAG = 'ci-auth-probe'

/**
 * Can this runner move a dist-tag?
 *
 * `npm publish` and `npm dist-tag add` are DIFFERENT registry operations with
 * different authorization, and a release that publishes perfectly can still
 * be unable to set its second tag — the OIDC identity that published is not
 * allowed to. Whether the token in the environment can is not knowable from
 * a run where every tag already happens to be correct, because then nothing
 * is written and nothing is learned.
 *
 * So it writes a throwaway tag on one package and removes it again. The
 * answer is the point; the tag is not.
 */
export function probeWriteAccess(name, version, run = runNpm) {
  try {
    run(['dist-tag', 'add', `${name}@${version}`, PROBE_TAG])
  } catch (error) {
    return { ok: false, why: `${error.message}` }
  }
  try {
    run(['dist-tag', 'rm', name, PROBE_TAG])
  } catch (error) {
    // The answer was already obtained. A tag nothing reads, left behind, is
    // debris rather than a failure — say so and do not fail the run over it.
    return { ok: true, leftBehind: PROBE_TAG, why: `${error.message}` }
  }
  return { ok: true }
}

function runNpm(args) {
  return execFileSync('npm', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function main(argv) {
  const set = argv.includes('--set')
  const probe = argv.includes('--probe')
  const at = argv.indexOf('--version')
  const version = at >= 0 ? String(argv[at + 1] ?? '') : repoVersion()
  if (!version) {
    console.error('dist-tags: no version — pass --version <v>')
    return 1
  }

  const names = publishablePackages()
  console.log(`dist-tags: ${names.length} package(s); every tag ${version} owns → ${version}`)

  if (probe) {
    /*
     * Asked BEFORE the sweep, because the sweep's answer depends on it: a run
     * where every tag is already correct writes nothing, so it cannot tell a
     * runner that may write from one that may not. The probe is asked of the
     * first package that actually has this version.
     */
    const subject = names.find((name) => readTags(name).versions?.includes(version))
    if (!subject) {
      console.error(`dist-tags: no package has ${version}, so write access could not be probed.`)
      return 1
    }
    const answer = probeWriteAccess(subject, version)
    if (!answer.ok) {
      console.error(`dist-tags: this runner CANNOT move a dist-tag — ${answer.why}`)
      console.error('An OIDC identity may not; a token with write on the scope may.')
      return 1
    }
    console.log(`dist-tags: write access confirmed on ${subject}.`)
    if (answer.leftBehind) {
      console.error(`dist-tags: could not remove the probe tag "${answer.leftBehind}" from ${subject} — ${answer.why}`)
    }
  }

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
    for (const tag of verdict.tags) {
      try {
        execFileSync('npm', ['dist-tag', 'add', `${name}@${version}`, tag], {
          cwd: ROOT,
          /*
           * Keeps the terminal. Run by a person, npm challenges this with the
           * account's second factor and cannot ask for it with no stdin; run
           * in CI, `NODE_AUTH_TOKEN` answers and nothing is asked.
           */
          stdio: 'inherit',
        })
        moved += 1
      } catch (error) {
        failed += 1
        console.error(`    FAILED ${name} ${tag} — ${error.message}`)
      }
    }
  }

  if (failed) {
    console.error(
      `dist-tags: ${failed} tag(s) failed${moved ? `, ${moved} moved` : ''}. ` +
        'Re-run — the ones already moved are skipped.',
    )
    return 1
  }
  if (!behind.length) {
    console.log(`dist-tags: every published package has its tags at ${version}.`)
    return 0
  }
  if (!set) {
    console.log('')
    console.log(`${behind.length} package(s) are behind. The owner moves them:`)
    console.log('')
    console.log('  npm run dist-tags -- --set')
    console.log('')
    console.log('It changes what an `npm install` of these packages hands out, so it runs')
    console.log("either in CI with NODE_AUTH_TOKEN or against the owner's own login.")
    return 1
  }
  console.log(`dist-tags: moved ${moved} tag(s) to ${version}.`)
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (error) {
    console.error(`dist-tags: FAILED — ${error.message}`)
    process.exit(1)
  }
}
