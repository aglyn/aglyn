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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PLAN_ENTITLEMENTS,
  PLAN_LABELS,
  planSellsAiTiers,
  SELF_SERVE_PLANS,
} from '@aglyn/aglyn'

/**
 * The native plan-change screen restates what the console's plan cards and
 * `overLimitSummary` read from code: the self-serve plans in order, their
 * names, what each plan includes of the three capacities a downgrade can
 * strand, and which plans sell an Aglyn AI tier (AGL-3965: a tier keeps its
 * own price across a plan change, so the screen names no per-plan price). A
 * change to any of them must change the screen.
 */
const plans = (
  JSON.parse(
    readFileSync(
      join(__dirname, '../../../libs/native/screens/billing.screens.json'),
      'utf8',
    ),
  ).screens as Array<{ id: string; constants?: any }>
).find((s) => s.id === 'core.billing.plans')!.constants

describe('native plan change', () => {
  it('lists the self-serve plans in the console order, under the console names', () => {
    expect(plans.plans.map((p: { id: string }) => p.id)).toEqual([
      ...SELF_SERVE_PLANS,
    ])
    expect(plans.labels).toEqual(PLAN_LABELS)
  })

  it('knows what each plan includes of sites, team members and datasets', () => {
    for (const [plan, entitlements] of Object.entries(PLAN_ENTITLEMENTS)) {
      expect(plans.limits[plan]).toEqual({
        hostLimit: entitlements.hostLimit,
        managersPerOrg: entitlements.managersPerOrg,
        datasetsPerOrg: entitlements.datasetsPerOrg,
      })
    }
  })

  it('knows which plans sell an Aglyn AI tier', () => {
    const sold = Object.fromEntries(
      Object.keys(PLAN_ENTITLEMENTS)
        .filter((plan) => planSellsAiTiers(plan))
        .map((plan) => [plan, true]),
    )
    expect(plans.aiTiersSold).toEqual(sold)
    // No per-plan AI price is restated: the tier keeps its own.
    expect(plans.aiPrice).toBeUndefined()
  })
})
