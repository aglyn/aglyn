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
 * The product and variant check-in setting (AGL-4043): whether an item needs
 * check-in and how many people one item admits. It has no imports, so the
 * native contracts and the console read the same shape and rules.
 */

/** The most people one item admits. */
export const CHECK_IN_MAX_HEADCOUNT = 50

/**
 * Whether a product (or one variant) needs check-in (AGL-4043), and how
 * many people one item admits. On a product it is the default for every
 * variant; on a variant it overrides the product's.
 */
export interface ProductCheckIn {
  enabled: boolean
  /** People one item admits, 1–{@link CHECK_IN_MAX_HEADCOUNT}; absent is 1. */
  headcount?: number
  /**
   * Ask the buyer which day they will use it (a day pass bought ahead), as an
   * optional date at checkout. Without an answer the item is due on the day
   * it was bought, as every check-in item always has been. Absent is off.
   */
  askUseDate?: boolean
}

/*==========================================
 * THE USE DAY (pass dates, AGL-4043)
 *
 * The day an item is for is a day key, `YYYY-MM-DD` on the store's own
 * calendar (its time zone): the same key a check-in's `dayKey`, the day
 * totals' `from`/`to` and the check-in day picker use. An order line
 * carries the buyer's answer as `useDayKey`; a line without one is due on
 * the day the order was placed.
 *=========================================*/

/** The furthest ahead a buyer may choose a use day: about two years. */
export const CHECK_IN_USE_DAY_MAX_AHEAD_DAYS = 730

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

/** UTC midnight of a real `YYYY-MM-DD` calendar day, or null. */
function dayKeyMs(value: unknown): number | null {
  const match = typeof value === 'string' ? DAY_KEY.exec(value) : null
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const ms = Date.UTC(year, month - 1, day)
  const check = new Date(ms)
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day
    ? ms
    : null
}

/** Whether a value is a real calendar day written `YYYY-MM-DD`. */
export function isCheckInDayKey(value: unknown): value is string {
  return dayKeyMs(value) !== null
}

/** The day key `days` after (or before, when negative) another. */
export function addCheckInDays(dayKey: string, days: number): string {
  const ms = dayKeyMs(dayKey)
  if (ms === null) return dayKey
  return new Date(ms + Math.round(days) * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Why a chosen use day cannot be sold, or null: a day that is not a date, a
 * day before `todayKey` (today on the store's calendar), or one further
 * ahead than {@link CHECK_IN_USE_DAY_MAX_AHEAD_DAYS}.
 */
export function checkInUseDayProblem(value: unknown, todayKey: string): string | null {
  if (!isCheckInDayKey(value)) return 'Choose the day as a date.'
  if (value < todayKey) return 'That day has passed. Choose today or a later day.'
  if (value > addCheckInDays(todayKey, CHECK_IN_USE_DAY_MAX_AHEAD_DAYS)) {
    return 'Choose a day within the next two years.'
  }
  return null
}

function headcountOf(value: unknown): number {
  const count = Math.round(Number(value))
  return Number.isFinite(count) && count >= 1 ? Math.min(count, CHECK_IN_MAX_HEADCOUNT) : 1
}

/** A stored check-in setting made safe, or `undefined` when it says nothing. */
export function normalizeProductCheckIn(value: unknown): ProductCheckIn | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw['enabled'] !== 'boolean') return undefined
  return raw['enabled']
    ? {
        enabled: true,
        headcount: headcountOf(raw['headcount']),
        ...(raw['askUseDate'] === true ? { askUseDate: true } : {}),
      }
    : { enabled: false }
}

/** Why a check-in setting cannot be saved, or `null`. */
export function productCheckInProblem(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || typeof (value as ProductCheckIn).enabled !== 'boolean') {
    return 'Check-in must be on or off'
  }
  const askUseDate = (value as ProductCheckIn).askUseDate
  if (askUseDate !== undefined && typeof askUseDate !== 'boolean') {
    return 'Asking for a use date must be on or off'
  }
  const headcount = (value as ProductCheckIn).headcount
  if (headcount === undefined) return null
  if (!Number.isInteger(headcount) || headcount < 1 || headcount > CHECK_IN_MAX_HEADCOUNT) {
    return `People per item must be a whole number from 1 to ${CHECK_IN_MAX_HEADCOUNT}`
  }
  return null
}
