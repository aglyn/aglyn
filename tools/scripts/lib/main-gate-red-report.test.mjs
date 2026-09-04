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
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import {
  REPORTED_CONTEXT_PREFIX,
  alreadyReported,
  failedJobs,
  redDigest,
  reportedContext,
  shouldReport,
  slackPayload,
  statusDescription,
} from './main-gate-red-report.mjs'
import { gateContexts } from './main-gate-verdicts.mjs'

/* ========================================================================= *
 * RED ONLY — greens must post nothing and touch no network.
 * ========================================================================= */

test('a green run reports nothing', () => {
  assert.equal(shouldReport({ fast: 'success', full: 'success' }), false)
})

test('a SKIPPED full is not a failure - it is skipped on every push by design', () => {
  // `full` runs only on the hourly cron, so treating skipped as red would alert
  // on every green push and the channel would be muted within a day.
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

/* ========================================================================= *
 * THE DIGEST — the idempotency key.
 * ========================================================================= */

test('the same red on the same sha produces the SAME digest', () => {
  const a = redDigest({ sha: 'be2165a60', results: { fast: 'success', full: 'failure' } })
  const b = redDigest({ sha: 'be2165a60', results: { fast: 'success', full: 'failure' } })
  assert.equal(a, b)
})

test('a DIFFERENT failing set on the same sha is new information', () => {
  // Otherwise a sha that starts failing `fast` too would be silently swallowed.
  const one = redDigest({ sha: 'be2165a60', results: { fast: 'success', full: 'failure' } })
  const two = redDigest({ sha: 'be2165a60', results: { fast: 'failure', full: 'failure' } })
  assert.notEqual(one, two)
})

test('a different sha with the same failing set is also new', () => {
  const one = redDigest({ sha: 'aaaaaaaaa', results: { full: 'failure' } })
  const two = redDigest({ sha: 'bbbbbbbbb', results: { full: 'failure' } })
  assert.notEqual(one, two)
})

/* ========================================================================= *
 * THE DEDUPE ORACLE — a per-sha commit status.
 * ========================================================================= */

test('the reported context is namespaced and carries the digest', () => {
  const args = { sha: 'be2165a60', results: { fast: 'failure' } }
  const context = reportedContext(args)
  assert.ok(context.startsWith(REPORTED_CONTEXT_PREFIX))
  assert.ok(context.endsWith(redDigest(args)))
  assert.match(context, /^main-gate-notify\/red-reported-[0-9a-f]{12}$/)
})

test('⛔ the dedupe context is NOT a Main Gate VERDICT context', () => {
  // The regression this guards: `gateContexts()` selects a sha's gate verdicts
  // by matching the `main-gate/` prefix. Filing the dedupe record under that
  // prefix would make the `Promotion verdict` check count bookkeeping as a
  // verdict — and a sha whose `fast` job skipped and whose only failure was
  // `sweep-due` writes NO verdict status at all, so the promotion would grade
  // an ungated tip as OK instead of reporting that it was never gated.
  const context = reportedContext({ sha: 'be2165a60', results: { sweepDue: 'failure' } })
  assert.equal(context.startsWith('main-gate/'), false)
  assert.deepEqual(gateContexts({ contexts: [{ context, state: 'success' }] }), [])
})

test('a real gate verdict is still matched, so the guard above is not vacuous', () => {
  assert.equal(gateContexts({ contexts: [{ context: 'main-gate/fast', state: 'failure' }] }).length, 1)
})

test('a sha carrying this exact red is a duplicate', () => {
  const args = { sha: 'be2165a60', results: { fast: 'failure' } }
  const context = reportedContext(args)
  assert.equal(alreadyReported({ statuses: [{ context, state: 'success' }], context }), true)
})

test('a sha carrying a DIFFERENT red is not a duplicate', () => {
  const context = reportedContext({ sha: 'be2165a60', results: { fast: 'failure' } })
  const other = reportedContext({ sha: 'be2165a60', results: { fast: 'failure', full: 'failure' } })
  assert.equal(alreadyReported({ statuses: [{ context: other, state: 'success' }], context }), false)
})

test('the gate VERDICT statuses on the sha never read as a dedupe record', () => {
  // A red sha always carries `main-gate/fast` or `main-gate/full`. If those
  // satisfied the dedupe, the very first red would suppress its own alert.
  const context = reportedContext({ sha: 'be2165a60', results: { fast: 'failure' } })
  const statuses = [
    { context: 'main-gate/fast', state: 'failure' },
    { context: 'main-gate/full', state: 'success' },
  ]
  assert.equal(alreadyReported({ statuses, context }), false)
})

test('the dedupe FAILS OPEN on anything uncertain', () => {
  // A duplicate is visible and annoying; a miss is silent, and silence is the
  // whole subject of AGL-2533.
  const context = reportedContext({ sha: 'be2165a60', results: { fast: 'failure' } })
  assert.equal(alreadyReported({ statuses: undefined, context }), false)
  assert.equal(alreadyReported({ statuses: null, context }), false)
  assert.equal(alreadyReported({ statuses: 'not an array', context }), false)
  assert.equal(alreadyReported({ statuses: [null, undefined, {}], context }), false)
  // A pending or failed record is not proof the alert was delivered.
  assert.equal(alreadyReported({ statuses: [{ context, state: 'pending' }], context }), false)
  assert.equal(alreadyReported({ statuses: [{ context, state: 'failure' }], context }), false)
})

test('the status description says what it is, in the 140 chars GitHub allows', () => {
  const d = statusDescription({ fast: 'failure', full: 'failure', sweepDue: 'failure' })
  assert.match(d, /fast, full, sweepDue/)
  assert.ok(d.length <= 140)
})

/* ========================================================================= *
 * THE SLACK PAYLOAD — the only channel there is.
 * ========================================================================= */

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
  assert.ok(Array.isArray(p.blocks) && p.blocks.length > 0)
})

