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
// Sends Main Gate's RED verdict to Slack (AGL-2533) and records that it did,
// on a commit status, so the same red is never sent twice (AGL-2537). The
// payload, the digest, the context and the should-we-report decision live in
// `lib/main-gate-red-report.mjs`, where they are unit-tested; this file is the
// network half.
//
//   node tools/scripts/report-main-gate-red.mjs --fast=success --full=failure \
//     --sha=<sha> --run-url=<url> --subject='...'
//
// ALWAYS EXITS 0. A gate that went red because it could not report would be
// strictly worse than the silence this replaces, so every failure here is
// announced on stderr and swallowed.
//
// ## THE DEDUPE ORACLE IS A COMMIT STATUS
//
// Slack cannot be asked whether a message already exists, and the gate grades
// one sha more than once as a matter of routine -- a push run plus an hourly
// cron run, or a re-run of a red run. Run 33817081510 re-graded `8b9aef0a8`
// seven minutes after 33816117495 with the same failing set, and something had
// to know that was the same incident.
//
// That memory used to be a Linear issue: the alert was also a comment, and the
// comment history was walked before writing. It is a commit status now. The
// status is per-sha, durable, free, carries no credential beyond the
// `GITHUB_TOKEN` the workflow already holds, and -- unlike an issue -- cannot
// be archived on a workspace timer out from under the reader.
//
// Every uncertain answer FAILS OPEN and alerts: a duplicate is visible and
// merely annoying, while a swallowed red is silent.
import {
  alreadyReported,
  failedJobs,
  reportedContext,
  shouldReport,
  slackPayload,
  statusDescription,
} from './lib/main-gate-red-report.mjs'

// Matching `check-external-facts.mjs`, the proven remote caller in this repo.
// Without it a hung request stalls the report job for the whole job timeout,
// which is a worse outcome than a missed notification.
const TIMEOUT_MS = 15_000

const args = process.argv.slice(2)
const flag = (name, fallback = '') => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

/**
 * TEST MODE (AGL-2533). A notifier whose only test is "wait for a real
 * failure" is the thing this whole issue is about — it cannot be shown to
 * work until the day it matters. `--test` sends a clearly-labeled message
 * down the real path with the real secrets, so the wiring is provable on
 * demand rather than on incident.
 */
const TEST = args.includes('--test')

const results = { fast: flag('fast'), full: flag('full'), sweepDue: flag('sweep-due') }
const sha = flag('sha')
const runUrl = flag('run-url')
const subject = flag('subject')

const say = (msg) => process.stderr.write(`main-gate-red: ${msg}\n`)
/**
 * A notification that failed is itself a signal nobody saw, which is the whole
 * subject of AGL-2533 — so it gets an Actions annotation rather than a stderr
 * line in a passing step.
 */
const warn = (msg) => {
  say(msg)
  process.stdout.write(`::warning::main-gate-red: ${msg}\n`)
}

if (!shouldReport(results)) {
  say(`nothing to report (fast=${results.fast || 'n/a'} full=${results.full || 'n/a'})`)
  process.exit(0)
}
/**
 * The log line is read by a human scanning a run, so it carries the same
 * distinction the Slack body does. A test that logs "RED on <sha>" sends
 * whoever reads the run looking for a broken build that does not exist.
 */
say(
  TEST
    ? `[TEST] notification path check on ${sha.slice(0, 9)} - nothing is red`
    : `RED on ${sha.slice(0, 9)} - ${failedJobs(results).join(', ')}`,
)

