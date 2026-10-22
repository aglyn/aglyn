/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
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

/**
 * A zero tax has four meanings and a quote must say which.
 *
 * The dangerous one is `automatic_tax: requires_location_inputs`, where the
 * tax is legitimately `0` and the total is NOT final. Presenting that as a
 * price is how a customer is surprised on the invoice — and `taxComplete`
 * existed for exactly this and was read by nothing.
 */

export {}

import { taxExplanation } from './tax-explanation'

describe('a total is only final when Stripe finished computing it', () => {
  it('an uncomputed tax is never a confident total', () => {
    const out = taxExplanation({ taxComplete: false, taxCents: 0 })
    expect(out.kind).toBe('not-computed')
    expect(out.totalIsFinal).toBe(false)
    expect(out.sentence.toLowerCase()).toContain('billing address')
  })

  it('an uncomputed tax wins over every other signal', () => {
    // The ordering is the claim. A customer flagged exempt whose address
    // cannot be resolved still has an unfinished total, and saying
    // "no tax charged" would present a guess as a verdict.
    const out = taxExplanation({
      taxComplete: false,
      taxCents: 0,
      taxReason: 'customer_exempt',
      customerTaxExempt: 'exempt',
    })
    expect(out.kind).toBe('not-computed')
    expect(out.totalIsFinal).toBe(false)
  })

  it('CONTROL — a normal taxable quote IS final and says so', () => {
    // Without this, a function that returned "not final" for everything would
    // satisfy every assertion above.
    const out = taxExplanation({
      taxComplete: true,
      taxCents: 165,
      taxReason: 'taxable_basis_reduced',
    })
    expect(out.kind).toBe('charged')
    expect(out.totalIsFinal).toBe(true)
  })
})

describe('the four states a customer needs told apart', () => {
  it('reverse charge — the sentence a VAT-registered business is looking for', () => {
    const byReason = taxExplanation({
      taxComplete: true,
      taxCents: 0,
      taxReason: 'reverse_charge',
    })
    expect(byReason.kind).toBe('reverse-charge')
    expect(byReason.sentence.toLowerCase()).toContain('reverse charge')

    // Stripe reports it on the customer too; either is enough.
    const byFlag = taxExplanation({
      taxComplete: true,
      taxCents: 0,
      customerTaxExempt: 'reverse',
    })
    expect(byFlag.kind).toBe('reverse-charge')
  })

  it('exempt — reads customer.tax_exempt, which nothing read before', () => {
    const byFlag = taxExplanation({
      taxComplete: true,
      taxCents: 0,
      customerTaxExempt: 'exempt',
    })
    expect(byFlag.kind).toBe('exempt')
    expect(byFlag.sentence.toLowerCase()).toContain('tax-exempt')

    const byReason = taxExplanation({
      taxComplete: true,
      taxCents: 0,
      taxReason: 'customer_exempt',
    })
    expect(byReason.kind).toBe('exempt')
  })

  it('a computed zero still gets a sentence', () => {
    // Silent zeroes are indistinguishable from bugs.
    const out = taxExplanation({
      taxComplete: true,
      taxCents: 0,
      taxReason: 'not_collecting',
    })
    expect(out.kind).toBe('no-tax')
    expect(out.totalIsFinal).toBe(true)
    expect(out.sentence.length).toBeGreaterThan(0)
  })

  it('CONTROL — every state returns a distinct, non-empty sentence', () => {
    // Guards the failure where several branches collapse onto one string and
    // the customer is told the same thing whatever happened.
    const sentences = [
      taxExplanation({ taxComplete: false, taxCents: 0 }),
      taxExplanation({ taxComplete: true, taxCents: 0, taxReason: 'reverse_charge' }),
      taxExplanation({ taxComplete: true, taxCents: 0, customerTaxExempt: 'exempt' }),
      taxExplanation({ taxComplete: true, taxCents: 0, taxReason: 'not_collecting' }),
      taxExplanation({ taxComplete: true, taxCents: 165 }),
    ].map((out) => out.sentence)
    expect(new Set(sentences).size).toBe(5)
    for (const sentence of sentences) expect(sentence.trim().length).toBeGreaterThan(10)
  })

  it('never invents a figure', () => {
    // The whole contract: this explains Stripe's number and never produces
    // one. A sentence carrying a currency amount would mean it had.
    for (const out of [
      taxExplanation({ taxComplete: false, taxCents: 0 }),
      taxExplanation({ taxComplete: true, taxCents: 999 }),
      taxExplanation({ taxComplete: true, taxCents: 0, taxReason: 'reverse_charge' }),
    ]) {
      expect(out.sentence).not.toMatch(/[$£€]|\d+\.\d{2}/)
    }
  })
})
