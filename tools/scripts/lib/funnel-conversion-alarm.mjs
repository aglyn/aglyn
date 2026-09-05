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
 * The views-to-conversions ratio, graded (AGL-2587; re-timed to the hour by
 * AGL-2609). The pure half; the network half — GA4, the Identity Toolkit
 * admin API, the Slack post — is `tools/scripts/check-funnel-conversions.mjs`.
 *
 * ## The quantity nothing was watching
 *
 * On 2026-09-01, the biggest traffic day of its period, `/signup` was viewed
 * 14 times by 5 people and not one account was created. The signup path was
 * broken (AGL-2581) and every one of those people bounced off it. Both halves
 * of that fact sat in the platform's own data the whole time.
 *
 * Neither half alarms on its own. Zero signups is the correct reading of a
 * quiet Tuesday, and page views are not a health metric. Only the RATIO says
 * anything: people arrived at the door, and the door opened for nobody.
 *
 * ## Why the conversions come from Firebase Auth and not from a GA4 event
 *
 * The first version graded `/signup` views against GA4's `sign_up` event,
 * over a window that ended two days back, because GA4's batch tables trail
 * live traffic — five hours behind the clock, measured on this property — and
 * a half-processed window looks exactly like an outage: views present,
 * conversions not yet counted. That guard made the alarm right and useless.
 * It named the AGL-2581 outage four days after it began and a day after it
 * had been fixed.
 *
 * The guard was protecting the numerator, so the numerator moved. An account
 * created is a row in Firebase Auth with a `createdAt`; a person signed in is
 * a `lastLoginAt`. Both are complete the instant they happen, and neither
 * waits behind a consent banner. With the truth on that side, GA4's lag can
 * only make the alarm QUIETER — fewer views counted, harder to clear the
 * floors — never falsely red. So the door window ends now, and the run is
 * hourly.
 *
 * ## Why a check that cannot go green is worthless
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
 *     14 views by 1 user is a person having a bad time; 9 views by 4 users
 *     with nothing through is an outage.
 *
 * Both floors are cleared by the 2026-09-01 numbers inside a single
 * {@link DOOR_WINDOW_HOURS}-hour window, and by neither of the quiet days
 * around them, which is the calibration the tests assert in both directions.
 *
 * ## The beacon check is where the lag guard still belongs
 *
 * "Accounts were created and GA4 recorded no `sign_up`" is still an incident.
 * Google Ads imports that event, and its path has silently died three times
 * (AGL-2548, AGL-2558, AGL-2559). Comparing Auth against GA4 needs GA4 to
 * have finished processing, so that grade — and only that grade — keeps a
 * settled window ending {@link PROCESSING_LAG_DAYS} days back. A beacon red
 * is a different incident from a door red, and the message says which.
 *
 * ## Saying it once
 *
 * An hourly alarm that re-posts every hour is a channel nobody reads by
 * lunchtime. {@link announceDecision} posts a red once, stays silent while it
 * persists — the run still fails, so the history shows it — and posts once
 * more when it clears.
 */

/**
 * The doors. A door is a page a person has to get through, the Firebase Auth
 * field that says they did, and the GA4 event that is supposed to say so
 * too. Adding one is adding an entry here.
 */
export const FUNNEL_DOORS = [
  {
    id: 'signup',
    label: 'Sign-up',
    pagePath: '/signup',
    conversionEvent: 'sign_up',
    truthField: 'createdAt',
    truth: 'account created',
    truthPlural: 'accounts created',
  },
  {
    id: 'signin',
    label: 'Sign-in',
    pagePath: '/signin',
    conversionEvent: 'login',
    truthField: 'lastLoginAt',
    truth: 'person signed in',
    truthPlural: 'people signed in',
  },
]

/**
 * Hours of traffic graded together for a door, ending now. Short enough that
 * a success does not mask a break for a day; long enough to clear the floors
 * on a day people actually arrive. Backtested: the 2026-09-01 outage is red
 * inside one such window by 23:00 Chicago time.
 */
export const DOOR_WINDOW_HOURS = 12

/** Days compared for the beacon check, settled. */
export const BEACON_WINDOW_DAYS = 7

/** How far back the beacon window ends, to clear GA4's batch processing lag. */
export const PROCESSING_LAG_DAYS = 2

