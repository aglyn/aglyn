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

import { aiUsageMeter } from './ai-usage-meter'
import { ASSIST_CREDIT_COST_USD } from './assist-credits'
import type { AssistReservation } from './assist-usage'

/**
 * The strip's `mine` on the Free plan (AGL-3722): the person's Free allowance
 * — their 300 a month across every Free workspace, net of give-backs, as the
 * reservation read it — never the workspace's gross per-member row, which a
 * give-back or a staff reset never reaches. The Maple Street Bakery panel of
 * 2026-10-10 said "You: 401 credits this month" off that row.
 */
describe('the usage meter’s own line', () => {
  const usd = (credits: number) => credits * ASSIST_CREDIT_COST_USD
  const base = { monthKey: '2026-10', allowed: true } as Pick<AssistReservation, 'monthKey' | 'allowed'>

  it('on the Free plan is the person’s allowance, used of 300, hard', () => {
    const meter = aiUsageMeter(
      {
        ...base,
        free: { accountUid: 'owner-1' } as AssistReservation['free'],
        freeAccountCostUsd: usd(240),
        allotment: { binding: null, personalCredits: 401 } as unknown as AssistReservation['allotment'],
      },
      { lastCredits: 12 },
    )
    expect(meter.mine).toEqual({ used: 252, limit: 300, mode: 'hard', scope: null, free: true })
  })

  it('off the Free plan is the person’s month on the allotment gate, as before', () => {
    const meter = aiUsageMeter(
      { ...base, free: null, allotment: { binding: null, personalCredits: 401 } as unknown as AssistReservation['allotment'] },
      { lastCredits: 0 },
    )
    expect(meter.mine).toEqual({ used: 401, limit: null, mode: null, scope: null })
  })
})
