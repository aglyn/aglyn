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

import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { OrgPlan } from '@aglyn/aglyn/foundation/definitions/org-billing.types'

/**
 * What a plan change would leave an org over, as data rather than sentences.
 *
 * Split out of `over-limit-summary.ts` because that file is `'use client'` and
 * opens the client Firestore SDK to fetch its counts, so a server route cannot
 * import it — and the server is where a downgrade is actually decided. The
 * comparison itself is the part that must not exist twice: it has already been
 * wrong once, measuring datasets against the purchase CEILING
 * (`maxDatasetsPerOrg`) while printing the word "includes" beside it, which
 * cleared orgs that a downgrade would strand. One rule, two readers — the
 * summary the customer reads before choosing, and the refusal they get if they
 * choose anyway.
 *
 * This module is deliberately pure: no I/O, no SDK, no `'use client'`.
 */

/** The three capacities a plan change can strand. */
export type OverLimitKind = 'sites' | 'seats' | 'datasets'

/** Order is the order both readers present: sites, seats, datasets. */
export const OVER_LIMIT_KINDS: readonly OverLimitKind[] = [
  'sites',
  'seats',
  'datasets',
]

/**
 * Nouns per kind. `held` names the things counted; `unreadable` names the
 * capacity when there is no count to attach a noun to — "5 team members" is a
 * roster, "team seats could not be checked" is a quota, and they are not the
 * same word.
 */
const NOUNS: Record<OverLimitKind, { held: string; unreadable: string }> = {
  sites: { held: 'sites', unreadable: 'sites' },
  seats: { held: 'team members', unreadable: 'team seats' },
  datasets: { held: 'datasets', unreadable: 'datasets' },
}

export interface OverLimitRow {
  kind: OverLimitKind
  /** What the org holds. `null` when the count could not be read. */
  count: number | null
  /**
   * What the target plan INCLUDES — never `maxDatasetsPerOrg` and friends,
   * which are what the org could reach by BUYING on top.
   */
  included: number
  /** How many must be released to fit. 0 when the count is unreadable. */
  excess: number
}

/**
 * Counts to measure. `undefined` means "not measured, leave it out";
 * `null` means "measured and unanswerable", which is reported as unchecked
 * rather than omitted — the reassuring failure is the dangerous one here.
 */
export interface OverLimitCounts {
  siteCount?: number | null
  managerSeats?: number | null
  datasetCount?: number | null
}

/**
 * What the org would be over on `targetPlan`, in `OVER_LIMIT_KINDS` order so
 * the warning and the refusal list the same capacities in the same sequence.
 */
export function overLimitRows(
  counts: OverLimitCounts,
  targetPlan: OrgPlan,
): OverLimitRow[] {
  const target = PLAN_ENTITLEMENTS[targetPlan]
  if (!target) return []
  const measured: Record<OverLimitKind, { count: number | null | undefined; included: number }> = {
    sites: { count: counts.siteCount, included: target.hostLimit },
    seats: { count: counts.managerSeats, included: target.managersPerOrg },
    datasets: { count: counts.datasetCount, included: target.datasetsPerOrg },
  }
  const rows: OverLimitRow[] = []
  for (const kind of OVER_LIMIT_KINDS) {
    const { count, included } = measured[kind]
    if (count === undefined) continue
    if (count === null) {
      rows.push({ kind, count: null, included, excess: 0 })
      continue
    }
    if (count > included) {
      rows.push({ kind, count, included, excess: count - included })
    }
  }
  return rows
}

/**
 * One row as the pre-choice summary reads it: what you hold, what the plan
 * includes. No imperative — nothing is being refused at this point, the
 * customer is being told what a choice would cost them.
 */
export function overLimitSummaryLine(
  row: OverLimitRow,
  targetPlan: OrgPlan,
): string {
  const includes = `${targetPlan} includes ${row.included}`
  return row.count == null
    ? `${NOUNS[row.kind].unreadable} — could not be checked (${includes})`
    : `${row.count} ${NOUNS[row.kind].held} (${includes})`
}

/**
 * One row as a REFUSAL reads it: the count, the ceiling, and the number to
 * release. "You cannot do that" is a support ticket; "You have 8 datasets,
 * Starter includes 3, remove 5" is an action the customer can take without
 * asking anybody.
 *
 * Only meaningful for a row with a real count — an unreadable count names no
 * remedy and must never be the reason a plan change is refused.
 */
export function overLimitReleaseInstruction(
  row: OverLimitRow,
  targetPlan: OrgPlan,
): string {
  const plan = targetPlan.charAt(0).toUpperCase() + targetPlan.slice(1)
  return (
    `You have ${row.count} ${NOUNS[row.kind].held}. ` +
    `${plan} includes ${row.included}. ` +
    `Remove ${row.excess} to continue.`
  )
}

/** The rows that name a remedy — an unreadable count is not one of them. */
export function blockingOverLimitRows(rows: OverLimitRow[]): OverLimitRow[] {
  return rows.filter((row) => row.count != null && row.excess > 0)
}