/** Views below this are a quiet window, not a silent door. */
export const MIN_VIEWS = 8

/** Distinct people below this is one person, not a cohort. */
export const MIN_USERS = 3

/**
 * Conversions below this cannot prove a beacon dead: a visitor who declined
 * analytics consent creates an account and emits nothing, so a couple of
 * truths with no event is the consent gate, not an outage.
 */
export const MIN_BEACON_TRUTH = 3

/**
 * The property's reporting zone, when the Admin API cannot be asked. GA4's
 * `date` and `dateHour` are in this zone, not UTC — `docs/ANALYTICS.md`.
 */
export const PROPERTY_TIME_ZONE_FALLBACK = 'America/Chicago'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const pad2 = (n) => String(n).padStart(2, '0')

const toMs = (when) =>
  when instanceof Date
    ? when.getTime()
    : typeof when === 'number'
      ? when
      : Date.parse(when)

/* ========================================================================= *
 * TIME IN THE PROPERTY'S ZONE
 *
 * GA4 buckets by the property's wall clock. Every window here is expressed
 * twice — as instants for Firebase Auth, whose timestamps are epoch
 * milliseconds, and as the zone's `date`/`dateHour` strings for GA4 — and the
 * two have to describe the same span, or the alarm compares a door's traffic
 * against a different hour's conversions.
 * ========================================================================= */

/** The zone's wall-clock parts at an instant. */
function wallClock(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms))
  const out = {}
  for (const { type, value } of parts) {
    if (type !== 'literal') out[type] = Number(value)
  }
  return out
}

/** The zone's offset from UTC at an instant, in milliseconds (east positive). */
function zoneOffsetMs(ms, timeZone) {
  const w = wallClock(ms, timeZone)
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  return asUtc - Math.floor(ms / 1000) * 1000
}

/**
 * The instant at which the zone's wall clock reads `year-month-day hour:00`.
 * Two passes settle a DST edge, where the offset at the guess differs from
 * the offset at the answer.
 */
export function zonedHourInstant({ year, month, day, hour = 0 }, timeZone) {
  const wall = Date.UTC(year, month - 1, day, hour)
  const first = wall - zoneOffsetMs(wall, timeZone)
  return wall - zoneOffsetMs(first, timeZone)
}

/** The start of the wall-clock hour containing `ms`. */
export function floorToHour(ms, timeZone) {
  return zonedHourInstant(wallClock(ms, timeZone), timeZone)
}

/** GA4's `dateHour` value for an instant: `YYYYMMDDHH` in the zone. */
export function hourBucket(ms, timeZone) {
  const w = wallClock(ms, timeZone)
  return `${w.year}${pad2(w.month)}${pad2(w.day)}${pad2(w.hour)}`
}

/** GA4's `date` value for an instant: `YYYY-MM-DD` in the zone. */
export function isoDay(ms, timeZone) {
  const w = wallClock(ms, timeZone)
  return `${w.year}-${pad2(w.month)}-${pad2(w.day)}`
}

/**
 * Every `dateHour` bucket touching `[startMs, endMs]`, in order. A DST
 * fall-back repeats a wall-clock hour, so two instants can share a bucket;
 * the set keeps each once.
 */
export function hourBuckets(startMs, endMs, timeZone) {
  const buckets = new Set()
  for (let t = floorToHour(startMs, timeZone); t <= endMs; t += HOUR_MS) {
    buckets.add(hourBucket(t, timeZone))
  }
  buckets.add(hourBucket(endMs, timeZone))
  return [...buckets]
}

/**
 * The door window: the trailing {@link DOOR_WINDOW_HOURS}, ending at `now`,
 * starting on a wall-clock hour so the GA4 buckets and the Auth span begin at
 * the same instant.
 *
 * @param {Date|number|string} now the run's own instant
 * @param {string} timeZone the property's reporting zone
 */
export function doorWindow(now, timeZone) {
  const endMs = toMs(now)
  const startMs = floorToHour(endMs - DOOR_WINDOW_HOURS * HOUR_MS, timeZone)
  return { startMs, endMs, hours: DOOR_WINDOW_HOURS, timeZone }
}

