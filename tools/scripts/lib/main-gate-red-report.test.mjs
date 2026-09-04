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
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  failedJobs,
  redCommentBody,
  redMarker,
  shouldPingSlack,
  shouldReport,
  sinkAlreadyCarries,
  slackPayload,
} from './main-gate-red-report.mjs'

const at = new Date('2026-09-03T04:18:00.000Z')

test('a green run reports nothing', () => {
  assert.equal(shouldReport({ fast: 'success', full: 'success' }), false)
})

test('a SKIPPED full is not a failure - it is skipped on every push by design', () => {
  // `full` runs only on the hourly cron, so treating skipped as red would post
  // on every green push and the sink would be muted within a day.
  assert.equal(shouldReport({ fast: 'success', full: 'skipped' }), false)
  assert.equal(shouldReport({ fast: 'success', full: 'cancelled' }), false)
})

test('a failing job reports, and names which', () => {
  assert.equal(shouldReport({ fast: 'success', full: 'failure' }), true)
  assert.deepEqual(failedJobs({ fast: 'success', full: 'failure' }), ['full'])
  assert.deepEqual(failedJobs({ fast: 'failure', full: 'failure' }), ['fast', 'full'])
})

test('THE OBSERVED REDS: both overnight failures are reportable', () => {
  // be2165a60 failed `full`; 7aea3d373 failed `fast`. Neither reached anyone.
  assert.equal(shouldReport({ fast: 'success', full: 'failure' }), true)
  assert.equal(shouldReport({ fast: 'failure', full: 'skipped' }), true)
})

test('the same red on the same sha produces the SAME marker', () => {
  const a = redMarker({ sha: 'be2165a60', results: { fast: 'success', full: 'failure' } })
  const b = redMarker({ sha: 'be2165a60', results: { fast: 'success', full: 'failure' } })
  assert.equal(a, b)
})

test('a DIFFERENT failing set on the same sha is new information', () => {
  // Otherwise a sha that starts failing `fast` too would be silently swallowed.
  const one = redMarker({ sha: 'be2165a60', results: { fast: 'success', full: 'failure' } })
  const two = redMarker({ sha: 'be2165a60', results: { fast: 'failure', full: 'failure' } })
  assert.notEqual(one, two)
})

test('a different sha with the same failing set is also new', () => {
  const one = redMarker({ sha: 'aaaaaaaaa', results: { full: 'failure' } })
  const two = redMarker({ sha: 'bbbbbbbbb', results: { full: 'failure' } })
  assert.notEqual(one, two)
})

test('the body carries the marker, the sha, the jobs and the run', () => {
  const body = redCommentBody({
    sha: 'be2165a60f00',
    results: { fast: 'success', full: 'failure' },
    runUrl: 'https://github.com/aglyn/aglyn/actions/runs/33714554537',
    subject: 'fix(monitoring): a comment fix',
    when: at,
  })
  assert.match(body, /^<!-- main-gate-red:[0-9a-f]{12} -->/)
  assert.match(body, /RED on `be2165a60`/)
  assert.match(body, /main-gate\/full` FAILED - tests \+ production builds/)
  assert.match(body, /actions\/runs\/33714554537/)
  assert.match(body, /2026-09-03T04:18:00\.000Z/)
  // The job that PASSED must not be listed as failing.
  assert.equal(/main-gate\/fast` FAILED/.test(body), false)
})

test('the marker in the body matches the standalone marker', () => {
  // The poster checks existing comments for the marker it is about to write;
  // if these two ever diverged, every red would post forever.
  const args = { sha: 'ccccccccc', results: { fast: 'failure' }, when: at }
  assert.ok(redCommentBody(args).startsWith(redMarker(args)))
})

test('a missing run url or subject degrades rather than printing undefined', () => {
  const body = redCommentBody({ sha: 'ddddddddd', results: { fast: 'failure' }, when: at })
  assert.equal(/undefined|null/.test(body), false)
})

test('Slack is pinged for a new red and NOT for a duplicate', () => {
  // Linear is the dedupe oracle: a webhook post is unconditional, and the gate
  // can grade one red sha more than once (a push run plus an hourly cron run).
  assert.equal(shouldPingSlack('posted'), true)
  assert.equal(shouldPingSlack('duplicate'), false)
})

