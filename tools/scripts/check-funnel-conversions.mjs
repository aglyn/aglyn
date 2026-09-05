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
// The views-to-conversions alarm (AGL-2587, re-timed to the hour by
// AGL-2609): reads page views from the GA4 Data API and conversions from
// Firebase Auth through the Identity Toolkit admin API, grades each funnel
// door, and tells Slack when a door is taking traffic and converting nobody.
// The grading — windows, thresholds, the say-it-once rule, the messages —
// lives in `lib/funnel-conversion-alarm.mjs`, where it is unit-tested against
// the real numbers from the 2026-09-01 incident; this file is the network
// half.
//
//   node tools/scripts/check-funnel-conversions.mjs [--dry-run] [--test]
//   node tools/scripts/check-funnel-conversions.mjs --as-of=2026-09-02T05:00:00Z
//
// Needs `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` and
// `FIREBASE_PRIVATE_KEY` — the admin service account, which holds Viewer on
// the property and reads Auth through its own project's Identity Toolkit.
// `SLACK_WEBHOOK_URL` is what makes it announce; without it the verdict is
// printed and nothing is sent. `PREVIOUS_CONCLUSION` — the workflow passes
// the previous scheduled run's `success` or `failure` — is what lets a red be
// said once rather than every hour. `GA4_PROPERTY_TIME_ZONE` overrides the
// zone read from the Admin API. See `docs/ANALYTICS.md` for what the
// credential needs enabled on the project, which is not obvious and has
// already cost one wrong conclusion.
//
// `--as-of` grades the windows a past instant would have graded (a bare date
// is midnight UTC). Backtesting is how the thresholds were calibrated
// against real traffic rather than a round number, and how anyone can re-check
// that this really would have caught the incident it claims to. A backtest
// NEVER announces: one that reached #ci would be a false alarm.
//
// EXITS NON-ZERO ONLY ON RED. A run that cannot reach GA4 or Auth exits 0 and
// says so loudly: an alarm that fails closed on a credential hiccup teaches
// the reader to ignore it, and the missing signal is already the thing being
// fixed.
//
// WHAT LEAVES THIS FILE: counts. The Identity Toolkit answers with email
// addresses and password hashes; none of that is logged, summarised or sent.
import { loadLocalEnv, readServiceAccount } from './lib/firebase-rules-api.mjs'
import {
  FUNNEL_DOORS,
  PROPERTY_TIME_ZONE_FALLBACK,
  announceDecision,
  beaconWindow,
  countWithin,
  doorWindow,
  doorWindowLabel,
  gradeFunnel,
  hourBuckets,
  isoDay,
  recoveryPayload,
  slackPayload,
  verdictLines,
} from './lib/funnel-conversion-alarm.mjs'

/** The platform property. One property, one web stream — `docs/ANALYTICS.md`. */
const PROPERTY_ID = process.env.GA4_PROPERTY_ID || '302497406'

const GA_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'
const AUTH_SCOPE = 'https://www.googleapis.com/auth/identitytoolkit'

// Matching `report-main-gate-red.mjs`: a hung request must not stall the job
// for its whole timeout.
const TIMEOUT_MS = 20_000

// Newest-first, one page per sort. Bounded so a large user base costs the
// same as a small one; when a whole page lands inside a window the count is
// a floor, which is already past every threshold that reads it.
const TRUTH_PAGE = 500

const args = process.argv.slice(2)
const TEST = args.includes('--test')
const AS_OF = args.find((a) => a.startsWith('--as-of='))?.slice(8) || null
const DRY_RUN = args.includes('--dry-run') || AS_OF !== null
const say = (msg) => process.stderr.write(`funnel-alarm: ${msg}\n`)

/**
 * A JWT-bearer access token for one Google API.
 *
 * Minted here rather than through firebase-admin because the scopes are not
 * Firebase scopes — the admin SDK's credential would hand back a token GA4
 * refuses. Same service account, different audience.
 */
