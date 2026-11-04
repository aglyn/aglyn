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
  CUSTOM_BILLING_BASE_PLANS,
  PLAN_LABELS,
  planLabelGrantingFeature,
  RETIRED_PLANS,
} from './plan-entitlements'

/**
 * Pricing v4 (AGL-4126) retired Business, Scale, Advanced and Agency. These
 * pin the two seams AGL-4158 moved customer and operator copy onto, so no
 * string built from them can name a retired plan again.
 */
describe('the staff custom-billing base plans (AGL-4158)', () => {
  it('offers Custom, then the paid self-serve plans from the top down', () => {
    expect(CUSTOM_BILLING_BASE_PLANS).toEqual(['enterprise', 'pro', 'starter'])
    expect(CUSTOM_BILLING_BASE_PLANS.map((plan) => PLAN_LABELS[plan])).toEqual([
      'Custom',
      'Pro',
      'Starter',
    ])
  })

  it('never offers a retired plan or Free', () => {
    for (const plan of [...RETIRED_PLANS, 'free' as const]) {
      expect([plan, CUSTOM_BILLING_BASE_PLANS.includes(plan)]).toEqual([plan, false])
    }
  })
})

describe('the plan an upsell names is one that exists (AGL-4158)', () => {
  // The commerce product types are pinned beside their 403s in
  // `checkout-duplicate-subscription.spec.ts`, where the plugin declares them.
  it.each([
    ['contentGating', 'Pro'],
    ['multilingual', 'Pro'],
    ['whiteLabel', 'Custom'],
  ] as const)('%s is included from %s', (feature, label) => {
    expect(planLabelGrantingFeature(feature)).toBe(label)
  })
})
