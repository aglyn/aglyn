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

import type { OutreachEnrollmentEngagement } from './outreach.types'

/**
 * WHAT ONE PERSON DID WITH THE LINKS THEY WERE SENT (AGL-3239), read back
 * from the stored map.
 *
 * Client-safe, and here rather than beside the writer for that reason: the
 * enrollments table renders this in the browser and the click route writes
 * it on the server, and both must agree on what an absent field means.
 *
 * Read defensively, a field at a time. `readOutreachEngagement(undefined)`
 * is what an enrollment that has never been clicked reads as — which is
 * every enrollment of every sequence that does not track clicks, so it is
 * the common case rather than the edge one.
 */
export function readOutreachEngagement(raw: unknown): OutreachEnrollmentEngagement {
  const data = (raw ?? {}) as Record<string, unknown>
  const count = (value: unknown): number => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
  }
  const ms = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null
  return {
    clicks: count(data['clicks']),
    firstClickAtMs: ms(data['firstClickAtMs']),
    lastClickAtMs: ms(data['lastClickAtMs']),
    lastClickUrl: typeof data['lastClickUrl'] === 'string' ? data['lastClickUrl'] : null,
    machineClicks: count(data['machineClicks']),
  }
}