/**
 * The beacon window: {@link BEACON_WINDOW_DAYS} whole property days, ending
 * {@link PROCESSING_LAG_DAYS} days before `now` so no partially-processed day
 * is ever compared. `startDate`/`endDate` are what GA4 is asked for;
 * `startMs`/`endMs` are the same span for Auth, midnight to midnight in the
 * zone.
 */
export function beaconWindow(now, timeZone) {
  const endDayMs = toMs(now) - PROCESSING_LAG_DAYS * DAY_MS
  const startDayMs = endDayMs - (BEACON_WINDOW_DAYS - 1) * DAY_MS
  const startDate = isoDay(startDayMs, timeZone)
  const endDate = isoDay(endDayMs, timeZone)
  const dayParts = (iso) => {
    const [year, month, day] = iso.split('-').map(Number)
    return { year, month, day }
  }
  const after = new Date(Date.parse(`${endDate}T00:00:00Z`) + DAY_MS)
  return {
    startDate,
    endDate,
    startMs: zonedHourInstant(dayParts(startDate), timeZone),
    endMs: zonedHourInstant(
      {
        year: after.getUTCFullYear(),
        month: after.getUTCMonth() + 1,
        day: after.getUTCDate(),
      },
      timeZone,
    ),
    days: BEACON_WINDOW_DAYS,
    timeZone,
  }
}

/**
 * How many Auth records carry `field` inside `[startMs, endMs]`. The field
 * values are epoch-millisecond strings, as the Identity Toolkit returns them.
 */
export function countWithin(records, field, { startMs, endMs }) {
  let n = 0
  for (const record of records ?? []) {
    const at = Number(record?.[field])
    if (Number.isFinite(at) && at >= startMs && at <= endMs) n += 1
  }
  return n
}

/* ========================================================================= *
 * GRADING
 * ========================================================================= */

/**
 * Grade one door: views and distinct visitors from GA4, conversions from Auth.
 *
 * Every green says WHY it is green, because "green" alone cannot be told
 * apart from "the query returned nothing and we called it fine" — which is
 * the failure mode a funnel alarm is most likely to die of.
 *
 * @param {{label:string,pagePath:string,truth:string,truthPlural:string,
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
      reason: `${conversions} ${conversions === 1 ? door.truth : door.truthPlural} from ${views} views`,
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
    reason: `${views} views from ${users} people and not one ${door.truth}`,
  }
}

/**
 * Grade one beacon: conversions Auth knows happened against the GA4 event
 * that should have reported each one, over a settled window.
 *
 * @param {{conversionEvent:string,truthPlural:string,truth:number,events:number}} beacon
 */
export function gradeBeacon(beacon) {
  const truth = Number(beacon.truth) || 0
  const events = Number(beacon.events) || 0
  const base = { ...beacon, truth, events }
  if (events > 0) {
    return {
      ...base,
      verdict: 'green',
      reason: `${events} ${beacon.conversionEvent} against ${truth} ${beacon.truthPlural}`,
    }
  }
  if (truth < MIN_BEACON_TRUTH) {
    return {
      ...base,
      verdict: 'green',
      reason: `${truth} ${beacon.truthPlural}, under the ${MIN_BEACON_TRUTH} needed to grade`,
    }
  }
  return {
    ...base,
    verdict: 'red',
    reason: `${truth} ${beacon.truthPlural} and not one ${beacon.conversionEvent} reached GA4`,
  }
}

/**
 * Grade the whole funnel. Red when any door or any beacon is.
 *
 * @param {Array} doors measured doors
 * @param {Array} beacons measured beacons
 */
export function gradeFunnel(doors, beacons = []) {
  const gradedDoors = doors.map(gradeDoor)
  const gradedBeacons = beacons.map(gradeBeacon)
  return {
    red: [...gradedDoors, ...gradedBeacons].some((d) => d.verdict === 'red'),
    doors: gradedDoors,
    beacons: gradedBeacons,
  }
}

/**
 * Whether this run should speak, given the previous scheduled run's
 * conclusion (`success`, `failure`, or `''` when there is none).
 *
 *   red       — newly red: announce it
 *   silent    — still red: the history shows it, the channel already knows
 *   recovered — first green after a red: say so, once
 *   quiet     — green after green: nothing to say
 */
