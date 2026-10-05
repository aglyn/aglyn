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

import { giftCardsPlanRefusal } from './gift-cards-plan'

/*
 * Importing gift cards needs a plan with them (AGL-3548): refused in the
 * issue route's words, naming the plan that includes them, in the transfer
 * routes' 403 `plan_required` body.
 */
describe('giftCardsPlanRefusal', () => {
  it('refuses a plan without gift cards, naming the plan that has them', () => {
    for (const plan of ['free', 'starter', 'pro']) {
      expect(giftCardsPlanRefusal({ plan })).toEqual({
        status: 403,
        body: { error: 'Gift cards are not included on this plan. Included from Business.', reason: 'plan_required', code: 'giftCards' },
      })
    }
  })

  it('answers nothing on a plan with them', () => {
    expect(giftCardsPlanRefusal({ plan: 'business' })).toBeNull()
    expect(giftCardsPlanRefusal({ plan: 'enterprise' })).toBeNull()
  })
})
