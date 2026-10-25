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
  PLAN_ENTITLEMENTS,
  PLAN_LABELS,
  planGrantingQuota,
  planLabelGrantingQuota,
} from '@aglyn/aglyn'
import { campaignPlanCapMessage, campaignPlanLock } from './campaign-plan-lock'

describe('planGrantingQuota', () => {
  it('names the first plan in the ladder whose allowance reaches the figure', () => {
    const plan = planGrantingQuota('emailSendsPerMonth', 1)
    expect(plan).toBeDefined()
    expect(PLAN_ENTITLEMENTS[plan!].emailSendsPerMonth).toBeGreaterThan(0)
    expect(PLAN_ENTITLEMENTS.free.emailSendsPerMonth).toBe(0)
  })

  it('asks for a bigger plan as the figure grows', () => {
    const small = planGrantingQuota('emailSendsPerMonth', 1)!
    const big = planGrantingQuota(
      'emailSendsPerMonth',
      PLAN_ENTITLEMENTS[small].emailSendsPerMonth + 1,
    )
    expect(big).toBeDefined()
    expect(big).not.toBe(small)
  })

  it('names no plan when none reaches the figure', () => {
    expect(planLabelGrantingQuota('emailSendsPerMonth', Infinity)).toBeUndefined()
  })
})

describe('campaignPlanLock', () => {
  const firstPlan = planLabelGrantingQuota('emailSendsPerMonth', 1)

  it('locks a plan with no campaign email and names where it starts', () => {
    const lock = campaignPlanLock({ limit: 0, used: 0 })
    expect(lock?.kind).toBe('not-on-plan')
    expect(lock?.planLabel).toBe(firstPlan)
    expect(lock?.reason).toBe(`Campaign email is included from ${firstPlan}.`)
    // What still works is said, so the composer does not read as broken.
    expect(lock?.notice).toMatch(/draft/)
    expect(lock?.notice).toMatch(/test/)
  })

  it('locks a plan with no campaign email even for an empty audience', () => {
    // The production case: a Free org scheduled to an audience of nobody.
    expect(campaignPlanLock({ limit: 0, used: 0, sendable: 0 })?.kind).toBe(
      'not-on-plan',
    )
  })

  it('locks a spent allowance', () => {
    const lock = campaignPlanLock({ limit: 2500, used: 2500 })
    expect(lock?.kind).toBe('allowance-spent')
    expect(lock?.planLabel).not.toBe(PLAN_LABELS.free)
  })

  it('locks an audience bigger than what is left, and only then', () => {
    expect(campaignPlanLock({ limit: 2500, used: 2000, sendable: 500 })).toBeNull()
    const lock = campaignPlanLock({ limit: 2500, used: 2000, sendable: 501 })
    expect(lock?.kind).toBe('audience-over-allowance')
    expect(lock?.reason).toContain('501')
    expect(lock?.reason).toContain('500')
  })

  it('never locks an unlimited plan', () => {
    expect(
      campaignPlanLock({ limit: Infinity, used: 10_000_000, sendable: 5000 }),
    ).toBeNull()
  })

  it('leaves a send the allowance covers alone', () => {
    expect(campaignPlanLock({ limit: 2500, used: 0, sendable: 40 })).toBeNull()
  })
})

describe('campaignPlanCapMessage', () => {
  it('tells a plan without campaign email which plan to upgrade to', () => {
    const message = campaignPlanCapMessage(
      campaignPlanLock({ limit: 0, used: 0 })!,
    )
    expect(message).toMatch(/^Your plan does not include campaign email\./)
    expect(message).toContain(
      `Upgrade to ${planLabelGrantingQuota('emailSendsPerMonth', 1)}`,
    )
    expect(message).toMatch(/Transactional mail/)
  })
})
