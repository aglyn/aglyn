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

import type { PluginUsageAxesDeclaration } from '@aglyn/aglyn/plugin-manager/plugin-usage-axes'
import { AI_USAGE_METER_ID } from './constants'
import {
  ASSIST_CREDIT_COST_USD,
  ASSIST_PROVIDER_COST_FIELD,
} from '@aglyn/aglyn/app-utils/assist-credits'

/**
 * THE AI PLUGIN'S METER (AGL-3080): provider spend, in the platform's cost
 * model and against the credit band in its utilization table. Compiled into
 * core by the manifest generator (`register.usageAxes`).
 *
 * The rollup records `assistCostUsd` — what the month's tokens cost US, at
 * the provider's rates (AGL-3015) — so the axis enters the cost model at ×1
 * and names no rate. It is the one line on the platform whose unit cost is
 * real money paid to a third party, and the only one that can clear the
 * $2/site floor on its own, which is why a margin surface that could not see
 * it would rate a token-heavy workspace exactly as it rates an idle one.
 *
 * LIVE, because the rollup is a snapshot from when the cron ran and assist
 * keeps spending after it: a reader that fetches the month's
 * `assistUsage/{month}` document takes the provider figure, or the billed
 * one on a month closed before the two were split, over the snapshot.
 *
 * The band is sold in credits, and a credit is `ASSIST_CREDIT_COST_USD` of
 * spend, so what was used is the dollars over that — rounded up, the one
 * conversion the customer's own meter uses.
 *
 * On the usage BUDGET the month's spend is the billed figure (`estCostUsd`),
 * shown to the customer in credits and never in dollars: the dollars are our
 * cost, and publishing them would put our model choice and our margin on a
 * billing page. It counts toward the budget only from the month
 * `BILL_ASSIST_TOKENS_FROM` names, because assist is a plan entitlement with
 * no per-token price until then, and a budget that added it would be a
 * surprise bill invented by a notification.
 */
/** The AI plugin's line of a workspace's monthly spend, by the id it declares. */
export const AI_ASSIST_SPEND_LINE_ID = 'assist'

export function aiUsageAxes(): PluginUsageAxesDeclaration {
  return {
    costAxes: [
      {
        id: 'assist',
        order: 80,
        fields: ['assistCostUsd'],
        live: {
          collection: 'assistUsage',
          fields: [ASSIST_PROVIDER_COST_FIELD, 'estCostUsd'],
        },
      },
    ],
    bands: [
      {
        id: 'assistCredits',
        label: 'Assist credits',
        order: 90,
        fields: ['assistCostUsd'],
        entitlement: 'assistCreditsPerMonth',
        unitCostUsd: ASSIST_CREDIT_COST_USD,
      },
    ],
    meters: [{ id: AI_USAGE_METER_ID }],
    spendLines: [
      {
        id: AI_ASSIST_SPEND_LINE_ID,
        label: 'Assist',
        live: { collection: 'assistUsage', field: 'estCostUsd' },
        billedFromEnv: 'BILL_ASSIST_TOKENS_FROM',
        unit: { costUsd: ASSIST_CREDIT_COST_USD, label: 'Assist credits' },
      },
    ],
  }
}
