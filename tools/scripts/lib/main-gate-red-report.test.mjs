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
