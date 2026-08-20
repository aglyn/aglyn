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
  describeOrderTaxMode,
  storefrontTaxDecision,
  storefrontTaxMisconfiguration,
  storefrontTaxMode,
  storefrontTaxModeForDecision,
  STOREFRONT_TAX_NO_ORIGIN_MESSAGE,
  STOREFRONT_TAX_POS_STRIPE_MESSAGE,
} from './commerce-tax-decision'

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

/**
 * THE SECOND REFUSAL (AGL-2145): decisions the path cannot honour.
 *
 * `storefrontTaxDecision` answers "did a human decide?", and is deliberately
 * silent about a store that decided to collect nothing. These two states are
 * outside that distinction — the merchant decided to COLLECT, and the sale
 * charged zero anyway, leaving the liability with them and no trace anywhere.
 */
describe('storefrontTaxMisconfiguration (AGL-2145)', () => {
  describe('manual mode with no store origin', () => {
    it('refuses when the origin has no country', () => {
      expect(
        storefrontTaxMisconfiguration({
          mode: 'manual',
          rates: [{ country: 'US', state: 'TX', pct: 8.25 }],
        } as never),
      ).toBe(STOREFRONT_TAX_NO_ORIGIN_MESSAGE)
      // An origin object that exists but is empty is the same hole.
      expect(
        storefrontTaxMisconfiguration({
          mode: 'manual',
          origin: { state: 'TX' },
          rates: [{ country: 'US', state: 'TX', pct: 8.25 }],
        } as never),
      ).toBe(STOREFRONT_TAX_NO_ORIGIN_MESSAGE)
      // …and so is whitespace, which reads as truthy to a bare check.
      expect(
        storefrontTaxMisconfiguration({
          mode: 'manual',
          origin: { country: '  ' },
        } as never),
      ).toBe(STOREFRONT_TAX_NO_ORIGIN_MESSAGE)
    })

    /**
     * POSITIVE CONTROL, and the distinction the whole helper turns on. A
     * manual store WITH an origin and no matching rates still collects
     * nothing, and that is correct — the merchant answered, and the answer
     * applies per shopper. Refusing it would make the helper a wall in front
     * of every legitimately untaxed sale.
     */
    it('allows a manual store with an origin, even with no matching rates', () => {
      expect(
        storefrontTaxMisconfiguration({
          mode: 'manual',
          origin: { country: 'US', state: 'TX' },
          rates: [],
        } as never),
      ).toBeNull()
    })
  })

  describe('Stripe Tax at the register', () => {
    /**
     * `pos-order.ts` sends the basket as one opaque line and sets no
     * `automatic_tax` — it cannot, there is no customer address at a till —
     * and cash and folio never reach Stripe at all. Every in-person sale at a
     * Stripe-Tax store charged zero.
     */
    it('refuses an IN-PERSON sale', () => {
      expect(
        storefrontTaxMisconfiguration({ mode: 'stripe' } as never, {
          inPerson: true,
        }),
      ).toBe(STOREFRONT_TAX_POS_STRIPE_MESSAGE)
    })

    /**
     * POSITIVE CONTROL. Online Stripe-Tax sales are correct — Stripe computes
     * them on a session that carries the buyer's address — and refusing them
     * would break the three paths AGL-1999 already made right.
     */
    it('allows the same store ONLINE', () => {
      expect(
        storefrontTaxMisconfiguration({ mode: 'stripe' } as never),
      ).toBeNull()
      expect(
        storefrontTaxMisconfiguration({ mode: 'stripe' } as never, {
          inPerson: false,
        }),
      ).toBeNull()
    })
  })

  /**
   * NEGATIVE CONTROLS for everything this helper must NOT touch. `none` is a
   * recorded decision to collect nothing and is honoured silently; `undecided`
   * belongs to `storefrontTaxDecision`, whose refusal runs first and says
   * something different.
   */
  it('says nothing about `none`, `undecided`, or a well-formed manual store', () => {
    expect(storefrontTaxMisconfiguration({ mode: 'none' } as never)).toBeNull()
    expect(
      storefrontTaxMisconfiguration({ mode: 'none' } as never, { inPerson: true }),
    ).toBeNull()
    expect(storefrontTaxMisconfiguration({} as never)).toBeNull()
    expect(storefrontTaxMisconfiguration(undefined)).toBeNull()
    expect(
      storefrontTaxMisconfiguration(
        { mode: 'manual', origin: { country: 'US' } } as never,
        { inPerson: true },
      ),
    ).toBeNull()
  })
})

