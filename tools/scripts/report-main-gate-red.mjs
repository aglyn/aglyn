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
// Posts Main Gate's RED verdict into Linear (AGL-2533). The body, the marker
// and the should-we-report decision live in `lib/main-gate-red-report.mjs`;
// this file is the network half.
//
//   node tools/scripts/report-main-gate-red.mjs --fast=success --full=failure \
//     --sha=<sha> --run-url=<url> --subject='...'
//
// ALWAYS EXITS 0. A gate that went red because it could not report would be
// strictly worse than the silence this replaces, so every failure here is
// announced on stderr and swallowed.
import {
  SINK_ISSUE_ID,
  failedJobs,
  redCommentBody,
  redMarker,
  shouldPingSlack,
  shouldReport,
  slackPayload,
} from './lib/main-gate-red-report.mjs'

const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql'
// Matching `check-external-facts.mjs`, the proven caller of this API in this
// repo. Without it a hung request stalls the report job for the whole job
// timeout, which is a worse outcome than a missed notification.
const TIMEOUT_MS = 15_000

const args = process.argv.slice(2)
const flag = (name, fallback = '') => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

/**
 * TEST MODE (AGL-2533). A notifier whose only test is "wait for a real
 * failure" is the thing this whole issue is about — it cannot be shown to
 * work until the day it matters. `--test` sends a clearly-labelled message
 * down the real path with the real secrets, so the wiring is provable on
 * demand rather than on incident.
 */
const TEST = args.includes('--test')

const results = { fast: flag('fast'), full: flag('full') }
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

const key = (process.env['LINEAR_API_KEY'] ?? '').trim()
const slackWebhook = (process.env['SLACK_WEBHOOK_URL'] ?? '').trim()

if (!key && !slackWebhook) {
  // Loud, because this is the notification path failing silently - the exact
  // shape AGL-2533 is about.
  warn(
    `neither LINEAR_API_KEY nor SLACK_WEBHOOK_URL is set, so ${
      TEST ? 'a real red would reach' : 'this red reaches'
    } NOBODY.`,
  )
  process.exit(0)
}

async function linear(query, variables) {
  const res = await fetch(LINEAR_GRAPHQL_URL, {
    method: 'POST',
    headers: { authorization: key, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Linear returned ${res.status}`)
  const body = await res.json()
  if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'Linear error')
  return body.data
}

/**
 * What happened on the Linear side, which is also the dedupe oracle for Slack.
 * 'posted' | 'duplicate' | 'unavailable'
 */
let linearOutcome = 'unavailable'

try {
  if (!key) throw new Error('LINEAR_API_KEY is not set')
  const marker = redMarker({ sha, results })
  const found = await linear(
    `query Sink($id: String!) {
       issue(id: $id) { id identifier comments(first: 50) { nodes { body } } }
     }`,
    { id: SINK_ISSUE_ID },
  )
  const issue = found?.issue
  if (!issue) {
    warn(`sink issue ${SINK_ISSUE_ID} not found - has it been deleted? This red reaches nobody.`)
    process.exit(0)
  }
  const already = (issue.comments?.nodes ?? []).some((c) => (c.body ?? '').includes(marker))
  if (already) {
    say(`${SINK_ISSUE_ID} already carries this exact red; not repeating it`)
    linearOutcome = 'duplicate'
  } else {
    await linear(
      `mutation Comment($issueId: String!, $body: String!) {
         commentCreate(input: { issueId: $issueId, body: $body }) { success }
       }`,
        {
        issueId: issue.id,
        body: TEST
          ? '**[TEST] Notification path check - nothing is wrong.**\n\n' +
            'No build has failed. This proves a real red would reach this issue. ' +
            `Sent from ${runUrl || 'a manual dispatch'}. Safe to delete.`
          : redCommentBody({ sha, results, runUrl, subject }),
      },
    )
    say(`posted to ${SINK_ISSUE_ID}`)
    linearOutcome = 'posted'
  }
} catch (error) {
  warn(`could NOT post to Linear (${String(error).slice(0, 160)})`)
}

/*==========================================
 * SLACK - the immediate half.
 *
 * Linear is the durable record and the work item; Slack is "look now". They
 * are not duplicates, and the dedupe is deliberately keyed off the Linear
 * outcome because a webhook post is unconditional and the gate can grade one
 * red sha more than once.
 *========================================*/
if (slackWebhook && shouldPingSlack(linearOutcome)) {
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
    say('pinged Slack')
  } catch (error) {
    warn(`could NOT ping Slack (${String(error).slice(0, 160)})`)
  }
} else if (!slackWebhook) {
  say('SLACK_WEBHOOK_URL is not set; skipping the immediate ping')
} else {
  say('Slack not pinged - Linear already carried this exact red')
}

if (linearOutcome === 'unavailable' && !slackWebhook) {
  warn('this red reached NOBODY')
}
process.exit(0)
