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
  describeStripePaymentMethod,
  selectSubscriptionPaymentMethod,
} from './stripe-payment-method'

const cardMethod = {
  type: 'card',
  card: { brand: 'visa', last4: '4242', exp_month: 4, exp_year: 2030 },
  billing_details: { email: 'card@example.com' },
}

/** What Test Org actually pays with — no `.card` anywhere on it. */
const linkMethod = {
  type: 'link',
  link: { email: 'zach@example.com' },
  billing_details: { email: null },
}

const subscription = (status: string, pm: unknown = linkMethod) => ({
  status,
  default_payment_method: pm,
})

describe('describeStripePaymentMethod (AGL-940)', () => {
  it('describes a card', () => {
    expect(describeStripePaymentMethod(cardMethod)).toEqual({
      type: 'card',
      brand: 'visa',
      last4: '4242',
      expMonth: 4,
      expYear: 2030,
      email: 'card@example.com',
    })
  })

  it('describes a Link wallet, which has no card object at all', () => {
    // The original bug: reading `.card` on this yielded null, and the chip
    // said "No payment method" beside a paid invoice.
    const described = describeStripePaymentMethod(linkMethod)
    expect(described?.type).toBe('link')
    expect(described?.email).toBe('zach@example.com')
    expect(described?.brand).toBeNull()
  })

  it('returns null for an UNEXPANDED id string, not a blank method', () => {
    // Without `expand[]` Stripe sends the bare id. Treating that truthy
    // string as a method renders an empty chip, which reads as "we know
    // there is one and it has no details" — worse than an honest none.
    expect(describeStripePaymentMethod('pm_1TubsIDYHP4psn7hbmnl6tbh')).toBeNull()
  })

  it('returns null for absent input', () => {
    expect(describeStripePaymentMethod(null)).toBeNull()
    expect(describeStripePaymentMethod(undefined)).toBeNull()
  })
})

describe('selectSubscriptionPaymentMethod (AGL-940)', () => {
  it('prefers a live subscription over a newer cancelled one', () => {
    // `data` is newest-first, so a freshly cancelled subscription sorts
    // ahead of the one actually being billed. Taking [0] blindly would
    // report a stale method as current.
    const chosen = selectSubscriptionPaymentMethod([
      subscription('canceled', cardMethod),
      subscription('active', linkMethod),
    ])
    expect(chosen?.type).toBe('link')
  })

  it('accepts every status Stripe still bills against', () => {
    for (const status of ['active', 'trialing', 'past_due', 'unpaid']) {
      expect(selectSubscriptionPaymentMethod([subscription(status)])?.type).toBe(
        'link',
      )
    }
  })

  it('falls back to the newest subscription when none is live', () => {
    const chosen = selectSubscriptionPaymentMethod([
      subscription('canceled', cardMethod),
      subscription('incomplete_expired', linkMethod),
    ])
    expect(chosen?.type).toBe('card')
  })

  it('returns null for an empty list or a non-array', () => {
    expect(selectSubscriptionPaymentMethod([])).toBeNull()
    expect(selectSubscriptionPaymentMethod(undefined)).toBeNull()
    expect(selectSubscriptionPaymentMethod({ error: 'nope' })).toBeNull()
  })

  it('returns null when the live subscription carries no method', () => {
    expect(
      selectSubscriptionPaymentMethod([subscription('active', null)]),
    ).toBeNull()
  })
})