export function announceDecision({ red, previousConclusion }) {
  const wasRed = previousConclusion === 'failure'
  if (red) return wasRed ? 'silent' : 'red'
  return wasRed ? 'recovered' : 'quiet'
}

/* ========================================================================= *
 * WHAT THE CHANNEL IS TOLD
 * ========================================================================= */

const isoMinute = (ms) => `${new Date(ms).toISOString().slice(0, 16)}Z`

/** "the 12 hours to 2026-09-02T05:00Z" */
export function doorWindowLabel(window) {
  return `the ${window.hours} hours to ${isoMinute(window.endMs)}`
}

const actionsUrl = (runUrl) =>
  runUrl || 'https://github.com/aglyn/aglyn/actions'

/**
 * The red message. Names the door, the numbers and the window, because an
 * alarm that says only "conversions are down" sends the reader to the GA4 UI
 * to find out what this already knows — and says which KIND of red it is,
 * because a broken door and a dead beacon are different incidents with
 * different first moves.
 */
export function slackPayload({
  verdict,
  doorWindow: dw,
  beaconWindow: bw,
  runUrl,
}) {
  const brokenDoors = verdict.doors.filter((d) => d.verdict === 'red')
  const brokenBeacons = verdict.beacons.filter((b) => b.verdict === 'red')
  let headline
  if (brokenDoors.length === 1) {
    headline = `${brokenDoors[0].label} is taking traffic and converting nobody`
  } else if (brokenDoors.length > 1) {
    headline = 'The funnel is taking traffic and converting nobody'
  } else if (brokenBeacons.length === 1) {
    headline = `\`${brokenBeacons[0].conversionEvent}\` stopped reaching GA4`
  } else {
    headline = 'The funnel events stopped reaching GA4'
  }
  const lines = [`*<${actionsUrl(runUrl)}|${headline}>*`]
  if (brokenDoors.length) {
    for (const d of brokenDoors) {
      lines.push(`• \`${d.pagePath}\` — ${d.reason}, ${doorWindowLabel(dw)}`)
    }
    lines.push(
      'Conversions are counted from Firebase Auth, not from GA4, so this is ' +
        'the door itself: people reached it and nothing came out. Open it in ' +
        'a browser now. (Page views arrive from GA4 hours late, which can only ' +
        'understate the traffic, never invent the failure.)',
    )
  }
  if (brokenBeacons.length) {
    for (const b of brokenBeacons) {
      lines.push(
        `• \`${b.conversionEvent}\` — ${b.reason} (${bw.startDate} → ${bw.endDate})`,
      )
    }
    lines.push(
      'That window is fully processed, so the event is not being emitted or ' +
        'not arriving. Google Ads imports it: conversions are blind until it is fixed.',
    )
  }
  const windowNote = brokenDoors.length
    ? doorWindowLabel(dw)
    : `${bw.startDate} → ${bw.endDate}`
  return {
    text: `${headline} (${windowNote})`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
    ],
  }
}

/**
 * The all-clear, sent once when a red clears. Lists every door's reason so
 * "green" is never mistaken for "converting" when it means "quiet".
 */
export function recoveryPayload({ verdict, doorWindow: dw, runUrl }) {
  const headline = 'The funnel alarm is green again'
  const lines = [
    `*<${actionsUrl(runUrl)}|${headline}>*`,
    ...verdict.doors.map((d) => `• \`${d.pagePath}\` — ${d.reason}`),
    ...verdict.beacons.map((b) => `• \`${b.conversionEvent}\` — ${b.reason}`),
    `Doors graded over ${doorWindowLabel(dw)}.`,
  ]
  return {
    text: `${headline} (${doorWindowLabel(dw)})`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
    ],
  }
}

/** One line per door and beacon, for the run log and the job summary. */
export function verdictLines(verdict) {
  const flag = (v) => (v === 'red' ? 'RED ' : 'ok  ')
  return [
    ...verdict.doors.map(
      (d) => `${flag(d.verdict)} door   ${d.pagePath.padEnd(10)} ${d.reason}`,
    ),
    ...verdict.beacons.map(
      (b) =>
        `${flag(b.verdict)} beacon ${b.conversionEvent.padEnd(10)} ${b.reason}`,
    ),
  ]
}
