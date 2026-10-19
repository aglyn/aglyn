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
  PLAN_CARD_CONTEXT_METERS,
  PLAN_CARD_METER_LABELS,
  PLAN_CARD_METERS,
  PLAN_CARD_SCREEN_CONTEXTS,
  planCardContext,
  planCardMeterOrder,
  planCardShows,
  type PlanCardReading,
} from './plan-card-meters'

const readings: PlanCardReading[] = [
  { meter: 'sites', used: 3, limit: 3 },
  { meter: 'storage', used: 400, limit: 1000 },
  { meter: 'bandwidth', used: 9, limit: 10 },
  { meter: 'emailSends', used: 100, limit: 1000 },
  { meter: 'aiCredits', used: null, limit: 500 },
  { meter: 'dataStorage', used: 5, limit: null },
]

describe('planCardMeterOrder', () => {
  it('leads with the context meter, then the rest fullest first', () => {
    expect(planCardMeterOrder(readings, 'media')).toEqual(['storage', 'bandwidth', 'emailSends', 'sites'])
    expect(planCardMeterOrder(readings, 'email')).toEqual(['emailSends', 'bandwidth', 'storage', 'sites'])
  })

  it('puts Sites first only on the Sites list, however full it is', () => {
    expect(planCardMeterOrder(readings, null)).toEqual(['bandwidth', 'storage', 'emailSends', 'sites'])
    expect(planCardMeterOrder(readings, 'sites')).toEqual(['sites', 'bandwidth', 'storage', 'emailSends'])
  })

  it('leaves out a failed read and an uncapped meter, and a context with nothing to show', () => {
    expect(planCardMeterOrder(readings, 'ai')).toEqual(['bandwidth', 'storage', 'emailSends', 'sites'])
    expect(planCardMeterOrder(readings, 'data')).toEqual(['bandwidth', 'storage', 'emailSends', 'sites'])
    expect(planCardMeterOrder([{ meter: 'pages', used: 2, limit: 0 }], null)).toEqual([])
  })

  it('breaks a tie in the meters’ own order and shows a meter once', () => {
    expect(
      planCardMeterOrder(
        [
          { meter: 'forms', used: 1, limit: 2 },
          { meter: 'storage', used: 5, limit: 10 },
          { meter: 'storage', used: 9, limit: 10 },
        ],
        'unknown',
      ),
    ).toEqual(['storage', 'forms'])
  })
})

describe('planCardContext', () => {
  it('reads a site’s Home as its website and the workspace’s Home as nothing', () => {
    expect(planCardContext('shell.home', true)).toBe('website')
    expect(planCardContext('shell.home', false)).toBeNull()
    expect(planCardContext('site.media', false)).toBe('media')
    expect(planCardContext('commerce.orders', true)).toBeNull()
    expect(planCardContext(null, true)).toBeNull()
  })
})

describe('planCardShows', () => {
  it('shows for a plan that can be upgraded, or for any plan near a limit', () => {
    expect(planCardShows([{ meter: 'storage', used: 1, limit: 100 }], true)).toBe(true)
    expect(planCardShows([{ meter: 'storage', used: 1, limit: 100 }], false)).toBe(false)
    expect(planCardShows([{ meter: 'storage', used: 80, limit: 100 }], false)).toBe(true)
    expect(planCardShows([{ meter: 'storage', used: null, limit: 100 }], true)).toBe(false)
  })
})

describe('the mapping', () => {
  it('names only meters it labels, from contexts to screens', () => {
    for (const meters of Object.values(PLAN_CARD_CONTEXT_METERS)) {
      for (const meter of meters) expect(PLAN_CARD_METERS).toContain(meter)
    }
    expect(Object.keys(PLAN_CARD_METER_LABELS).sort()).toEqual([...PLAN_CARD_METERS].sort())
    for (const context of Object.values(PLAN_CARD_SCREEN_CONTEXTS)) {
      expect(Object.keys(PLAN_CARD_CONTEXT_METERS)).toContain(context)
    }
  })
})
