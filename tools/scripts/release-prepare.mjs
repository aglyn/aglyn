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

// Step 1 of cutting a release (AGL-2089): work out the next version from the
// commits about to be promoted, and write it into package.json + CHANGELOG.md.
//
//   npm run release:prepare              # report only — changes NOTHING
//   npm run release:prepare -- --write   # write package.json + CHANGELOG.md
//   npm run release:prepare -- --write --set 1.0.0
//   npm run release:prepare -- --write --prerelease-tag beta
//
// REPORT-ONLY IS THE DEFAULT, DELIBERATELY. Cutting a version is a decision,
// not a build step. Running this without --write is how you find out what the
// batch contains before committing to a number.
//
// This script never commits, never tags and never pushes. It prints the exact
// `git commit --only` line to run, because the house rule is explicit paths —
// `git add -A` in this repo sweeps up other agents' work.
//
// WHERE THIS SITS IN THE PROMOTION FLOW — see docs/RELEASING.md. Short version:
// run this on `main` when Zach calls the batch, commit, push, then open the
// main→production PR as usual. The TAG goes on later, from release-tag.mjs,
// only once the deploy is verified.

import { execFileSync } from 'node:child_process'
import {
  existsSync as exists,
  readFileSync as read,
  writeFileSync as write,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertForward,
  CHANGELOG_HEADER,
  formatVersion,
  insertRelease,
  nextVersion,
  parseVersion,
  renderRelease,
  summarizeCommits,
  tagForVersion,
  versionForTag,
} from './lib/release-version.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const packagePath = join(repoRoot, 'package.json')
const changelogPath = join(repoRoot, 'CHANGELOG.md')

const git = (...args) =>
  execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()

function parseArgs(argv) {
  const options = {
    write: false,
    set: null,
    prereleaseTag: null,
    baseRef: null,
    headRef: 'HEAD',
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--write') options.write = true
    else if (arg === '--set') options.set = argv[++i]
    else if (arg.startsWith('--set=')) options.set = arg.slice(6)
    else if (arg === '--prerelease-tag') options.prereleaseTag = argv[++i]
    else if (arg.startsWith('--prerelease-tag='))
      options.prereleaseTag = arg.slice(17)
    else if (arg === '--base') options.baseRef = argv[++i]
    else if (arg.startsWith('--base=')) options.baseRef = arg.slice(7)
    else if (arg === '--head') options.headRef = argv[++i]
    else if (arg.startsWith('--head=')) options.headRef = arg.slice(7)
    else {
      throw new Error(`Unknown argument ${JSON.stringify(arg)}.`)
    }
  }
  return options
}

/**
 * The commit the changelog range starts from: always `origin/production`.
 *
 * IT IS NOT THE PREVIOUS TAG, and that is a topology fact rather than a
 * preference. Work flows `main` → `production` through a merge commit, so the
 * merge commit — and therefore the tag on it — is NEVER an ancestor of `main`.
 * A `git merge-base --is-ancestor <tag> HEAD` lookup fails for every release
 * tag forever, silently falling back on every run. (This was written the
 * tag-first way and the rehearsal caught it on release two.)
 *
 * `origin/production` is also the more honest boundary. It is by definition
 * exactly what is deployed, so `origin/production..main` is exactly what is
 * not yet released — the batch being promoted. It self-corrects if a
 * promotion is ever pulled or re-cut, which a tag-anchored range would not.
 *
 * Tags stay what they are for: naming a deployed SHA after the fact.
 */
function resolveBase(explicit) {
  if (explicit) {
    return { ref: explicit, reason: 'given with --base', firstRelease: false }
  }
  const anyReleaseTag = git('tag', '--list', 'v*', '--sort=-v:refname')
    .split('\n')
    .map((t) => t.trim())
    .some((t) => versionForTag(t) !== null)

  return {
    ref: 'origin/production',
    reason: anyReleaseTag
      ? 'what is currently deployed — so this range is exactly the batch being promoted'
      : 'what is currently deployed. NO RELEASE TAG EXISTS YET, so this is the ' +
        'first release: it documents the batch being promoted and does NOT ' +
        'reconstruct the history before it',
    firstRelease: !anyReleaseTag,
  }
}

