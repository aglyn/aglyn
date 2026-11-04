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
  planSellsAiCredits,
  SELF_SERVE_PLANS,
} from '@aglyn/aglyn'

/**
 * The native plan-change screen restates what the console's plan cards and
 * `overLimitSummary` read from code: the self-serve plans in order, their
 * names, what each plan includes of the three capacities a downgrade can
 * strand, and which plans sell the Aglyn AI add-on (since AGL-4144 credit
 * blocks, one price on every paid plan, so the screen names no per-plan
 * price). A change to any of them must change the screen.
 */
const screens = JSON.parse(
  readFileSync(
    join(__dirname, '../../../libs/native/screens/billing.screens.json'),
    'utf8',
  ),
).screens as Array<{ id: string; constants?: any }>
const plans = screens.find((s) => s.id === 'core.billing.plans')!.constants
/** Billing's own Plan row names the plan in force the same way (`enterprise` reads "Custom"). */
const overview = screens.find((s) => s.id === 'core.billing')!.constants

describe('native plan change', () => {
  it('lists the self-serve plans in the console order, under the console names', () => {
    expect(plans.plans.map((p: { id: string }) => p.id)).toEqual([
      ...SELF_SERVE_PLANS,
    ])
    expect(plans.labels).toEqual(PLAN_LABELS)
    expect(overview.labels).toEqual(PLAN_LABELS)
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

  it('knows which plans sell Aglyn AI credits (the screen still calls the set `aiTiersSold`)', () => {
    // The SET of plans is unchanged by AGL-4144 — every paid self-serve plan —
    // so the screen's constant still agrees with the console, under its old
    // name. Its words do not: see the native lane's owed items below.
    const sold = Object.fromEntries(
      Object.keys(PLAN_ENTITLEMENTS)
        .filter((plan) => planSellsAiCredits(plan))
        .map((plan) => [plan, true]),
    )
    expect(plans.aiTiersSold).toEqual(sold)
    // No per-plan AI price is restated: a block is one price on every plan.
    expect(plans.aiPrice).toBeUndefined()
  })

  /*
   * What the native plan-change screen still says about the retired tiers
   * (AGL-4144). Not asserted either way: the console's sentence is
   * `carriedAiAddonSentence`, in blocks, and the native lane owes the match.
   */
  it.todo(
    'native lane (AGL-4144): the plan-change notices say "Your Aglyn AI tier …"; they owe ' +
      '`carriedAiAddonSentence`\'s blocks wording ("Your 3 blocks of Aglyn AI credits carry over at $30/mo …")',
  )
})
