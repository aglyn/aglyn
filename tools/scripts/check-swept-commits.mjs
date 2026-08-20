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

// Lists commits that quietly deleted a file another issue had just added
// (AGL-2344).
//
//   npm run check:swept-commits                 # the last 200 commits
//   npm run check:swept-commits -- --count=1200
//   npm run check:swept-commits -- --range=origin/production..origin/main
//
// Nothing here writes, and it never rewrites history. It reads `git log` and
// prints candidates.
//
// WHEN TO RUN IT. Before opening a promotion PR, and after any session where
// several agents committed to the shared checkout in quick succession — that
// is when a stale working tree turns into a deletion nobody typed. All three
// known incidents happened inside a four-minute window of concurrent commits.
//
// WHAT A HIT MEANS. The named commit's diff removed a file that a DIFFERENT
// issue added moments earlier, and its message never mentions that file. That
// is usually a sweep from a contended tree. It is not proof — a deliberate
// deletion can simply go unmentioned — so every row is a candidate to read,
// never an instruction.
//
// ⚠️ DO NOT FIX A HIT BY REWRITING HISTORY. `main` is shared; rebasing or
// amending it is how work gets lost, which is the same class of harm this
// check exists to surface. Restore the content in a NEW commit tagged with
// the issue that owns it — `4599734b4` is the worked example — and record the
// correction on the affected issues so the changelog and PR manifest
// attribute it correctly.
//
// Exit codes:
//   0  nothing swept in the range
//   1  at least one candidate
//   2  the scan could not be made (a bad range, or no commits)

import { execFileSync } from 'node:child_process'
import {
  DEFAULT_WINDOW,
  findSweptFiles,
  formatReport,
  overallExitCode,
} from './lib/swept-commits.mjs'

/**
 * ASCII record/unit separators, written as ESCAPES rather than as the literal
 * bytes. They cannot appear in a commit subject or body, which is why they are
 * the delimiters — but as raw control characters in source they are invisible
 * to a reader and one stray editor or formatter pass silently empties them,
 * which would make every commit parse as one chunk.
 */
const RECORD = '\x1e'
const UNIT = '\x1f'

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  })
}

function parseArgs(argv) {
  const options = { count: 200, range: null, window: DEFAULT_WINDOW }
  for (const arg of argv) {
    if (arg.startsWith('--count=')) options.count = Number(arg.slice(8))
    else if (arg.startsWith('--range=')) options.range = arg.slice(8)
    else if (arg.startsWith('--window=')) options.window = Number(arg.slice(9))
    else {
      console.error(`Unknown argument: ${arg}`)
      console.error(
        'Usage: check:swept-commits [--count=N|--range=A..B] [--window=N]',
      )
      process.exit(2)
    }
  }
  if (!Number.isFinite(options.count) || options.count < 1) {
    console.error('--count must be a positive integer')
    process.exit(2)
  }
  if (!Number.isFinite(options.window) || options.window < 1) {
    console.error('--window must be a positive integer')
    process.exit(2)
  }
  return options
}

/**
 * Read the range as `[{ sha, subject, message, added, deleted }]`, OLDEST
 * first — the order findSweptFiles requires, since it walks backwards from a
 * deletion to the commit that added the file.
 *
 * Merges are excluded: a merge's name-status against its first parent
 * restates deletions that already happened on the branch, which would report
 * every real sweep a second time under the merge's own subject.
 */
function readCommits(options) {
  const selector = options.range ? [options.range] : [`-${options.count}`]
  const raw = git([
    'log',
    ...selector,
    '--no-merges',
    '--reverse',
    '--name-status',
    `--format=${RECORD}%H${UNIT}%s${UNIT}%B${UNIT}`,
  ])

  const commits = []
  for (const chunk of raw.split(RECORD)) {
    if (!chunk.trim()) continue
    const [sha, subject, message, files = ''] = chunk.split(UNIT)
    const added = []
    const deleted = []
    for (const line of files.split('\n')) {
      const row = line.trim()
      if (!row) continue
      const parts = row.split('\t')
      const status = parts[0]
      const path = parts[parts.length - 1]
      if (!path) continue
      // A rename's destination is not an "add" of new work, and its source is
      // not a loss — git tracked the move. Only plain A/D count.
      if (status === 'A') added.push(path)
      else if (status === 'D') deleted.push(path)
    }
    commits.push({ sha, subject, message, added, deleted })
  }
  return commits
}

function main() {
  const options = parseArgs(process.argv.slice(2))

  let commits
  try {
    commits = readCommits(options)
  } catch (error) {
    console.error(`Could not read the commit range: ${error?.message || error}`)
    console.error('Nothing was scanned. This is exit 2, not a clean run.')
    process.exit(2)
  }

  if (commits.length === 0) {
    console.error('The range selected no commits. Nothing was scanned.')
    process.exit(2)
  }

  const findings = findSweptFiles(commits, { window: options.window })
  console.log(formatReport(findings, { scanned: commits.length }))
  process.exit(overallExitCode(findings))
}

main()
