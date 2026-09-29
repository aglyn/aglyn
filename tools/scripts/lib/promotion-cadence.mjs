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

// How many promotions `production` may take in one day (AGL-3413).
//
// Every promotion rebuilds tenant, console and docs on Vercel, and Pro bills
// each build by the CPU-minute. The build line is therefore promotions × a
// near-constant price per promotion, and the only lever on it is how often we
// promote — the build cache, the ignore step and the machine size were all
// measured and none of them moves it. So the cadence is capped instead: a
// batch is what lands on `main` between promotions, and fewer promotions make
// bigger batches for the same work.
//
// A PROMOTION is a first-parent merge commit on `production`. That branch is
// PR-only, so every such merge is a promotion PR landing, and its committer
// date is the moment GitHub merged it. The DAY is a calendar day in Central
// time, the time zone the team works in, so the allowance resets at midnight
// there rather than at a UTC boundary in the middle of the evening.
//
// A hotfix is the one reason to go past the cap: production is broken for
// users and the fix cannot wait for tomorrow's allowance. It is an explicit
// flag (`--hotfix`, or the `hotfix` label on the PR), never an inference.

export const PROMOTIONS_PER_DAY = 3
export const PROMOTION_TIME_ZONE = 'America/Chicago'

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
function zoneOffsetMs(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  )
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000
}

/** The calendar date of `instant` in `timeZone`, as `YYYY-MM-DD`. */
export function zonedDate(instant, timeZone = PROMOTION_TIME_ZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

/**
 * Midnight at the start of the `timeZone` calendar day containing `instant`.
 *
 * The offset is read at the guessed midnight and then read again at the
 * result, because on a DST changeover day the offset at 00:00 differs from
 * the offset later that day.
 */
export function startOfZonedDay(instant, timeZone = PROMOTION_TIME_ZONE) {
  const [year, month, day] = zonedDate(instant, timeZone).split('-').map(Number)
  const wallMidnight = Date.UTC(year, month - 1, day)
  let start = wallMidnight - zoneOffsetMs(new Date(wallMidnight), timeZone)
  start = wallMidnight - zoneOffsetMs(new Date(start), timeZone)
  return new Date(start)
}

/**
 * Decides whether another promotion may go out today.
 *
 * `merges` is every first-parent merge on production that could fall in
 * today's window, as `{ sha, mergedAt: Date, subject }`; ones from earlier
 * days are ignored here, so the caller may over-read.
 */
export function evaluateCadence({
  merges,
  now = new Date(),
  limit = PROMOTIONS_PER_DAY,
  timeZone = PROMOTION_TIME_ZONE,
  hotfix = false,
}) {
  const dayStart = startOfZonedDay(now, timeZone)
  const today = merges
    .filter((merge) => merge.mergedAt >= dayStart && merge.mergedAt <= now)
    .sort((a, b) => a.mergedAt - b.mergedAt)
  const used = today.length
  const withinCap = used < limit
  return {
    allowed: withinCap || hotfix,
    hotfixOverride: !withinCap && hotfix,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    day: zonedDate(now, timeZone),
    timeZone,
    promotions: today,
  }
}

/** Human-readable lines for a verdict; the caller chooses where to print. */
export function describeCadence(verdict) {
  const lines = [
    `Promotions on ${verdict.day} (${verdict.timeZone}): ${verdict.used} of ${verdict.limit}`,
  ]
  for (const merge of verdict.promotions) {
    const time = new Intl.DateTimeFormat('en-US', {
      timeZone: verdict.timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(merge.mergedAt)
    lines.push(`  ${time}  ${merge.sha.slice(0, 9)}  ${merge.subject}`)
  }
  if (verdict.hotfixOverride) {
    lines.push(
      'Over the daily cap, allowed as a HOTFIX. Use it only for a fix production cannot wait a day for.',
    )
  } else if (!verdict.allowed) {
    lines.push(
      `Today's ${verdict.limit} promotions are used. Keep landing on main; the batch goes out tomorrow.`,
      'If production is broken for users and cannot wait, re-run as a hotfix (--hotfix, or the `hotfix` label on the PR).',
    )
  }
  return lines
}

/**
 * Reads first-parent merges on `ref` from the last two days, which always
 * covers the current Central day. `git` is `(...args) => stdout`.
 */
export function readProductionMerges(git, ref = 'origin/production') {
  const raw = git(
    'log',
    ref,
    '--first-parent',
    '--merges',
    '--since=2.days.ago',
    '--format=%H%x00%cI%x00%s',
  )
  if (!raw) return []
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, date, subject] = line.split('\x00')
      return { sha, mergedAt: new Date(date), subject: subject ?? '' }
    })
}
