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

// Sends the uptime probe's RED to Slack `#ci` (AGL-2586) — the network half
// of `lib/uptime-red-report.mjs`, where the payload and the decision live and
// are unit-tested.
//
//   UPTIME_RESULTS_PATH=/tmp/uptime.json node tools/scripts/probe-uptime.mjs …
//   node tools/scripts/report-uptime-red.mjs --results=/tmp/uptime.json \
//     --run-url=<url>
//
//   node tools/scripts/report-uptime-red.mjs --test --run-url=<url>
//
// ALWAYS EXITS 0. A monitor that failed because it could not report would be
// strictly worse than the silence this replaces, so every failure here is
// announced on stderr and swallowed. The probe's own exit code is what fails
// the run.
//
// TEST MODE, for the same reason Main Gate's reporter has one: a notification
// path whose only test is a real outage is unverifiable until the day it
// matters, which is the shape AGL-2586 is about. `--test` sends a
// clearly-labeled message through the real secret and the real code.
//
// ⚠️ The label must survive into EVERY stream a reader sees, not just the
// headline — a test that reads as an incident anywhere has false-alarmed.
import { readFileSync } from 'node:fs'

import { shouldReport, slackPayload } from './lib/uptime-red-report.mjs'

// Matching the sibling reporters. Without it a hung request stalls the job
// for its whole timeout, which is worse than a missed notification.
const TIMEOUT_MS = 15_000

const args = process.argv.slice(2)
const flag = (name, fallback = '') => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const TEST = args.includes('--test')
const say = (message) => process.stderr.write(`uptime-red: ${message}\n`)

/** A subject that says what it is in every field a reader can land on. */
const TEST_RESULTS = [
  {
    name: 'TEST-not-a-real-target',
    url: 'https://example.invalid/api/health',
    ok: false,
    detail:
      'TEST of the notification path — nothing is down, no action is needed',
  },
]

let results = TEST_RESULTS
if (!TEST) {
  const path = flag('results')
  if (!path) {
    say('no --results= given; nothing to report')
    process.exit(0)
  }
  try {
    results = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    // The probe writes this file best-effort, so a missing one is a probe that
    // could not write rather than an outage. Say so and stop.
    say(`could not read ${path}: ${error?.message ?? error}`)
    process.exit(0)
  }
}

if (!TEST && !shouldReport(results)) {
  say('every target is up (or pending promotion); nothing to send')
  process.exit(0)
}

const webhook = process.env.SLACK_WEBHOOK_URL
if (!webhook) {
  // Loud on stderr rather than silent: an unset secret is the failure mode
  // that turns a notifier into decoration, and the run log is where it shows.
  say('SLACK_WEBHOOK_URL is not set — the red is NOT being announced')
  process.exit(0)
}

const payload = slackPayload({ results, runUrl: flag('run-url') })
if (TEST) {
  payload.text = `[TEST — not a real alert] ${payload.text}`
  payload.blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*TEST of the uptime notification path — nothing is down and no action is needed.*\n${payload.blocks[0].text.text}`,
      },
    },
  ]
}

try {
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) {
    say(`Slack refused the message (HTTP ${response.status})`)
  } else {
    say(TEST ? 'test message sent' : 'red announced to #ci')
  }
} catch (error) {
  say(`could not reach Slack: ${error?.message ?? error}`)
}

process.exit(0)
