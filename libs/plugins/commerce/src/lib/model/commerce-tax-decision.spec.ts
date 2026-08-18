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

import { storefrontTaxDecision } from './commerce-tax-decision'

/**
 * AGL-1999. The defect was that `undefined` matched neither `'stripe'` nor
 * `'manual'`, so no branch ran and the shopper was charged an untaxed total.
 * The cases below pin the distinction the fix rests on: an unmade decision is
 * NOT the same fact as a decision to collect nothing.
 */
describe('storefrontTaxDecision (AGL-1999)', () => {
  it('refuses when no settings document exists at all', () => {
    // The state of every brand-new storefront.
    expect(storefrontTaxDecision({ settings: undefined }).kind).toBe(
      'undecided',
    )
    expect(storefrontTaxDecision({ settings: null }).kind).toBe('undecided')
  })

  it('refuses a settings document that states no mode', () => {
    // `{ tax: {} }` — the shape the old pos-order spec used for "no tax".
    expect(storefrontTaxDecision({ settings: {} }).kind).toBe('undecided')
    expect(
      storefrontTaxDecision({ settings: { rates: [], origin: {} } }).kind,
    ).toBe('undecided')
  })

  it('refuses a mode this build does not recognise', () => {
    // Guessing at an unknown string is how the original defect behaved.
    expect(
      storefrontTaxDecision({ settings: { mode: 'avalara' as never } }).kind,
    ).toBe('undecided')
  })

  // Positive controls. Refusal must be reserved for the one state that is not
  // a decision — otherwise the guard passes by refusing every merchant.
  it('honours an explicit decision NOT to collect', () => {
    const decision = storefrontTaxDecision({ settings: { mode: 'none' } })
    expect(decision.kind).toBe('none')
    // The reason travels with it, so the absence is stated, not inferred.
    expect(decision.kind === 'none' && decision.reason).toBeTruthy()
  })

  it('passes a manual-mode store through', () => {
    expect(storefrontTaxDecision({ settings: { mode: 'manual' } }).kind).toBe(
      'manual',
    )
    // Empty rates are still a decision: the merchant was asked and answered.
    expect(
      storefrontTaxDecision({ settings: { mode: 'manual', rates: [] } }).kind,
    ).toBe('manual')
  })

  it('passes a stripe-mode store through', () => {
    expect(storefrontTaxDecision({ settings: { mode: 'stripe' } }).kind).toBe(
      'stripe-automatic',
    )
  })

  it('lets an exempt product sell even where nobody decided', () => {
    // No tax question arises, so no decision is owed — and refusing here
    // would block a sale for no reason.
    const decision = storefrontTaxDecision({
      settings: undefined,
      taxExempt: true,
    })
    expect(decision.kind).toBe('exempt')
    expect(decision.kind === 'exempt' && decision.reason).toBeTruthy()
  })

  it('lets the product exemption win over every store mode', () => {
    // Matches the inline `&& !taxExempt` tests the four paths already had.
    for (const mode of ['manual', 'stripe', 'none'] as const) {
      expect(
        storefrontTaxDecision({ settings: { mode }, taxExempt: true }).kind,
      ).toBe('exempt')
    }
  })

  it('treats a non-exempt product as no answer at all', () => {
    // `taxExempt: false` must not be read as "decided" — that would restore
    // the defect through the other door.
    expect(
      storefrontTaxDecision({ settings: undefined, taxExempt: false }).kind,
    ).toBe('undecided')
  })
})
