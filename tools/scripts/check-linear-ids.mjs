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

// Refuses a Linear issue id that cannot exist, in a commit message or in
// source (AGL-2500). The comparator and its rationale are in
// `lib/linear-ids.mjs`; this file is the git and network half.
//
//   npm run check:linear-ids                     # source at HEAD + commits vs production
//   npm run check:linear-ids -- --worktree       # source as it is on disk (pre-commit)
//   npm run check:linear-ids -- --commits=A..B   # an explicit range
//   npm run check:linear-ids -- --message-file=.git/COMMIT_EDITMSG   # commit-msg hook
//   npm run check:linear-ids -- --self-test      # PROVE it discriminates
//   npm run check:linear-ids -- --refresh        # re-read the ceiling (needs LINEAR_API_KEY)
//
// ── WHY IT READS HEAD AND NOT THE WORKING TREE ────────────────────────────
//
// A dozen agents share this checkout, so the working tree routinely holds
// other sessions' half-finished work. A guard that reads it makes every agent
// answerable for every other agent's tree, and goes red for reasons the person
// reading the output did not cause and cannot fix — which is how a guard
// teaches people to ignore it. HEAD is the same on every checkout and in CI.
// `--worktree` is there for a pre-commit hook, where the tree IS the subject.
//
// ── EXIT CODES ────────────────────────────────────────────────────────────
//
//   0  every citation is at or below the ceiling
//   1  at least one citation names an issue that was never assigned
//   2  the check could not be made — no ceiling file, a malformed one, a bad
//      ref, or a sweep that matched nothing over a non-empty corpus
//
// 2 dominates 1 dominates 0. Cannot-check must NEVER render as clean; that is
// the entire failure mode this guard exists inside of.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  FABRICATED,
  OK,
  UNKNOWN,
  ceilingAgeDays,
  raiseCeiling,
  classifyCitation,
  formatReport,
  issueFromSubject,
  overallExitCode,
  parseCitations,
  readCeiling,
  remedy,
  sweepVerdict,
  isExemptPath,
  isForgivenCommit,
} from './lib/linear-ids.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..')
const CEILING_PATH = join(HERE, 'linear-issue-ceiling.json')
const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql'

function git(args) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
}

/** `git grep`/`git log` answer 1 for "no match", which is not an error. */
function gitAllowingNoMatch(args) {
  try {
    return git(args)
  } catch (error) {
    if (error?.status === 1) return ''
    throw error
  }
}

function parseArgs(argv) {
  const options = { source: true, commits: null, messageFile: null, worktree: false }
  for (const arg of argv) {
    if (arg === '--self-test') options.selfTest = true
    else if (arg === '--refresh') options.refresh = true
    else if (arg === '--worktree') options.worktree = true
    else if (arg === '--no-source') options.source = false
    else if (arg.startsWith('--commits=')) options.commits = arg.slice('--commits='.length)
    else if (arg.startsWith('--message-file=')) options.messageFile = arg.slice('--message-file='.length)
    else if (arg.startsWith('--')) {
      console.error(`Unknown option ${arg}`)
      process.exit(2)
    }
  }
  return options
}

/** The forgiven-commit list carried on the ceiling record, or none. */
function forgivenCommits(ceiling) {
  return ceiling?.raw?.historicalCitations?.commits ?? []
}

function loadCeiling() {
  let raw
  try {
    raw = JSON.parse(readFileSync(CEILING_PATH, 'utf8'))
  } catch (error) {
    console.error(
      `UNKNOWN — cannot read the issue ceiling at\n  ${CEILING_PATH}\n  ${error.message}\n\n` +
        'Without it nothing can be judged, so this is exit 2 and not a pass.',
    )
    process.exit(2)
  }
  const result = readCeiling(raw)
  if (!result.ok) {
    console.error(
      `UNKNOWN — the issue ceiling is unusable: ${result.reason}\n  ${CEILING_PATH}\n\n` +
        'A guard that cannot read its own baseline must not print a verdict either way.',
    )
    process.exit(2)
  }
  return result.ceiling
}

