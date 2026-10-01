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

import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { OrgPlan } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import {
  AI_CREDITS_BY_PLAN,
  aiPlanEntitlements,
  ENTERPRISE_ASSIST_CREDITS_PER_MONTH,
  FREE_AI_TASTE_CREDITS_PER_MONTH,
} from './plan-entitlements'

describe('the AI credits each plan includes are the AI plugin’s to declare (AGL-3080)', () => {
  it('reach core’s plan table unchanged, on every plan', () => {
    for (const plan of Object.keys(PLAN_ENTITLEMENTS) as OrgPlan[]) {
      expect([plan, PLAN_ENTITLEMENTS[plan].assistCreditsPerMonth]).toEqual([
        plan,
        AI_CREDITS_BY_PLAN[plan],
      ])
    }
  })

  it('declare the band the generator compiles', () => {
    expect(aiPlanEntitlements().quotas).toEqual([
      expect.objectContaining({ key: 'assistCreditsPerMonth', byPlan: AI_CREDITS_BY_PLAN }),
    ])
  })

  /*
   * Three workspaces per account (AGL-2265) do NOT triple the taste: the
   * account allowance is this constant, read by the meter for the owner, and
   * it is the Free row's band.
   */
  it('the Free taste IS the Free band', () => {
    expect(FREE_AI_TASTE_CREDITS_PER_MONTH).toBe(300)
    expect(FREE_AI_TASTE_CREDITS_PER_MONTH).toBe(PLAN_ENTITLEMENTS.free.assistCreditsPerMonth)
  })

  /*
   * The 2026-09-07 rule: every Enterprise fallback is Agency's band × 2, and
   * finite, so it survives the wire — `JSON.stringify(Infinity)` is `null`,
   * which reads back as a band of zero on the most expensive plan.
   */
  it('the Enterprise band is Agency’s × 2, finite', () => {
    expect(PLAN_ENTITLEMENTS.enterprise.assistCreditsPerMonth).toBe(
      ENTERPRISE_ASSIST_CREDITS_PER_MONTH,
    )
    expect(ENTERPRISE_ASSIST_CREDITS_PER_MONTH).toBe(AI_CREDITS_BY_PLAN.agency * 2)
    expect(Number.isFinite(ENTERPRISE_ASSIST_CREDITS_PER_MONTH)).toBe(true)
  })
})
