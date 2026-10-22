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
 * WHY the tax on a quote is what it is.
 *
 * ## Why a zero needs a sentence
 *
 * A quote showing no tax has four completely different meanings, and to the
 * customer who cares most — a VAT-registered business checking that reverse
 * charge applied — they are indistinguishable:
 *
 *  - tax was charged at a rate;
 *  - it is zero because REVERSE CHARGE shifts the liability to them, which is
 *    the thing their tax ID buys and the thing they are looking for;
 *  - it is zero because the customer is tax-exempt;
 *  - it could not be computed at all, so the total is not final.
 *
 * The fourth is the dangerous one. `automatic_tax` answers
 * `requires_location_inputs` when it cannot resolve an address, and in that
 * state the tax is legitimately `0` — a total that presents it as final is a
 * number the invoice will then contradict.
 *
 * ## What this does NOT do
 *
 * It never computes tax. Stripe's figure is the only figure; this reads
 * Stripe's own `taxability_reason` and says what it means. A number our
 * arithmetic produced that Stripe's invoice disagrees with would be worse
 * than no preview at all, and it would be the number in front of a tax
 * authority.
 *
 * It is also unrelated to `AGLYN_TAX_JURISDICTION` and the platform filing
 * config: those say where AGLYN files, and this says what a CUSTOMER is
 * charged.
 */

export interface TaxExplanationInput {
  /** Stripe finished computing tax for this address. */
  taxComplete: boolean
  /** The tax Stripe computed, in the invoice's minor units. */
  taxCents: number
  /**
   * Stripe's own `taxability_reason` from the first tax line, when there is
   * one. Never inferred — the whole point is to report Stripe's verdict.
   */
  taxReason?: string | null
  /** `customer.tax_exempt`: 'none' | 'exempt' | 'reverse'. */
  customerTaxExempt?: string | null
}

export interface TaxExplanation {
  /** One sentence for the quote, always present. */
  sentence: string
  /**
   * Whether the total may be presented as what the customer will pay. False
   * means the quote must NOT show a confident total.
   */
  totalIsFinal: boolean
  kind: 'charged' | 'reverse-charge' | 'exempt' | 'not-computed' | 'no-tax'
}

/** Stripe reasons that mean the liability moved to the buyer. */
const REVERSE_CHARGE_REASONS = ['reverse_charge']
/** Stripe reasons that mean this customer is exempt. */
const EXEMPT_REASONS = ['customer_exempt']

export function taxExplanation(input: TaxExplanationInput): TaxExplanation {
  // FIRST, before any reading of the amount. An uncomputed tax is `0`, and
  // every branch below would otherwise treat it as a real zero.
  if (!input.taxComplete) {
    return {
      sentence:
        'Tax is calculated once we have your billing address. This total ' +
        'does not include it yet.',
      totalIsFinal: false,
      kind: 'not-computed',
    }
  }

  const reason = String(input.taxReason ?? '')
  const exemptFlag = String(input.customerTaxExempt ?? '')

  if (REVERSE_CHARGE_REASONS.includes(reason) || exemptFlag === 'reverse') {
    return {
      // The sentence a VAT-registered business is specifically looking for.
      sentence:
        'No tax charged — reverse charge applies, so you account for it ' +
        'under your own registration.',
      totalIsFinal: true,
      kind: 'reverse-charge',
    }
  }

  if (EXEMPT_REASONS.includes(reason) || exemptFlag === 'exempt') {
    return {
      sentence: 'No tax charged — this account is registered as tax-exempt.',
      totalIsFinal: true,
      kind: 'exempt',
    }
  }

  if (input.taxCents > 0) {
    return {
      sentence: 'Tax is calculated from your billing address and shown above.',
      totalIsFinal: true,
      kind: 'charged',
    }
  }

  // Computed, and genuinely nothing — an untaxed jurisdiction, a zero-rated
  // or not-collecting verdict. Still said out loud: a silent zero is
  // indistinguishable from a bug.
  return {
    sentence: 'No tax applies to this charge in your location.',
    totalIsFinal: true,
    kind: 'no-tax',
  }
}
