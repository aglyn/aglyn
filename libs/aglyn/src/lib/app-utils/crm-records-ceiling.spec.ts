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

/**
 * Starter sells CRM records past its band only up to Pro's included amount
 * (AGL-4227). Past it a NEW record is refused with an upgrade message; every
 * record already held stays, and keeps billing.
 */

import {
  PLAN_ENTITLEMENTS,
  PLAN_PRICING,
  UNLIMITED,
  checkCrmRecordsQuota,
  crmRecordsRefusalMessage,
} from './plan-entitlements'
import type { OrgPlan } from '../foundation'

const starter = { plan: 'starter', billingStatus: 'active' } as never
const PRO_BAND = PLAN_ENTITLEMENTS.pro.contactsPerHost as number

describe('Starter CRM records stop at Pro\'s included amount (AGL-4227)', () => {
  it('reads the ceiling off Pro\'s band, and Pro and up have none', () => {
    expect(PLAN_ENTITLEMENTS.starter.maxCrmRecords).toBe(PRO_BAND)
    expect(PRO_BAND).toBe(10_000)
    for (const plan of ['pro', 'business', 'scale', 'advanced', 'agency', 'enterprise'] as OrgPlan[]) {
      expect(`${plan}: ${PLAN_ENTITLEMENTS[plan].maxCrmRecords}`).toBe(`${plan}: ${UNLIMITED}`)
    }
  })

  it('meters past 1,000 and refuses the record AT Pro\'s band', () => {
    const below = checkCrmRecordsQuota(starter, PRO_BAND - 1)
    expect(below.allowed).toBe(true)
    expect(below.overageRecords).toBe(PRO_BAND - 1 - 1_000)
    const at = checkCrmRecordsQuota(starter, PRO_BAND)
    expect(at.allowed).toBe(false)
    expect(at.refusedBy).toBe('ceiling')
    expect(at.ceiling).toBe(PRO_BAND)
  })

  it('records already held past the ceiling keep billing — the ceiling refuses, never deletes', () => {
    const over = checkCrmRecordsQuota(starter, 15_000)
    expect(over.allowed).toBe(false)
    expect(over.overageRecords).toBe(14_000)
    expect(over.overageMonthlyUsd).toBeCloseTo((14_000 / 1000) * (PLAN_PRICING.starter.extraContactsUsdPer1k as number), 2)
  })

  it('Pro is never refused, however many it holds', () => {
    expect(checkCrmRecordsQuota({ plan: 'pro', billingStatus: 'active' } as never, 5_000_000).allowed).toBe(true)
  })

  it('Free still walls at its band, as before', () => {
    const free = checkCrmRecordsQuota({ plan: 'free' } as never, 100)
    expect(free.allowed).toBe(false)
    expect(free.refusedBy).toBe('band')
  })

  it('says what the limit is, that nothing held is lost, and where the room is', () => {
    const message = crmRecordsRefusalMessage(starter, checkCrmRecordsQuota(starter, PRO_BAND))
    expect(message).toContain('10,000')
    expect(message).toContain('every record you have is kept')
    expect(message).toContain('Upgrade to Pro')
  })
})
