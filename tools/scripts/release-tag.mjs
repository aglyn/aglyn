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
//   npm run release:tag -- --at <sha>            # backfill a missed tag
//   npm run release:tag -- --at <sha> --write --push
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
// AND IT IS WHY `--at` EXISTS (AGL-2765)
//
// Being a separate step run by hand is also how the step gets MISSED. On
// 2026-09-10 v1.0.0-beta.114 and v1.0.0-beta.115 were both cut, promoted and
// served — beta.115 ran in production at 30a394bd6 — and neither was ever
// tagged, which broke exactly the property above for those two releases while
// leaving the series looking merely gappy.
//
// `--at <sha>` tags a release that already shipped. Its guards prove the commit
// was MERGED to `production` as a promotion — and that is all they prove.
//
// MERGED IS NOT SERVED, AND GIT CANNOT TELL YOU THE DIFFERENCE
//
// This is the whole hazard of a backfill, and `v1.0.0-beta.5` is the worked
// example. It merged to `production` as `f2bac3cd1` and was deliberately never
// tagged: both `console:build:production` and `tenant:build:production` errored
// on Vercel after the merge (a misplaced `'use client'`), so the aliases kept
// serving the previous READY build and that tree never reached a user.
// `v1.0.0-beta.6` carries the fix and is tagged. The gap at 5 IS the record.
//
// Every guard below passes on `f2bac3cd1`. Ancestry, the first-parent line, the
// merge shape, the changelog — all true, and the tag would still be a lie,
// because the tag's claim is "built AND SERVED" and a failed build serves
// nothing. A gap in the series is therefore not a defect to be closed on
// sight; back-filling one to make the sequence look continuous would make
// every tag mean merely "merged", which is the weaker claim this scheme exists
// to avoid.
//
// On the forward path the operator settles this by running
// `verify-production-aliases.mjs` against the live aliases at tag time. That
// tool reads CURRENT state, so it can say nothing about a historical commit —
// which is why `--write` under `--at` refuses without `--served <evidence>`,
// and why that evidence is recorded in the annotation rather than assumed.
//
// Note that most gaps in the tag series are NOT missed tags and must be left
// alone. A version cut on `main` whose promotion was superseded by the next
// batch never reached production at all, so no commit carries it and there is
// nothing to tag — the gap is the honest record. Only a version that appears
// in a tree on `production` was served.
//
// ONE GAP SHAPE `--at` CANNOT DECIDE, and deliberately does not try to. Before
// the monotonic guard existed, a promotion could reach production without the
// bump, so the SAME version shipped as more than one tree — 1.0.0-beta.18 was
// served by PRs #920, #921 and #922, three different trees under one number.
// Every guard here passes on all three, and tagging any one of them makes the
// other two refuse as "already exists". Which tree deserves the number is a
// judgment about history, not something a guard can read off the graph, so it
// stays a human decision and `--at` simply does what it is told.
//
// RUN IT ONLY AFTER THE DEPLOY IS VERIFIED — `node tools/deploy/verify-production-aliases.mjs`
// (Vercel prints to stderr). This script cannot check that for you; it checks
// the things it CAN prove, listed in the guards below.
//
// It also looks the other way, at `origin/main` (AGL-2594). The bump is meant
// to reach `main` as well as `production`, and when it is cut on a pinned
// release branch it reaches only `production`. That never makes the tag
// wrong, so it is a warning and not a refusal — but a loud one, because
// `main` left behind reds the monotonic guard and conflicts the next PR.

import { execFileSync } from 'node:child_process'

