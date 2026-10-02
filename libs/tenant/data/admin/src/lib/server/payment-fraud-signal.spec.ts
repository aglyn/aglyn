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
  SELLER_FRAUD_PATTERN,
  type SellerFraudLedgerEntry,
  sellerFraudPattern,
  staffSubscriptionCardPath,
} from './payment-fraud-signal'

describe('the row a fraud signal files', () => {
  it('is one row per CHARGE, whichever signals it draws (AGL-3490)', () => {
    const on = (
      kind: 'early-fraud-warning' | 'radar-review' | 'dispute',
      stripeObjectId: string,
      chargeId: string | null,
      paymentIntentId: string | null = null,
    ) => paymentFraudSignalReviewId({ kind, stripeObjectId, chargeId, paymentIntentId })
    const id = on('early-fraud-warning', 'issfr_1', 'ch_1')
    expect(id).toMatch(/^[a-f0-9]{40}$/)
    expect(on('dispute', 'du_1', 'ch_1')).toBe(id)
    expect(on('radar-review', 'prv_1', 'ch_1', 'pi_1')).toBe(id)
    expect(on('early-fraud-warning', 'issfr_2', 'ch_2')).not.toBe(id)
    // The payment intent stands in for a charge the signal does not name,
    // and the signal itself for one that names neither.
    expect(on('radar-review', 'prv_2', null, 'pi_9')).toBe(
      on('dispute', 'du_9', null, 'pi_9'),
    )
    expect(on('radar-review', 'prv_3', null)).not.toBe(on('radar-review', 'prv_4', null))
    expect(paymentFraudSignalReference(id)).toMatch(/^PF-[A-F0-9]{10}$/)
  })

  it('links the org page’s Subscription card', () => {
    expect(staffSubscriptionCardPath('org 1')).toBe('/admin/orgs/org%201#subscription')
  })

  it('says an unknown amount is unknown, never zero', () => {
    expect(formatSignalAmount(null, 'usd')).toBe('amount not recorded')
    expect(formatSignalAmount(5600, 'eur')).toBe('56.00 EUR')
  })

  it('names the org, the charge, the checks, and that the alert refunded nothing', () => {
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
    expect(text).toContain('This alert refunded and canceled nothing')
    expect(text).not.toContain('Nothing has been refunded')
    expect(text).not.toContain('TEST MODE')
  })

  const dispute = {
    kind: 'dispute' as const,
    stripeObjectId: 'du_1',
    chargeId: 'ch_1',
    paymentIntentId: null,
    orgId: 'org-1',
    amountCents: 5600,
    currency: 'usd',
    detail: 'fraudulent',
    checks: null,
    livemode: true,
  }
  const history = [
    { kind: 'early-fraud-warning' as const, stripeObjectId: 'issfr_1', detail: '', atMs: 1, arrivedAfter: null },
    { kind: 'dispute' as const, stripeObjectId: 'du_1', detail: 'fraudulent', atMs: 2, arrivedAfter: 'actioned' },
  ]

  it('lists every signal on the charge and keeps a closed row’s decision in front (AGL-3490)', () => {
    const text = describePaymentFraudSignal(dispute, {
      history,
      closed: { status: 'actioned', resolution: 'Locked; accepted the chargeback.' },
    })
    expect(text).toContain('Early fraud warning (issfr_1); Card dispute opened (du_1, after the row was actioned)')
    expect(text).toContain('closed as actioned: “Locked; accepted the chargeback.”')
    expect(text).toContain('nobody was notified again')
    expect(text).not.toContain('Decide on the org’s Subscription card')
  })

  it('says a dispute reopened a row staff had dismissed', () => {
    const text = describePaymentFraudSignal(dispute, {
      history,
      closed: { status: 'dismissed', resolution: null },
      reopened: true,
    })
    expect(text).toContain('REOPENED. Staff had dismissed this row.')
    expect(text).toContain('evidence deadline')
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

describe('the seller fraud pattern (AGL-3360)', () => {
  const NOW = 1_800_000_000_000
  const DAY = 86_400_000
  const entry = (
    kind: SellerFraudLedgerEntry['kind'],
    chargeId: string,
    ageDays = 0,
  ): SellerFraudLedgerEntry => ({
    kind,
    stripeObjectId: `${kind}-${chargeId}-${ageDays}`,
    chargeId,
    amountCents: 1000,
    currency: 'usd',
    detail: '',
    hostIds: [],
    atMs: NOW - ageDays * DAY,
  })

  it('matches three distinct charges with warnings or disputes inside the window', () => {
    expect(SELLER_FRAUD_PATTERN.minDistinctCharges).toBe(3)
    expect(
      sellerFraudPattern(
        [
          entry('early-fraud-warning', 'a', 6),
          entry('dispute', 'b', 2),
          entry('early-fraud-warning', 'c'),
        ],
        NOW,
      ),
    ).toEqual({ matched: true, chargeIds: ['a', 'b', 'c'] })
  })

  it('counts a charge once however many signals it drew', () => {
    expect(
      sellerFraudPattern(
        [
          entry('early-fraud-warning', 'a'),
          entry('dispute', 'a'),
          entry('early-fraud-warning', 'b'),
        ],
        NOW,
      ).matched,
    ).toBe(false)
  })

  it('ignores reviews and anything older than the window', () => {
    expect(
      sellerFraudPattern(
        [
          entry('radar-review', 'a'),
          entry('radar-review', 'b'),
          entry('early-fraud-warning', 'c', 8),
          entry('dispute', 'd'),
          entry('dispute', 'e'),
        ],
        NOW,
      ),
    ).toEqual({ matched: false, chargeIds: ['d', 'e'] })
  })
})

describe('readStripeChargeForSignal names the seller (AGL-3360)', () => {
  const reply = (charge: Record<string, unknown>) =>
    (async () => ({ ok: true, json: async () => charge })) as unknown as typeof fetch

  it('reads a destination charge’s connected account', async () => {
    const read = await readStripeChargeForSignal('ch_1', {
      secretKey: 'sk_test_x',
      fetchImpl: reply({ amount: 100, transfer_data: { destination: 'acct_1' } }),
    })
    expect(read?.sellerAccountId).toBe('acct_1')
  })

  it('is null for a charge that paid only the platform', async () => {
    const read = await readStripeChargeForSignal('ch_1', {
      secretKey: 'sk_test_x',
      fetchImpl: reply({ amount: 100 }),
    })
    expect(read?.sellerAccountId).toBeNull()
  })
})
