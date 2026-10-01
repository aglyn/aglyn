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
  defaultPaymentMethodChange,
  describeStripePaymentMethod,
  moveSubscriptionsOntoDefault,
  selectSubscriptionPaymentMethod,
  subscriptionsToMoveOntoDefault,
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

/**
 * A NEW CUSTOMER DEFAULT MUST REACH THE SUBSCRIPTION (AGL-3442).
 *
 * The Billing Portal's payment-method flow sets only
 * `customer.invoice_settings.default_payment_method`, and every subscription
 * the console creates carries its own `default_payment_method`, which wins.
 * Left there, the customer is told the payment method is updated while the
 * next retry charges the card that failed.
 */
describe('defaultPaymentMethodChange (AGL-3442)', () => {
  const customer = (pm: unknown) => ({ invoice_settings: { default_payment_method: pm } })

  it('reads a change from one default to another', () => {
    expect(
      defaultPaymentMethodChange(customer('pm_new'), {
        invoice_settings: { default_payment_method: 'pm_old' },
      }),
    ).toEqual({ from: 'pm_old', to: 'pm_new' })
  })

  it('reads a first default as a change from none', () => {
    expect(
      defaultPaymentMethodChange(customer({ id: 'pm_new' }), {
        invoice_settings: { default_payment_method: null },
      }),
    ).toEqual({ from: null, to: 'pm_new' })
  })

  it('is no change when the update was about something else', () => {
    // An address edit names `address` in previous_attributes, not the default,
    // however the default is set.
    expect(
      defaultPaymentMethodChange(customer('pm_new'), { address: { city: 'Austin' } }),
    ).toBeNull()
    expect(defaultPaymentMethodChange(customer('pm_new'), undefined)).toBeNull()
    expect(
      defaultPaymentMethodChange(customer('pm_new'), {
        invoice_settings: { custom_fields: null },
      }),
    ).toBeNull()
  })

  it('is no change when the default was cleared', () => {
    expect(
      defaultPaymentMethodChange(customer(null), {
        invoice_settings: { default_payment_method: 'pm_old' },
      }),
    ).toBeNull()
  })
})

describe('subscriptionsToMoveOntoDefault (AGL-3442)', () => {
  const sub = (id: string, status: string, pm: unknown) => ({
    id,
    status,
    default_payment_method: pm,
  })

  it('moves a live subscription still billing the previous default', () => {
    expect(
      subscriptionsToMoveOntoDefault(
        [sub('sub_live', 'past_due', 'pm_old'), sub('sub_paid', 'active', { id: 'pm_old' })],
        { from: 'pm_old', to: 'pm_new' },
      ),
    ).toEqual(['sub_live', 'sub_paid'])
  })

  it('leaves a subscription pinned to some other method, one with no override, one already on the new default, and a dead one', () => {
    expect(
      subscriptionsToMoveOntoDefault(
        [
          sub('sub_other', 'active', 'pm_elsewhere'),
          sub('sub_follows', 'active', null),
          sub('sub_done', 'active', 'pm_new'),
          sub('sub_dead', 'canceled', 'pm_old'),
        ],
        { from: 'pm_old', to: 'pm_new' },
      ),
    ).toEqual([])
  })

  it('moves every live override when the customer had no default before', () => {
    expect(
      subscriptionsToMoveOntoDefault(
        [sub('sub_legacy', 'unpaid', 'pm_checkout'), sub('sub_follows', 'active', null)],
        { from: null, to: 'pm_new' },
      ),
    ).toEqual(['sub_legacy'])
  })

  it('reads nothing into a non-list', () => {
    expect(subscriptionsToMoveOntoDefault({ error: 'nope' }, { from: null, to: 'pm_new' })).toEqual([])
  })
})

describe('moveSubscriptionsOntoDefault (AGL-3442)', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('posts the new default onto each subscription that must follow it, and only those', async () => {
    const posts: Array<{ url: string; body: string }> = []
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push({ url, body: String(init.body) })
        return { ok: !url.endsWith('sub_refused'), json: async () => ({}) }
      }
      return {
        ok: true,
        json: async () => ({
          data: [
            { id: 'sub_live', status: 'past_due', default_payment_method: 'pm_old' },
            { id: 'sub_refused', status: 'active', default_payment_method: 'pm_old' },
            { id: 'sub_other', status: 'active', default_payment_method: 'pm_elsewhere' },
          ],
        }),
      }
    }) as never

    const outcome = await moveSubscriptionsOntoDefault('sk_test_fake', 'cus_1', {
      from: 'pm_old',
      to: 'pm_new',
    })

    expect(outcome).toEqual({ moved: ['sub_live'], failed: ['sub_refused'] })
    expect(posts.map((post) => post.url)).toEqual([
      'https://api.stripe.com/v1/subscriptions/sub_live',
      'https://api.stripe.com/v1/subscriptions/sub_refused',
    ])
    expect(posts[0].body).toBe('default_payment_method=pm_new')
  })

  it('answers undefined, and never throws, when the subscriptions cannot be read', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('network down')
    }) as never
    await expect(
      moveSubscriptionsOntoDefault('sk_test_fake', 'cus_1', { from: 'pm_old', to: 'pm_new' }),
    ).resolves.toBeUndefined()
  })
})
