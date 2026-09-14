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
 * THE ORGS LIST'S "AI SPEND (MONTH)" COLUMN (AGL-2930).
 *
 * `/api/admin/orgs` serves each row's live `assistUsage/{thisMonth}` spend,
 * and the grid sorts whatever the column's `valueGetter` returns. These two
 * functions are that getter and that cell, kept out of the page so the
 * ordering can be pinned without mounting a DataGrid: a column that handed
 * the grid a formatted string would sort `$10.00` before `$9.00`.
 */

export interface StaffOrgAiSpendRow {
  /**
   * Provider spend this month in USD, or `null` when the org has no
   * `assistUsage` document for the month — "spent nothing" and "not measured"
   * stay distinct through the projection, as they do everywhere else.
   */
  aiSpendUsd?: number | null
}

/**
 * What the grid sorts by. A NUMBER, and `null` for an unmeasured org — the
 * grid puts nulls last in both directions, which is where an org that has
 * not touched AI belongs on a column whose point is finding the one that has.
 */
export function aiSpendSortValue(row: StaffOrgAiSpendRow): number | null {
  const value = row.aiSpendUsd
  if (value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * What the cell shows. Four decimals, for the AGL-2280 reason: a month that
 * really cost eight cents must not read as `$0.00`.
 */
export function aiSpendCell(row: StaffOrgAiSpendRow): string {
  const value = aiSpendSortValue(row)
  return value === null ? '—' : `$${value.toFixed(4)}`
}

/** The comparator the column's sort reduces to, for the spec and by hand. */
export function byAiSpendDesc(
  a: StaffOrgAiSpendRow,
  b: StaffOrgAiSpendRow,
): number {
  const left = aiSpendSortValue(a)
  const right = aiSpendSortValue(b)
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return right - left
}
