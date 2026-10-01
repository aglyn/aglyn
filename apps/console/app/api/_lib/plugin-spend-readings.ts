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

import { pluginSpendLines } from '@aglyn/aglyn/plugin-manager/plugin-usage-axes'

/**
 * Each declared spend line's figure for one workspace's month, keyed by line
 * id — the input `orgMonthlySpend` takes as `lineReadings`.
 *
 * One read per line, `orgs/{orgId}/{collection}/{month}`, as the line's
 * declaration names it. A missing document reads as `undefined`, which the
 * budget reads as nothing spent; the month is fixed by the caller, never
 * "now", so a figure and the rollup it sits beside describe one period.
 */
export async function readPluginSpendLines(
  orgRef: FirebaseFirestore.DocumentReference,
  month: string,
): Promise<Record<string, unknown>> {
  const lines = pluginSpendLines()
  const documents = await Promise.all(
    lines.map((line) => orgRef.collection(line.live.collection).doc(month).get()),
  )
  return Object.fromEntries(
    lines.map((line, index) => [line.id, documents[index]?.get(line.live.field)]),
  )
}