/**
 * The highest issue Linear actually has, or null (AGL-2563).
 *
 * The cached ceiling exists because, when this guard was written,
 * `LINEAR_API_KEY` was "set nowhere in this repo". That is no longer true — it
 * is a repo secret, used by Main Gate's notifier. So in CI the guard can ask
 * the authority instead of trusting a copy someone has to remember to bump,
 * which is what made THREE of the last eight Main Gate reds fire on issues
 * that existed perfectly well.
 *
 * Distinct from `--refresh`: nothing is written. The number is used for this
 * run only, so the file is still only ever edited by a human who looked.
 *
 * Fails SOFT in every direction — no key, a timeout, an HTTP error, a shape
 * that is not a positive integer all return null and leave the cache in
 * charge. A guard that went red because Linear was slow would be worse than
 * the staleness it is fixing.
 */
async function liveHighest() {
  const apiKey = (process.env['LINEAR_API_KEY'] ?? '').trim()
  if (!apiKey) return null
  const query = `
    query HighestIssue {
      issues(first: 1, filter: { team: { key: { eq: "AGL" } } }, orderBy: createdAt) {
        nodes { number }
      }
    }`
  try {
    const response = await fetch(LINEAR_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: apiKey },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return null
    const body = await response.json()
    if (body.errors) return null
    const number = body?.data?.issues?.nodes?.[0]?.number
    return Number.isInteger(number) && number > 0 ? number : null
  } catch {
    return null
  }
}

// ── THE SWEEPS ────────────────────────────────────────────────────────────

/** Every `AGL-nnnn` in tracked source, with the file and line that carries it. */
function sourceSweep(ceiling, { worktree }) {
  // ⚠️ `git grep`, never plain `grep`. The shell `grep` on this machine is
  // ugrep with `--ignore-files`, so it honours .gitignore and answers ZERO for
  // tracked files that are ignored by pattern — a silent false clean.
  //
  // ⚠️ AND NO `\b` HERE. `git grep -E` is POSIX ERE, which has no `\b`: the
  // pattern compiles, matches NOTHING, and exits 1 exactly as it would over a
  // clean tree. That is not hypothetical — the first version of this sweep
  // used `\b` and reported zero citations across 18,245 files, and the only
  // reason it was caught is the positive control below refusing to call that
  // clean. The guard's own defence caught the guard.
  //
  // So git grep is a COARSE pre-filter and nothing more. The precise word
  // boundary is applied by `parseCitations`, in JS, where `\b` means what it
  // says and where the unit tests can reach it. Over-matching here is free;
  // under-matching is the failure mode.
  const target = worktree ? [] : ['HEAD']
  const output = gitAllowingNoMatch([
    'grep', '--no-color', '-n', '-I', '-E', 'AGL-[0-9]+', ...target, '--', '.',
  ])

  const fabricated = []
  let scanned = 0
  for (const line of output.split('\n')) {
    if (!line) continue
    // `HEAD:path:line:text` with a rev, `path:line:text` without one.
    const body = worktree ? line : line.replace(/^HEAD:/, '')
    const firstColon = body.indexOf(':')
    const secondColon = body.indexOf(':', firstColon + 1)
    if (firstColon < 0 || secondColon < 0) continue
    const file = body.slice(0, firstColon)
    // Files ABOUT the fabricated ids, not citing them. See NOT_A_CITATION.
    if (isExemptPath(file)) continue
    const lineNo = body.slice(firstColon + 1, secondColon)
    const text = body.slice(secondColon + 1)
    for (const citation of parseCitations(text)) {
      scanned += 1
      if (classifyCitation(citation, ceiling.highest) !== FABRICATED) continue
      fabricated.push({ ...citation, where: `${file}:${lineNo}` })
    }
  }

  // THE POSITIVE CONTROL. `corpusSize` is the number of tracked files, counted
  // by a DIFFERENT git command than the one that produced the citations. If
  // the tree has thousands of files and the sweep examined zero citations, the
  // search broke — this repo cites issues in comments everywhere — and that
  // must read as UNKNOWN rather than as a clean tree.
  const trackedFiles = gitAllowingNoMatch(['ls-files']).split('\n').filter(Boolean).length

  return sweepVerdict({
    fabricated,
    scanned,
    corpusSize: trackedFiles,
    ceiling: ceiling.highest,
    name: worktree ? 'source (working tree)' : 'source (HEAD)',
  })
}

