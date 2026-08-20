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

// Self-test for the shipped-but-still-open reconciler (AGL-2036).
//
// Every fixture here is a REAL case from the 2026-08-18/19 sweep, not a
// synthesised one, because the whole point of the check is that the obvious
// implementation gets these wrong:
//
//   * `AGL-2380` was attributed from a commit that only MENTIONED it, and the
//     wrong answer survived review.
//   * `AGL-2084`'s fix landed twice under two SHAs (a rebase twin), which a
//     naive count reads as half-promoted.
//   * `AGL-2334` genuinely IS half-promoted — 2 of 3 commits in production —
//     and must not be reported as shipped.
//   * `AGL-2377` shipped a commit and left two of its three asks undone, which
//     is why the report calls its rows candidates rather than closures.
//
// This suite is pure node and runs in tools-guards.yml. That matters: the
// `check:` half needs the Linear issue list, and a guard that can only run
// with a credential nobody has set is a guard that never runs (AGL-2379).

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  attributeBySubject,
  bucketIssue,
  dedupeRebaseTwins,
  formatReport,
  issueFromSubject,
  issuesMentioned,
  overallExitCode,
  reconcile,
} from './shipped-not-closed.mjs'

describe('issueFromSubject — the mention/implementation boundary', () => {
  it('attributes a subject that ENDS in the tag', () => {
    assert.equal(
      issueFromSubject('fix(console): a GET on the audit archive reports instead of deleting (AGL-2084)'),
      'AGL-2084',
    )
  })

  it('REFUSES a subject that only mentions the issue mid-sentence', () => {
    // The AGL-2380 shape. `git log --grep` returns this commit; it is not an
    // implementation of AGL-1000 and must never be attributed to it.
    assert.equal(issueFromSubject('fix(x): follow-up to the AGL-1000 regression'), null)
  })

  it('attributes the TRAILING tag when a subject names two issues', () => {
    assert.equal(
      issueFromSubject('fix(x): follow-up to AGL-1000 (AGL-2000)'),
      'AGL-2000',
    )
  })

  it('refuses a tag followed by more words', () => {
    assert.equal(issueFromSubject('chore: revert (AGL-2000) for now'), null)
  })

  it('tolerates trailing whitespace, which git subjects carry', () => {
    assert.equal(issueFromSubject('docs: a thing (AGL-3000)   '), 'AGL-3000')
  })

  it('returns null for empty and nullish input rather than throwing', () => {
    assert.equal(issueFromSubject(''), null)
    assert.equal(issueFromSubject(undefined), null)
  })
})

describe('issuesMentioned — reporting only, never attribution', () => {
  it('finds every id and dedupes', () => {
    assert.deepEqual(
      issuesMentioned('follow-up to AGL-1000 and AGL-1000, see AGL-2000 (AGL-3000)'),
      ['AGL-1000', 'AGL-2000', 'AGL-3000'],
    )
  })
})

describe('attributeBySubject', () => {
  it('groups by the implementing issue and drops untagged commits', () => {
    const grouped = attributeBySubject([
      { sha: 'aaa', subject: 'feat: one (AGL-1)' },
      { sha: 'bbb', subject: 'feat: two (AGL-1)' },
      { sha: 'ccc', subject: 'chore: no tag at all' },
      { sha: 'ddd', subject: 'fix: mentions AGL-1 but implements (AGL-2)' },
    ])
    assert.deepEqual([...grouped.keys()], ['AGL-1', 'AGL-2'])
    assert.deepEqual(grouped.get('AGL-1').map((c) => c.sha), ['aaa', 'bbb'])
    // The mention did NOT add ddd to AGL-1. This is the assertion that fails
    // the moment somebody "helpfully" switches to a body grep.
    assert.deepEqual(grouped.get('AGL-2').map((c) => c.sha), ['ddd'])
  })
})

