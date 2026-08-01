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

import { checkDiscountMargin } from '@aglyn/aglyn/server'

/**
 * The badge on /admin/coupons, at the org the page actually rates against
 * (AGL-1120).
 *
 * `plan-entitlements.spec.ts` already pins `checkDiscountMargin` itself. This
 * pins the thing Zach reported: what the coupon form SHOWS while you type. The
 * two can diverge without either being individually wrong, because the page
 * supplies its own hypothetical org — bump its site count or change its plan
 * and the badge moves while every function-level test stays green.
 *
 * Kept in sync by construction: this is the same literal the page declares.
 * If the page's reference org changes, this file has to change with it, and
 * that is the point — it makes the badge's inputs a decision rather than an
 * incidental constant.
 */
const REFERENCE_ORG = {
  plan: 'business',
  subscription: { status: 'active', interval: 'month' },
} as never

/**
 * The page renders `severity`/`Chip` from `rating`, and picks the one-line
 * explanation from `reason`:
 *
 *   depth      → "<n>% off list price"
 *   underwater → (the underwater sentence)
 *   otherwise  → "Net margin <x>% vs a <y>% floor"
 *
 * so `rating` + `reason` fully determine what a staff member reads.
 */
describe('the coupon form badge', () => {
  it('does not rate 93% off "OK" — the reported bug', () => {
    // "Rating: OK — Net margin 78.1% vs a 75% floor", on a 93%-off coupon.
    // The margin figure was arithmetically right, which is what made the
    // badge convincing enough to act on.
    const rating = checkDiscountMargin(REFERENCE_ORG, { percentOff: 93 })
    expect(rating.rating).toBe('block')
  })

  it('says depth is the reason, so the badge stops quoting a margin', () => {
    // The specific misleading string. `reason: 'depth'` is what routes the
    // page away from the "Net margin …" sentence and onto "93% off list
    // price" — the number a person needs to make this call.
    const rating = checkDiscountMargin(REFERENCE_ORG, { percentOff: 93 })
    expect(rating.reason).toBe('depth')
    expect(`${(rating.depthPct * 100).toFixed(0)}% off list price`).toBe(
      '93% off list price',
    )
  })

  it('still finds the cost side healthy — the negative control', () => {
    // If cost recovery ever stopped clearing this on its own, the tests above
    // would pass for the wrong reason and the depth arm could be removed
    // without anything going red.
    const rating = checkDiscountMargin(REFERENCE_ORG, { percentOff: 93 })
    expect(rating.marginPct).toBeGreaterThan(rating.floorPct)
  })

  it('leaves an ordinary discount reading OK', () => {
    // The guardrail has to stay usable: if it shouted at every coupon, staff
    // would learn to ignore the badge and it would protect nothing.
    const rating = checkDiscountMargin(REFERENCE_ORG, { percentOff: 20 })
    expect(rating.rating).toBe('ok')
    expect(rating.reason).toBe('none')
  })

  it('escalates monotonically with depth', () => {
    // No band where a deeper discount reads better than a shallower one.
    const order = { ok: 0, warn: 1, block: 2 }
    let previous = -1
    for (const percentOff of [10, 20, 30, 40, 50, 60, 70, 80, 90, 93, 97]) {
      const current = order[checkDiscountMargin(REFERENCE_ORG, { percentOff }).rating]
      expect(current).toBeGreaterThanOrEqual(previous)
      previous = current
    }
  })
})
