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
 * The declared org capacities answer with nothing loaded (AGL-3080).
 *
 * This file imports the module and NOTHING else — no plugin, no loader, no
 * boot. That is the whole point: the two readers are a downgrade refusal in a
 * console API route and the warning the customer reads before choosing, and
 * neither loads a plugin's code. A capacity that only existed once something
 * had registered it would be missing from one side, the plan change that
 * strands it would be allowed, and nothing would be red.
 *
 * So these cases are deliberately not written against a fixture plugin. They
 * assert what the real config compiles, in the state a bare process is in.
 */

import { PLAN_ENTITLEMENTS } from '../app-utils/plan-entitlements'
import {
  pluginOrgCapacities,
  pluginOrgCapacity,
  pluginOrgCapacityForAddon,
} from './plugin-org-capacity'

describe('plugin org capacities', () => {
  it('answers with no plugin loaded at all', () => {
    expect(pluginOrgCapacities().length).toBeGreaterThan(0)
    const datasets = pluginOrgCapacity('datasets')
    expect(datasets).toEqual({
      pluginId: 'data',
      kind: 'datasets',
      order: 30,
      collection: 'datasets',
      addonKind: 'datasets',
      includedEntitlement: 'datasetsPerOrg',
      nouns: { one: 'dataset', many: 'datasets', addon: 'extra datasets' },
    })
    expect(pluginOrgCapacityForAddon('datasets')).toEqual(datasets)
  })

  it('names nothing for a capacity nobody backs', () => {
    // `null`, not a default row. A caller that invented a capacity is asking
    // about something no plugin measures, and core answering with a plausible
    // shape would let it clear a gate against a count of nothing.
    expect(pluginOrgCapacity('nonesuch')).toBeNull()
    expect(pluginOrgCapacityForAddon('nonesuch')).toBeNull()
  })

  it('points every capacity at an entitlement every plan actually has', () => {
    /*
     * The failure this catches is the quiet one. `overLimitRows` and
     * `includedCapacity` both read the declared field off the plan and both
     * treat a missing field as ZERO included — so a typo here does not throw,
     * it reports every org as over by everything it holds and refuses every
     * downgrade. Loud in production, invisible in review; this is where it
     * gets caught instead.
     */
    for (const capacity of pluginOrgCapacities()) {
      for (const [plan, entitlements] of Object.entries(PLAN_ENTITLEMENTS)) {
        const where = `${capacity.kind}/${plan}`
        const value = (entitlements as unknown as Record<string, unknown>)[
          capacity.includedEntitlement
        ]
        expect([where, typeof value]).toEqual([where, 'number'])
      }
    }
  })

  it('keeps one owner per capacity, per add-on and per position', () => {
    // The generator refuses each of these when the manifest is written; this
    // is the same property asserted against what actually shipped, so a
    // hand-edited generated file cannot slip past.
    const capacities = pluginOrgCapacities()
    const unique = (values: string[]) =>
      expect([values.length, new Set(values).size]).toEqual([
        values.length,
        values.length,
      ])
    unique(capacities.map((one) => one.kind))
    unique(capacities.map((one) => one.addonKind))
    unique(capacities.map((one) => String(one.order)))
    // Core's own two are not declarable: a site and a team seat exist with no
    // plugin loaded, so a plugin claiming one would be claiming the platform.
    expect(
      capacities.filter((one) => ['sites', 'seats'].includes(one.kind)),
    ).toEqual([])
    expect(
      capacities.filter((one) => [10, 20].includes(one.order)),
    ).toEqual([])
  })
})
