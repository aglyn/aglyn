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
 * The timing was independently wrong. `proration_behavior: create_prorations`
 * charges NOTHING at the switch; Stripe writes the adjustment onto the
 * upcoming invoice. "Prorated charge today" was false whatever number stood
 * beside it.
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

  it('says the money lands on the NEXT invoice, not today', () => {
    // `create_prorations` takes nothing at the switch. A customer told
    // "charge today" watches for a charge that never arrives, then finds it
    // on an invoice they were not expecting it on.
    const quote = prorationQuote(SWITCH, EFFECTIVE).toLowerCase()
    expect(quote).toContain('next invoice')
    expect(quote).not.toContain('charge today')
    expect(quote).not.toContain('charged today')
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

  it('CONTROL — the effective date reaches the sentence', () => {
    // The date is what makes "next invoice" actionable rather than vague.
    expect(prorationQuote(SWITCH, EFFECTIVE)).toContain(EFFECTIVE)
  })
})

describe('the third place the same claim lived', () => {
  it('the customer docs no longer say a plan change is charged today', () => {
    // A bug that survived one fix in a second location had a third: the
    // published "When each change takes effect" table told customers an
    // upgrade and an add-on are "Charged today". Same mechanic, same
    // falsehood, and the one customers read without opening the console.
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
    // The claim itself.
    expect(source).not.toMatch(/\|\s*Charged today\s*\|/)
    expect(source).toContain('next invoice')
  })
})
