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

// The reconciliation logic behind `npm run check:shipped-not-closed`
// (AGL-2036). Pure functions only — no git, no network — so the self-test can
// pin every trap that produced a wrong answer by hand.
//
// THE PROBLEM THIS EXISTS FOR. An issue whose fix has shipped stays open
// until somebody remembers to move it. On 2026-08-18 a sweep found the
// `awaiting-smoke` label queue EMPTY, five issues labelled
// `awaiting-promotion` after they had already shipped, and ~30 more In Review
// issues whose commits were in production carrying no blocking label at all —
// invisible to every label-defined pool. A label-defined queue only holds if
// someone remembers to apply the label. THE QUEUE MUST BE DEFINED BY STATE:
// the set of issues in a started state whose implementing commits are already
// ancestors of production. That set is computable, so it should never again
// depend on memory.
//
// FOUR TRAPS, each of which produced a WRONG ANSWER during the manual sweep,
// and each of which is pinned by a test in the sibling .test.mjs:
//
//   1. BODY MENTIONS ARE NOT IMPLEMENTATIONS. `git log --grep=AGL-2380` finds
//      every commit that so much as names the issue — including the one that
//      merely cites it as prior art. Only a commit whose SUBJECT ENDS
//      `(AGL-xxxx)` implements it. Attributing by grep is what closed the
//      wrong issue on 2026-08-19.
//   2. REBASE TWINS DOUBLE-COUNT. The same change lands under two SHAs, and a
//      naive "all commits in production?" test can read one twin as shipped
//      and the other as pending, yielding a bogus PARTIAL. Collapse by
//      patch-id before bucketing.
//   3. PARTIAL IS NOT SHIPPED. An issue with three implementing commits, two
//      of them in production, is NOT done — it is mid-promotion. Closing it
//      would ship a claim ahead of the code.
//   4. ANCESTRY IS NOT DEPLOYMENT. `merge-base --is-ancestor` proves a commit
//      is MERGED into the production branch, never that the production branch
//      is what is RUNNING. The caller must pass `deployed` after checking the
//      live deployment (tools/deploy/verify-production-aliases.mjs); when it
//      is false this module refuses to call anything shipped, because a merged
//      -but-undeployed commit is exactly the false green the sweep was for.
//
// A fifth trap is not solvable here and is deliberately left to a human: a
// commit can implement HALF an issue. Ancestry proves code shipped, never that
// it finished the job. Everything this module reports is therefore a
// CANDIDATE for closure, never an instruction to close — the report says so in
// its own words, and `check-shipped-not-closed.mjs` prints it on every run.

/** Matches ONLY a subject that ends in the issue tag. See trap 1. */
const SUBJECT_TAG = /\((AGL-\d+)\)\s*$/

/** Matches the tag anywhere — used to REPORT mentions, never to attribute. */
const ANYWHERE_TAG = /\b(AGL-\d+)\b/g

/**
 * The issue a commit subject implements, or null.
 *
 * Deliberately anchored at the end of the subject. A subject like
 * `fix(x): follow-up to AGL-1000 (AGL-2000)` implements AGL-2000 and merely
 * mentions AGL-1000 — the anchor is the whole difference.
 */
export function issueFromSubject(subject) {
  const match = SUBJECT_TAG.exec(String(subject ?? '').trim())
  return match ? match[1] : null
}

/** Every issue id a commit names, in order, deduped. Reporting only. */
export function issuesMentioned(text) {
  const seen = new Set()
  for (const match of String(text ?? '').matchAll(ANYWHERE_TAG)) seen.add(match[1])
  return [...seen]
}

/**
 * Group commits by the issue their SUBJECT implements.
 *
 * @param commits `[{ sha, subject, patchId?, inProduction? }]`
 * @returns `Map<issueId, commit[]>`, insertion-ordered per issue.
 */
export function attributeBySubject(commits) {
  const byIssue = new Map()
  for (const commit of commits ?? []) {
    const id = issueFromSubject(commit?.subject)
    if (!id) continue
    if (!byIssue.has(id)) byIssue.set(id, [])
    byIssue.get(id).push(commit)
  }
  return byIssue
}

/**
 * Collapse rebase twins — commits with an identical patch-id (trap 2).
 *
 * The survivor is the one already in production when any twin is, so a
 * cherry-picked pair never reads as PARTIAL. A commit with no patchId is
 * never collapsed: an unknown identity must not be assumed equal to another.
 */
