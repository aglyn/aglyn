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

import { storefrontTaxRow } from './storefront-tax'

/**
 * The storefront tax decomposition (AGL-1904).
 *
 * The two session fixtures are TRANSCRIBED FROM REAL STRIPE RESPONSES, from
 * the test-mode two-arm experiment recorded in the module note: the same
 * session shape (`transfer_data[destination]` to a connected account,
 * `automatic_tax[enabled]`, a Texas shopper) run once with the platform
 * unregistered and once with it registered in Texas. They are the evidence
 * that `automatic_tax.liability` says `self` on a platform session and that
 * the destination account's own registrations are not consulted.
 *
 * The load-bearing case is `manual`: a manual-mode subscription renewal
 * carries genuine Stripe Tax Rates, so its invoice is shaped like a Stripe Tax
 * invoice. The mode must still come out `manual`, or merchant-configured tax
 * gets booked as Aglyn-collected — which is the defect this issue exists to
 * close, restated.
 */
describe('storefrontTaxRow (AGL-1904)', () => {
  /** Arm 2 of the experiment, verbatim: platform registered in Texas. */
  const registeredPlatformSession = {
    id: 'cs_test_arm2',
    object: 'checkout_session',
    amount_subtotal: 10000,
    amount_total: 10825,
    currency: 'usd',
    created: 1787032952,
    metadata: { type: 'commerce-cart', hostId: 'host-1' },
    automatic_tax: {
      enabled: true,
      liability: { type: 'self' },
      provider: 'stripe',
      status: 'complete',
    },
    customer_details: {
      address: {
        line1: '500 W 2nd St',
        city: 'Austin',
        state: 'TX',
        postal_code: '78701',
        country: 'US',
      },
    },
    total_details: {
      amount_discount: 0,
      amount_shipping: 0,
      amount_tax: 825,
      breakdown: {
        discounts: [],
        taxes: [
          {
            amount: 825,
            taxability_reason: 'standard_rated',
            taxable_amount: 10000,
            rate: {
              id: 'txr_arm2',
              object: 'tax_rate',
              jurisdiction: 'Texas',
              jurisdiction_level: 'multiple',
              percentage: 8.25,
              effective_percentage: 8.25,
              state: 'TX',
              tax_type: 'sales_tax',
            },
          },
        ],
      },
    },
  }

  /** Arm 1, verbatim: platform unregistered, DESTINATION account registered. */
  const unregisteredPlatformSession = {
    ...registeredPlatformSession,
    id: 'cs_test_arm1',
    amount_total: 10000,
    total_details: {
      amount_discount: 0,
      amount_shipping: 0,
      amount_tax: 0,
      breakdown: {
        discounts: [],
        taxes: [
          {
            amount: 0,
            taxability_reason: 'not_collecting',
            taxable_amount: 0,
            rate: {
              id: 'txr_arm1',
              object: 'tax_rate',
              jurisdiction: 'Texas',
              percentage: 8.25,
              effective_percentage: 0,
              state: 'TX',
              tax_type: 'sales_tax',
            },
          },
        ],
      },
    },
  }

  it('reads a platform session as Aglyn-liable, keeping Stripe’s base', () => {
    const row = storefrontTaxRow(registeredPlatformSession, {
      kind: 'session',
      hostId: 'host-1',
    })
    expect(row).toMatchObject({
      kind: 'session',
      hostId: 'host-1',
      metadataType: 'commerce-cart',
      taxMode: 'stripe-automatic',
      taxLiability: 'platform',
      grossCents: 10825,
      taxCents: 825,
      netCents: 10000,
      currency: 'usd',
      customerAddress: { country: 'US', state: 'TX', city: 'Austin' },
    })
    // The base is KEPT, not derived from amount ÷ rate.
    expect(row?.taxLines).toEqual([
      {
        amountCents: 825,
        taxabilityReason: 'standard_rated',
        taxRateId: 'txr_arm2',
        taxableAmountCents: 10000,
        jurisdiction: 'Texas',
        rateState: 'TX',
        percentage: 8.25,
      },
    ])
  })

  it('records the unregistered arm as zero-collected, not as untaxed', () => {
    const row = storefrontTaxRow(unregisteredPlatformSession, {
      kind: 'session',
      hostId: 'host-1',
    })
    // Still `stripe-automatic` — Stripe Tax RAN, and answered zero. A row that
    // read this as `none` would lose the evidence that the destination
    // account's registration was ignored.
    expect(row?.taxMode).toBe('stripe-automatic')
    expect(row?.taxLiability).toBe('platform')
    expect(row?.taxCents).toBe(0)
    expect(row?.taxLines[0]).toMatchObject({
      taxabilityReason: 'not_collecting',
      taxableAmountCents: 0,
    })
  })

  it('names the connected account when the session carries one', () => {
    const row = storefrontTaxRow(
      {
        ...registeredPlatformSession,
        payment_intent_data: { transfer_data: { destination: 'acct_merchant' } },
      },
      { kind: 'session', hostId: 'host-1' },
    )
    expect(row?.connectedAccountId).toBe('acct_merchant')
  })

  it('reads `liability: account` as the connected account, not the platform', () => {
    const row = storefrontTaxRow(
      {
        ...registeredPlatformSession,
        automatic_tax: {
          enabled: true,
          liability: { type: 'account', account: 'acct_merchant' },
          status: 'complete',
        },
      },
      { kind: 'session', hostId: 'host-1' },
    )
    expect(row?.taxLiability).toBe('connected-account')
  })

  describe('the manual mode is a different fact', () => {
    it('reads a manual-mode session from its metadata, with no tax lines', () => {
      const row = storefrontTaxRow(
        {
          id: 'cs_manual',
          amount_total: 10800,
          currency: 'usd',
          created: 1787032952,
          metadata: { type: 'commerce-order', hostId: 'host-1', taxCents: '800' },
          automatic_tax: { enabled: false },
          total_details: { amount_tax: 0 },
        },
        { kind: 'session', hostId: 'host-1', manualTaxCents: 800 },
      )
      expect(row).toMatchObject({
        taxMode: 'manual',
        // Never `platform`: Aglyn's registrations played no part.
        taxLiability: null,
        taxCents: 800,
        netCents: 10000,
      })
      expect(row?.taxLines).toEqual([])
    })

    /**
     * THE TRAP. AGL-1751 attaches a real Stripe Tax Rate to a manual-mode
     * subscription so the tax recurs, so the renewal invoice arrives with a
     * populated `total_taxes[]` — shaped exactly like a Stripe Tax invoice.
     * Only `automatic_tax.enabled` tells them apart.
     */
    it('does NOT call a manual subscription renewal Stripe-computed, though its invoice carries real tax rates', () => {
      const row = storefrontTaxRow(
        {
          id: 'in_manual_renewal',
          amount_paid: 10800,
          currency: 'usd',
          status_transitions: { paid_at: 1787032952 },
          automatic_tax: { enabled: false },
          subscription_details: {
            metadata: { type: 'commerce-subscription', hostId: 'host-1' },
          },
          total_taxes: [
            {
              amount: 800,
              taxable_amount: 10000,
              taxability_reason: 'standard_rated',
              tax_rate_details: { tax_rate: 'txr_merchant_configured' },
            },
          ],
          customer_address: { country: 'US', state: 'TX' },
        },
        { kind: 'invoice', hostId: 'host-1' },
      )
      expect(row?.taxMode).toBe('manual')
      expect(row?.taxLiability).toBeNull()
      expect(row?.taxCents).toBe(800)
      // Stripe DID state a base here, and since AGL-1953 it is kept rather
      // than discarded: the same construction now carries the cart and
      // draft-order manual paths, and throwing the breakdown away left
      // `merchantManual.taxableSalesCents` a permanent zero.
      //
      // Discarding it was never what protected Aglyn's figure — the
      // CLASSIFICATION is. `taxMode: 'manual'` sends this row to the
      // `merchantManual` bucket in `tx-return.ts` and it can reach the
      // Aglyn-liable one by no path at all, which the two assertions above
      // are what pin. Restated here so a future reader does not "restore"
      // the empty array believing it was a safety property.
      expect(row?.taxLines).toEqual([
        {
          amountCents: 800,
          taxabilityReason: 'standard_rated',
          taxRateId: 'txr_merchant_configured',
          taxableAmountCents: 10000,
          jurisdiction: null,
          rateState: null,
          percentage: null,
        },
      ])
    })

    it('reads a Stripe-Tax subscription renewal from `total_taxes[]`', () => {
      const row = storefrontTaxRow(
        {
          id: 'in_auto_renewal',
          amount_paid: 10825,
          currency: 'usd',
          tax: 0,
          status_transitions: { paid_at: 1787032952 },
          automatic_tax: { enabled: true, liability: { type: 'self' } },
          subscription_details: {
            metadata: { type: 'commerce-subscription', hostId: 'host-1' },
          },
          total_taxes: [
            {
              amount: 825,
              taxable_amount: 10000,
              taxability_reason: 'standard_rated',
              tax_rate_details: { tax_rate: 'txr_auto' },
            },
          ],
          customer_address: { country: 'US', state: 'TX', city: 'Austin' },
        },
        { kind: 'invoice', hostId: 'host-1' },
      )
      // The scalar `tax: 0` beside a populated array is the live-account shape
      // AGL-1811 measured; the array wins.
      expect(row).toMatchObject({
        kind: 'invoice',
        metadataType: 'commerce-subscription',
        taxMode: 'stripe-automatic',
        taxLiability: 'platform',
        taxCents: 825,
        grossCents: 10825,
        netCents: 10000,
        customerAddress: { country: 'US', state: 'TX' },
      })
      expect(row?.taxLines[0]?.taxableAmountCents).toBe(10000)
    })
  })

  it('marks a session with no tax at all as `none`', () => {
    const row = storefrontTaxRow(
      {
        id: 'cs_none',
        amount_total: 10000,
        currency: 'usd',
        metadata: { type: 'commerce-reservation', hostId: 'host-1' },
      },
      { kind: 'session', hostId: 'host-1' },
    )
    expect(row).toMatchObject({ taxMode: 'none', taxLiability: null, taxCents: 0 })
  })

  it('leaves the base null when Stripe stated an amount but no breakdown', () => {
    // The un-expanded webhook payload: `amount_tax` present, no `breakdown`.
    const row = storefrontTaxRow(
      {
        id: 'cs_unexpanded',
        amount_total: 10825,
        currency: 'usd',
        metadata: { type: 'commerce-cart', hostId: 'host-1' },
        automatic_tax: { enabled: true, liability: { type: 'self' } },
        total_details: { amount_tax: 825 },
      },
      { kind: 'session', hostId: 'host-1' },
    )
    expect(row?.taxCents).toBe(825)
    // No fabricated base — the return has to be able to say "unknown".
    expect(row?.taxLines).toEqual([])
  })

  it('answers null without a host rather than writing an unattributable row', () => {
    expect(
      storefrontTaxRow(registeredPlatformSession, { kind: 'session', hostId: '' }),
    ).toBeNull()
  })

  it('never throws on junk', () => {
    for (const junk of [null, undefined, 0, 'x', [], { automatic_tax: 'yes' }]) {
      expect(() =>
        storefrontTaxRow(junk, { kind: 'session', hostId: 'host-1' }),
      ).not.toThrow()
    }
    expect(
      storefrontTaxRow(null, { kind: 'session', hostId: 'host-1' }),
    ).toMatchObject({ taxMode: 'none', grossCents: 0, taxCents: 0 })
  })
})
