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
 * The CONFIRM quotes the proration, not next month's invoice (AGL-535, part
 * two).
 *
 * AGL-535 found the plan-switch preview returning
 * `invoices/upcoming.amount_due` — the whole next invoice, next period's
 * recurring charge included — where the cost of the change is the `proration`
 * lines alone. It fixed the server, added `prorationCents`, and repointed the
 * add-ons card.
 *
 * It did not repoint the plan-switch confirmation dialog, which kept reading
 * `amountDueCents`. So the fix produced a page quoting the right number and a
 * confirm dialog, one click later, overstating it by a full billing period —
 * in the exact place a customer commits.
 *
 * The timing is pinned too, and it moved (AGL-3358). An upgrade used to be
 * `create_prorations`, which took nothing at the switch and parked the
 * difference on the renewal — so a customer could pay for Pro once and run
 * Advanced for a month before a cent of the difference was billed. An upgrade
 * is now invoiced and charged when it is confirmed, and applies once paid, so
 * a positive proration is quoted as a charge NOW. A credit still lands on the
 * next invoice.
 *
 * Asserted on the NUMBER and on the field read, never on the prose.
 */

import { prorationQuote } from '../utils/proration-quote'

/**
 * The AGL-535 fixture, reused deliberately: the switch costs $30.00 and the
 * upcoming invoice totals $129.00. A quote that says 129 is reading the wrong
 * field, and that is the whole bug.
 */
const SWITCH = {
  prorationCents: 3000,
  amountDueCents: 12900,
  currency: 'usd',
}
const EFFECTIVE = 'January 13, 2027'

describe('the number the confirm dialog quotes', () => {
  it('is the proration, not the upcoming invoice total', () => {
    const quote = prorationQuote(SWITCH, EFFECTIVE)
    expect(quote).toContain('30.00')
    // THE REGRESSION. Before this fix the dialog said $129.00.
    expect(quote).not.toContain('129.00')
  })

  it('says an upgrade is charged NOW, not parked on the next invoice (AGL-3358)', () => {
    // The upgrade is invoiced and charged the moment it is confirmed, and the
    // plan moves only once that payment goes through. A quote still saying
    // "next invoice" would describe the pay-later behavior that was the leak.
    const quote = prorationQuote(SWITCH, EFFECTIVE).toLowerCase()
    expect(quote).toContain('charged $30.00 usd now')
    expect(quote).toContain('payment goes through')
    expect(quote).not.toContain('next invoice')
  })

  it('quotes the amount TAKEN when the server sends it, not the bare proration', () => {
    // `chargedNowCents` is the `always_invoice` preview's `amount_due`: the
    // proration plus its tax, less any account credit. It is the figure that
    // leaves the card, so it is the figure the confirm names.
    const quote = prorationQuote(
      { ...SWITCH, chargesNow: true, chargedNowCents: 3248 },
      EFFECTIVE,
    )
    expect(quote).toContain('$32.48 USD now')
    expect(quote).not.toContain('129.00')
  })

  it('a credit still lands on the next invoice — nothing is charged for it', () => {
    const quote = prorationQuote(
      { ...SWITCH, prorationCents: -3000, chargesNow: false, chargedNowCents: 0 },
      EFFECTIVE,
    ).toLowerCase()
    expect(quote).toContain('next invoice')
    expect(quote).not.toContain('charged')
  })

  it('reads a credit as a credit', () => {
    // A negative proration is money back. Rendering it as "-$30.00 charged"
    // is the same class of error in the opposite direction.
    const quote = prorationQuote(
      { ...SWITCH, prorationCents: -3000 },
      EFFECTIVE,
    )
    expect(quote).toContain('30.00')
    expect(quote.toLowerCase()).toContain('credit')
    // Never a minus sign in front of an amount presented as a charge.
    expect(quote).not.toContain('$-')
    expect(quote).not.toContain('-$30.00')
  })

  it('prints NO figure rather than the wrong one when the field is absent', () => {
    // `?? amountDueCents` would restore exactly the bug being removed. Saying
    // less is recoverable; quoting the wrong number as somebody commits is
    // not.
    const quote = prorationQuote(
      { amountDueCents: 12900, currency: 'usd' },
      EFFECTIVE,
    )
    expect(quote).not.toContain('129.00')
    expect(quote).not.toMatch(/\$\d/)
    // Still tells them the shape of what happens.
    expect(quote.toLowerCase()).toContain('next invoice')
  })

  it('CONTROL — it does quote a figure when it has one', () => {
    // Without this, a function that never printed a number would satisfy
    // every "not the wrong number" assertion above.
    expect(prorationQuote(SWITCH, EFFECTIVE)).toMatch(/\$\d+\.\d{2}/)
    expect(prorationQuote(SWITCH, EFFECTIVE)).toContain('USD')
  })

  it('CONTROL — the effective date reaches a credit\'s sentence', () => {
    // The date is what makes "next invoice" actionable rather than vague.
    expect(
      prorationQuote({ ...SWITCH, prorationCents: -3000 }, EFFECTIVE),
    ).toContain(EFFECTIVE)
  })
})

