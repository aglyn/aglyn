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
import {
  AI_JOB_REFUNDS_PER_DAY,
  aiJobRefundCredits,
  aiJobRefundKey,
  aiJobRefundsOn,
} from './assist-job-refund'

describe('a job that failed on our side gives back what it spent (AGL-3594)', () => {
  it('is keyed by its day, its job and its give-back count, in the shape the give-back writer takes', () => {
    const key = aiJobRefundKey({ day: '2026-10-06', jobId: 'f0UzIs7Lcl', ordinal: 0 })
    expect(key).toBe('job-refund-20261006-f0UzIs7Lcl-0')
    expect(isAssistCreditReturnKey(key)).toBe(true)
    // The same failure handled twice gives back once; the next failure is its own.
    expect(aiJobRefundKey({ day: '2026-10-06', jobId: 'f0UzIs7Lcl', ordinal: 0 })).toBe(key)
    expect(aiJobRefundKey({ day: '2026-10-06', jobId: 'f0UzIs7Lcl', ordinal: 1 })).not.toBe(key)
    expect(isAssistCreditReturnKey(aiJobRefundKey({ day: '2026-10-06', jobId: `${'x'.repeat(90)}/:`, ordinal: 12 }))).toBe(true)
  })

  it('gives back everything a job that delivered nothing spent, and only the failing step where it delivered drafts', () => {
    expect(aiJobRefundCredits({ delivered: false, jobCredits: 227, stepCredits: 227, alreadyRefunded: 0 })).toBe(227)
    // Earlier steps' spend comes back too, less what was already given back.
    expect(aiJobRefundCredits({ delivered: false, jobCredits: 80, stepCredits: 0, alreadyRefunded: 35 })).toBe(45)
    expect(aiJobRefundCredits({ delivered: true, jobCredits: 180, stepCredits: 20, alreadyRefunded: 0 })).toBe(20)
    expect(aiJobRefundCredits({ delivered: true, jobCredits: 180, stepCredits: 0, alreadyRefunded: 0 })).toBe(0)
  })

  it('counts a day’s give-backs off the month’s keys, and no one else’s', () => {
    const returns = {
      'job-refund-20261006-a-0': {},
      'job-refund-20261006-b-0': {},
      'job-refund-20261005-c-0': {},
      'staff-6f1c2b9e-0000': {},
    }
    expect(aiJobRefundsOn(returns, '2026-10-06')).toBe(2)
    expect(aiJobRefundsOn(null, '2026-10-06')).toBe(0)
    expect(AI_JOB_REFUNDS_PER_DAY).toBe(3)
  })
})