/**
 * The regime an order carries, and how it is worded (AGL-2451).
 *
 * The whole point of the field is that one order can be reconciled against
 * the `storefrontTaxCollected` record and, eventually, against a return. That
 * only holds while ONE rule produces both, which is why this rule is here and
 * not restated at each of the seven order-writing doors.
 */
describe('storefrontTaxMode (AGL-2451)', () => {
  it('reads the flag, so a taxed manual sale is never Aglyn-collected', () => {
    // THE TRAP, as a unit. A manual-mode renewal carries a real Stripe Tax
    // Rate (AGL-1751) so its invoice has tax on it; only the flag separates it
    // from a Stripe Tax sale of the identical amount.
    expect(storefrontTaxMode({ automatic: false, taxCents: 825 })).toBe('manual')
    expect(storefrontTaxMode({ automatic: true, taxCents: 825 })).toBe(
      'stripe-automatic',
    )
  })

  /**
   * A Stripe Tax sale stays `stripe-automatic` at zero tax: "Stripe Tax
   * answered not-collecting" is the audit answer to why a jurisdiction is
   * absent from a return, and collapsing it to `none` destroys that answer.
   */
  it('keeps stripe-automatic at zero tax, and calls an untaxed sale none', () => {
    expect(storefrontTaxMode({ automatic: true, taxCents: 0 })).toBe(
      'stripe-automatic',
    )
    expect(storefrontTaxMode({ automatic: false, taxCents: 0 })).toBe('none')
  })

  /** The decision-shaped entry point the register and the draft path use. */
  it('maps a decision the same way, with exempt landing on none', () => {
    expect(
      storefrontTaxModeForDecision({ kind: 'stripe-automatic' }, 0),
    ).toBe('stripe-automatic')
    expect(storefrontTaxModeForDecision({ kind: 'manual' }, 412)).toBe('manual')
    expect(storefrontTaxModeForDecision({ kind: 'manual' }, 0)).toBe('none')
    expect(
      storefrontTaxModeForDecision({ kind: 'exempt', reason: 'x' }, 0),
    ).toBe('none')
    expect(storefrontTaxModeForDecision({ kind: 'none', reason: 'x' }, 0)).toBe(
      'none',
    )
  })
})

describe('describeOrderTaxMode (AGL-2451)', () => {
  /**
   * ABSENT IS NOT `none`. Every order written before the stamp shipped has no
   * mode, and wording that as "no sales tax was calculated" would state a tax
   * fact nobody recorded — on an order that may well have carried tax.
   */
  it('says an unstamped order is unrecorded, never that it had no tax', () => {
    const unknown = describeOrderTaxMode(undefined)
    expect(unknown).toBe(describeOrderTaxMode(null))
    expect(unknown).not.toBe(describeOrderTaxMode('none'))
    expect(unknown).toMatch(/not recorded/i)
    expect(unknown).not.toMatch(/no sales tax/i)
  })

  /** Each mode says HOW, and each says something different. */
  it('describes the mechanism for each recorded mode', () => {
    expect(describeOrderTaxMode('stripe-automatic')).toMatch(/Stripe Tax/)
    expect(describeOrderTaxMode('manual')).toMatch(/own configured tax rate/)
    expect(describeOrderTaxMode('none')).toMatch(/No sales tax/)
    expect(
      new Set(
        (['stripe-automatic', 'manual', 'none', undefined] as const).map(
          describeOrderTaxMode,
        ),
      ).size,
    ).toBe(4)
  })

  /**
   * NO REMITTANCE DETERMINATION — the constraint AGL-2440 ships under and the
   * reason this wording is a tested artefact rather than a string literal in a
   * component. Who owes which authority what attaches by operation of law
   * (AGL-1904/AGL-1956); it belongs to counsel, not to an order dialog.
   */
  it('never tells the merchant who owes or remits the tax', () => {
    for (const mode of ['stripe-automatic', 'manual', 'none', undefined] as const) {
      const text = describeOrderTaxMode(mode)
      expect(text).not.toMatch(/remit|owe|liable|liability|your responsibility/i)
    }
  })
})
