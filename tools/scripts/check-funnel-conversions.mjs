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
// The views-to-conversions alarm (AGL-2587): reads the GA4 Data API, grades
// each funnel door, and tells Slack when a door is taking traffic and
// converting nobody. The grading — thresholds, window, lag guard, message —
// lives in `lib/funnel-conversion-alarm.mjs`, where it is unit-tested against
// the real numbers from the 2026-09-01 incident; this file is the network
// half.
//
//   node tools/scripts/check-funnel-conversions.mjs [--dry-run] [--test]
//
// Needs `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` and
// `FIREBASE_PRIVATE_KEY` — the admin service account, which holds Viewer on
// the property. `SLACK_WEBHOOK_URL` is what makes it announce; without it the
// verdict is printed and nothing is sent. See `docs/ANALYTICS.md` for what
// that credential needs enabled on the project, which is not obvious and has
// already cost one wrong conclusion.
//
// EXITS NON-ZERO ONLY ON RED. A run that cannot reach GA4 exits 0 and says so
// loudly: an alarm that fails closed on a credential hiccup teaches the reader
// to ignore it, and the missing signal is already the thing being fixed.
import { loadLocalEnv, readServiceAccount } from './lib/firebase-rules-api.mjs'
import {
  FUNNEL_DOORS,
  gradeFunnel,
  slackPayload,
  verdictLines,
  windowBounds,
} from './lib/funnel-conversion-alarm.mjs'

/** The platform property. One property, one web stream — `docs/ANALYTICS.md`. */
const PROPERTY_ID = process.env.GA4_PROPERTY_ID || '302497406'

// Matching `report-main-gate-red.mjs`: a hung request must not stall the job
// for its whole timeout.
const TIMEOUT_MS = 20_000

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const TEST = args.includes('--test')
// Grade the window some PAST day would have graded (`--as-of=2026-09-04`).
// Backtesting is how a threshold gets calibrated against real traffic instead
// of against a round number, and how anyone can re-check afterwards that this
// really would have caught the incident it claims to.
const AS_OF = args.find((a) => a.startsWith('--as-of='))?.slice(8) || null
const say = (msg) => process.stderr.write(`funnel-alarm: ${msg}\n`)

/**
 * A JWT-bearer access token for the Data API.
 *
 * Minted here rather than through firebase-admin because the scope is
 * `analytics.readonly`, which is not a Firebase scope — the admin SDK's
 * credential would hand back a token GA4 refuses.
 */
async function accessToken(sa) {
  const { createSign } = await import('node:crypto')
  const now = Math.floor(Date.now() / 1000)
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const header = b64({ alg: 'RS256', typ: 'JWT' })
  const claim = b64({
    iss: sa.clientEmail,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claim}`)
  signer.end()
  const jwt = `${header}.${claim}.${signer.sign(sa.privateKey).toString('base64url')}`
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const payload = await response.json()
  if (!response.ok || !payload.access_token) {
    throw new Error(`token exchange failed: ${JSON.stringify(payload).slice(0, 300)}`)
  }
  return payload.access_token
}

async function runReport(token, body) {
  const response = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}:runReport`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  )
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(`runReport failed: ${JSON.stringify(payload).slice(0, 400)}`)
  }
  return payload
}

/**
 * Views and distinct viewers per door page.
 *
 * `pagePath` is matched EXACTLY. A `CONTAINS` match would fold `/signup` in
 * with any path that merely mentions it, and the alarm would then be grading
 * a page nobody is actually stuck on.
 */
async function measureViews(token, range) {
  const report = await runReport(token, {
    dateRanges: [range],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
    dimensionFilter: {
      filter: {
        fieldName: 'pagePath',
        inListFilter: { values: FUNNEL_DOORS.map((d) => d.pagePath) },
      },
    },
    limit: 50,
  })
  const byPath = new Map()
  for (const row of report.rows ?? []) {
    byPath.set(row.dimensionValues[0].value, {
      views: Number(row.metricValues[0].value) || 0,
      users: Number(row.metricValues[1].value) || 0,
    })
  }
  return byPath
}

/** Conversion counts per event name over the same window. */
async function measureConversions(token, range) {
  const report = await runReport(token, {
    dateRanges: [range],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: {
        fieldName: 'eventName',
        inListFilter: { values: FUNNEL_DOORS.map((d) => d.conversionEvent) },
      },
    },
    limit: 50,
  })
  const byEvent = new Map()
  for (const row of report.rows ?? []) {
    byEvent.set(row.dimensionValues[0].value, Number(row.metricValues[0].value) || 0)
  }
  return byEvent
}

async function announce(payload) {
  const webhook = process.env.SLACK_WEBHOOK_URL
  if (!webhook) {
    say('no SLACK_WEBHOOK_URL — verdict printed, nothing sent')
    return
  }
  if (DRY_RUN) {
    say(`dry run — would have sent: ${payload.text}`)
    return
  }
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) {
    say(`Slack refused the message: ${response.status}`)
    return
  }
  say('announced in #ci')
}

async function main() {
  loadLocalEnv()
  const range = windowBounds(AS_OF ?? new Date())
  say(`grading ${range.startDate} → ${range.endDate}`)

  // Proving the notifier without waiting for an incident, the same posture as
  // `report-main-gate-red.mjs`. A notification path whose only test is a real
  // outage is unverifiable until the day it matters.
  if (TEST) {
    await announce({
      text: 'TEST of the funnel conversion alarm — not a real alarm',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              '*TEST of the funnel conversion alarm — nothing is wrong.* ' +
              'This message proves the path from `check-funnel-conversions.mjs` ' +
              'to this channel works. No door is red and no action is needed.',
          },
        },
      ],
    })
    return 0
  }

  const sa = readServiceAccount()
  if (!sa) {
    say('NO SERVICE ACCOUNT — the funnel went unmeasured this run. Exiting 0.')
    return 0
  }

  let views
  let conversions
  try {
    const token = await accessToken(sa)
    ;[views, conversions] = await Promise.all([
      measureViews(token, range),
      measureConversions(token, range),
    ])
  } catch (error) {
    // Fails open, loudly. See the header: a credential hiccup must not read
    // as a funnel outage.
    say(`COULD NOT READ GA4 — the funnel went unmeasured this run: ${error.message}`)
    return 0
  }

  const verdict = gradeFunnel(
    FUNNEL_DOORS.map((door) => ({
      ...door,
      ...(views.get(door.pagePath) ?? { views: 0, users: 0 }),
      conversions: conversions.get(door.conversionEvent) ?? 0,
    })),
  )
  for (const line of verdictLines(verdict)) process.stdout.write(`${line}\n`)

  if (!verdict.red) {
    say('every door that took enough traffic to grade converted somebody')
    return 0
  }
  await announce(slackPayload({ verdict, window: range, runUrl: process.env.RUN_URL }))
  return 1
}

process.exitCode = await main()
