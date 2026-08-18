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

// Step 2 of cutting a release (AGL-2089): put the tag on the commit that is
// ACTUALLY DEPLOYED.
//
//   npm run release:tag              # report only — creates nothing
//   npm run release:tag -- --write   # create the annotated tag locally
//   npm run release:tag -- --write --push
//
// WHY THE TAG GOES ON `origin/production`, NOT ON THE COMMIT THAT BUMPED
//
// The bump lands on `main`. `main` is not deployed — only `production` is
// (docs/VERCEL_DEPLOYMENTS.md, AGL-522), and it gets there through a real
// merge commit whose SHA exists only after the PR is merged. Tagging the main
// commit would name something that was never served, and would be wrong
// outright if the batch were pulled. So the tag names the merge commit on
// `production`, created after the fact, and it therefore means:
//
//     THIS EXACT TREE WAS BUILT AND SERVED.
//
// That is the property that makes "what shipped in v1.0.0-beta.3?" answerable
// a year later, and it is why this is a separate script run at a separate
// time rather than a flag on release-prepare.
//
// RUN IT ONLY AFTER THE DEPLOY IS VERIFIED — `node tools/deploy/verify-production-aliases.mjs`
// (Vercel prints to stderr). This script cannot check that for you; it checks
// the things it CAN prove, listed in the guards below.

import { execFileSync } from 'node:child_process'

import {
  compareVersions,
  formatVersion,
  parseVersion,
  tagForVersion,
  versionForTag,
} from './lib/release-version.mjs'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

// `null` on failure, and genuinely quiet: git writes "fatal: path ... does not
// exist" to stderr, which would otherwise print above this script's own, much
// clearer, refusal message.
const gitQuiet = (...args) => {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

function parseArgs(argv) {
  const options = { write: false, push: false, ref: 'origin/production' }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--write') options.write = true
    else if (arg === '--push') options.push = true
    else if (arg === '--ref') options.ref = argv[++i]
    else if (arg.startsWith('--ref=')) options.ref = arg.slice(6)
    else throw new Error(`Unknown argument ${JSON.stringify(arg)}.`)
  }
  return options
}

function main() {
  const options = parseArgs(process.argv.slice(2))

  // Read the version out of the TREE AT THAT COMMIT, never the working copy.
  // The working copy is on main and has almost certainly moved on; using it
  // would tag the deployed commit with a version it does not contain.
  const raw = gitQuiet('show', `${options.ref}:package.json`)
  if (raw === null) {
    throw new Error(
      `Cannot read package.json at ${options.ref}. Run \`git fetch origin production\` first.`,
    )
  }
  const version = formatVersion(parseVersion(JSON.parse(raw).version))
  const tag = tagForVersion(version)
  const sha = git('rev-parse', options.ref)

  const out = []
  out.push('')
  out.push('  Aglyn release — tag')
  out.push('  ' + '-'.repeat(60))
  out.push(`  ref             ${options.ref}`)
  out.push(`  commit          ${sha}`)
  out.push(`  subject         ${git('log', '-1', '--format=%s', options.ref)}`)
  out.push(`  version there   ${version}`)
  out.push(`  tag             ${tag}`)
  out.push('')

  // GUARD 1 — the tag must not already exist. Moving a tag would silently
  // repoint a released version at a different tree, which is the one thing a
  // tag series exists to make impossible.
  const existing = gitQuiet('rev-parse', '-q', '--verify', `refs/tags/${tag}`)
  if (existing) {
    throw new Error(
      `${tag} already exists (at ${existing.slice(0, 9)}).\n  ` +
        `Tags are never moved. If ${options.ref} needs a new version, run ` +
        `release:prepare again on main and promote that.`,
    )
  }

  // GUARD 2 — the version at this commit must be ahead of the newest existing
  // release tag. Catches the commonest real mistake: promoting a batch that
  // did NOT include the bump commit, so production still carries the old
  // version and the "new" tag would duplicate the last release's tree.
  const tags = git('tag', '--list', 'v*', '--sort=-v:refname')
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => versionForTag(t) !== null)

  if (tags.length === 0) {
    out.push('  NOTE: this is the FIRST release tag in the repo.')
    out.push(
      '  (The two 2021 `*-0.0.1` tags are a dead per-library scheme and are ignored.)',
    )
    out.push('')
  } else {
    const newest = versionForTag(tags[0])
    if (compareVersions(version, newest) <= 0) {
      throw new Error(
        `${options.ref} carries version ${version}, which is not ahead of the ` +
          `newest release tag ${tags[0]}.\n  ` +
          `That almost always means the promotion did not include the ` +
          `\`chore(release)\` commit — check that the bump is an ancestor of ${options.ref}.`,
      )
    }
    out.push(`  previous tag    ${tags[0]}`)
    out.push('')
  }

  // GUARD 3 — the changelog must document this version. A tag with no
  // changelog entry is a release nobody can read.
  const changelog = gitQuiet('show', `${options.ref}:CHANGELOG.md`)
  if (changelog === null || !changelog.includes(`## ${tag} `)) {
    throw new Error(
      `CHANGELOG.md at ${options.ref} has no \`## ${tag}\` section.\n  ` +
        `release-prepare writes package.json and CHANGELOG.md together, so a ` +
        `version without an entry means they were committed apart.`,
    )
  }
  out.push(
    '  guards          tag is new · version is ahead · changelog documents it',
  )
  out.push('')

  if (!options.write) {
    out.push('  ' + '-'.repeat(60))
    out.push(
      '  REPORT ONLY. No tag was created. Re-run with --write to create it.',
    )
    out.push('')
    out.push(
      '  Before you do, confirm the deploy is live and serving THIS commit:',
    )
    out.push('')
    out.push('    node tools/deploy/verify-production-aliases.mjs')
    out.push('')
    console.log(out.join('\n'))
    return
  }

  git(
    'tag',
    '-a',
    tag,
    sha,
    '-m',
    `Aglyn ${version}\n\nPromoted to production and verified deployed.\nSee CHANGELOG.md for what shipped.`,
  )
  out.push(`  CREATED  annotated tag ${tag} → ${sha.slice(0, 9)}`)

  if (options.push) {
    git('push', 'origin', tag)
    out.push(`  PUSHED   ${tag} to origin`)
  } else {
    out.push('')
    out.push('  The tag is LOCAL only. Publish it with:')
    out.push('')
    out.push(`    git push origin ${tag}`)
  }
  out.push('')
  console.log(out.join('\n'))
}

try {
  main()
} catch (error) {
  console.error(`\n  release:tag refused to continue.\n\n  ${error.message}\n`)
  process.exitCode = 1
}
