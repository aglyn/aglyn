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

import {
  checkDataStorageQuota,
  dataStorageEnforcementShape,
} from '@aglyn/aglyn/server'

/**
 * `dataStorageMbPerOrg`, answered once for every path that writes dataset
 * bytes (AGL-2253).
 *
 * AGL-2163 wired `checkDataStorageQuota().allowed` into `/api/orgs/datasets`
 * and stopped there, so the console route refused what the REST API and the
 * public form path went on accepting. The measurement and the shape logic
 * lived inside that route file, which is exactly why the other two writers
 * never got it — a gate that only one caller can reach is a gate the next
 * caller is guaranteed to miss.
 *
 * The VERDICT lives here; the REFUSAL does not. `/api/orgs/datasets` answers
 * a console `{ error }` 403, `/v1` answers an `ApiErrors.planRequired` body
 * with a machine-readable `code`, and the tenant form path answers nothing at
 * all — it drops the dataset row and still accepts the submission. Three
 * correct, incompatible renderings of one decision.
 *
 * ## What it costs a paying customer: NOTHING
 *
 * Every plan with an `extraDataGbMonthlyUsd` rate resolves to
 * `'never-blocks'` — the overage bills, exactly as `checkDataStorageQuota`'s
 * docblock promises — so the metered case returns `null` without a single
 * read and with no possibility of a refusal. Only the other two shapes cost
 * anything, and one of them costs no read either.
 */
export interface DataStorageRefusal {
  /** The included band the write would exceed, MB. */
  includedMb: number
  /**
   * `'always'` — the band is zero and the plan meters nothing, so no
   * measurement could change the answer and none was taken.
   * `'measured'` — a finite non-zero band on a plan with no rate, decided
   * against the monthly rollup.
   */
  basis: 'always' | 'measured'
}

/**
 * Null when the write may proceed; a refusal when dataset bytes are not
 * included on this org's plan.
 *
 * The `'measure'` shape reads `orgs/{orgId}/usage/{YYYY-MM}.dataStorageMb`
 * rather than re-summing the org's datasets: `report-usage`'s
 * `orgDatasetBytes` is O(datasets) reads with two aggregate queries EACH,
 * which is not a per-record-write cost. The reading is therefore up to a
 * month stale, and that is stated rather than hidden — it can only ever
 * UNDER-refuse, never refuse a write it should have allowed. The only orgs
 * that shape can reach are ones staff configured by hand
 * (`entitlementOverrides.dataStorageMbPerOrg` on a plan that meters nothing).
 */
export async function dataStorageRefusal(
  org: unknown,
  orgRef: FirebaseFirestore.DocumentReference,
  now: Date = new Date(),
): Promise<DataStorageRefusal | null> {
  const shape = dataStorageEnforcementShape(org as never)
  if (shape === 'never-blocks') return null
  if (shape === 'always-blocks') {
    return {
      includedMb: checkDataStorageQuota(org as never, 0).includedMb,
      basis: 'always',
    }
  }
  const usage = await orgRef
    .collection('usage')
    .doc(now.toISOString().slice(0, 7))
    .get()
  const quota = checkDataStorageQuota(
    org as never,
    Number(usage.get('dataStorageMb') ?? 0),
  )
  if (quota.allowed) return null
  return { includedMb: quota.includedMb, basis: 'measured' }
}
