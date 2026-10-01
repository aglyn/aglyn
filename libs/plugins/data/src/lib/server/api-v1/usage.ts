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

import { checkDatasetQuota } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  type ApiV1Context,
  usageBand,
} from '@aglyn/tenant-data-admin/server/api-v1-kit'

/**
 * The organization's datasets band on `GET /v1/usage` (AGL-2277, AGL-3080).
 *
 * Datasets are the one band with no overage RATE — extra slots are an add-on
 * the organization buys, not usage that meters — so `metered` is always false
 * and `included` is the effective limit INCLUDING purchased add-ons, which is
 * the number that actually refuses a create.
 */
export async function datasetUsageFigures(
  ctx: ApiV1Context,
): Promise<Record<string, unknown>> {
  const held = (
    await ctx.firestore
      .collection('orgs')
      .doc(ctx.orgId)
      .collection('datasets')
      .count()
      .get()
  ).data().count
  const quota = checkDatasetQuota(ctx.org, held)
  return { datasets: usageBand(held, quota.limit, quota.remaining, null) }
}
