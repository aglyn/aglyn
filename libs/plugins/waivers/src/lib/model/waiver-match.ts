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

import { isDayKey } from './waiver'

/*==========================================
 * MATCHING A RIDER TO A SIGNATURE (AGL-4042): by email first; when the
 * rider has no email match, by full name AND date of birth together, never
 * by a name alone. A minor a parent or guardian listed is matched the same
 * way, by their own name and birth date.
 *
 * Each signature carries `nameDobKeys`: one key per person it covers (the
 * signer, then each minor), written when it is signed, so the match is one
 * Firestore query (`array-contains`) on an index, never a scan. Server-side
 * only: this module is not part of the plugin's eager barrel.
 *=========================================*/

/** How many people one signature's keys cover: the signer and up to the form's minors. */
export const WAIVER_NAME_DOB_KEYS_MAX = 30

/** What check-in says when the rider has no email match and no birth date to match a name with. */
export const WAIVER_NOT_MATCHED_LABEL = 'Waiver not matched — check by name'

/** A name as the match reads it: case and spacing do not count; spelling does. */
export function waiverMatchName(name: unknown): string {
  return String(name ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

/**
 * One person's match key, `name|YYYY-MM-DD`, or `null` without both a name
 * and a real date of birth.
 */
export function waiverNameDobKey(name: unknown, dateOfBirth: unknown): string | null {
  const matchName = waiverMatchName(name)
  const day = String(dateOfBirth ?? '').trim()
  if (!matchName || !isDayKey(day)) return null
  return `${matchName}|${day}`
}

/** Every person a signature covers, as match keys: the signer, then each minor. */
export function waiverNameDobKeys(signature: {
  signer?: { name?: unknown; dateOfBirth?: unknown } | null
  minors?: ReadonlyArray<{ name?: unknown; dateOfBirth?: unknown }> | null
}): string[] {
  const people = [signature.signer, ...(signature.minors ?? [])]
  const keys = new Set<string>()
  for (const person of people) {
    const key = waiverNameDobKey(person?.name, person?.dateOfBirth)
    if (key) keys.add(key)
  }
  return [...keys].slice(0, WAIVER_NAME_DOB_KEYS_MAX)
}

/** Whether a stored signature's keys are what its people say they should be. */
export function waiverNameDobKeysCurrent(signature: Parameters<typeof waiverNameDobKeys>[0] & { nameDobKeys?: unknown }): boolean {
  const stored = Array.isArray(signature.nameDobKeys) ? signature.nameDobKeys : null
  const wanted = waiverNameDobKeys(signature)
  return Boolean(stored) && stored!.length === wanted.length && wanted.every((key, at) => stored![at] === key)
}
