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
  monthlyRecurringCents,
  subscriptionDateLine,
  subscriptionDateText,
  subscriptionIntervalSuffix,
  subscriptionPlanName,
  subscriptionStatusColor,
  subscriptionStatusLabel,
} from './subscription-view'

const DEC_4 = Date.UTC(2026, 11, 4, 12)
const day = () => 'Dec 4, 2026'

describe('monthlyRecurringCents (AGL-4191)', () => {
  it('counts a monthly price whole and a yearly price as a twelfth', () => {
    expect(monthlyRecurringCents(9900, 0, 'month')).toBe(9900)
    expect(monthlyRecurringCents(99000, 0, 'year')).toBe(8250)
  })

  it('leaves tax out, because it is not the merchant’s revenue', () => {
    expect(monthlyRecurringCents(10890, 990, 'month')).toBe(9900)
  })

  it('counts nothing for an interval it cannot read, rather than guessing', () => {
    expect(monthlyRecurringCents(9900, 0, undefined)).toBe(0)
    expect(monthlyRecurringCents(9900, 0, 'week')).toBe(0)
  })

  it('never goes negative or reads junk as money', () => {
    expect(monthlyRecurringCents(100, 500, 'month')).toBe(0)
    expect(monthlyRecurringCents('abc', null, 'month')).toBe(0)
  })
})

describe('subscriptionDateLine (AGL-4191)', () => {
  it('an active subscription renews at its period end', () => {
    const line = subscriptionDateLine({ status: 'active', currentPeriodEndMs: DEC_4 })
    expect(line).toEqual({ kind: 'renews', atMs: DEC_4 })
    expect(subscriptionDateText(line, day)).toBe('Renews Dec 4, 2026')
  })

  it('one cancelled in the billing portal ends instead of renewing', () => {
    const line = subscriptionDateLine({
      status: 'active',
      cancelAtPeriodEnd: true,
      currentPeriodEndMs: DEC_4,
    })
    expect(subscriptionDateText(line, day)).toBe('Ends Dec 4, 2026')
  })

  it('a trial says when it ends, or that the subscription ends with it', () => {
    expect(
      subscriptionDateText(subscriptionDateLine({ status: 'trialing', currentPeriodEndMs: DEC_4 }), day),
    ).toBe('Trial ends Dec 4, 2026')
    expect(
      subscriptionDateText(
        subscriptionDateLine({ status: 'trialing', cancelAtPeriodEnd: true, currentPeriodEndMs: DEC_4 }),
        day,
      ),
    ).toBe('Ends Dec 4, 2026')
  })

  it('falls back to the paid-through date when Stripe sent no period end', () => {
    expect(
      subscriptionDateLine({ status: 'active', currentPeriodEndMs: null, paidThroughMs: DEC_4 }),
    ).toEqual({ kind: 'renews', atMs: DEC_4 })
  })

  it('a failed payment names no date, because Stripe moves the period while it retries', () => {
    expect(subscriptionDateLine({ status: 'past_due', currentPeriodEndMs: DEC_4 })).toEqual({
      kind: 'paymentFailed',
    })
    expect(subscriptionDateText(subscriptionDateLine({ status: 'unpaid' }))).toBe('Payment failed')
  })

  it('a canceled subscription says when it ended, and nothing without a date', () => {
    expect(
      subscriptionDateText(subscriptionDateLine({ status: 'canceled', currentPeriodEndMs: DEC_4 }), day),
    ).toBe('Ended Dec 4, 2026')
    expect(subscriptionDateLine({ status: 'canceled' })).toBeNull()
  })

  it('says nothing for an active subscription with no date at all', () => {
    expect(subscriptionDateLine({ status: 'active' })).toBeNull()
    expect(subscriptionDateText(null)).toBe('')
  })
})

describe('labels (AGL-4191)', () => {
  it('names every Stripe status in the merchant’s words', () => {
    expect(subscriptionStatusLabel('trialing')).toBe('Trial')
    expect(subscriptionStatusLabel('past_due')).toBe('Past due')
    expect(subscriptionStatusLabel('incomplete_expired')).toBe('Expired')
    expect(subscriptionStatusLabel('something_new')).toBe('something new')
    expect(subscriptionStatusLabel(undefined)).toBe('Unknown')
  })

  it('colors trouble, and leaves an ended subscription plain', () => {
    expect(subscriptionStatusColor('active')).toBe('success')
    expect(subscriptionStatusColor('past_due')).toBe('warning')
    expect(subscriptionStatusColor('canceled')).toBe('default')
  })

  it('names the plan from the line bought, with its quantity', () => {
    expect(subscriptionPlanName({ lineItems: [{ name: 'Pro — monthly', quantity: 1 }] })).toBe(
      'Pro — monthly',
    )
    expect(subscriptionPlanName({ lineItems: [{ name: 'Extra seat', quantity: 3 }] })).toBe(
      '3× Extra seat',
    )
    expect(subscriptionPlanName({ productId: 'p1' })).toBe('p1')
    expect(subscriptionPlanName({})).toBe('Subscription')
  })

  it('suffixes a price with its interval only when it knows it', () => {
    expect(subscriptionIntervalSuffix('month')).toBe('/month')
    expect(subscriptionIntervalSuffix('year')).toBe('/year')
    expect(subscriptionIntervalSuffix(undefined)).toBe('')
  })
})