function readCommits(baseRef, headRef) {
  // %x00 between fields and %x01 between records: commit bodies contain
  // newlines and every printable separator, so a text delimiter would split a
  // multi-paragraph body into fake commits.
  const raw = git(
    'log',
    `${baseRef}..${headRef}`,
    '--no-merges',
    '--format=%H%x00%s%x00%b%x01',
  )
  if (!raw) return []
  return raw
    .split('\x01')
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.trim().length > 0)
    .map((record) => {
      const [sha, subject, body] = record.split('\x00')
      return { sha, subject: subject ?? '', body: body ?? '' }
    })
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const pkg = JSON.parse(read(packagePath, 'utf8'))
  const current = parseVersion(pkg.version)

  const base = resolveBase(options.baseRef)
  const commits = readCommits(base.ref, options.headRef)
  const summary = summarizeCommits(commits)

  const proposed = options.set
    ? parseVersion(options.set)
    : nextVersion(current, summary.bump, {
        prereleaseTag: options.prereleaseTag,
      })
  assertForward(current, proposed)
  const version = formatVersion(proposed)

  const out = []
  out.push('')
  out.push('  Aglyn release — prepare')
  out.push('  ' + '-'.repeat(60))
  out.push(`  base            ${base.ref}  (${base.reason})`)
  out.push(
    `  head            ${options.headRef} = ${git('rev-parse', '--short', options.headRef)}`,
  )
  out.push(`  commits         ${summary.total}`)
  out.push(
    `  by type         ${Object.entries(summary.byType)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${type}:${count}`)
      .join('  ')}`,
  )
  out.push(`  Linear issues   ${summary.linearIds.length}`)
  out.push(`  aggregate bump  ${summary.bump}`)
  if (summary.breaking.length > 0) {
    out.push(`  BREAKING        ${summary.breaking.length}`)
    for (const commit of summary.breaking) {
      out.push(`                  ${commit.sha.slice(0, 9)} ${commit.subject}`)
    }
  }
  out.push('')
  out.push(`  current         ${formatVersion(current)}`)
  out.push(`  proposed        ${version}      tag: ${tagForVersion(version)}`)
  if (options.set) out.push('                  (forced with --set)')
  if (current.prerelease && !options.set) {
    out.push('')
    out.push(
      `  NOTE: ${formatVersion(current)} is a prerelease, so the series number moves and the`,
    )
    out.push(
      `  base ${current.major}.${current.minor}.${current.patch} does not. The aggregate bump above is reported, not applied.`,
    )
    out.push('  To leave the prerelease series, pass --set explicitly.')
  }
  out.push('')

  // Because the range is anchored on what is DEPLOYED, a bump that was
  // prepared but never promoted still sits in it — and re-running would
  // re-document every commit the earlier run already wrote up, under a second
  // version number. Refuse, and say which commit to look at.
  const priorRelease = summary.commits.filter((c) =>
    /^chore\(release\):/.test(c.subject),
  )
  if (priorRelease.length > 0 && !options.baseRef) {
    out.push('  ' + '-'.repeat(60))
    out.push('  REFUSING: an earlier release was prepared but never promoted.')
    out.push('')
    for (const commit of priorRelease) {
      out.push(`    ${commit.sha.slice(0, 9)} ${commit.subject}`)
    }
    out.push('')
    out.push(
      '  That commit is on main but not on production, so the range above',
    )
    out.push(
      '  still contains everything it already documented. Promote it first,',
    )
    out.push(
      '  or pass --base <sha> deliberately if you know what you are doing.',
    )
    out.push('')
    console.log(out.join('\n'))
    process.exitCode = 1
    return
  }

  if (summary.total === 0) {
    out.push('  Nothing to release: no commits between base and head.')
    out.push('')
    console.log(out.join('\n'))
    process.exitCode = 1
    return
  }

  const rendered = renderRelease({
    version,
    date: new Date().toISOString().slice(0, 10),
    summary,
    compareUrl: base.firstRelease
      ? null
      : `https://github.com/aglyn/aglyn/compare/${base.ref}...${tagForVersion(version)}`,
  })

  if (!options.write) {
    out.push('  ' + '-'.repeat(60))
    out.push(
      '  REPORT ONLY. Nothing was written. Re-run with --write to apply.',
    )
    out.push('')
    out.push('  CHANGELOG.md would gain:')
    out.push('')
    out.push(
      rendered
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n'),
    )
    console.log(out.join('\n'))
    return
  }

  pkg.version = version
  write(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)

  const existing = exists(changelogPath)
    ? read(changelogPath, 'utf8')
    : CHANGELOG_HEADER
  write(changelogPath, insertRelease(existing, rendered))

  let changelogTracked = true
  try {
    git('ls-files', '--error-unmatch', 'CHANGELOG.md')
  } catch {
    changelogTracked = false
  }

  out.push('  ' + '-'.repeat(60))
  out.push('  WROTE  package.json  (version → ' + version + ')')
  out.push('  WROTE  CHANGELOG.md')
  out.push('')
  out.push(
    '  Next — commit with EXPLICIT paths (never `git add -A` in this repo):',
  )
  out.push('')
  // `git commit --only` cannot take a path git has never seen, so on the first
  // release CHANGELOG.md needs an explicit `git add` first. Naming the one
  // file keeps the house rule intact — what `add -A` breaks is sweeping up
  // OTHER agents' work, not adding a file you just wrote on purpose.
  if (!changelogTracked) {
    out.push('    git add CHANGELOG.md   # new file — --only cannot stage it')
  }
  out.push('    git commit --only package.json CHANGELOG.md \\')
  out.push(`      -m 'chore(release): ${tagForVersion(version)} (AGL-2089)'`)
  out.push('')
  out.push('  Then push to main and open the main→production PR as usual.')
  out.push(
    '  The TAG is not created here — run `npm run release:tag` AFTER the',
  )
  out.push('  promotion is merged and the deploy is verified.')
  out.push('')
  console.log(out.join('\n'))
}

try {
  main()
} catch (error) {
  // A refusal here is a normal outcome (a backwards --set, an unparseable
  // version), not a crash. A stack trace would bury the one line that says
  // what to do about it.
  console.error(
    `\n  release:prepare refused to continue.\n\n  ${error.message}\n`,
  )
  process.exitCode = 1
}