export function dedupeRebaseTwins(commits) {
  const byPatch = new Map()
  const kept = []
  for (const commit of commits ?? []) {
    const patchId = commit?.patchId
    if (!patchId) {
      kept.push(commit)
      continue
    }
    const seen = byPatch.get(patchId)
    if (!seen) {
      const copy = { ...commit }
      byPatch.set(patchId, copy)
      kept.push(copy)
      continue
    }
    // Same change, two SHAs. Production-ness is a property of the CHANGE.
    seen.inProduction = Boolean(seen.inProduction) || Boolean(commit.inProduction)
    seen.twins = [...(seen.twins ?? [seen.sha]), commit.sha]
  }
  return kept
}

/**
 * Which bucket an open issue falls in.
 *
 * @param issue `{ id, state, commits }` — `commits` already deduped.
 * @param deployed whether the production ref is the RUNNING build (trap 4).
 */
export function bucketIssue(issue, { deployed } = {}) {
  const commits = issue?.commits ?? []
  if (commits.length === 0) return 'no-subject-commit'
  const inProd = commits.filter((c) => c.inProduction).length
  if (inProd === 0) return 'not-in-production'
  if (inProd < commits.length) return 'partial'
  // Every implementing commit is an ancestor of the production ref. That is
  // only "shipped" if the production ref is also what is serving traffic.
  return deployed ? 'shipped-not-closed' : 'merged-not-deployed'
}

/**
 * Reconcile a state-defined queue against git.
 *
 * @param openIssues `[{ id, state }]` — EVERY issue in a started state, from
 *   Linear, filtered by STATE and never by label. Passing a label-filtered
 *   list reproduces the bug this check exists to catch.
 * @param commits `[{ sha, subject, patchId, inProduction }]`
 * @param options `{ deployed }`
 */
export function reconcile(openIssues, commits, { deployed = false } = {}) {
  const attributed = attributeBySubject(commits)
  const buckets = {
    'shipped-not-closed': [],
    'merged-not-deployed': [],
    partial: [],
    'not-in-production': [],
    'no-subject-commit': [],
  }
  for (const issue of openIssues ?? []) {
    const issueCommits = dedupeRebaseTwins(attributed.get(issue.id) ?? [])
    const bucket = bucketIssue({ ...issue, commits: issueCommits }, { deployed })
    buckets[bucket].push({ ...issue, commits: issueCommits })
  }
  return buckets
}

/**
 * Exit code for a reconciliation.
 *
 * 1 ONLY for `shipped-not-closed` — the one bucket that is unambiguously a
 * stale status. `partial` and `not-in-production` are healthy mid-flight
 * states, and failing on them would train everyone to ignore the check.
 *
 * `merged-not-deployed` is NOT a failure either: it means the promotion PR
 * merged and the deploy has not finished, which is a normal few minutes.
 */
export function overallExitCode(buckets) {
  return (buckets?.['shipped-not-closed']?.length ?? 0) > 0 ? 1 : 0
}

/** Human-readable report. `summary` omits the per-commit subject lines. */
export function formatReport(buckets, { summary = false, deployed = false } = {}) {
  const lines = []
  const shipped = buckets['shipped-not-closed'] ?? []
  const order = [
    ['shipped-not-closed', 'SHIPPED, STILL OPEN — every implementing commit is live'],
    ['merged-not-deployed', 'merged into production, deploy not yet confirmed'],
    ['partial', 'partially promoted — some commits are not in production'],
    ['not-in-production', 'not promoted yet'],
    ['no-subject-commit', 'no commit whose SUBJECT ends in the issue tag'],
  ]
  for (const [key, label] of order) {
    const rows = buckets[key] ?? []
    if (rows.length === 0) continue
    lines.push(`${rows.length} ${key}: ${label}`)
    if (key === 'no-subject-commit') continue
    for (const row of rows) {
      lines.push(`  ${row.id}  (${row.state})`)
      if (summary) continue
      for (const commit of row.commits) {
        const twins = commit.twins ? ` [rebase twins: ${commit.twins.join(', ')}]` : ''
        lines.push(
          `      ${commit.inProduction ? 'PROD' : 'main'} ${String(commit.sha).slice(0, 9)} ${commit.subject}${twins}`,
        )
      }
    }
  }
  if (!deployed) {
    lines.push('')
    lines.push(
      'NOTE: the production ref was not confirmed to be the running build, so nothing',
      'is reported as shipped. Run tools/deploy/verify-production-aliases.mjs and pass',
      '--deployed to get a verdict.',
    )
  }
  if (shipped.length > 0) {
    lines.push('')
    lines.push(
      'These are CANDIDATES, not instructions. Ancestry proves the code shipped; it',
      'never proves the commit finished the issue. Read each fix before closing —',
      'half-fixes are common and closing one manufactures a false claim.',
    )
  }
  return lines.join('\n')
}
