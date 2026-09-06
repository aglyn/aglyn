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
 * What a bulk action on the companies table WRITES (AGL-2621).
 *
 * A company is one holder's record — there is no facet to patch, the way a
 * contact has — so each plan is a plain top-level update per row: the owner
 * as the drawer stores it, the tags by `arrayUnion`/`arrayRemove` rather
 * than a rewritten array, because the rows the bar reads came off a
 * listener that may be behind the server and a bulk action must not roll
 * back what another console just saved. Deleting is not a plan here: a
 * company's delete is a detach pass and then a delete (`company-delete.ts`),
 * and the bar runs that per row.
 */

import { arrayRemove, arrayUnion, deleteField } from 'firebase/firestore'
import type { CrmBulkPlan, CrmBulkSkip, CrmBulkWrite } from './crm-bulk-writes'

/** The drawer's cap on a company's tags — the same number, so the two agree. */
export const COMPANY_TAGS_CAP = 20

/** As much of a companies row as a bulk write reads. */
export interface CompanyBulkRow {
  $id: string
  name?: string
  tags?: string[]
  ownerUid?: string
}

/** The name a report lists a company under, falling back to the id. */
const labelOf = (row: CompanyBulkRow): string => String(row.name || row.$id)

/**
 * Add one tag to every row. A row that already carries it is skipped
 * silently — `arrayUnion` would write nothing; a row at the cap without it
 * is skipped AND named, so the bar cannot slip past the drawer's limit.
 */
export function planCompanyAddTag(
  rows: readonly CompanyBulkRow[],
  tag: string,
  nowMs: number,
): CrmBulkPlan {
  const writes: CrmBulkWrite[] = []
  const skipped: CrmBulkSkip[] = []
  for (const row of rows) {
    const held = (row.tags ?? []).map((held) => held.toLowerCase())
    if (held.includes(tag)) continue
    if (held.length >= COMPANY_TAGS_CAP) {
      skipped.push({ label: labelOf(row), reason: `already has ${COMPANY_TAGS_CAP} tags` })
      continue
    }
    writes.push({
      id: row.$id,
      label: labelOf(row),
      kind: 'update',
      data: { tags: arrayUnion(tag), updatedAt: new Date(nowMs) },
    })
  }
  return { writes, skipped }
}

/** Take one tag off every row that has it; the rest are left alone. */
export function planCompanyRemoveTag(
  rows: readonly CompanyBulkRow[],
  tag: string,
  nowMs: number,
): CrmBulkPlan {
  const writes: CrmBulkWrite[] = []
  for (const row of rows) {
    const held = (row.tags ?? []).map((held) => held.toLowerCase())
    if (!held.includes(tag)) continue
    writes.push({
      id: row.$id,
      label: labelOf(row),
      kind: 'update',
      data: { tags: arrayRemove(tag), updatedAt: new Date(nowMs) },
    })
  }
  return { writes, skipped: [] }
}

/**
 * Set the owner on every row. An empty owner DELETES the field rather than
 * writing an empty string — the drawer clears it the same way, and the
 * Owner column filter is an equality that must not find `''`.
 */
export function planCompanySetOwner(
  rows: readonly CompanyBulkRow[],
  ownerUid: string | null,
  nowMs: number,
): CrmBulkPlan {
  return {
    writes: rows.map((row) => ({
      id: row.$id,
      label: labelOf(row),
      kind: 'update' as const,
      data: {
        ownerUid: ownerUid ? ownerUid : deleteField(),
        updatedAt: new Date(nowMs),
      },
    })),
    skipped: [],
  }
}
