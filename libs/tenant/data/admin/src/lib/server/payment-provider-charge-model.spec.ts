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
 *
 * @jest-environment node
 */

/**
 * WHICH ACCOUNT SELLS: the charge shape is read off the seller's Stripe
 * account, and anything short of a full, Stripe-billed account stays a
 * destination charge on the platform.
 */

import {
  accountChargeModel,
  connectedAccountHeader,
  DIRECT_CHARGE_ACCOUNT_PARAMS,
  directChargeParams,
  saleChargeModel,
} from './payment-provider'

describe('direct charge helpers', () => {
  it('creates new seller accounts as full, Stripe-billed accounts', () => {
    expect(DIRECT_CHARGE_ACCOUNT_PARAMS).toEqual({
      'controller[fees][payer]': 'account',
      'controller[losses][payments]': 'stripe',
      'controller[requirement_collection]': 'stripe',
      'controller[stripe_dashboard][type]': 'full',
    })
    expect(Object.keys(DIRECT_CHARGE_ACCOUNT_PARAMS)).not.toContain('type')
  })

  it('reads direct only off a full, Stripe-billed account', () => {
    const full = {
      controller: { fees: { payer: 'account' }, stripe_dashboard: { type: 'full' } },
    }
    expect(accountChargeModel(full)).toBe('direct')
    // Express: the platform pays and the dashboard cannot refund or dispute.
    expect(
      accountChargeModel({
        controller: {
          fees: { payer: 'application_express' },
          stripe_dashboard: { type: 'express' },
        },
      }),
    ).toBe('destination')
    expect(accountChargeModel(null)).toBe('destination')
    expect(accountChargeModel({})).toBe('destination')
  })

  it('treats anything but a recorded "direct" as destination', () => {
    expect(saleChargeModel('direct')).toBe('direct')
    for (const value of [undefined, null, '', 'Direct', true, 'destination']) {
      expect(saleChargeModel(value)).toBe('destination')
    }
  })

  it('sends Stripe-Account only for a direct charge with an account', () => {
    expect(connectedAccountHeader('direct', 'acct_1')).toEqual({
      'Stripe-Account': 'acct_1',
    })
    expect(connectedAccountHeader('destination', 'acct_1')).toEqual({})
    expect(connectedAccountHeader('direct', '')).toEqual({})
    expect(connectedAccountHeader('direct', undefined)).toEqual({})
  })

  it('splits a direct charge by application fee alone, and sends nothing at zero', () => {
    expect(directChargeParams(150)).toEqual({
      'payment_intent_data[application_fee_amount]': '150',
    })
    expect(directChargeParams(149.6, '')).toEqual({ application_fee_amount: '150' })
    expect(directChargeParams(0)).toEqual({})
    expect(directChargeParams(-5)).toEqual({})
    expect(directChargeParams(Number.NaN)).toEqual({})
  })
})