describe('the third place the same claim lives', () => {
  it('the customer docs say an upgrade is charged when it is confirmed (AGL-3358)', () => {
    // The published "When each change takes effect" table is the copy
    // customers read without opening the console, so it has to describe the
    // same mechanic the confirm does: an upgrade and an added add-on are
    // charged today, and a downgrade or a removal charges nothing.
    const source = require('node:fs').readFileSync(
      require('node:path').join(
        __dirname,
        '..',
        '..',
        '..',
        'apps',
        'docs',
        'docs',
        'workspace-and-billing',
        'billing-and-plans',
        'downgrading-and-canceling.md',
      ),
      'utf8',
    )
    // CONTROL: the file read is the right one.
    expect(source).toContain('When each change takes effect')
    expect(source).toContain('Upgrading')
    // The claim itself: no row may still promise an upgrade costs nothing
    // today.
    expect(source).not.toMatch(/Upgrading.*Nothing today/)
    expect(source).toMatch(/\*\*Upgrading\*\*.*\*\*Today\.\*\*.*charged when you confirm/)
  })
})

/**
 * A mid-cycle change is a charge, so it is quoted WITH its tax.
 *
 * `automatic_tax` was already enabled on the plan-switch preview — Stripe
 * computed the tax on every one of these and the response simply never carried
 * it. The dialog therefore quoted a bare proration as though a mid-cycle switch
 * were untaxed: the same failure as a plan total that omits tax, on the same
 * endpoint as the proration bug above.
 *
 * The tax must come from the PRORATION LINES, never from the invoice's `tax`:
 * that figure covers the whole upcoming invoice including next period's
 * recurring charge, so adding it to a proration overstates the change by a
 * period's tax — the proration bug again, one field over.
 */
describe('the tax on a mid-cycle change', () => {
  const TAXED = {
    prorationCents: 3000,
    prorationTaxCents: 248,
    taxComplete: true,
    taxReason: 'standard_rated',
    amountDueCents: 12900,
    currency: 'usd',
  }

  it('is quoted, not omitted', () => {
    // Charged now, so the tax is part of the amount taken ($30.00 + $2.48)
    // and named inside it rather than added on top.
    const quote = prorationQuote(TAXED, EFFECTIVE)
    expect(quote).toContain('32.48')
    expect(quote).toContain('2.48')
  })

  it('never adds the WHOLE invoice’s tax to a proration', () => {
    // The invoice totals $129.00; its tax would be far larger than the tax on
    // a $30 change. A quote carrying that figure is reading the wrong field.
    const quote = prorationQuote({ ...TAXED, prorationTaxCents: 248 }, EFFECTIVE)
    expect(quote).not.toContain('129')
    expect(quote).not.toContain('10.64')
  })

  it('explains a zero rather than printing "plus $0.00 tax"', () => {
    // Reverse charge is the case a VAT-registered business is checking for,
    // and "$0.00 tax" tells them nothing about whether it applied.
    const quote = prorationQuote(
      { ...TAXED, prorationTaxCents: 0, taxReason: 'reverse_charge' },
      EFFECTIVE,
    )
    expect(quote).not.toContain('$0.00')
    expect(quote.toLowerCase()).toContain('reverse charge')
  })

  it('says the total is not final when Stripe could not compute the tax', () => {
    // `requires_location_inputs` yields a tax of 0 that is indistinguishable
    // from a real zero unless the status travels with it.
    const quote = prorationQuote(
      { ...TAXED, prorationTaxCents: 0, taxComplete: false },
      EFFECTIVE,
    )
    expect(quote.toLowerCase()).toContain('billing address')
    expect(quote).not.toContain('$0.00')
  })

  it('CONTROL — it reuses taxExplanation rather than growing a second vocabulary', () => {
    // Two sets of tax sentences for one fact is how they drift apart. The
    // reverse-charge wording here must be the SAME string the plan quote uses.
    const {
      taxExplanation,
      // eslint-disable-next-line @typescript-eslint/no-var-requires
    } = require('../utils/tax-explanation')
    const shared = taxExplanation({
      taxComplete: true,
      taxCents: 0,
      taxReason: 'reverse_charge',
    }).sentence
    expect(
      prorationQuote(
        { ...TAXED, prorationTaxCents: 0, taxReason: 'reverse_charge' },
        EFFECTIVE,
      ),
    ).toContain(shared)
  })
})