/** Every citation in the commit messages of a range. */
function commitSweep(ceiling, range, forgiven = []) {
  let log
  try {
    log = gitAllowingNoMatch(['log', '--format=%H%x1f%s%x1f%b%x1e', range])
  } catch (error) {
    return {
      name: `commits (${range})`,
      state: UNKNOWN,
      scanned: 0,
      corpusSize: 0,
      fabricated: [],
      detail: `the range could not be read: ${error.message.split('\n')[0]}`,
    }
  }

  const records = log.split('\x1e').map((one) => one.trim()).filter(Boolean)
  const fabricated = []
  let scanned = 0
  let forgivenSeen = 0
  for (const record of records) {
    const [sha, subject, body] = record.split('\x1f')
    // A commit whose message is already on `main` and cannot be corrected
    // without rewriting history. Counted, never silently skipped — a guard
    // that forgives without saying so reads exactly like one that found
    // nothing.
    if (isForgivenCommit(sha, forgiven)) {
      forgivenSeen += 1
      continue
    }
    const tagged = issueFromSubject(subject)
    for (const citation of parseCitations(`${subject}\n${body ?? ''}`)) {
      scanned += 1
      if (classifyCitation(citation, ceiling.highest) !== FABRICATED) continue
      const how = tagged === citation.id ? 'subject tag' : 'mentioned'
      fabricated.push({ ...citation, where: `${sha.slice(0, 9)} (${how}) ${subject}` })
    }
  }

  // ⚠️ NO positive control on citation count here, deliberately. A commit is
  // not obliged to cite an issue, so a range of ten commits citing nothing is
  // a legitimate clean result — unlike the source tree, where zero citations
  // across thousands of files could only mean the search broke. `corpusSize`
  // is therefore passed as 0: an empty range proves nothing and is not
  // pretended to.
  const verdict = sweepVerdict({
    fabricated,
    scanned,
    corpusSize: 0,
    ceiling: ceiling.highest,
    name: `commits (${range})`,
  })
  const forgivenNote =
    forgivenSeen > 0
      ? `, ${forgivenSeen} historical commit(s) forgiven (see historicalCitations in the ceiling file)`
      : ''
  return {
    ...verdict,
    detail: `${records.length} commit(s), ${scanned} citation(s)${forgivenNote} — ${verdict.detail}`,
  }
}

/** One commit message on disk, for a `commit-msg` hook. */
function messageSweep(ceiling, path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    return {
      name: `message (${path})`,
      state: UNKNOWN, scanned: 0, corpusSize: 0, fabricated: [],
      detail: `could not be read: ${error.message}`,
    }
  }
  const all = parseCitations(text)
  const fabricated = all
    .filter((one) => classifyCitation(one, ceiling.highest) === FABRICATED)
    .map((one) => ({ ...one, where: path }))
  return {
    name: `message (${relative(REPO_ROOT, path)})`,
    state: fabricated.length > 0 ? FABRICATED : OK,
    scanned: all.length,
    corpusSize: all.length,
    fabricated,
    detail: `${all.length} citation(s) checked`,
  }
}

// ── THE DISCRIMINATION PROOF ──────────────────────────────────────────────

