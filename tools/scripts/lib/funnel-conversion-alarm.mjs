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
/**
 * The views-to-conversions ratio, graded (AGL-2587). The pure half; the
 * network half — GA4 credentials, the Data API, the Slack post — is
 * `tools/scripts/check-funnel-conversions.mjs`.
 *
 * ## The quantity nothing was watching
 *
 * On 2026-09-01, the biggest traffic day of its period, `/signup` was viewed
 * 14 times by 5 people and `sign_up` fired zero times. The signup path was
 * broken (AGL-2581) and every one of those people bounced off it. Both halves
 * of that fact sat in GA4 the whole time.
 *
 * Neither half alarms on its own. Zero `sign_up` is the correct reading of a
 * quiet Tuesday, and page views are not a health metric. Only the RATIO says
 * anything: people arrived at the door, and the door opened for nobody.
 *
 * ## Why the thresholds, and why a check that cannot go green is worthless
 *
 * A rule that fires on "any view with no conversion" is red on nearly every
 * day this property has ever had — a single curious visitor is not an
 * incident — and a channel that is always red is a channel nobody reads.
 * So a door is graded only once the window holds enough traffic for "nobody
 * converted" to mean something:
 *
 *   • {@link MIN_VIEWS} views, so one look does not raise an alarm.
 *   • {@link MIN_USERS} distinct people, so one person reloading a page — or
 *     retrying a form they are stuck on — is not mistaken for a cohort.
 *     14 views by 1 user is a person having a bad time; 14 views by 5 users
 *     with nothing through is an outage.
 *
 * Both floors are cleared by the 2026-09-01 numbers and by neither of the
 * quiet days around them, which is the calibration the tests assert in both
 * directions.
 *
 * ## The lag guard is part of the alarm, not a detail
 *
 * GA4's batch tables trail live traffic. Grading today's numbers means
 * grading a half-written day, and a half-written day looks exactly like an
 * outage: views present, conversions not yet processed. That is the trap this
 * very issue nearly fell into over `org_created`, so the window ENDS
 * {@link PROCESSING_LAG_DAYS} days back. The alarm is a day or two late by
 * construction, and a day-late true alarm beats a same-day false one.
 */

/**
 * The doors. A door is a page a person has to get through and the GA4 event
 * that says they did. Adding one is adding an entry here.
 */
export const FUNNEL_DOORS = [
  {
    id: 'signup',
    label: 'Sign-up',
    pagePath: '/signup',
    conversionEvent: 'sign_up',
  },
  {
    id: 'signin',
    label: 'Sign-in',
    pagePath: '/signin',
    conversionEvent: 'login',
  },
]

/** Days of traffic graded together. Long enough to clear the floors. */
export const ALARM_WINDOW_DAYS = 3

/** How far back the window ends, to clear GA4's batch processing lag. */
export const PROCESSING_LAG_DAYS = 2

/** Views below this are a quiet window, not a silent door. */
export const MIN_VIEWS = 8

/** Distinct people below this is one person, not a cohort. */
export const MIN_USERS = 3

const DAY_MS = 24 * 60 * 60 * 1000

/** `YYYY-MM-DD` for a Date, in UTC. */
function isoDay(date) {
  return date.toISOString().slice(0, 10)
}

/**
 * The window to grade, ending `PROCESSING_LAG_DAYS` before `today` so no
 * partially-processed day is ever graded.
 *
 * @param {Date|string} today anchor — the run's own date.
 */
export function windowBounds(today) {
  const anchor = today instanceof Date ? today : new Date(`${today}T00:00:00Z`)
  const end = new Date(anchor.getTime() - PROCESSING_LAG_DAYS * DAY_MS)
  const start = new Date(end.getTime() - (ALARM_WINDOW_DAYS - 1) * DAY_MS)
  return { startDate: isoDay(start), endDate: isoDay(end) }
}

/**
 * Grade one door.
 *
 * Every green says WHY it is green, because "green" alone cannot be told
 * apart from "the query returned nothing and we called it fine" — which is
 * the failure mode a funnel alarm is most likely to die of.
 *
 * @param {{label:string,pagePath:string,conversionEvent:string,
 *          views:number,users:number,conversions:number}} door
 */
export function gradeDoor(door) {
  const views = Number(door.views) || 0
  const users = Number(door.users) || 0
  const conversions = Number(door.conversions) || 0
  const base = { ...door, views, users, conversions }
  if (conversions > 0) {
    return {
      ...base,
      verdict: 'green',
      reason: `${conversions} ${door.conversionEvent} from ${views} views`,
    }
  }
  if (views < MIN_VIEWS) {
    return {
      ...base,
      verdict: 'green',
      reason: `quiet window — ${views} views, under the ${MIN_VIEWS} needed to grade`,
    }
  }
  if (users < MIN_USERS) {
    return {
      ...base,
      verdict: 'green',
      reason: `${views} views but only ${users} visitor(s) — one person, not a cohort`,
    }
  }
  return {
    ...base,
    verdict: 'red',
    reason: `${views} views from ${users} people and not one ${door.conversionEvent}`,
  }
}

/**
 * Grade the whole funnel. Red when any door is.
 *
 * @param {Array} doors measured doors
 */
export function gradeFunnel(doors) {
  const graded = doors.map(gradeDoor)
  return {
    red: graded.some((d) => d.verdict === 'red'),
    doors: graded,
  }
}

/**
 * What Slack is told. Names the door, the numbers and the window, because a
 * conversion alarm that says only "conversions are down" sends the reader to
 * the GA4 UI to find out what this already knows.
 */
export function slackPayload({ verdict, window: range, runUrl }) {
  const broken = verdict.doors.filter((d) => d.verdict === 'red')
  const headline =
    broken.length === 1
      ? `${broken[0].label} is taking traffic and converting nobody`
      : 'The funnel is taking traffic and converting nobody'
  const summary = `${headline} (${range.startDate} → ${range.endDate})`
  const detail = [
    `*<${runUrl || 'https://github.com/aglyn/aglyn/actions'}|${headline}>*`,
    ...broken.map(
      (d) => `• \`${d.pagePath}\` — ${d.reason} (\`${d.conversionEvent}\`)`,
    ),
    `Window \`${range.startDate}\` → \`${range.endDate}\`, ending ` +
      `${PROCESSING_LAG_DAYS} days back so GA4's processing lag cannot fake this.`,
    'Either the door is broken or the event stopped being emitted. Both are ' +
      'incidents; check the door in a browser before assuming the second.',
  ].join('\n')
  return {
    text: summary,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: detail } }],
  }
}

/** One line per door, for the run log and the job summary. */
export function verdictLines(verdict) {
  return verdict.doors.map(
    (d) =>
      `${d.verdict === 'red' ? 'RED ' : 'ok  '} ${d.pagePath.padEnd(10)} ${d.reason}`,
  )
}
