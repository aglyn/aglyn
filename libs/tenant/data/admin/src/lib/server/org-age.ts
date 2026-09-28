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

// The leaf, not the barrel: a spec that substitutes the barrel must still get
// the real day arithmetic here.
import { daysBetween } from '@aglyn/shared-util-email/sender-reputation'

/**
 * How old a workspace is, in days, from whatever its `createdAt` turns out to
 * be.
 *
 * Firestore hands back a `Timestamp`, a restore or a fixture can leave a
 * number, and an org written before the field existed has nothing. All three
 * are handled and the last one answers `null`, which
 * `claimOrgEmailSendDay` reads as graduated — the only safe direction,
 * for the reason stated there.
 */
export function orgAgeDays(
  createdAt: unknown,
  now: number = Date.now(),
): number | null {
  const raw = createdAt as
    | { toMillis?: () => number; seconds?: number }
    | number
    | string
    | null
    | undefined
  let createdMs = 0
  if (typeof raw === 'number') createdMs = raw
  else if (typeof raw === 'string') createdMs = Date.parse(raw)
  else if (typeof raw?.toMillis === 'function') createdMs = raw.toMillis()
  else if (typeof raw?.seconds === 'number') createdMs = raw.seconds * 1000
  /*
   * The one check, and it has to answer `null` rather than 0. A creation date
   * that could not be read is an org whose record predates the field, which
   * is an EXISTING customer; `0` would say "created today" and ramp every
   * paying tenant on the platform down to the first step.
   */
  if (!Number.isFinite(createdMs) || createdMs <= 0) return null
  return daysBetween(createdMs, now)
}