/**
 * Prove the guard says different things about a real id and a fabricated one.
 *
 * ⚠️ This is not decoration. A validator whose pattern matches nothing calls
 * every corpus clean and looks identical to one that works, and this repo has
 * shipped that exact shape more than once. So the guard carries an executable
 * demonstration that it separates the two cases, pinned to real ids: AGL-305
 * and AGL-2499 exist, AGL-2508 and AGL-2521 are two of the fourteen that
 * never did.
 */
function selfTest(ceiling) {
  const cases = [
    { id: 'AGL-305', want: OK, why: 'exists — Discounts engine v2' },
    { id: 'AGL-96', want: OK, why: 'exists — Commerce v2 coupons' },
    { id: `AGL-${ceiling.highest}`, want: OK, why: 'exists — the ceiling itself' },
    { id: `AGL-${ceiling.highest + 1}`, want: FABRICATED, why: 'one past the ceiling' },
    { id: `AGL-${ceiling.highest + 41}`, want: FABRICATED, why: 'well past the ceiling' },
    { id: 'AGL-9999', want: FABRICATED, why: 'fabricated — far past the ceiling' },
    // AGL-2508 and AGL-2521 used to sit here as the two ids a session actually
    // hallucinated. They were correct fixtures on the day they were written and
    // WRONG by the time the workspace reached AGL-2522: a number that was
    // fabricated in August is a real issue in September, so the case asserted
    // FABRICATED against an id that now exists and the proof failed on `main`
    // for reasons no commit caused (AGL-2563).
    //
    // Anything pinned BELOW a rising ceiling expires. Every fabricated fixture
    // is therefore derived from the ceiling, which cannot go stale, and the
    // historical pair is covered by `FABRICATED_IDS` in the unit suite where
    // the ceiling is a fixed 2500 and they stay fabricated forever.
  ]

  console.log(`Discrimination proof against ceiling AGL-${ceiling.highest}:\n`)
  let failures = 0
  for (const one of cases) {
    const [citation] = parseCitations(one.id)
    const got = classifyCitation(citation, ceiling.highest)
    const pass = got === one.want
    if (!pass) failures += 1
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${one.id.padEnd(10)} → ${got.padEnd(11)} (want ${one.want}) — ${one.why}`)
  }

  // A parser that matched nothing would report every case above as UNKNOWN and
  // could still be read as "no failures" by a careless eye, so assert the
  // separation itself: both verdicts must actually occur.
  const verdicts = new Set(cases.map((one) => classifyCitation(parseCitations(one.id)[0], ceiling.highest)))
  const discriminates = verdicts.has(OK) && verdicts.has(FABRICATED)
  console.log(`\n  ${discriminates ? 'PASS' : 'FAIL'}  the classifier produced BOTH verdicts, so it is not matching everything or nothing`)

  if (failures > 0 || !discriminates) {
    console.error('\nSELF-TEST FAILED — this guard cannot be trusted to discriminate.')
    return 2
  }
  console.log('\nSelf-test passed.')
  return 0
}

// ── REFRESH ───────────────────────────────────────────────────────────────

/**
 * Re-read the highest issue from Linear and rewrite the ceiling.
 *
 * The seam for the day `LINEAR_API_KEY` is set. Deliberately a SEPARATE,
 * explicit command rather than something the check does on its own: a guard
 * that silently refreshes its own baseline is a guard that ratifies whatever
 * it just found, which is the `--write` laundering path (AGL-2486).
 */
async function refresh(ceiling) {
  const apiKey = (process.env['LINEAR_API_KEY'] ?? '').trim()
  if (!apiKey) {
    console.error(
      'LINEAR_API_KEY is not set, so --refresh cannot run.\n\n' +
        'That key is set nowhere in this repo, which is WHY this guard uses a\n' +
        'cached ceiling rather than a live query. To refresh by hand: list the\n' +
        'Aglyn team newest-first with includeArchived: true, take the highest\n' +
        `identifier, and edit\n  ${CEILING_PATH}`,
    )
    return 2
  }
  // Ordered by creation, newest first, scoped to the team — an unscoped query
  // returns nothing and would read as "ceiling 0" rather than "wrong query".
  const query = `
    query HighestIssue {
      issues(first: 1, filter: { team: { key: { eq: "AGL" } } }, orderBy: createdAt) {
        nodes { identifier number }
      }
    }`
  const response = await fetch(LINEAR_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: apiKey },
    body: JSON.stringify({ query }),
  })
  if (!response.ok) {
    console.error(`Linear responded ${response.status} — ceiling left untouched.`)
    return 2
  }
  const body = await response.json()
  if (body.errors) {
    console.error(`Linear: ${JSON.stringify(body.errors)} — ceiling left untouched.`)
    return 2
  }
  const node = body.data?.issues?.nodes?.[0]
  if (!node?.number) {
    console.error('Linear returned no issue — ceiling left untouched, since 0 would disarm the guard.')
    return 2
  }
  if (node.number < ceiling.highest) {
    console.error(
      `Linear reports AGL-${node.number} as highest, BELOW the recorded ceiling ` +
        `AGL-${ceiling.highest}. Refusing to lower it automatically — that is either a ` +
        'wrong query or a deleted issue, and both need a human.',
    )
    return 2
  }
  const next = {
    team: 'AGL',
    highest: node.number,
    verifiedAt: new Date().toISOString().slice(0, 10),
    verifiedBy: 'npm run check:linear-ids -- --refresh',
  }
  writeFileSync(CEILING_PATH, `${JSON.stringify(next, null, 2)}\n`)
  console.log(`Ceiling refreshed to AGL-${next.highest} (${next.verifiedAt}).`)
  return 0
}

// ── MAIN ──────────────────────────────────────────────────────────────────

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const cached = loadCeiling()

  if (options.selfTest) process.exit(selfTest(cached))
  if (options.refresh) process.exit(await refresh(cached))

  // Linear can only ever RAISE the cached number, so this can remove a false
  // red and never create one (AGL-2563).
  const { ceiling, source } = raiseCeiling(cached, await liveHighest())
  if (ceiling.highest !== cached.highest) {
    console.log(`Ceiling read from Linear: ${source}`)
  }

  const sweeps = []

  if (options.messageFile) sweeps.push(messageSweep(ceiling, options.messageFile))

  if (options.source) sweeps.push(sourceSweep(ceiling, { worktree: options.worktree }))

  // The commit range. `production` is the natural floor — everything above it
  // is unreleased and still cheap to correct. When neither ref resolves the
  // sweep is SKIPPED LOUDLY rather than silently omitted.
  if (!options.messageFile) {
    const range =
      options.commits ??
      ['production', 'origin/production'].find((ref) => {
        try {
          git(['rev-parse', '--verify', '--quiet', ref])
          return true
        } catch {
          return false
        }
      })
    if (range) sweeps.push(commitSweep(ceiling, options.commits ? range : `${range}..HEAD`, forgivenCommits(ceiling)))
    else
      sweeps.push({
        name: 'commits',
        state: UNKNOWN, scanned: 0, corpusSize: 0, fabricated: [],
        detail:
          'neither `production` nor `origin/production` resolves, so no commit range ' +
          'could be derived. Pass --commits=<range>. (Reported rather than skipped: a ' +
          'sweep that quietly did not run is the failure this guard is about.)',
      })
  }

  const ageDays = ceilingAgeDays(ceiling, Date.now())
  console.log(formatReport(sweeps, { ceiling, ageDays, ceilingPath: CEILING_PATH }))

  const code = overallExitCode(sweeps)
  if (code === 1) console.log(remedy(CEILING_PATH, ceiling))
  if (code === 2)
    console.log(
      '\nUNKNOWN — this run did not establish that the citations are sound. ' +
        'Treated as a failure on purpose: a check that could not run must not print the ' +
        'same green as one that ran and found nothing.',
    )
  process.exit(code)
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
