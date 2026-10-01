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
  ORG_COGS_UNIT_RATES_USD,
  orgCogsInputFrom,
  orgMonthlyCogsUsd,
} from '../app-utils/plan-entitlements'
import { UTILIZATION_BANDS } from '../app-utils/margin-utilization'
import {
  declaredMeterReading,
  liveMeterReading,
  pluginCostAxes,
  pluginUsageBands,
} from './plugin-usage-axes'

describe('a plugin declares the meters it contributes to the cost model (AGL-3080)', () => {
  it('every declared rate is a rate core carries — a price stays core’s', () => {
    for (const axis of pluginCostAxes()) {
      if (axis.rate === undefined) continue
      expect([axis.id, axis.rate in ORG_COGS_UNIT_RATES_USD]).toEqual([axis.id, true])
    }
  })

  /*
   * The breakdown every staff reader keys on, in the order it always had.
   * Named, so a declaration that stopped compiling in is red here by the axis
   * it lost rather than by a margin figure three suites away.
   */
  it('prices the platform’s axes and the plugins’ in one breakdown, in order', () => {
    expect(Object.keys(orgMonthlyCogsUsd(null, 0).breakdown)).toEqual([
      'storage',
      'pageViews',
      'formSubmissions',
      'dataStorage',
      'apiRequests',
      'contacts',
      'emailSends',
      'assist',
      'runs',
    ])
    expect(Object.fromEntries(pluginCostAxes().map((axis) => [axis.id, axis.pluginId]))).toEqual({
      formSubmissions: 'forms',
      contacts: 'crm',
      assist: 'ai',
      runs: 'workflows',
    })
  })

  it('measures the platform’s bands and the plugins’ in one table, in order', () => {
    expect(UTILIZATION_BANDS).toEqual([
      'hosts',
      'storageGb',
      'pageViews',
      'formSubmissions',
      'dataStorageMb',
      'apiRequests',
      'contactsCount',
      'emailSends',
      'assistCredits',
      'workflowRuns',
      'actionRuns',
    ])
    expect(Object.fromEntries(pluginUsageBands().map((band) => [band.id, band.pluginId]))).toEqual({
      formSubmissions: 'forms',
      contactsCount: 'crm',
      assistCredits: 'ai',
      workflowRuns: 'workflows',
      actionRuns: 'workflows',
    })
  })

  it('forwards every field a declared axis reads or records, and prices it', () => {
    const rollup: Record<string, number> = {}
    for (const axis of pluginCostAxes()) {
      for (const field of [...axis.fields, ...(axis.fallbackFields ?? []), ...(axis.recordedFields ?? [])]) {
        rollup[field] = 1000
      }
    }
    const input = orgCogsInputFrom({ ...rollup, month: '2026-09' })
    for (const field of Object.keys(rollup)) expect([field, input[field]]).toEqual([field, 1000])
    const { breakdown } = orgMonthlyCogsUsd(input, 0)
    for (const axis of pluginCostAxes()) expect([axis.id, breakdown[axis.id]! > 0]).toEqual([axis.id, true])
  })
})

describe('reading a declared meter', () => {
  const crmLike = { fields: ['records'], fallbackFields: ['contacts'] }

  it('sums its fields, and falls back only when a rollup carries none of them', () => {
    expect(declaredMeterReading({ runs: 2, more: 3 }, { fields: ['runs', 'more'] })).toBe(5)
    expect(declaredMeterReading({ contacts: 7 }, crmLike)).toBe(7)
    // A rollup that measured zero has answered: no fall back to the older basis.
    expect(declaredMeterReading({ records: 0, contacts: 7 }, crmLike)).toBe(0)
    expect(declaredMeterReading(null, crmLike)).toBe(0)
  })

  it('reads a negative, a string or NaN as nothing', () => {
    expect(declaredMeterReading({ a: -4, b: '9', c: Number.NaN }, { fields: ['a', 'b', 'c'] })).toBe(9)
    expect(declaredMeterReading({ a: 'x' }, { fields: ['a'] })).toBe(0)
  })

  it('takes the first positive live field, and nothing rather than zero', () => {
    const live = { fields: ['provider', 'billed'] }
    const doc = (values: Record<string, unknown>) => ({ get: (field: string) => values[field] })
    expect(liveMeterReading(doc({ provider: 2, billed: 3 }), live)).toBe(2)
    expect(liveMeterReading(doc({ provider: 0, billed: 3 }), live)).toBe(3)
    expect(liveMeterReading(doc({}), live)).toBeUndefined()
    expect(liveMeterReading(null, live)).toBeUndefined()
  })
})

describe('a declared rate core does not carry', () => {
  it('fails loud rather than pricing the meter at nothing', () => {
    jest.isolateModules(() => {
      jest.doMock('./first-party-plugins.generated', () => ({
        ...jest.requireActual('./first-party-plugins.generated'),
        PLUGIN_COST_AXES_DECLARED: [
          { pluginId: 'cellar', id: 'bottles', order: 35, fields: ['bottles'], rate: 'perBottle' },
        ],
      }))
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { orgMonthlyCogsUsd: price } = require('../app-utils/plan-entitlements')
      expect(() => price({ bottles: 3 }, 0)).toThrow(/perBottle/)
    })
  })
})