const slackWebhook = (process.env['SLACK_WEBHOOK_URL'] ?? '').trim()
const token = (process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'] ?? '').trim()
const apiBase = (process.env['GITHUB_API_URL'] ?? 'https://api.github.com').replace(/\/+$/, '')
const repo = process.env['GITHUB_REPOSITORY'] || 'aglyn/aglyn'

if (!slackWebhook) {
  // Loud, because this is the notification path failing silently - the exact
  // shape AGL-2533 is about, and Slack is now the only channel there is.
  warn(
    `SLACK_WEBHOOK_URL is not set, so ${
      TEST ? 'a real red would reach' : 'this red reaches'
    } NOBODY.`,
  )
  process.exit(0)
}

const gh = async (path, init = {}) =>
  await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

const context = reportedContext({ sha, results })

/*==========================================
 * 1. HAVE WE ALREADY SENT THIS EXACT RED?
 *
 * A TEST is never deduped and never leaves a record. It carries a body that
 * says nothing is wrong, so suppressing it would report the run green on the
 * strength of having sent nothing -- the one thing a notification test must
 * never do. Recording it would be worse: the record is keyed on the sha and
 * the failing set the test was invoked with, so a REAL red matching them would
 * afterwards be silently swallowed as a duplicate of a message that only ever
 * said "nothing is wrong".
 *========================================*/
if (!TEST) {
  if (!token) {
    warn('no GITHUB_TOKEN, so this red cannot be deduped; alerting anyway (a miss is worse)')
  } else {
    try {
      const res = await gh(`/repos/${repo}/commits/${sha}/status?per_page=100`)
      if (!res.ok) throw new Error(`GitHub returned ${res.status}`)
      const body = await res.json()
      if (alreadyReported({ statuses: body?.statuses, context })) {
        say(`${sha.slice(0, 9)} has already been alerted with this exact failing set; not repeating it`)
        process.exit(0)
      }
    } catch (error) {
      warn(
        `could NOT read commit statuses to dedupe (${String(error).slice(0, 160)}); ` +
          'alerting anyway (a miss is worse than a duplicate)',
      )
    }
  }
}

/*==========================================
 * 2. THE ALERT. Slack `#ci` is the only channel.
 *========================================*/
let alerted = false
try {
  const res = await fetch(slackWebhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(
      TEST
        ? {
            // NOT the real body with a banner bolted on. A test that leads
            // with "Main Gate is RED" reads as an incident however it is
            // captioned - it did, the first time this ran, and the person
            // reading it went looking for a broken build. The test message
            // states the true fact instead: nothing is wrong.
            text: '[TEST] Notification path check - Main Gate is NOT red',
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text:
                    ':white_check_mark: *[TEST] Notification path check - nothing is wrong.*\n' +
                    'No build has failed. This message exists only to prove that a real ' +
                    'failure would reach this channel.\n' +
                    `Sent from <${runUrl || 'https://github.com/aglyn/aglyn/actions'}|this run>. ` +
                    'A real alert looks different: it names the failing job and links the run.',
                },
              },
            ],
          }
        : slackPayload({ sha, results, runUrl, subject }),
    ),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Slack returned ${res.status}`)
  say(TEST ? 'pinged Slack with the TEST message' : 'pinged Slack')
  alerted = true
} catch (error) {
  warn(`could NOT ping Slack (${String(error).slice(0, 160)}); this red reached NOBODY`)
}

/*==========================================
 * 3. RECORD IT, but only if it was actually sent.
 *
 * The record is what suppresses the next attempt, so writing one for an alert
 * that failed would convert a transient Slack outage into permanent silence
 * for that red -- the next run would find the record and skip. An unrecorded
 * success merely risks one duplicate.
 *========================================*/
if (alerted && !TEST) {
  if (!token) {
    warn('no GITHUB_TOKEN, so this alert was not recorded; a re-run may repeat it')
  } else {
    try {
      const res = await gh(`/repos/${repo}/statuses/${sha}`, {
        method: 'POST',
        body: JSON.stringify({
          state: 'success',
          context,
          description: statusDescription(results),
          ...(runUrl ? { target_url: runUrl } : {}),
        }),
      })
      if (!res.ok) throw new Error(`GitHub returned ${res.status}`)
      say(`recorded ${context} on ${sha.slice(0, 9)}`)
    } catch (error) {
      warn(
        `alerted, but could NOT record it (${String(error).slice(0, 160)}); ` +
          'a re-run of this red may ping twice',
      )
    }
  }
}

process.exit(0)
