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
 * The pure halves of the Stripe fraud-signal filing (AGL-3356). The filing
 * itself is driven end to end through the billing webhook in
 * `apps/console/specs/billing-webhook-platform-dispute.spec.ts`.
 */

import {
  describePaymentFraudSignal,
  formatSignalAmount,
  paymentFraudSignalReference,
  paymentFraudSignalReviewId,
  readStripeChargeForSignal,
  staffSubscriptionCardPath,
} from './payment-fraud-signal'

describe('the row a fraud signal files', () => {
  it('is one row per Stripe object, addressable by the admin route', () => {
    const id = paymentFraudSignalReviewId('early-fraud-warning', 'issfr_1')
    expect(id).toMatch(/^[a-f0-9]{40}$/)
    expect(paymentFraudSignalReviewId('early-fraud-warning', 'issfr_1')).toBe(id)
    expect(paymentFraudSignalReviewId('radar-review', 'issfr_1')).not.toBe(id)
    expect(paymentFraudSignalReference(id)).toMatch(/^PF-[A-F0-9]{10}$/)
  })

  it('links the org page’s Subscription card', () => {
    expect(staffSubscriptionCardPath('org 1')).toBe('/admin/orgs/org%201#subscription')
  })

  it('says an unknown amount is unknown, never zero', () => {
    expect(formatSignalAmount(null, 'usd')).toBe('amount not recorded')
    expect(formatSignalAmount(5600, 'eur')).toBe('56.00 EUR')
  })

  it('names the org, the charge, the checks, and that nothing was refunded', () => {
    const text = describePaymentFraudSignal({
      kind: 'early-fraud-warning',
      stripeObjectId: 'issfr_1',
      chargeId: 'ch_1',
      paymentIntentId: null,
      orgId: 'org-1',
      amountCents: 5600,
      currency: 'usd',
      detail: 'unauthorized_use_of_card',
      checks: {
        cvcCheck: 'unavailable',
        addressPostalCodeCheck: 'fail',
        cardCountry: 'NL',
        riskLevel: 'elevated',
        threeDSecure: null,
      },
      livemode: true,
    })
    expect(text).toContain('Workspace: org-1')
    expect(text).toContain('ch_1 · 56.00 USD')
    expect(text).toContain('CVC unavailable')
    expect(text).toContain('issued in NL')
    expect(text).toContain('Nothing has been refunded or canceled')
    expect(text).not.toContain('TEST MODE')
  })
})

describe('readStripeChargeForSignal', () => {
  it('makes no request without a key or a charge', async () => {
    const fetchImpl = jest.fn()
    expect(await readStripeChargeForSignal('ch_1', { secretKey: undefined, fetchImpl })).toBeNull()
    expect(await readStripeChargeForSignal('', { secretKey: 'sk', fetchImpl })).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('is a GET, and answers null rather than throwing on a refusal', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, json: async () => ({}) }))
    expect(
      await readStripeChargeForSignal('ch_1', { secretKey: 'sk', fetchImpl: fetchImpl as never }),
    ).toBeNull()
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { method?: string }]
    expect(url).toBe('https://api.stripe.com/v1/charges/ch_1')
    expect(init.method ?? 'GET').toBe('GET')
    const throwing = jest.fn(async () => {
      throw new Error('network')
    })
    expect(
      await readStripeChargeForSignal('ch_1', { secretKey: 'sk', fetchImpl: throwing as never }),
    ).toBeNull()
  })
})
