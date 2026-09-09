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
 * The visitor-approximation claim (AGL-1844): "is this pageview the first
 * this tab has sent today?"
 *
 * ## What this is, exactly — and what it is not
 *
 * The day string in sessionStorage is the ENTIRE state: no id, no token, no
 * hash, nothing that distinguishes one visitor from another, so there is
 * nothing here to consent to (the same argument that exempts the pageview
 * beacon itself, see `site-analytics.tsx`). sessionStorage is scoped to the
 * tab and dies with it, so the resulting `visitors` counter is honestly
 * "approximate unique visits": one per browser tab per UTC day. A visitor
 * with two tabs counts twice; a visitor who closes the tab and comes back
 * counts again; nothing links today's visit to yesterday's. That
 * imprecision is the design — the alternative (a persistent client id or a
 * server-side IP+UA fingerprint) is exactly what the no-cookie/no-PII
 * posture rules out.
 *
 * Kept in its own import-free module so `site-analytics.tsx` stays inside
 * the AGL-1550 independence invariant and this stays unit-testable.
 */

const VISIT_DAY_KEY = 'aglyn-visit-day'

/**
 * True once per sessionStorage scope per `day`. Any storage failure
 * (disabled, quota, sandboxed iframe) answers false — under-counting is the
 * safe direction for a counter that only ever feeds a dashboard.
 */
export function claimDailyVisit(day: string): boolean {
  try {
    if (window.sessionStorage.getItem(VISIT_DAY_KEY) === day) return false
    window.sessionStorage.setItem(VISIT_DAY_KEY, day)
    return true
  } catch {
    return false
  }
}
