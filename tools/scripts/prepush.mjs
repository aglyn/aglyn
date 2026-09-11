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
// The pre-push checks (AGL-2837). `.husky/pre-push` runs this with the refs
// git hands the hook on stdin. The decisions live in `lib/prepush.mjs`,
// `lib/stale-literals.mjs` and `lib/guard-scope.mjs`, where they are tested.
//
//   node tools/scripts/prepush.mjs                     # as the hook
//   node tools/scripts/prepush.mjs --base origin/main  # by hand: merge-base..HEAD
//
// The budget is seconds on the shared Mac. Only the checks a pushed path can
// trip run, the file-content guards read only the pushed files, and scripts run
// four at a time. Exit 1 when a check fails.
//
// ## What it reads, and why that holds in a shared checkout
//
//  - The citation check and the stale-literal finder read git objects for the
//    pushed range, never the working tree.
//  - The guards read files on disk. A pushed file whose working copy differs
//    from HEAD is left out of the scoped list and counted, so a peer's
//    uncommitted edit is never judged as this push. A push of a commit that is
//    not checked out skips the disk-reading checks and says so.
//  - A range it cannot read prints NOT CHECKED and lets the push through: CI is
//    the verdict of record, and a hook that blocks on its own tooling is one
//    people learn to skip.

