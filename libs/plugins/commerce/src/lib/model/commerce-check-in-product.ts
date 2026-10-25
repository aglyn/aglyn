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
    ? { enabled: true, headcount: headcountOf(raw['headcount']) }
    : { enabled: false }
}

/** Why a check-in setting cannot be saved, or `null`. */
export function productCheckInProblem(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || typeof (value as ProductCheckIn).enabled !== 'boolean') {
    return 'Check-in must be on or off'
  }
  const headcount = (value as ProductCheckIn).headcount
  if (headcount === undefined) return null
  if (!Number.isInteger(headcount) || headcount < 1 || headcount > CHECK_IN_MAX_HEADCOUNT) {
    return `People per item must be a whole number from 1 to ${CHECK_IN_MAX_HEADCOUNT}`
  }
  return null
}
