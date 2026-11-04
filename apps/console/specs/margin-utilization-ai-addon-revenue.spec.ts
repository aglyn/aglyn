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
 * The AI add-on on the margin surface's revenue side (AGL-2930).
 *
 * `orgListPriceMonthlyUsd` already folds the add-on's price into the list
 * price, so the surface must NAME it rather than add it: the assertion
 * that matters is that `aiAddonRevenueUsd` is inside `listPriceUsd`, not on
 * top of it. Then the three cases where naming it would be wrong — no
 * add-on, a dead subscription, a custom-priced deal — all read 0.
 *
 * Since AGL-4144 the revenue is blocks × $10, whatever the plan.
 */

import { AI_CREDIT_BLOCK_MONTHLY_USD } from '@aglyn/aglyn/app-utils/ai-credit-blocks'
import { fleetUtilization, orgMarginRow } from '@aglyn/aglyn/app-utils/margin-utilization'

const row = (org: Record<string, unknown>) =>
  orgMarginRow({ orgId: 'org-1', org: org as never, rollup: null, month: null })

describe('margin utilization names the AI add-on revenue (AGL-2930, AGL-4144)', () => {
  it('names the add-on inside the list price rather than adding it', () => {
    const withAddon = row({
      plan: 'pro',
      subscription: { status: 'active' },
      seatAddons: { aiAddon: 1 },
    })
    const without = row({ plan: 'pro', subscription: { status: 'active' } })
    expect(AI_CREDIT_BLOCK_MONTHLY_USD).toBe(10)
    expect(withAddon.aiAddonRevenueUsd).toBe(10)
    expect(without.aiAddonRevenueUsd).toBe(0)
    // Already inside the price: the two list prices differ by exactly it.
    expect(withAddon.listPriceUsd - without.listPriceUsd).toBe(
      withAddon.aiAddonRevenueUsd,
    )
  })

  it('names blocks × $10, whatever the plan (AGL-4144)', () => {
    const three = row({
      plan: 'pro',
      subscription: { status: 'active' },
      seatAddons: { aiAddon: 3 },
    })
    const without = row({ plan: 'pro', subscription: { status: 'active' } })
    expect(three.aiAddonRevenueUsd).toBe(30)
    expect(three.listPriceUsd - without.listPriceUsd).toBe(30)
    // A retired tier written on the org changes nothing: blocks are the price.
    expect(
      row({
        plan: 'pro',
        subscription: { status: 'active' },
        seatAddons: { aiAddon: 3 },
        aiTier: 'studio',
      }).aiAddonRevenueUsd,
    ).toBe(30)
    // A stored count past the ceiling earns the ceiling, never more.
    expect(
      row({ plan: 'starter', subscription: { status: 'active' }, seatAddons: { aiAddon: 45 } })
        .aiAddonRevenueUsd,
    ).toBe(300)
  })

  it('reads 0 when the subscription is dead — the add-on has stopped billing', () => {
    expect(
      row({
        plan: 'pro',
        subscription: { status: 'canceled' },
        seatAddons: { aiAddon: 2 },
      }).aiAddonRevenueUsd,
    ).toBe(0)
  })

  it('reads 0 on a custom-priced deal, whose quote already folds it', () => {
    expect(
      row({
        plan: 'pro',
        subscription: { status: 'active', customMonthlyUsd: 2730 },
        seatAddons: { aiAddon: 2 },
      }).aiAddonRevenueUsd,
    ).toBe(0)
  })

  it('totals it across the fleet', () => {
    const fleet = fleetUtilization([
      row({ plan: 'pro', subscription: { status: 'active' }, seatAddons: { aiAddon: 1 } }),
      row({ plan: 'starter', subscription: { status: 'active' }, seatAddons: { aiAddon: 4 } }),
      row({ plan: 'pro', subscription: { status: 'active' } }),
    ])
    expect(fleet.totalAiAddonRevenueUsd).toBe(50)
  })
})