test('Slack is pinged FAIL-OPEN when Linear could not answer', () => {
  // A duplicate is visible and annoying; a miss is silent, and silence is the
  // whole subject of AGL-2533.
  assert.equal(shouldPingSlack('unavailable'), true)
})

test('the Slack payload sets `text`, not blocks alone', () => {
  // `text` is what Slack shows in the notification and in clients that cannot
  // render blocks. A blocks-only payload pushes "This content can't be
  // displayed" into exactly the phone alert this exists to send.
  const p = slackPayload({
    sha: 'be2165a60f00',
    results: { fast: 'success', full: 'failure' },
    runUrl: 'https://github.com/aglyn/aglyn/actions/runs/1',
    subject: 'fix(x): a thing',
  })
  assert.equal(typeof p.text, 'string')
  assert.ok(p.text.length > 0)
  assert.match(p.text, /RED on be2165a60/)
  assert.match(p.text, /main-gate\/full/)
  assert.ok(Array.isArray(p.blocks) && p.blocks.length > 0)
})

test('the Slack payload names only the jobs that failed', () => {
  const p = slackPayload({ sha: 'ccccccccc', results: { fast: 'success', full: 'failure' } })
  assert.equal(/main-gate\/fast/.test(JSON.stringify(p)), false)
  assert.match(JSON.stringify(p), /main-gate\/full/)
})

test('the Slack payload degrades without a run url or subject', () => {
  const p = slackPayload({ sha: 'ddddddddd', results: { fast: 'failure' } })
  assert.equal(/undefined|null/.test(JSON.stringify(p)), false)
})

// --- the sweep-due blind spot (AGL-2552) -----------------------------------

test('a failed sweep-due IS a red — otherwise the sweep stops silently', () => {
  // The bug this covers: `full` needs `sweep-due`, so a failed `sweep-due`
  // leaves `full` skipped. A skipped `full` is not a failure, so the reporter
  // said "nothing to report" while the sweep quietly stopped running.
  assert.equal(shouldReport({ fast: 'success', full: 'skipped', sweepDue: 'failure' }), true)
  assert.deepEqual(failedJobs({ fast: 'success', full: 'skipped', sweepDue: 'failure' }), ['sweepDue'])
})

test('a green sweep-due with a skipped full is still silent', () => {
  // The overwhelmingly common push: the sweep was asked, said "not due", and
  // `full` was skipped on purpose. That must stay quiet.
  assert.equal(shouldReport({ fast: 'success', full: 'skipped', sweepDue: 'success' }), false)
})

test('a skipped sweep-due is not a failure', () => {
  assert.equal(shouldReport({ fast: 'success', full: 'skipped', sweepDue: 'skipped' }), false)
})

test('the alert names sweep-due by its job, not by a status context that does not exist', () => {
  const body = redCommentBody({
    sha: 'abc123def456',
    results: { fast: 'success', full: 'skipped', sweepDue: 'failure' },
  })
  assert.match(body, /is the full sweep due/)
  assert.doesNotMatch(body, /main-gate\/sweepDue/)
  assert.match(body, /NOT running on pushes/)
})

test('fast and full are still named by their commit-status contexts', () => {
  const body = redCommentBody({ sha: 'abc123def456', results: { fast: 'failure', full: 'failure' } })
  assert.match(body, /`main-gate\/fast`/)
  assert.match(body, /`main-gate\/full`/)
})

test('sweep-due failing alongside fast is one red naming both', () => {
  assert.deepEqual(
    failedJobs({ fast: 'failure', full: 'skipped', sweepDue: 'failure' }),
    ['fast', 'sweepDue'],
  )
})

test('a sweep-due red does not claim `main` is broken', () => {
  const body = redCommentBody({ sha: 'abc123def456', results: { fast: 'success', full: 'skipped', sweepDue: 'failure' } })
  assert.match(body, /not known to be broken/)
  assert.doesNotMatch(body, /`main` is broken until/)
})

test('a real job red still says `main` is broken', () => {
  const body = redCommentBody({ sha: 'abc123def456', results: { fast: 'failure', sweepDue: 'failure' } })
  assert.match(body, /`main` is broken until/)
})

