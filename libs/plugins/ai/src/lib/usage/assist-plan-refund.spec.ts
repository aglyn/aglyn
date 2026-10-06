/**
 * @jest-environment node
 *
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

jest.mock('@aglyn/tenant-data-admin/server/staff-alert-email', () => ({ __esModule: true, sendStaffAlertEmail: jest.fn() }))
jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({ __esModule: true, addAdminAudit: jest.fn() }))

import { isAssistCreditReturnKey } from './assist-credit-returns-write'
import { AI_PLAN_REFUNDS_PER_DAY, aiPlanRefundKey, aiPlanRefundsOn } from './assist-plan-refund'

describe('a refused Free plan’s give-back (AGL-3594)', () => {
  it('is keyed by its day, its job and its step run, in the shape the give-back writer takes', () => {
    const key = aiPlanRefundKey({ day: '2026-10-06', jobId: 'f0UzIs7Lcl', stepIndex: 0, at: 1_791_329_280_000 })
    expect(key).toBe('plan-refund-20261006-f0UzIs7Lcl-0-1791329280000')
    expect(isAssistCreditReturnKey(key)).toBe(true)
    // A long or odd job id is cut to fit, never refused.
    expect(isAssistCreditReturnKey(aiPlanRefundKey({ day: '2026-10-06', jobId: `${'x'.repeat(90)}/:`, stepIndex: 12, at: 1 }))).toBe(true)
  })

  it('counts the day’s refunds off the give-backs the month records, and no one else’s', () => {
    const returns = {
      'plan-refund-20261006-a-0-1': {},
      'plan-refund-20261006-b-0-2': {},
      'plan-refund-20261005-c-0-3': {},
      'staff-6f1c2b9e-0000': {},
    }
    expect(aiPlanRefundsOn(returns, '2026-10-06')).toBe(2)
    expect(aiPlanRefundsOn(null, '2026-10-06')).toBe(0)
    expect(AI_PLAN_REFUNDS_PER_DAY).toBe(3)
  })
})
