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
 * Quiet hours for texts (AGL-3610): 9 PM to 8 AM in the recipient's zone,
 * the window US state telemarketing rules and carrier guidance both name.
 * A text asked to respect them that would land inside the window is held and
 * delivered at 8 AM local instead — by the provider's own scheduler, so there
 * is no queue of ours to drain or lose.
 */
export const QUIET_HOURS_START_HOUR = 21
export const QUIET_HOURS_END_HOUR = 8

/**
 * The provider's scheduling floor: Twilio refuses a send time less than 15
 * minutes ahead. A text due at 8 AM asked for at 7:55 goes a few minutes
 * past eight instead.
 */
export const SMS_SCHEDULE_MIN_LEAD_MS = 16 * 60_000

interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function wallClock(atMs: number, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(atMs))
  const read = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  }
}

/** The zone's offset from UTC at `atMs`, in ms (local minus UTC). */
function zoneOffsetMs(atMs: number, timeZone: string): number {
  const local = wallClock(atMs, timeZone)
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  )
  return asUtc - Math.floor(atMs / 1000) * 1000
}

/**
 * When a text asked for at `nowMs` should be delivered: `null` for "now"
 * (outside quiet hours, or a zone this runtime cannot read — a text is never
 * withheld over a bad zone name), or the instant of the next 8 AM in
 * `timeZone`, no sooner than the provider's scheduling floor.
 */
export function quietHoursSendAt(nowMs: number, timeZone: string): number | null {
  let local: WallClock
  try {
    local = wallClock(nowMs, timeZone)
  } catch {
    return null
  }
  if (local.hour >= QUIET_HOURS_END_HOUR && local.hour < QUIET_HOURS_START_HOUR) {
    return null
  }
  // Tomorrow's 8 AM when the evening has started; today's before dawn.
  const dayShift = local.hour >= QUIET_HOURS_START_HOUR ? 1 : 0
  const wallTarget = Date.UTC(
    local.year,
    local.month - 1,
    local.day + dayShift,
    QUIET_HOURS_END_HOUR,
  )
  // Two passes settle a target that sits across a daylight-saving change.
  let target = wallTarget - zoneOffsetMs(wallTarget, timeZone)
  target = wallTarget - zoneOffsetMs(target, timeZone)
  return Math.max(target, nowMs + SMS_SCHEDULE_MIN_LEAD_MS)
}