import { execFile as execFileCallback, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { readCeiling } from './lib/linear-ids.mjs'
import {
  addedLinesOf,
  checksFor,
  citationsAboveCeiling,
  commitsOf,
  parsePushedRefs,
} from './lib/prepush.mjs'
import { findStaleLiteralSpecs } from './lib/stale-literals.mjs'

const execFile = promisify(execFileCallback)
const CONCURRENCY = 4
const TAIL_LINES = 30
const started = Date.now()

let ROOT
try {
  ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
} catch (error) {
  console.log(`pre-push: NOT CHECKED, this is not a git checkout (${error.message.split('\n')[0]})`)
  process.exit(0)
}

function git(args, { allowNoMatch = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    if (allowNoMatch && error.status === 1) return ''
    throw error
  }
}

function tryGit(args) {
  try {
    return git(args).trim()
  } catch {
    return null
  }
}

/** The ranges being pushed: from the hook's stdin, or `--base <ref>` by hand. */
function pushedRanges(argv) {
  const at = argv.indexOf('--base')
  if (at >= 0) {
    const head = tryGit(['rev-parse', 'HEAD'])
    const base = tryGit(['merge-base', argv[at + 1] ?? 'origin/main', 'HEAD'])
    return head && base ? [{ base, head, ref: 'HEAD' }] : []
  }
  const stdin = process.stdin.isTTY ? '' : readFileSync(0, 'utf8')
  return parsePushedRefs(stdin)
    .map((ref) => {
      const known = ref.remoteSha !== null && tryGit(['cat-file', '-e', `${ref.remoteSha}^{commit}`]) !== null
      const base = known ? ref.remoteSha : tryGit(['merge-base', ref.localSha, 'origin/main'])
      return base ? { base, head: ref.localSha, ref: ref.remoteRef } : null
    })
    .filter(Boolean)
}

async function runScript(name, args, detail) {
  const begun = Date.now()
  try {
    const { stdout, stderr } = await execFile(process.execPath, args, {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: '0' },
    })
    return { name, state: 'PASS', ms: Date.now() - begun, detail, output: `${stdout}${stderr}` }
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}` || String(error.message)
    return { name, state: 'FAIL', ms: Date.now() - begun, detail, output }
  }
}

async function pool(tasks, limit) {
  const results = new Array(tasks.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const index = next
      next += 1
      results[index] = await tasks[index]()
    }
  })
  await Promise.all(workers)
  return results
}

function citationsCheck(ranges) {
  const begun = Date.now()
  const name = 'linear citations'
  let raw
  try {
    raw = JSON.parse(readFileSync(join(ROOT, 'tools', 'scripts', 'linear-issue-ceiling.json'), 'utf8'))
  } catch (error) {
    return { name, state: 'FAIL', ms: Date.now() - begun, output: `cannot read the issue ceiling: ${error.message}` }
  }
  const read = readCeiling(raw)
  if (!read.ok) {
    return { name, state: 'FAIL', ms: Date.now() - begun, output: `the issue ceiling is unusable: ${read.reason}` }
  }
  const commits = ranges.flatMap(({ base, head }) =>
    commitsOf(git(['log', '--format=%H%x1f%B%x1e', `${base}..${head}`])),
  )
  const addedLines = ranges.flatMap(({ base, head }) =>
    addedLinesOf(git(['diff', '-U0', '--no-color', '--no-renames', base, head])),
  )
  const above = citationsAboveCeiling({
    commits,
    addedLines,
    ceiling: read.ceiling.highest,
    forgiven: raw.historicalCitations?.commits ?? [],
  })
  if (!above.length) return { name, state: 'PASS', ms: Date.now() - begun }
  return {
    name,
    state: 'WARN',
    ms: Date.now() - begun,
    output: [
      `${above.map((one) => one.id).join(', ')} ${above.length === 1 ? 'is' : 'are'} above the checked-in ceiling AGL-${read.ceiling.highest}.`,
      "CI's check:linear-ids asks Linear and refuses an id it has not assigned: cite only an issue that already exists.",
      ...above.map((one) => `  ${one.id}  ${one.where.slice(0, 3).join(', ')}`),
    ].join('\n'),
  }
}

function staleLiteralsCheck(ranges) {
  const begun = Date.now()
  const name = 'stale spec literals'
  const findings = ranges.flatMap(({ base, head }) => findStaleLiteralSpecs({ base, head, git }))
  if (!findings.length) return { name, state: 'PASS', ms: Date.now() - begun }
  return {
    name,
    state: 'FAIL',
    ms: Date.now() - begun,
    output: [
      ...findings.map(
        (one) => `${one.spec}:${one.line} still asserts "${one.literal}", which the push changed to "${one.now}" in ${one.changedIn}`,
      ),
      'Move the spec to the new copy, commit, and push again.',
    ].join('\n'),
  }
}

let ranges
let changed
try {
  ranges = pushedRanges(process.argv.slice(2))
  changed = [
    ...new Set(
      ranges.flatMap(({ base, head }) =>
        git(['diff', '--name-only', '--diff-filter=ACMR', '--no-renames', base, head]).split('\n').filter(Boolean),
      ),
    ),
  ]
} catch (error) {
  console.log(`pre-push: NOT CHECKED, the pushed range could not be read (${error.message.split('\n')[0]})`)
  process.exit(0)
}
if (!ranges.length) {
  console.log('pre-push: nothing new to check')
  process.exit(0)
}
if (!changed.length) {
  console.log('pre-push: the pushed commits change no files')
  process.exit(0)
}

const checkedOut = tryGit(['rev-parse', 'HEAD'])
const readsDisk = ranges.every(({ head }) => head === checkedOut)
const dirty = new Set(readsDisk ? git(['diff', '--name-only', 'HEAD']).split('\n').filter(Boolean) : [])
const commitCount = ranges.reduce(
  (count, { base, head }) => count + Number(git(['rev-list', '--count', `${base}..${head}`]).trim()),
  0,
)

const tmp = mkdtempSync(join(tmpdir(), 'aglyn-prepush-'))
const skipped = []
const tasks = []
for (const check of checksFor(changed)) {
  if (!readsDisk) {
    skipped.push({ name: check.name, state: 'SKIP', detail: 'the pushed commit is not checked out, so the files on disk are not what is pushed' })
    continue
  }
  const args = [join(ROOT, check.script), ...(check.args ?? [])]
  let detail = ''
  if (check.scoped) {
    const paths = check.paths.filter((path) => !dirty.has(path))
    const leftOut = check.paths.length - paths.length
    if (!paths.length) {
      skipped.push({ name: check.name, state: 'SKIP', detail: `every pushed file it reads (${leftOut}) has uncommitted changes on disk` })
      continue
    }
    const list = join(tmp, `${check.name.replace(/[^\w-]+/g, '-')}.txt`)
    writeFileSync(list, `${paths.join('\n')}\n`)
    args.push('--files-from', list)
    detail = `${paths.length} file(s)${leftOut ? `, ${leftOut} with uncommitted changes left out` : ''}`
  }
  tasks.push(() => runScript(check.name, args, detail))
}

let results
try {
  const running = pool(tasks, CONCURRENCY)
  const inline = [citationsCheck(ranges), staleLiteralsCheck(ranges)]
  results = [...inline, ...(await running), ...skipped]
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

const width = Math.max(...results.map((result) => result.name.length))
console.log(
  `pre-push: ${changed.length} file(s) in ${commitCount} commit(s) to ${ranges.map((range) => range.ref).join(', ')}`,
)
for (const result of results) {
  const time = result.ms === undefined ? '' : `${(result.ms / 1000).toFixed(1)}s`
  console.log(`  ${result.state.padEnd(4)}  ${result.name.padEnd(width)}  ${time}${result.detail ? `  (${result.detail})` : ''}`)
}
for (const result of results) {
  if (result.state === 'PASS' || !result.output) continue
  const lines = result.output.trimEnd().split('\n')
  console.log(`\n--- ${result.state} ${result.name} ---`)
  if (lines.length > TAIL_LINES) console.log(`[… ${lines.length - TAIL_LINES} earlier lines]`)
  console.log(lines.slice(-TAIL_LINES).join('\n'))
}

const failed = results.filter((result) => result.state === 'FAIL')
console.log(
  `\npre-push: ${failed.length ? `${failed.length} check(s) FAILED` : 'clean'} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
)
if (failed.length) {
  console.log('Each failure above is a red CI would raise after this push. Fix it, commit, and push again.')
}
process.exit(failed.length ? 1 : 0)
