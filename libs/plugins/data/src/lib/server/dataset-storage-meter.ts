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

import { checkDataStorageQuota } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type {
  PluginUsageMeterContext,
  PluginUsageMeterReading,
} from '@aglyn/aglyn/plugin-manager/plugin-usage-meters'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * Approximate aggregate dataset bytes for an org (AGL-240): per dataset, an
 * aggregate record count × the average serialized size of a small sample —
 * O(datasets) reads instead of O(records), good enough for metering.
 */
async function orgDatasetBytes(
  orgRef: FirebaseFirestore.DocumentReference,
): Promise<number> {
  const datasets = await orgRef.collection('datasets').get()
  // Datasets in parallel (AGL-1141). Each is two independent reads and the
  // results are summed, so walking them in sequence cost the sum of the
  // latencies for no ordering benefit.
  const perDataset = await Promise.all(
    datasets.docs.map(async (dataset) => {
      const records = dataset.ref.collection('records')
      const [countSnapshot, sample] = await Promise.all([
        records.count().get(),
        records.limit(50).get(),
      ])
      const count = Number(countSnapshot.data().count ?? 0)
      const sampleBytes = sample.docs.reduce(
        (sum, record) => sum + JSON.stringify(record.data() ?? {}).length,
        0,
      )
      const average = sample.size > 0 ? sampleBytes / sample.size : 0
      return (
        JSON.stringify(dataset.data() ?? {}).length + Math.round(average * count)
      )
    }),
  )
  return perDataset.reduce((sum, bytes) => sum + bytes, 0)
}

/**
 * The data plugin's month in the usage sweep: what the workspace's datasets
 * store, in the `dataStorageMb` the platform's data storage band and cost
 * model read, and the plan-priced overage past that band (AGL-240).
 *
 * A STOCK, read at the end of the month it bills (AGL-2399): the closed-month
 * sweep bills the last reading an in-progress sweep stamped inside the month,
 * and measures now only when there is none; the in-progress sweep stamps its
 * own reading as the period-end one, and a closed sweep never stamps, so
 * every re-run of a closed month bills the same amount.
 */
export async function measureDatasetStorage(
  context: PluginUsageMeterContext,
): Promise<PluginUsageMeterReading> {
  const orgRef = firebaseAdmin.app().firestore().collection('orgs').doc(context.orgId)
  const bytes = await orgDatasetBytes(orgRef)
  const dataStorageMbAtSweep = Math.round((bytes / (1024 * 1024)) * 10) / 10
  // A reading an earlier sweep stamped, or `null` when there is none to
  // trust — a malformed field falls back to measuring and never bills as 0.
  const stamped = Number(context.previous['dataStorageMbAtPeriodEnd'])
  const dataStorageMbAtPeriodEnd =
    Number.isFinite(stamped) && stamped >= 0 ? stamped : null
  const dataStorageMb =
    context.closed && dataStorageMbAtPeriodEnd !== null
      ? dataStorageMbAtPeriodEnd
      : dataStorageMbAtSweep
  // Plan-priced, not cost-plus: the overage the platform's data storage band
  // sells past what the plan includes.
  const quota = checkDataStorageQuota(context.org as never, dataStorageMb)
  return {
    fields: {
      // The billed figure, under the name the console meter, the budget card
      // and the cost model read.
      dataStorageMb,
      dataOverageUsd: quota.overageMonthlyUsd,
      dataStorageMbAtSweep,
    },
    periodEndFields: { dataStorageMbAtPeriodEnd: dataStorageMbAtSweep },
    billedUsd: quota.overageMonthlyUsd,
    periodEndBasis: context.closed && dataStorageMbAtPeriodEnd !== null,
  }
}