import {
  compareVersions,
  formatVersion,
  mainVersionVerdict,
  parseVersion,
  predecessorVerdict,
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
  const options = {
    write: false,
    push: false,
    ref: 'origin/production',
    at: null,
    served: null,
  }
  let sawRef = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--write') options.write = true
    else if (arg === '--push') options.push = true
    else if (arg === '--ref') {
      options.ref = argv[++i]
      sawRef = true
    } else if (arg.startsWith('--ref=')) {
      options.ref = arg.slice(6)
      sawRef = true
    } else if (arg === '--at') options.at = argv[++i]
    else if (arg.startsWith('--at=')) options.at = arg.slice(5)
    else if (arg === '--served') options.served = argv[++i]
    else if (arg.startsWith('--served=')) options.served = arg.slice(9)
    else throw new Error(`Unknown argument ${JSON.stringify(arg)}.`)
  }

  // Both name the commit to tag, and they disagree about what the guards mean.
  // Taking one silently would tag the commit the operator did not name.
  if (sawRef && options.at !== null) {
    throw new Error(
      '--ref and --at both name the commit to tag; pass one.\n  ' +
        '--ref tags the tip of a branch as a new release; --at backfills a ' +
        'release that already shipped.',
    )
  }
  if (options.at !== null) options.ref = options.at

  // `--served` is meaningless on the forward path, where the operator proves
  // the deploy against the live aliases instead. Accepting it there would
  // invite pasting an attestation in place of running the check.
  if (options.served !== null && options.at === null) {
    throw new Error(
      '--served applies only to --at. On the forward path, prove the deploy ' +
        'with `node tools/deploy/verify-production-aliases.mjs` instead.',
    )
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

  // THE BACKFILL GUARDS — only under `--at`, and they are what make it safe.
  //
  // The forward path gets all of this for free from the ref it reads: the tip
  // of `origin/production` is by definition served, a promotion, and a merge.
  // `--at` names an arbitrary commit, so each of those has to be proved.
  if (options.at !== null) {
    const production = gitQuiet('rev-parse', 'origin/production')
    if (production === null) {
      throw new Error(
        'Cannot resolve origin/production, so nothing can be proved about ' +
          `${options.at}. Run \`git fetch origin production\` first.`,
      )
    }

    // B1 — MERGED. An ancestor of `production` is a commit production's
    // history contains. A commit that is not one was never promoted at all.
    // Necessary, and nowhere near sufficient — see the header on beta.5.
    const isAncestor =
      gitQuiet('merge-base', '--is-ancestor', sha, production) !== null
    if (!isAncestor) {
      throw new Error(
        `${sha.slice(0, 9)} is NOT an ancestor of origin/production, so it was ` +
          `never even merged there.\n  ` +
          `A tag means "this exact tree was built and served". Nothing about ` +
          `the version in its tree can make that true.`,
      )
    }

    // B2 — A PROMOTION, not something a promotion absorbed. `git log
    // origin/production` walks every parent, so it also lists the branch
    // merges that happened INSIDE a batch before it was promoted; several of
    // those carry the same version as each other and none of them is the
    // commit production ran. The first-parent line is production's own
    // history, one entry per promotion, and that is the only place a tag goes.
    const firstParent = git('rev-list', '--first-parent', production)
      .split('\n')
      .map((line) => line.trim())
    if (!firstParent.includes(sha)) {
      throw new Error(
        `${sha.slice(0, 9)} is an ancestor of origin/production but is NOT on ` +
          `its first-parent line.\n  ` +
          `That makes it a commit a promotion SWALLOWED — a branch merge from ` +
          `inside the batch — not a commit production was ever pointed at. ` +
          `Tag the promotion merge that brought it in.`,
      )
    }

    // B3 — A MERGE. Every promotion is a real merge commit ("never squash",
    // docs/RELEASING.md). A single-parent commit on this line would mean the
    // branch protection was bypassed, and that is worth refusing over.
    const parents = git('rev-list', '--parents', '-n', '1', sha)
      .split(/\s+/)
      .slice(1)
    if (parents.length < 2) {
      throw new Error(
        `${sha.slice(0, 9)} has ${parents.length} parent(s), so it is not a ` +
          `promotion merge.\n  ` +
          `A promotion reaches production as a merge commit from a PR; a ` +
          `direct push is rejected by branch protection (AGL-1777).`,
      )
    }

    // B4 — NOT ALREADY A RELEASE. A different tag on this commit means this
    // tree already shipped under another number, so adding a second would
    // make "what shipped in X?" answer two things.
    const claimed = git('tag', '--points-at', sha)
      .split('\n')
      .map((t) => t.trim())
      .filter((t) => versionForTag(t) !== null)
    if (claimed.length > 0) {
      throw new Error(
        `${sha.slice(0, 9)} is already tagged ${claimed.join(', ')}.\n  ` +
          `One deployed tree carries one version. Tags are never moved.`,
      )
    }

    // B5 — SERVED, and the only guard here a human has to answer. Nothing in
    // the graph distinguishes a promotion whose builds went READY from one
    // whose builds errored, and the second kind must never be tagged. So the
    // script refuses to write without an explicit attestation, and stores it
    // in the annotation so the claim stays auditable instead of becoming
    // folklore.
    if (options.write && !options.served) {
      throw new Error(
        `Refusing to tag ${sha.slice(0, 9)} without --served <evidence>.\n\n  ` +
          `Everything provable from git passes. What is NOT provable is the ` +
          `tag's actual claim:\n  that this tree was BUILT AND SERVED. A ` +
          `promotion whose Vercel builds errored merged exactly like one that\n  ` +
          `succeeded — the aliases simply kept serving the previous build. ` +
          `v1.0.0-beta.5 is that\n  case, and is deliberately untagged.\n\n  ` +
          `verify-production-aliases.mjs reads CURRENT state and cannot speak ` +
          `for a past\n  commit. Establish it from a record of the time, then ` +
          `pass what you found:\n\n    ` +
          `--served 'vercel: console+tenant READY for <deployment-id>, <date>'\n    ` +
          `--served '<apex> served <version> on <date>, confirmed by <who/what>'\n\n  ` +
          `If you cannot establish it, LEAVE THE GAP. A gap is the honest ` +
          `record of a release\n  that merged and never shipped; a tag is a ` +
          `claim that it did.`,
      )
    }

    out.push(
      '  backfill        --at, so the commit had to prove it was promoted:',
    )
    out.push('                  · ancestor of origin/production  (merged)')
    out.push('                  · on its first-parent line       (a promotion)')
    out.push(
      `                  · ${parents.length} parents                       (a merge commit)`,
    )
    out.push('                  · carries no other release tag')
    out.push('')
  }

  // GUARD 1 — the tag must not already exist. Moving a tag would silently
  // repoint a released version at a different tree, which is the one thing a
  // tag series exists to make impossible.
  // `^{commit}` because an annotated tag's own object sha is not a commit, and
  // printing it sends the reader looking for a commit that does not exist.
  const existing = gitQuiet(
    'rev-parse',
    '-q',
    '--verify',
    `refs/tags/${tag}^{commit}`,
  )
  if (existing) {
    throw new Error(
      `${tag} already exists (at ${existing.slice(0, 9)}).\n  ` +
        `Tags are never moved. If ${options.ref} needs a new version, run ` +
        `release:prepare again on main and promote that.`,
    )
  }

  // GUARD 2 — the version at this commit must be ahead of THE RELEASE BEFORE
  // IT. Catches the commonest real mistake: promoting a batch that did NOT
  // include the bump commit, so production still carries the old version and
  // the "new" tag would duplicate the last release's tree.
  //
  // "The release before it" is the whole subtlety, and it is why the two paths
  // hand predecessorVerdict different lists.
  //
  //   FORWARD — every release tag in the repo. The commit being tagged is the
  //   tip of `production`, so every tag that exists precedes it.
  //
  //   BACKFILL — only the tags REACHABLE FROM the commit. The newest tag in
  //   the repo comes after a backfilled commit, so comparing against it would
  //   refuse a correct tag for a reason that has nothing to do with the
  //   mistake being guarded against. `--merged <sha>` is the set of releases
  //   that actually shipped before this one, which is what the guard meant by
  //   "before" all along.
  const tagList = (...extra) =>
    git('tag', '--list', 'v*', '--sort=-v:refname', ...extra)
      .split('\n')
      .map((t) => t.trim())
      .filter((t) => versionForTag(t) !== null)

  const precedingTags =
    options.at === null ? tagList() : tagList('--merged', sha)

  const predecessor = predecessorVerdict({
    version,
    reachableVersions: precedingTags.map((t) => versionForTag(t)),
  })
  if (!predecessor.ok) {
    throw new Error(`${options.ref} ${predecessor.lines.join('\n  ')}`)
  }
  if (predecessor.predecessor === null) {
    out.push(...predecessor.lines)
  } else {
    out.push(`  previous tag    ${tagForVersion(predecessor.predecessor)}`)
  }
  out.push('')

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

  // Not a guard: nothing about `main` can make a tag on `production` wrong.
  // Read the same way as the tagged version — from the tree at the ref, never
  // the working copy — and the verdict goes LAST in both paths below, so the
  // final lines on screen are the warning rather than "PUSHED".
  const mainRaw = gitQuiet('show', 'origin/main:package.json')
  const main = mainVersionVerdict({
    tagVersion: version,
    mainVersion: mainRaw === null ? null : JSON.parse(mainRaw).version,
  })
  // 'ok' covers both "carries it" and "already past it", and on a backfill it
  // is ALWAYS the latter — main is many releases ahead of a tag being filled
  // in behind it. Printing "carries this version" there would be a plain
  // untruth in the one report whose job is to be checkable.
  const mainVersion = mainRaw === null ? null : JSON.parse(mainRaw).version
  out.push(
    `  origin/main     ${
      main.state === 'unknown'
        ? 'not fetched'
        : main.state === 'behind'
          ? `BEHIND — ${mainVersion}`
          : compareVersions(mainVersion, version) > 0
            ? `ahead — ${mainVersion}`
            : 'carries this version'
    }`,
  )
  out.push('')

  if (!options.write) {
    out.push('  ' + '-'.repeat(60))
    out.push(
      '  REPORT ONLY. No tag was created. Re-run with --write to create it.',
    )
    out.push('')
    if (options.at === null) {
      out.push(
        '  Before you do, confirm the deploy is live and serving THIS commit:',
      )
      out.push('')
      out.push('    node tools/deploy/verify-production-aliases.mjs')
      out.push('')
    } else {
      out.push(
        '  Everything provable from git passes. The tag also claims this tree was',
      )
      out.push(
        '  SERVED, which git cannot show — a promotion whose builds errored merged',
      )
      out.push(
        '  identically to one that succeeded (v1.0.0-beta.5). Establish that from a',
      )
      out.push('  record of the time and pass it:')
      out.push('')
      out.push(`    npm run release:tag -- --at ${options.at} --write \\`)
      out.push("      --served '<how you know it was served>'")
      out.push('')
      out.push('  If you cannot establish it, LEAVE THE GAP.')
      out.push('')
    }
    out.push(...main.lines)
    if (main.lines.length > 0) out.push('')
    console.log(out.join('\n'))
    return
  }

  // The annotation every release in this series carries, unchanged — readers
  // and `git for-each-ref --format='%(contents)'` both expect these lines. A
  // backfill adds one more, because "when was this tagged?" has a different
  // answer from "when did this ship?" for exactly these releases, and a reader
  // a year from now cannot work that out from the tag date alone.
  const message =
    `Aglyn ${version}\n\n` +
    'Promoted to production and verified deployed.\n' +
    'See CHANGELOG.md for what shipped.' +
    (options.at === null
      ? ''
      : `\n\nTagged retroactively: the tag was missed when this release was cut.\n` +
        `The commit is the promotion merge on production's first-parent line.\n` +
        `Served, per: ${options.served}`)

  git('tag', '-a', tag, sha, '-m', message)
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
  out.push(...main.lines)
  if (main.lines.length > 0) out.push('')
  console.log(out.join('\n'))
}

try {
  main()
} catch (error) {
  console.error(`\n  release:tag refused to continue.\n\n  ${error.message}\n`)
  process.exitCode = 1
}