describe('dedupeRebaseTwins', () => {
  it('collapses two SHAs carrying the same patch into one change', () => {
    // AGL-2084's real pair: ba1633ed3 and f2666db67 share patch-id a0cc8096.
    const kept = dedupeRebaseTwins([
      { sha: 'ba1633ed3', subject: 's', patchId: 'a0cc8096', inProduction: true },
      { sha: 'f2666db67', subject: 's', patchId: 'a0cc8096', inProduction: true },
    ])
    assert.equal(kept.length, 1)
    assert.deepEqual(kept[0].twins, ['ba1633ed3', 'f2666db67'])
  })

  it('a change in production under EITHER sha counts as in production', () => {
    // Without this, a cherry-pick reads as PARTIAL and the issue is reported
    // as mid-promotion forever.
    const kept = dedupeRebaseTwins([
      { sha: 'aaa', subject: 's', patchId: 'p1', inProduction: false },
      { sha: 'bbb', subject: 's', patchId: 'p1', inProduction: true },
    ])
    assert.equal(kept.length, 1)
    assert.equal(kept[0].inProduction, true)
  })

  it('never collapses commits with no patch-id', () => {
    const kept = dedupeRebaseTwins([
      { sha: 'aaa', subject: 's' },
      { sha: 'bbb', subject: 's' },
    ])
    assert.equal(kept.length, 2)
  })

  it('does not mutate its input', () => {
    const input = [
      { sha: 'aaa', subject: 's', patchId: 'p1', inProduction: false },
      { sha: 'bbb', subject: 's', patchId: 'p1', inProduction: true },
    ]
    dedupeRebaseTwins(input)
    assert.equal(input[0].inProduction, false)
  })
})

describe('bucketIssue', () => {
  const deployed = { deployed: true }

  it('all commits in production, and production is live → shipped-not-closed', () => {
    assert.equal(
      bucketIssue({ id: 'AGL-1', commits: [{ sha: 'a', inProduction: true }] }, deployed),
      'shipped-not-closed',
    )
  })

  it('all commits in production but the deploy is unconfirmed → merged-not-deployed', () => {
    // Trap 4. Ancestry proves MERGED, never DEPLOYED.
    assert.equal(
      bucketIssue({ id: 'AGL-1', commits: [{ sha: 'a', inProduction: true }] }, { deployed: false }),
      'merged-not-deployed',
    )
  })

  it('2 of 3 in production → partial, NOT shipped', () => {
    // The AGL-2334 shape.
    assert.equal(
      bucketIssue(
        {
          id: 'AGL-2334',
          commits: [
            { sha: 'a', inProduction: true },
            { sha: 'b', inProduction: true },
            { sha: 'c', inProduction: false },
          ],
        },
        deployed,
      ),
      'partial',
    )
  })

  it('nothing in production → not-in-production', () => {
    assert.equal(
      bucketIssue({ id: 'AGL-1', commits: [{ sha: 'a', inProduction: false }] }, deployed),
      'not-in-production',
    )
  })

  it('no implementing commit at all → no-subject-commit', () => {
    assert.equal(bucketIssue({ id: 'AGL-1', commits: [] }, deployed), 'no-subject-commit')
  })
})

