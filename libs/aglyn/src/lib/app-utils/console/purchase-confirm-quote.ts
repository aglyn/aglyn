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
 * The sentence a customer reads immediately before real money moves.
 *
 * ## Why the purchase has a confirm at all
 *
 * The plan grid's Upgrade button used to charge the card. A workspace with a
 * stored card and a stored address needs no Stripe screen, no address form and
 * no card entry, so the click that chose a plan was also the click that bought
 * it — one gesture, no statement of the amount, and no way back. Every other
 * irreversible act on the Billing page asks first; the one that takes money
 * did not.
 *
 * ## Every number here is the SERVER'S
 *
 * Nothing in this file computes a price. The figures arrive from the same
 * `/api/billing/checkout` preview that priced the plan card — Stripe's own
 * invoice preview, with the promotion code already resolved and applied — and
 * this only decides which sentence explains them. A confirm that recomputed
 * the total client-side would be a fourth number in a flow whose entire
 * problem is numbers that disagree.
 *
 * ## Renewal honesty
 *
 * A `duration: once` coupon discounts the first invoice and nothing after it.
 * Quoting only today's total would be true and still misleading: the customer
 * confirms $0.80 and is enrolled at $26.65 a month. So whenever the discount
 * does not demonstrably persist, the renewal is stated beside it, at the
 * UNDISCOUNTED subtotal the same preview reports.
 *
 * The renewal is quoted before tax in exactly those cases, and said to be. Tax
 * on a later invoice is computed by Stripe against that invoice's own base and
 * rates; carrying today's tax figure onto a renewal whose base is thirty times
 * larger would be arithmetic of ours presented as Stripe's. Saying "plus tax"
 * is the most precise claim the data supports.
 */

export interface PurchaseConfirmQuoteInput {
  /** The plan's display name, as the plan grid labels it. */
  planLabel: string
  interval: 'month' | 'year'
  /** Stripe's pre-discount recurring amount for the plan. */
  subtotalCents: number
  /** What the invoice's discounts take off, positive cents; 0 when none. */
  discountCents: number
  /** The amount actually charged today, discount and tax included. */
  totalCents: number
  currency: string
  /** Whether Stripe finished computing tax for this address. */
  taxComplete: boolean
  /** The code Stripe resolved and applied, or '' when none did. */
  promotionCode: string
  /** Stripe's `coupon.duration`, or null when it is not known. */
  promotionDuration: string | null
  /** Stripe's `coupon.duration_in_months`, set only for `repeating`. */
  promotionDurationInMonths: number | null
}

export interface PurchaseConfirmQuote {
  title: string
  description: string
  confirmationText: string
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: String(currency || 'usd').toUpperCase(),
  }).format(cents / 100)
}

export function purchaseConfirmQuote(
  input: PurchaseConfirmQuoteInput,
): PurchaseConfirmQuote {
  const {
    planLabel,
    interval,
    subtotalCents,
    discountCents,
    totalCents,
    currency,
    taxComplete,
    promotionCode,
    promotionDuration,
    promotionDurationInMonths,
  } = input
  const period = interval === 'year' ? 'year' : 'month'
  const cadence = interval === 'year' ? 'billed yearly' : 'billed monthly'
  const total = money(totalCents, currency)
  const undiscounted = money(subtotalCents, currency)

  // The charge, stated first and as a fact about TODAY.
  //
  // `taxComplete: false` is the one state where the figure is not final —
  // `automatic_tax` answers `requires_location_inputs` and the tax under the
  // total is a zero nobody computed. The confirm still offers the purchase,
  // because the address is on file and the server is the one that decides, but
  // it does not call an incomplete figure the amount that will be taken.
  const charge = taxComplete
    ? `${total} will be charged to your card now.`
    : `${total} will be charged to your card now, plus sales tax — Stripe ` +
      `could not finish calculating tax for your billing address, so the ` +
      `amount on your invoice may be higher than this.`

  const discountLine =
    discountCents > 0
      ? promotionCode
        ? ` That includes ${money(discountCents, currency)} off with code ` +
          `${promotionCode}.`
        : ` That includes ${money(discountCents, currency)} off.`
      : ''

  // What the SUBSCRIPTION costs, which is a different question from what
  // today costs the moment a discount is not permanent.
  let renewal: string
  if (discountCents <= 0) {
    renewal = ` It renews at ${total} per ${period} until you cancel.`
  } else if (promotionDuration === 'forever') {
    renewal =
      ` Code ${promotionCode} applies to every invoice, so it renews at ` +
      `${total} per ${period} until you cancel.`
  } else if (promotionDuration === 'once') {
    renewal =
      ` Code ${promotionCode} applies to this first invoice only — after it, ` +
      `${planLabel} renews at ${undiscounted} per ${period} plus tax, until ` +
      `you cancel.`
  } else if (
    promotionDuration === 'repeating' &&
    typeof promotionDurationInMonths === 'number' &&
    promotionDurationInMonths > 0
  ) {
    const months =
      promotionDurationInMonths === 1
        ? '1 month'
        : `${promotionDurationInMonths} months`
    renewal =
      ` Code ${promotionCode} applies for ${months} — after that, ` +
      `${planLabel} renews at ${undiscounted} per ${period} plus tax, until ` +
      `you cancel.`
  } else {
    // A discount whose duration Stripe did not report. Named as an unknown
    // rather than resolved in either direction: the customer is told the
    // price the subscription reverts to if it does not persist, which is the
    // number they would otherwise discover on an invoice.
    renewal =
      ` We cannot confirm that code ${promotionCode} applies to later ` +
      `invoices. Without it, ${planLabel} is ${undiscounted} per ${period} ` +
      `plus tax.`
  }

  // What the plan price does NOT cover.
  //
  // Every figure above describes the subscription, and a subscription is not
  // the whole bill: storage, page views and form submissions are metered past
  // what the plan includes and settle on a later invoice. A confirm that named
  // only the recurring price would be accurate about the part it quoted and
  // silent about the part that varies — and the month a site is busy is
  // exactly when the difference is noticed, which is far too late for it to
  // have been disclosed here.
  //
  // Deliberately no rates. The charged figures live in
  // `METERED_BILLED_RATES_USD` and descend by tier for the retail meters, so a
  // rate copied into this sentence is a second place for a price to drift from
  // the one the invoice uses. The meters are named and the surface that holds
  // the live numbers is pointed at instead.
  const overage =
    ` Usage past what ${planLabel} includes is billed on top: storage, page ` +
    `views and form submissions are metered and settle on a later invoice, ` +
    `so a busy month can cost more than the plan price. Billing → Usage ` +
    `shows the current rates and what this workspace has used.`

  return {
    title: `Subscribe to ${planLabel}?`,
    description: `${planLabel}, ${cadence}. ${charge}${discountLine}${renewal}${overage}`,
    // The amount on the BUTTON, so the last thing under the cursor is the
    // figure and not a verb. Dropped to a plain label when the total is not
    // final, because a button that names a price is a promise about it.
    confirmationText: taxComplete ? `Pay ${total}` : 'Confirm and pay',
  }
}
