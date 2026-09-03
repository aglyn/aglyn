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
// Reads Main Gate's verdict for a promotion range (AGL-2533). The grading and
// its rationale live in `lib/main-gate-verdicts.mjs`; this file is the git and
// network half.
//
//   npm run check:main-gate-verdicts                   # origin/production..HEAD
//   npm run check:main-gate-verdicts -- --range=A..B   # an explicit range
//   npm run check:main-gate-verdicts -- --repo=o/r     # override the repo
//
// Exit 0 clean, 1 the tip is red, 2 the tip carries no verdict.
import { execFileSync } from 'node:child_process'
import {
  gradePromotion,
  gateContexts,
  REFUSE,
  UNVERIFIED,
} from './lib/main-gate-verdicts.mjs'

// A promotion range is small; a runaway one means something is wrong, and 50
// API calls is where this stops rather than hammering GitHub.
const MAX_COMMITS = 50

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const sh = (cmd, argv) =>
  execFileSync(cmd, argv, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

const repo = flag('repo', process.env['GITHUB_REPOSITORY'] || 'aglyn/aglyn')
const range = flag('range', 'origin/production..HEAD')

/** `gh api`, because it carries the right auth in Actions and locally alike. */
function ghJson(path) {
  try {
    return JSON.parse(sh('gh', ['api', path]))
  } catch {
    return null
  }
}

let log = ''
try {
  log = sh('git', ['log', '--reverse', '--format=%H %s', range])
} catch (error) {
  process.stderr.write(
    `could not read the range ${range}: ${String(error).slice(0, 200)}\n` +
      'Fetch `production` first, or pass --range=<A..B>.\n',
  )
  process.exit(UNVERIFIED)
}

const rows = log
  ? log.split('\n').map((line) => {
      const at = line.indexOf(' ')
      return at === -1
        ? { sha: line, subject: '' }
        : { sha: line.slice(0, at), subject: line.slice(at + 1) }
    })
  : []

if (rows.length > MAX_COMMITS) {
  process.stderr.write(
    `${rows.length} commits in ${range} — refusing to query more than ` +
      `${MAX_COMMITS}. Is the range right?\n`,
  )
  process.exit(UNVERIFIED)
}

const commits = rows.map((row) => {
  const status = ghJson(`repos/${repo}/commits/${row.sha}/status`)
  return {
    ...row,
    contexts: (status?.statuses ?? []).map((s) => ({
      context: s.context,
      state: s.state,
      targetUrl: s.target_url,
      description: s.description,
    })),
  }
})

const verdict = gradePromotion(commits)

const line = (c) => {
  const gate = gateContexts(c)
  const rendered = gate.length
    ? gate.map((g) => `${g.context}=${g.state}`).join(' ')
    : '(no Main Gate verdict)'
  return `  ${c.sha.slice(0, 9)}  ${rendered}  ${c.subject ?? ''}`
}

process.stdout.write(
  `Main Gate verdicts for ${range} (${commits.length} commit(s))\n\n`,
)
for (const c of commits) process.stdout.write(`${line(c)}\n`)
process.stdout.write(`\n${verdict.reason}\n`)

if (verdict.reds.length > 0) {
  process.stdout.write(
    `\nWARN ${verdict.reds.length} commit(s) in this range went RED at some point:\n`,
  )
  for (const red of verdict.reds) {
    for (const ctx of red.contexts) {
      process.stdout.write(
        `  ${red.commit.sha.slice(0, 9)}  ${ctx.context}  ${ctx.targetUrl ?? ''}\n`,
      )
    }
  }
  process.stdout.write(
    '\nAn ancestor red is a REPORT, not a refusal - it may have been repaired\n' +
      'by a later commit, or it may have been a flake. Read them before merging;\n' +
      'that reading is the thing whose absence let four promotions go out over\n' +
      'two unread reds on 2026-09-03.\n',
  )
}

if (verdict.code === REFUSE) {
  process.stderr.write('\nREFUSED: the tip being promoted is red.\n')
} else if (verdict.code === UNVERIFIED) {
  process.stderr.write(
    '\nNO VERDICT: Main Gate has not graded the tip. Since AGL-2534 every push\n' +
      'to `main` runs the fast gate, so this is normally a race with a very\n' +
      'recent push rather than a missing gate - re-run in a minute.\n',
  )
}
process.exit(verdict.code)
