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
 * The billing month a non-card POS fee accrues into (AGL-2111): `YYYY-MM` in
 * **UTC**, byte-identical to the key `apps/console/utils/billing-month.ts`
 * mints and to the twelve other month counters on the platform
 * (`orgs/{id}/apiUsage/*`, `orgs/{id}/assistUsage/*`, the per-host counters).
 *
 * It has to be UTC and it has to be this exact expression: `report-usage`
 * sweeps `previousMonth()` in UTC and reads the accrual document by that key,
 * so a local-time month would strand every sale rung in the offset window on a
 * document no sweep ever looks at — which is uncollected revenue that leaves
 * no trace. `offline-pos-fee-month-key.spec.ts` pins the two against each
 * other rather than trusting the comment.
 *
 * Local rather than imported because `apps/console` is an app: a plugin
 * library cannot import from it, and the repo's other eleven copies of this
 * one-liner are the established shape.
 */
export function offlineFeeMonthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7)
}