describe('reconcile', () => {
  const commits = [
    { sha: 'a1', subject: 'feat: shipped (AGL-100)', patchId: 'p1', inProduction: true },
    { sha: 'a2', subject: 'feat: shipped (AGL-100)', patchId: 'p1', inProduction: true },
    { sha: 'b1', subject: 'feat: half (AGL-200)', patchId: 'p2', inProduction: true },
    { sha: 'b2', subject: 'feat: half (AGL-200)', patchId: 'p3', inProduction: false },
    { sha: 'c1', subject: 'feat: pending (AGL-300)', patchId: 'p4', inProduction: false },
    { sha: 'd1', subject: 'chore: mentions AGL-400 only', patchId: 'p5', inProduction: true },
  ]
  const open = [
    { id: 'AGL-100', state: 'In Review' },
    { id: 'AGL-200', state: 'In Review' },
    { id: 'AGL-300', state: 'In Progress' },
    { id: 'AGL-400', state: 'In Review' },
  ]

  it('sorts a mixed queue into the five buckets', () => {
    const buckets = reconcile(open, commits, { deployed: true })
    assert.deepEqual(buckets['shipped-not-closed'].map((r) => r.id), ['AGL-100'])
    assert.deepEqual(buckets.partial.map((r) => r.id), ['AGL-200'])
    assert.deepEqual(buckets['not-in-production'].map((r) => r.id), ['AGL-300'])
    // AGL-400 is mentioned by a production commit and is STILL not shipped.
    assert.deepEqual(buckets['no-subject-commit'].map((r) => r.id), ['AGL-400'])
  })

  it('collapses the twin so AGL-100 shows one change, not two', () => {
    const buckets = reconcile(open, commits, { deployed: true })
    assert.equal(buckets['shipped-not-closed'][0].commits.length, 1)
  })

  it('reports nothing as shipped when the deploy is unconfirmed', () => {
    const buckets = reconcile(open, commits, { deployed: false })
    assert.equal(buckets['shipped-not-closed'].length, 0)
    assert.deepEqual(buckets['merged-not-deployed'].map((r) => r.id), ['AGL-100'])
  })

  it('an EMPTY open list yields an empty report, not a green verdict about the repo', () => {
    // The failure mode that started all this: a team-scoped query run at
    // workspace scope returns nothing, which reads as "queue is clean".
    // The check cannot tell those apart, so the CLI refuses an empty list
    // outright (exit 2) — see check-shipped-not-closed.mjs.
    const buckets = reconcile([], commits, { deployed: true })
    assert.equal(buckets['shipped-not-closed'].length, 0)
  })
})

describe('overallExitCode', () => {
  it('is 1 when anything shipped is still open', () => {
    assert.equal(overallExitCode({ 'shipped-not-closed': [{ id: 'AGL-1' }] }), 1)
  })

  it('is 0 for partial and not-in-production — healthy mid-flight states', () => {
    assert.equal(
      overallExitCode({
        'shipped-not-closed': [],
        partial: [{ id: 'AGL-2' }],
        'not-in-production': [{ id: 'AGL-3' }],
      }),
      0,
    )
  })

  it('is 0 for merged-not-deployed — a deploy in flight is not a stale status', () => {
    assert.equal(
      overallExitCode({ 'shipped-not-closed': [], 'merged-not-deployed': [{ id: 'AGL-4' }] }),
      0,
    )
  })

  it('is 0 on an empty report', () => {
    assert.equal(overallExitCode({}), 0)
  })
})

describe('formatReport', () => {
  const buckets = reconcile(
    [{ id: 'AGL-100', state: 'In Review' }],
    [{ sha: 'a1b2c3d4e5', subject: 'feat: shipped (AGL-100)', patchId: 'p1', inProduction: true }],
    { deployed: true },
  )

  it('names the issue and its commit', () => {
    const report = formatReport(buckets, { deployed: true })
    assert.match(report, /AGL-100/)
    assert.match(report, /a1b2c3d4e/)
  })

  it('always warns that a row is a candidate, never an instruction', () => {
    // Without this the report reads as a close-list, which is how a half-fix
    // gets marked Done.
    assert.match(formatReport(buckets, { deployed: true }), /CANDIDATES, not instructions/)
  })

  it('--summary omits the commit subjects but keeps the issue ids', () => {
    const report = formatReport(buckets, { summary: true, deployed: true })
    assert.match(report, /AGL-100/)
    assert.doesNotMatch(report, /a1b2c3d4e/)
  })

  it('says so loudly when the deploy was never confirmed', () => {
    assert.match(
      formatReport(buckets, { deployed: false }),
      /not confirmed to be the running build/,
    )
  })
})