test('the alert carries the sha, the failing job and the run', () => {
  const p = slackPayload({
    sha: 'be2165a60f00',
    results: { fast: 'success', full: 'failure' },
    runUrl: 'https://github.com/aglyn/aglyn/actions/runs/33714554537',
    subject: 'fix(monitoring): a comment fix',
  })
  const json = JSON.stringify(p)
  assert.match(json, /be2165a60/)
  assert.match(json, /main-gate\/full` failed/)
  assert.match(json, /tests \+ production builds/)
  assert.match(json, /actions\/runs\/33714554537/)
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

/* ========================================================================= *
 * THE SWEEP-DUE BLIND SPOT (AGL-2552) and its wording (AGL-2550).
 * ========================================================================= */

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
  const json = JSON.stringify(
    slackPayload({ sha: 'abc123def456', results: { fast: 'success', full: 'skipped', sweepDue: 'failure' } }),
  )
  assert.match(json, /is the full sweep due/)
  assert.doesNotMatch(json, /main-gate\/sweepDue/)
  assert.match(json, /NOT running on pushes/)
})

test('fast and full are still named by their commit-status contexts', () => {
  const json = JSON.stringify(slackPayload({ sha: 'abc123def456', results: { fast: 'failure', full: 'failure' } }))
  assert.match(json, /main-gate\/fast/)
  assert.match(json, /main-gate\/full/)
})

test('sweep-due failing alongside fast is one red naming both', () => {
  assert.deepEqual(failedJobs({ fast: 'failure', full: 'skipped', sweepDue: 'failure' }), ['fast', 'sweepDue'])
})

test('a sweep-due red does not claim `main` is broken', () => {
  // AGL-2550: an alert that overstates sends the reader hunting for a break
  // that does not exist. The retired Linear body got this right and the Slack
  // payload did not, which mattered the moment Slack became the only channel.
  const json = JSON.stringify(
    slackPayload({ sha: 'abc123def456', results: { fast: 'success', full: 'skipped', sweepDue: 'failure' } }),
  )
  assert.match(json, /not known to be broken/)
  assert.doesNotMatch(json, /`main` is broken until/)
  assert.doesNotMatch(json, /Main Gate is RED/)
})

test('a real job red still says `main` is broken', () => {
  const json = JSON.stringify(slackPayload({ sha: 'abc123def456', results: { fast: 'failure', sweepDue: 'failure' } }))
  assert.match(json, /`main` is broken until/)
  assert.match(json, /Main Gate is RED/)
})

/* ========================================================================= *
 * END TO END, through the real script.
 *
 * The dedupe is the whole reason this refactor exists, so it is proven by
 * RUNNING the reporter — twice, against a stub commit-status API and a stub
 * Slack webhook — rather than by asserting on the pure function it calls. The
 * script reaches both stubs through `GITHUB_API_URL` and `SLACK_WEBHOOK_URL`,
 * which is exactly how it reaches the real ones.
 * ========================================================================= */

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'report-main-gate-red.mjs')
const run = promisify(execFile)

/**
 * A stand-in for GitHub's commit statuses and for Slack.
 *
 * `statuses` persists across requests, so a POST from one reporter run is
 * visible to the GET of the next — which is what makes a two-run dedupe test
 * mean anything.
 */
async function stubs({ readFails = false, writeFails = false, slackFails = false } = {}) {
  const state = { statuses: [], slackPosts: [], reads: 0, writes: 0 }
  const server = createServer((req, res) => {
    const body = []
    req.on('data', (c) => body.push(c))
    req.on('end', () => {
      const payload = Buffer.concat(body).toString('utf8')
      const send = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json' })
        res.end(JSON.stringify(obj))
      }
      if (req.url.startsWith('/slack')) {
        if (slackFails) return send(500, { ok: false })
        state.slackPosts.push(JSON.parse(payload))
        return send(200, { ok: true })
      }
      if (req.method === 'GET' && req.url.includes('/status')) {
        state.reads += 1
        if (readFails) return send(500, { message: 'boom' })
        return send(200, { statuses: state.statuses })
      }
      if (req.method === 'POST' && req.url.includes('/statuses/')) {
        state.writes += 1
        if (writeFails) return send(500, { message: 'boom' })
        state.statuses.push(JSON.parse(payload))
        return send(201, { ok: true })
      }
      return send(404, { message: 'unexpected' })
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  return {
    state,
    api: base,
    slack: `${base}/slack`,
    close: () => new Promise((r) => server.close(r)),
  }
}

/** Run the reporter as the workflow runs it, and never let it fail the gate. */
async function report(env, flags) {
  const { stdout, stderr } = await run('node', [SCRIPT, ...flags], {
    env: { ...process.env, GITHUB_REPOSITORY: 'aglyn/aglyn', ...env },
  })
  // execFile rejects on a non-zero exit, so reaching here IS the fail-soft
  // assertion: the reporter exited 0.
  return { stdout, stderr }
}

const RED_FAST = [
  '--sha=8b9aef0a8c0ffee0000000000000000000000000',
  '--fast=failure',
  '--full=skipped',
  '--sweep-due=success',
  '--run-url=https://github.com/aglyn/aglyn/actions/runs/33816117495',
  '--subject=chore: a commit',
]

test('E2E: a new red alerts Slack and records the alert', async () => {
  const s = await stubs()
  try {
    const { stderr } = await report({ GITHUB_API_URL: s.api, SLACK_WEBHOOK_URL: s.slack, GITHUB_TOKEN: 't' }, RED_FAST)
    assert.equal(s.state.slackPosts.length, 1)
    assert.match(JSON.stringify(s.state.slackPosts[0]), /Main Gate is RED on 8b9aef0a8/)
    assert.equal(s.state.statuses.length, 1)
    assert.match(s.state.statuses[0].context, /^main-gate-notify\/red-reported-[0-9a-f]{12}$/)
    assert.equal(s.state.statuses[0].state, 'success')
    assert.match(stderr, /pinged Slack/)
  } finally {
    await s.close()
  }
})

test('E2E: THE DEDUPE — the same sha and failing set, reported twice, alerts once', async () => {
  // The real case this exists for: run 33817081510 re-graded `8b9aef0a8` seven
  // minutes after 33816117495, same `{fast}` set, and must not ping twice.
  const s = await stubs()
  try {
    const env = { GITHUB_API_URL: s.api, SLACK_WEBHOOK_URL: s.slack, GITHUB_TOKEN: 't' }
    await report(env, RED_FAST)
    assert.equal(s.state.slackPosts.length, 1)

    const second = await report(env, [...RED_FAST, '--run-url=https://github.com/aglyn/aglyn/actions/runs/33817081510'])
    assert.equal(s.state.slackPosts.length, 1, 'the second report must NOT ping Slack again')
    assert.equal(s.state.statuses.length, 1, 'and must not write a second record')
    assert.match(second.stderr, /already been alerted/)
  } finally {
    await s.close()
  }
})

test('E2E: a DIFFERENT failing set on the SAME sha is a new red and does alert', async () => {
  const s = await stubs()
  try {
    const env = { GITHUB_API_URL: s.api, SLACK_WEBHOOK_URL: s.slack, GITHUB_TOKEN: 't' }
    await report(env, RED_FAST)
    await report(env, [
      '--sha=8b9aef0a8c0ffee0000000000000000000000000',
      '--fast=failure',
      '--full=failure',
      '--sweep-due=success',
    ])
    assert.equal(s.state.slackPosts.length, 2)
    assert.equal(s.state.statuses.length, 2)
    assert.notEqual(s.state.statuses[0].context, s.state.statuses[1].context)
  } finally {
    await s.close()
  }
})

test('E2E: RED ONLY — a green touches no network at all', async () => {
  const s = await stubs()
  try {
    await report({ GITHUB_API_URL: s.api, SLACK_WEBHOOK_URL: s.slack, GITHUB_TOKEN: 't' }, [
      '--sha=8b9aef0a8',
      '--fast=success',
      '--full=skipped',
      '--sweep-due=success',
    ])
    assert.equal(s.state.slackPosts.length, 0)
    assert.equal(s.state.reads, 0)
    assert.equal(s.state.writes, 0)
  } finally {
    await s.close()
  }
})

test('E2E: FAIL-SOFT — a failed status READ still alerts, and does not fail the gate', async () => {
  const s = await stubs({ readFails: true })
  try {
    const { stdout } = await report(
      { GITHUB_API_URL: s.api, SLACK_WEBHOOK_URL: s.slack, GITHUB_TOKEN: 't' },
      RED_FAST,
    )
    assert.equal(s.state.slackPosts.length, 1, 'an unreadable oracle must not swallow the red')
    assert.match(stdout, /::warning::/)
  } finally {
    await s.close()
  }
})

test('E2E: FAIL-SOFT — a failed status WRITE still alerts, and does not fail the gate', async () => {
  const s = await stubs({ writeFails: true })
  try {
    const { stdout, stderr } = await report(
      { GITHUB_API_URL: s.api, SLACK_WEBHOOK_URL: s.slack, GITHUB_TOKEN: 't' },
      RED_FAST,
    )
    assert.equal(s.state.slackPosts.length, 1)
    assert.match(stdout, /::warning::/)
    assert.match(stderr, /could NOT record it/)
  } finally {
    await s.close()
  }
})

test('E2E: FAIL-SOFT — no GITHUB_TOKEN means no dedupe, so it alerts anyway', async () => {
  const s = await stubs()
  try {
    const { stdout } = await report(
      { GITHUB_API_URL: s.api, SLACK_WEBHOOK_URL: s.slack, GITHUB_TOKEN: '', GH_TOKEN: '' },
      RED_FAST,
    )
    assert.equal(s.state.slackPosts.length, 1)
    assert.equal(s.state.reads, 0)
    assert.equal(s.state.writes, 0)
    assert.match(stdout, /::warning::/)
  } finally {
    await s.close()
  }
})

test('E2E: a failed Slack post records NOTHING, so the next run retries', async () => {
  // Recording an alert that never arrived would convert a transient Slack
  // outage into permanent silence for that red.
  const s = await stubs({ slackFails: true })
  try {
    const { stdout } = await report(
      { GITHUB_API_URL: s.api, SLACK_WEBHOOK_URL: s.slack, GITHUB_TOKEN: 't' },
      RED_FAST,
    )
    assert.equal(s.state.writes, 0)
    assert.match(stdout, /::warning::/)
  } finally {
    await s.close()
  }
})

test('E2E: no SLACK_WEBHOOK_URL is loud, and records nothing', async () => {
  const s = await stubs()
  try {
    const { stdout } = await report(
      { GITHUB_API_URL: s.api, SLACK_WEBHOOK_URL: '', GITHUB_TOKEN: 't' },
      RED_FAST,
    )
    assert.match(stdout, /::warning::.*NOBODY/)
    assert.equal(s.state.writes, 0)
  } finally {
    await s.close()
  }
})

test('E2E: a TEST is never deduped and never leaves a record', async () => {
  // Both halves matter. Suppressing a test would report the run green on the
  // strength of having sent nothing; recording one would afterwards swallow a
  // REAL red on that sha and failing set as a duplicate of a message that said
  // nothing was wrong.
  const s = await stubs()
  try {
    const env = { GITHUB_API_URL: s.api, SLACK_WEBHOOK_URL: s.slack, GITHUB_TOKEN: 't' }
    await report(env, ['--test', ...RED_FAST])
    await report(env, ['--test', ...RED_FAST])
    assert.equal(s.state.slackPosts.length, 2, 'a test must send every time it is asked to')
    assert.equal(s.state.writes, 0, 'and must never write a record a real red would trip over')
    assert.doesNotMatch(JSON.stringify(s.state.slackPosts[0]), /Main Gate is RED/)
    assert.match(JSON.stringify(s.state.slackPosts[0]), /nothing is wrong/)

    // The proof that it did not record: a REAL red with the same sha and set
    // still alerts.
    await report(env, RED_FAST)
    assert.equal(s.state.slackPosts.length, 3)
    assert.match(JSON.stringify(s.state.slackPosts[2]), /Main Gate is RED/)
  } finally {
    await s.close()
  }
})

test('E2E: nothing reads or writes Linear any more', async () => {
  // The sink issue AGL-2537 can be closed, and Linear auto-archives completed
  // issues on a workspace timer. If anything here still resolved it, that
  // archive would break the notification path — the failure AGL-2533 is about.
  const s = await stubs()
  try {
    const { stdout, stderr } = await report(
      { GITHUB_API_URL: s.api, SLACK_WEBHOOK_URL: s.slack, GITHUB_TOKEN: 't', LINEAR_API_KEY: '' },
      RED_FAST,
    )
    assert.equal(s.state.slackPosts.length, 1)
    assert.doesNotMatch(stdout + stderr, /AGL-2537|Linear|linear/)
  } finally {
    await s.close()
  }
})
