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
  BILLING_LOCK_GRACE_DAYS,
  billingAutoLockEnabled,
  shouldAutoLockOrgForBilling,
} from './billing-auto-lock'

const NOW = Date.parse('2026-08-13T12:00:00Z')
const DAY_MS = 24 * 60 * 60 * 1000
const periodEnd = (daysAgo: number) => ({
  seconds: Math.floor((NOW - daysAgo * DAY_MS) / 1000),
})

describe('billingAutoLockEnabled — the switch is OFF until Zach flips it', () => {
  it('is disabled with no env value, an empty one, or garbage', () => {
    expect(billingAutoLockEnabled('2026-08', undefined)).toBe(false)
    expect(billingAutoLockEnabled('2026-08', '')).toBe(false)
    expect(billingAutoLockEnabled('2026-08', 'true')).toBe(false)
    expect(billingAutoLockEnabled('2026-08', '2026')).toBe(false)
    expect(billingAutoLockEnabled('2026-08', '2026-8')).toBe(false)
  })

  it('arms from the configured month onward, never before', () => {
    expect(billingAutoLockEnabled('2026-08', '2026-09')).toBe(false)
    expect(billingAutoLockEnabled('2026-09', '2026-09')).toBe(true)
    expect(billingAutoLockEnabled('2026-10', '2026-09')).toBe(true)
  })
})

describe('shouldAutoLockOrgForBilling', () => {
  it('locks an unpaid org whose paid period ended over 30 days ago', () => {
    for (const status of ['past_due', 'unpaid']) {
      expect(
        shouldAutoLockOrgForBilling(
          {},
          { status, currentPeriodEnd: periodEnd(31) },
          NOW,
        ),
      ).toBe(true)
    }
  })

  it('reads the org-doc billingStatus mirror when the subdoc lacks a status', () => {
    expect(
      shouldAutoLockOrgForBilling(
        { billingStatus: 'unpaid' },
        { currentPeriodEnd: periodEnd(31) },
        NOW,
      ),
    ).toBe(true)
  })

  it('waits out the full grace window', () => {
    expect(
      shouldAutoLockOrgForBilling(
        {},
        {
          status: 'unpaid',
          currentPeriodEnd: periodEnd(BILLING_LOCK_GRACE_DAYS - 1),
        },
        NOW,
      ),
    ).toBe(false)
  })

  it('never touches healthy, canceled, free or already-suspended orgs', () => {
    expect(
      shouldAutoLockOrgForBilling(
        {},
        { status: 'active', currentPeriodEnd: periodEnd(40) },
        NOW,
      ),
    ).toBe(false)
    // Canceled orgs downgrade to Free via entitlement resolution — that is
    // the product's lapse path, not a suspension.
    expect(
      shouldAutoLockOrgForBilling(
        {},
        { status: 'canceled', currentPeriodEnd: periodEnd(40) },
        NOW,
      ),
    ).toBe(false)
    expect(shouldAutoLockOrgForBilling({}, null, NOW)).toBe(false)
    expect(
      shouldAutoLockOrgForBilling(
        { suspendedAt: { seconds: 1 } },
        { status: 'unpaid', currentPeriodEnd: periodEnd(40) },
        NOW,
      ),
    ).toBe(false)
  })

  it('fails closed without a period end to anchor the 30 days on', () => {
    expect(
      shouldAutoLockOrgForBilling(
        {},
        { status: 'unpaid', currentPeriodEnd: null },
        NOW,
      ),
    ).toBe(false)
    expect(
      shouldAutoLockOrgForBilling({ billingStatus: 'unpaid' }, null, NOW),
    ).toBe(false)
  })
})
