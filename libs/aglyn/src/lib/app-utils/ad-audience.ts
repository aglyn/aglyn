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
 * The account-holder ad audience (AGL-3780): the opt-out a staff member
 * records on `users/{uid}` to keep one account out of the operator's own
 * customer-list audiences on Meta, Google and LinkedIn.
 *
 * Client-safe on purpose: the staff user page reads it to draw the switch,
 * and the nightly sync in `tenant-data-admin` reads it to leave the account
 * out. The rules refuse the field to every client, the account holder and
 * staff alike, so the one writer is the audited staff manage route.
 */

/** The field on `users/{uid}`. Absent means the account is not opted out. */
export const AD_AUDIENCE_OPT_OUT_FIELD = 'adAudienceOptOut'

/** What the field holds: when, and which staff member recorded it. */
export interface AdAudienceOptOut {
  atMs: number
  /** The staff member's uid. */
  by: string
}

/**
 * The opt-out a profile document holds, or null when it holds none.
 *
 * Any object counts as an opt-out, even one missing its fields: a malformed
 * record is still somebody asking for the account to be left out, and the
 * safe reading of it is "out".
 */
export function readAdAudienceOptOut(
  profile: Record<string, unknown> | null | undefined,
): AdAudienceOptOut | null {
  const raw = profile?.[AD_AUDIENCE_OPT_OUT_FIELD]
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  return {
    atMs: typeof record['atMs'] === 'number' && Number.isFinite(record['atMs']) ? record['atMs'] : 0,
    by: typeof record['by'] === 'string' ? record['by'] : '',
  }
}
