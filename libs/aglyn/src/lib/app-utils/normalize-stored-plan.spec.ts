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
  normalizeStoredPlan,
  PLAN_ENTITLEMENTS,
  PLAN_LABELS,
  PLAN_LADDER,
  readOrgPlanComp,
  resolveEffectivePlan,
  storedPlanLabel,
} from './plan-entitlements'

/**
 * The one read-time safety net for the plans removed on 2026-11-24
 * (AGL-4245). No workspace stored one when they were removed; this holds what
 * happens if a document written before then still does.
 */
const REMOVED = ['business', 'scale', 'advanced', 'agency'] as const

describe('normalizeStoredPlan (AGL-4245)', () => {
  it('returns every current plan as it is', () => {
    for (const plan of PLAN_LADDER) {
      expect(normalizeStoredPlan(plan)).toBe(plan)
    }
  })

  it('reads each removed id as Pro, the plan their features moved into', () => {
    for (const id of REMOVED) {
      expect([id, normalizeStoredPlan(id)]).toEqual([id, 'pro'])
    }
  })

  it('reads anything else as no plan, so each caller keeps its own fallback', () => {
    for (const value of ['platinum', '', 'Pro', ' pro', 'toString', '__proto__', null, undefined, 42, {}, ['pro']]) {
      expect(normalizeStoredPlan(value)).toBeNull()
    }
  })

  it('keeps no table row for a removed id', () => {
    for (const id of REMOVED) {
      expect(PLAN_ENTITLEMENTS).not.toHaveProperty(id)
      expect(PLAN_LABELS).not.toHaveProperty(id)
    }
  })
})

describe('where a stored plan id enters (AGL-4245)', () => {
  it('resolves a stored removed plan on a live subscription as Pro', () => {
    expect(resolveEffectivePlan({ plan: 'business', billingStatus: 'active' } as never)).toBe('pro')
    expect(resolveEffectivePlan({ plan: 'agency', billingStatus: 'active' } as never)).toBe('pro')
  })

  it('still drops a dead subscription to Free, and an unknown plan to Free', () => {
    expect(resolveEffectivePlan({ plan: 'scale', billingStatus: 'canceled' } as never)).toBe('free')
    expect(resolveEffectivePlan({ plan: 'platinum', billingStatus: 'active' } as never)).toBe('free')
    expect(resolveEffectivePlan({} as never)).toBe('free')
  })

  it('reads a comp written on a removed plan as a Pro comp, and junk as no comp', () => {
    const comp = (plan: unknown) =>
      ({ entitlements: { planComp: { plan, reason: 'beta', grantedBy: 'staff-1' } } }) as never
    expect(readOrgPlanComp(comp('advanced'))?.plan).toBe('pro')
    expect(resolveEffectivePlan(comp('advanced'))).toBe('pro')
    expect(readOrgPlanComp(comp('platinum'))).toBeNull()
    expect(readOrgPlanComp(comp('free'))).toBeNull()
  })
})

describe('storedPlanLabel (AGL-4245)', () => {
  it('names a current plan by its label', () => {
    for (const plan of PLAN_LADDER) {
      expect(storedPlanLabel(plan)).toBe(PLAN_LABELS[plan])
    }
    expect(storedPlanLabel('enterprise')).toBe('Custom')
  })

  it('names a removed id as retired, so an old audit note still reads', () => {
    expect(REMOVED.map((id) => storedPlanLabel(id))).toEqual([
      'Business (retired)',
      'Scale (retired)',
      'Advanced (retired)',
      'Agency (retired)',
    ])
  })

  it('prints anything else as it was stored, and nothing as empty', () => {
    expect(storedPlanLabel('platinum')).toBe('platinum')
    expect(storedPlanLabel(null)).toBe('')
    expect(storedPlanLabel(undefined)).toBe('')
  })
})
