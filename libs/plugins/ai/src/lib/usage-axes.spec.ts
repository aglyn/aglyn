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
  ASSIST_CREDIT_COST_USD,
  ASSIST_PROVIDER_COST_FIELD,
} from './usage/assist-credits'
import {
  pluginCostAxes,
  pluginSpendLines,
  pluginUsageBands,
} from '@aglyn/aglyn/plugin-manager/plugin-usage-axes'
import { aiUsageAxes } from './usage-axes'

describe('provider spend is the AI plugin’s meter to declare (AGL-3080)', () => {
  it('reaches core’s cost model and utilization table as declared', () => {
    const declared = aiUsageAxes()
    expect(pluginCostAxes().filter((axis) => axis.pluginId === 'ai')).toEqual(
      (declared.costAxes ?? []).map((axis) => ({ pluginId: 'ai', ...axis })),
    )
    expect(pluginUsageBands().filter((band) => band.pluginId === 'ai')).toEqual(
      (declared.bands ?? []).map((band) => ({ pluginId: 'ai', ...band })),
    )
    expect(pluginSpendLines().filter((line) => line.pluginId === 'ai')).toEqual(
      (declared.spendLines ?? []).map((line) => ({ pluginId: 'ai', ...line })),
    )
  })

  /*
   * The budget shows the BILLED figure, in credits and never in dollars, and
   * counts it only once `BILL_ASSIST_TOKENS_FROM` names the month.
   */
  it('puts the billed figure on the budget, in credits, from its own start month', () => {
    const [line] = aiUsageAxes().spendLines ?? []
    expect(line?.live).toEqual({ collection: 'assistUsage', field: 'estCostUsd' })
    expect(line?.billedFromEnv).toBe('BILL_ASSIST_TOKENS_FROM')
    expect(line?.unit?.costUsd).toBe(ASSIST_CREDIT_COST_USD)
  })

  /*
   * The cost model takes what the tokens cost US, never what they drew
   * (AGL-3015), and the band counts credits the one way the customer's meter
   * does.
   */
  it('prices the provider figure first, and counts credits at the credit’s cost', () => {
    const [axis] = aiUsageAxes().costAxes ?? []
    expect(axis?.live?.fields[0]).toBe(ASSIST_PROVIDER_COST_FIELD)
    expect(axis?.rate).toBeUndefined()
    const [band] = aiUsageAxes().bands ?? []
    expect(band?.unitCostUsd).toBe(ASSIST_CREDIT_COST_USD)
  })
})