async function accessToken(sa, scope) {
  const { createSign } = await import('node:crypto')
  const now = Math.floor(Date.now() / 1000)
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const header = b64({ alg: 'RS256', typ: 'JWT' })
  const claim = b64({
    iss: sa.clientEmail,
    scope,
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
    throw new Error(
      `token exchange failed: ${JSON.stringify(payload).slice(0, 300)}`,
    )
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
    throw new Error(
      `runReport failed: ${JSON.stringify(payload).slice(0, 400)}`,
    )
  }
  return payload
}

/**
 * The property's reporting zone, from the Admin API. GA4's `dateHour` is a
 * wall-clock hour in this zone, and the door window has to be cut on the
 * same clock or the views and the conversions describe different hours.
 */
async function propertyTimeZone(token) {
  const response = await fetch(
    `https://analyticsadmin.googleapis.com/v1beta/properties/${PROPERTY_ID}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  )
  const payload = await response.json()
  if (!response.ok || !payload.timeZone) {
    throw new Error(
      `property read failed: ${JSON.stringify(payload).slice(0, 300)}`,
    )
  }
  return payload.timeZone
}

/**
 * Views and distinct viewers per door page over the door window.
 *
 * `pagePath` is matched EXACTLY. A `CONTAINS` match would fold `/signup` in
 * with any path that merely mentions it, and the alarm would then be grading
 * a page nobody is actually stuck on. The `dateHour` filter cuts the window
 * inside the day range; the Data API applies it without the hour in the
 * output, so `activeUsers` is de-duplicated over exactly the window's hours.
 */
async function measureViews(token, window) {
  const report = await runReport(token, {
    dateRanges: [
      {
        startDate: isoDay(window.startMs, window.timeZone),
        endDate: isoDay(window.endMs, window.timeZone),
      },
    ],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
    dimensionFilter: {
      andGroup: {
        expressions: [
          {
            filter: {
              fieldName: 'pagePath',
              inListFilter: { values: FUNNEL_DOORS.map((d) => d.pagePath) },
            },
          },
          {
            filter: {
              fieldName: 'dateHour',
              inListFilter: {
                values: hourBuckets(
                  window.startMs,
                  window.endMs,
                  window.timeZone,
                ),
              },
            },
          },
        ],
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

/** GA4 event counts per conversion event over the settled beacon window. */
async function measureEvents(token, window) {
  const report = await runReport(token, {
    dateRanges: [{ startDate: window.startDate, endDate: window.endDate }],
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
    byEvent.set(
      row.dimensionValues[0].value,
      Number(row.metricValues[0].value) || 0,
    )
  }
  return byEvent
}

/** One newest-first page of Auth records, sorted on the field asked for. */
async function truthPage(token, projectId, sortBy) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        returnUserInfo: true,
        sortBy,
        order: 'DESC',
        limit: TRUTH_PAGE,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  )
  const payload = await response.json()
  if (!response.ok) {
    // The error body names the project at most; a success body is never
    // logged, because it carries every account's address and hash.
    throw new Error(
      `accounts:query failed: ${JSON.stringify(payload).slice(0, 300)}`,
    )
  }
  return payload.userInfo ?? []
}

/**
 * What Firebase Auth knows happened: accounts created and people signed in,
 * counted inside each window. Two pages, one per sort, then only numbers.
 *
 * `lastLoginAt` is a person's LATEST sign-in, so for a settled window it
 * under-counts anyone who signed in again after it — which only ever makes
 * the beacon grade quieter.
 */
async function measureTruth(token, projectId, windows) {
  const [byCreated, byLogin] = await Promise.all([
    truthPage(token, projectId, 'CREATED_AT'),
    truthPage(token, projectId, 'LAST_LOGIN_AT'),
  ])
  const counts = {}
  for (const [name, window] of Object.entries(windows)) {
    counts[name] = {
      createdAt: countWithin(byCreated, 'createdAt', window),
      lastLoginAt: countWithin(byLogin, 'lastLoginAt', window),
    }
  }
  return counts
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

  const nowMs = AS_OF ? Date.parse(AS_OF) : Date.now()
  if (!Number.isFinite(nowMs)) {
    say(`--as-of=${AS_OF} is not a date or instant. Exiting 0.`)
    return 0
  }

  let verdict
  let dw
  let bw
  try {
    const [ga, auth] = await Promise.all([
      accessToken(sa, GA_SCOPE),
      accessToken(sa, AUTH_SCOPE),
    ])
    let timeZone = process.env.GA4_PROPERTY_TIME_ZONE
    if (!timeZone) {
      try {
        timeZone = await propertyTimeZone(ga)
      } catch (error) {
        timeZone = PROPERTY_TIME_ZONE_FALLBACK
        say(
          `could not read the property's zone (${error.message}); using ${timeZone}`,
        )
      }
    }
    dw = doorWindow(nowMs, timeZone)
    bw = beaconWindow(nowMs, timeZone)
    say(
      `grading doors over ${doorWindowLabel(dw)} and beacons over ` +
        `${bw.startDate} → ${bw.endDate} (${timeZone})`,
    )
    const [views, events, truth] = await Promise.all([
      measureViews(ga, dw),
      measureEvents(ga, bw),
      measureTruth(auth, sa.projectId, { door: dw, beacon: bw }),
    ])
    verdict = gradeFunnel(
      FUNNEL_DOORS.map((door) => ({
        ...door,
        ...(views.get(door.pagePath) ?? { views: 0, users: 0 }),
        conversions: truth.door[door.truthField],
      })),
      FUNNEL_DOORS.map((door) => ({
        ...door,
        truth: truth.beacon[door.truthField],
        events: events.get(door.conversionEvent) ?? 0,
      })),
    )
  } catch (error) {
    // Fails open, loudly. See the header: a credential hiccup must not read
    // as a funnel outage.
    say(
      `COULD NOT READ GA4 OR AUTH — the funnel went unmeasured this run: ${error.message}`,
    )
    return 0
  }

  for (const line of verdictLines(verdict)) process.stdout.write(`${line}\n`)

  const runUrl = process.env.RUN_URL
  const decision = announceDecision({
    red: verdict.red,
    previousConclusion: process.env.PREVIOUS_CONCLUSION ?? '',
  })
  switch (decision) {
    case 'red':
      await announce(
        slackPayload({ verdict, doorWindow: dw, beaconWindow: bw, runUrl }),
      )
      break
    case 'silent':
      say('still red — announced on the run that turned red; not repeating it')
      break
    case 'recovered':
      await announce(recoveryPayload({ verdict, doorWindow: dw, runUrl }))
      break
    default:
      say('every door that took enough traffic to grade converted somebody')
  }
  return verdict.red ? 1 : 0
}

process.exitCode = await main()