/*==========================================
 * THE DEDUPE WALK
 *
 * The sink is append-only and keeps one comment per distinct red forever, so a
 * scan bounded to one page is a date after which idempotency silently stops
 * working. These pin the walk to the whole history.
 *========================================*/

/** A comment history cut into pages, served the way Linear serves them. */
const paged = (bodies, size = 100) => {
  const pages = []
  for (let i = 0; i < bodies.length; i += size) pages.push(bodies.slice(i, i + size))
  if (pages.length === 0) pages.push([])
  const calls = []
  const query = async (after) => {
    const index = after === null || after === undefined ? 0 : Number(after)
    calls.push(index)
    return {
      nodes: pages[index].map((body) => ({ body })),
      pageInfo: { hasNextPage: index + 1 < pages.length, endCursor: String(index + 1) },
    }
  }
  return { query, calls }
}

const walkMarker = redMarker({ sha: 'be2165a60', results: { fast: 'failure' } })

test('the walk finds a marker on the first page', async () => {
  const { query, calls } = paged(['noise', `${walkMarker}\n\nred`])
  assert.equal(await sinkAlreadyCarries({ query, marker: walkMarker }), true)
  assert.deepEqual(calls, [0])
})

test('THE BUG: a marker beyond the first page is still found', async () => {
  // 250 comments is about ten weeks of this sink at the rate 2026-09-03 set.
  // Bounded to one page the scan answers "no", and the gate reposts a red it
  // has already reported - invisibly, because a double-post looks exactly like
  // two reds.
  const bodies = Array.from({ length: 250 }, (_, i) => `old red ${i}`)
  bodies.push(`${walkMarker}\n\nthe red we are grading again`)
  const { query, calls } = paged(bodies)
  assert.equal(await sinkAlreadyCarries({ query, marker: walkMarker }), true)
  assert.ok(calls.length > 1, 'the walk must page rather than read only the first page')
})

test('an absent marker answers no after exhausting the history', async () => {
  const { query } = paged(Array.from({ length: 250 }, (_, i) => `old red ${i}`))
  assert.equal(await sinkAlreadyCarries({ query, marker: walkMarker }), false)
})

test('the walk stops at maxPages and FAILS OPEN', async () => {
  // A duplicate comment is visible and annoying; a swallowed red is silent.
  const { query, calls } = paged(
    Array.from({ length: 1000 }, () => 'old red'),
    10,
  )
  assert.equal(await sinkAlreadyCarries({ query, marker: walkMarker, maxPages: 3 }), false)
  assert.equal(calls.length, 3)
})

test('a page Linear could not answer for fails open rather than throwing', async () => {
  const empty = async () => null
  assert.equal(await sinkAlreadyCarries({ query: empty, marker: walkMarker }), false)
  const noPageInfo = async () => ({ nodes: [{ body: 'unrelated' }] })
  assert.equal(await sinkAlreadyCarries({ query: noPageInfo, marker: walkMarker }), false)
  const nullNodes = async () => ({ nodes: null, pageInfo: null })
  assert.equal(await sinkAlreadyCarries({ query: nullNodes, marker: walkMarker }), false)
})

test('a comment with no body does not crash the walk', async () => {
  const query = async () => ({
    nodes: [{}, { body: null }, { body: walkMarker }],
    pageInfo: null,
  })
  assert.equal(await sinkAlreadyCarries({ query, marker: walkMarker }), true)
})

test('an already-fetched first page is reused rather than re-requested', async () => {
  // The script takes page one and the issue id from a single request; asking
  // again would double every report job's Linear traffic for nothing.
  const { query, calls } = paged(['unrelated', `${walkMarker}\n\nred`])
  const firstPage = await query(null)
  calls.length = 0
  assert.equal(await sinkAlreadyCarries({ query, marker: walkMarker, firstPage }), true)
  assert.deepEqual(calls, [])
})

test('a DIFFERENT red on the same sha is not mistaken for this one', async () => {
  const other = redMarker({ sha: 'be2165a60', results: { fast: 'failure', full: 'failure' } })
  const { query } = paged([`${other}\n\na different failing set`])
  assert.equal(await sinkAlreadyCarries({ query, marker: walkMarker }), false)
})
