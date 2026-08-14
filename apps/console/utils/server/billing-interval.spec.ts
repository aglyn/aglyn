/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
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
 * AGL-1640: `billing_interval` is the sole input to the GTM §6 annual-mix
 * metric, and the annual mix feeds the cash-flow argument for beta pricing.
 *
 * The defect was a two-state ternary over a three-state world:
 *
 *   interval === 'year' ? 'annual' : 'monthly'
 *
 * Everything that is not literally `'year'` — a proration line, a one-off
 * invoice item, a metered-only line, a price whose `recurring` was never
 * expanded onto the webhook payload — reported `'monthly'`. That does not
 * degrade the metric symmetrically: it biases it toward monthly by exactly
 * the rate at which the interval is unreadable, and it is invisible, because
 * a wrong value looks exactly like a right one.
 *
 * Absence is now reported as absence. `sanitizeEventParams` drops `undefined`
 * keys and the param is optional on the taxonomy type, so an unreadable
 * invoice is EXCLUDED from the breakdown rather than miscounted in it — the
 * same `undefined`-vs-`false` distinction `first_publish` makes (AGL-1588).
 */

import {
  billingIntervalFromInvoice,
  selectSubscriptionLine,
} from './billing-interval'

/** A subscription line for a plan price on the given interval. */
const planLine = (interval: string) => ({
  type: 'subscription',
  price: { id: 'price_pro_monthly', recurring: { interval } },
})

describe('billingIntervalFromInvoice — one case per branch (AGL-1640)', () => {
  it('reads a yearly plan as annual', () => {
    expect(
      billingIntervalFromInvoice({ lines: { data: [planLine('year')] } }),
    ).toBe('annual')
  })

  it('reads a monthly plan as monthly', () => {
    expect(
      billingIntervalFromInvoice({ lines: { data: [planLine('month')] } }),
    ).toBe('monthly')
  })

  it('reports an unreadable interval as ABSENT, never as monthly', () => {
    // Each of these used to report 'monthly' with full confidence.
    const unreadable: Array<[string, Record<string, unknown>]> = [
      ['no recurring at all (one-off invoice item)', { price: { id: 'x' } }],
      ['recurring present but interval missing', { price: { recurring: {} } }],
      ['price not expanded onto the payload', { price: 'price_123' }],
      ['no price on the line', { description: 'Credit' }],
      ['an interval we do not model', { price: { recurring: { interval: 'week' } } }],
    ]
    for (const [label, line] of unreadable) {
      expect(`${label} → ${
        billingIntervalFromInvoice({ lines: { data: [line] } }) ?? 'absent'
      }`).toBe(`${label} → absent`)
    }
  })

  it('reports absence for an invoice with no lines and for junk', () => {
    expect(billingIntervalFromInvoice({ lines: { data: [] } })).toBeUndefined()
    expect(billingIntervalFromInvoice({})).toBeUndefined()
    expect(billingIntervalFromInvoice(null)).toBeUndefined()
    expect(billingIntervalFromInvoice(undefined)).toBeUndefined()
  })
})

describe('the subscription line is SELECTED, not assumed to be index 0', () => {
  it('skips a leading proration line and reads the plan behind it', () => {
    // A mid-cycle plan switch invoices prorations first. Index 0 is a
    // proration against the OLD monthly price; the plan being billed is
    // annual. The old code read the proration and reported monthly.
    const invoice = {
      lines: {
        data: [
          {
            type: 'invoiceitem',
            proration: true,
            price: { id: 'price_credit', recurring: { interval: 'month' } },
          },
          {
            type: 'subscription',
            price: { id: 'price_pro_yearly', recurring: { interval: 'year' } },
          },
        ],
      },
    }
    expect(billingIntervalFromInvoice(invoice)).toBe('annual')
  })

  it('skips a leading one-off line with no recurring at all', () => {
    const invoice = {
      lines: {
        data: [
          { type: 'invoiceitem', price: { id: 'price_setup_fee' } },
          planLine('year'),
        ],
      },
    }
    expect(billingIntervalFromInvoice(invoice)).toBe('annual')
  })

  it('falls back to a proration line rather than reporting nothing', () => {
    // If prorations are ALL there is, their interval is still the
    // subscription's interval — Stripe requires every recurring item on one
    // subscription to share a cadence. Absence is for genuinely unreadable,
    // not for merely awkward.
    const invoice = {
      lines: {
        data: [
          {
            type: 'invoiceitem',
            proration: true,
            price: { id: 'price_pro_yearly', recurring: { interval: 'year' } },
          },
        ],
      },
    }
    expect(billingIntervalFromInvoice(invoice)).toBe('annual')
  })

  it('exposes the same selected line the GA item is identified by', () => {
    // The route names the purchased item from this line too, so a leading
    // proration credit must not become the `item_id` either.
    const plan = planLine('year')
    const line = selectSubscriptionLine({
      lines: {
        data: [{ type: 'invoiceitem', proration: true, price: { id: 'c' } }, plan],
      },
    })
    expect(line).toBe(plan)
  })
})
