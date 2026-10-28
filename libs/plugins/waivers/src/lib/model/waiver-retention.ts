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

import { WAIVER_RETENTION_YEARS, WAIVER_RETENTION_YEARS_KEY } from '../constants/settings'
import { WAIVER_DEFAULT_ADULT_AGE, addDays, isDayKey } from './waiver'

export { WAIVERS_CONFIG_SCHEMA, WAIVER_RETENTION_YEARS, WAIVER_RETENTION_YEARS_KEY } from '../constants/settings'

/*==========================================
 * HOW LONG A SIGNED WAIVER IS KEPT (AGL-4042).
 *
 * Every signed waiver is the store's record of what a rider agreed to, and
 * every one is kept for the store's waiver retention period, then deleted
 * with its drawn signature and paper photo. An erasure request does not
 * delete it sooner. The period is a plugin setting, at the workspace and per
 * site, in whole years, counted from the last day the waiver covers, or, for
 * one signed for minors, from the day the youngest of them reaches the
 * waiver's adult age, whichever is later.
 *
 * A signature is stamped with the date it is deleted (`retainUntilMs`) and
 * the period that date was counted with (`retentionYears`) when it is
 * signed; the retention job stamps it again when the store changes the
 * period. Pure: signing, the eraser, the retention job, the backfill script
 * and the console read the same rule from here.
 *=========================================*/

/** The period a resolved settings object names, in whole years, inside the bounds. */
export function waiverRetentionYears(config: Record<string, unknown> | null | undefined): number {
  const years = Math.trunc(Number(config?.[WAIVER_RETENTION_YEARS_KEY]))
  if (!Number.isFinite(years)) return WAIVER_RETENTION_YEARS.default
  return Math.min(WAIVER_RETENTION_YEARS.max, Math.max(WAIVER_RETENTION_YEARS.min, years))
}

const yearsAfter = (dayKey: string, years: number): string => {
  const [y, m, d] = dayKey.split('-').map(Number)
  // Feb 29 on a year with none rolls to Mar 1, never a day early.
  return new Date(Date.UTC(y + years, m - 1, d)).toISOString().slice(0, 10)
}

/** What the rule reads of a signature. */
export interface WaiverRetentionSubject {
  validThroughDayKey: string
  minors?: ReadonlyArray<{ dateOfBirth: string }> | null
  adultAge?: number | null
}

/**
 * The day a kept signature's period is counted from: the last day it
 * covers, or the day the youngest minor on it reaches the waiver's adult
 * age, whichever is later.
 */
export function waiverRetentionStartDayKey(signature: WaiverRetentionSubject): string {
  let start = signature.validThroughDayKey
  const adultAge = Number.isInteger(signature.adultAge) ? Number(signature.adultAge) : WAIVER_DEFAULT_ADULT_AGE
  for (const minor of signature.minors ?? []) {
    if (!isDayKey(minor?.dateOfBirth)) continue
    const comesOfAge = yearsAfter(minor.dateOfBirth, adultAge)
    if (comesOfAge > start) start = comesOfAge
  }
  return start
}

/**
 * When a kept signature is deleted, epoch ms: the start of the day after the
 * period ends (UTC), so the whole of its last day is kept.
 */
export function waiverRetainUntilMs(signature: WaiverRetentionSubject, years: number): number {
  const lastKept = yearsAfter(waiverRetentionStartDayKey(signature), years)
  const [y, m, d] = addDays(lastKept, 1).split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** What a signature carries of its retention: when it is deleted, and the period that was counted with. */
export interface WaiverRetentionStamp {
  retainUntilMs: number
  retentionYears: number
}

/** A signature's retention stamp under a period of `years`. */
export function waiverRetentionStamp(signature: WaiverRetentionSubject, years: number): WaiverRetentionStamp {
  return { retainUntilMs: waiverRetainUntilMs(signature, years), retentionYears: years }
}

/**
 * Whether a signature's stored stamp differs from the one its period gives
 * now: never stamped (signed before every signature was), or stamped under a
 * period the store has since changed.
 */
export function waiverRetentionStampMoved(
  stored: { retainUntilMs?: number | null; retentionYears?: number | null },
  stamp: WaiverRetentionStamp,
): boolean {
  return stored.retainUntilMs !== stamp.retainUntilMs || stored.retentionYears !== stamp.retentionYears
}
