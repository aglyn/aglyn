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
 * What a mid-cycle plan switch actually costs, and WHEN.
 *
 * ## The same defect AGL-535 fixed once already
 *
 * This read `amountDueCents` — Stripe's `invoices/upcoming.amount_due`, which
 * is the WHOLE of the next invoice including next period's recurring charge.
 * AGL-535 fixed the preview to also return `prorationCents` (the proration
 * lines alone, signed) and repointed the add-ons card at it; the plan-switch
 * confirm kept reading the old field. So a customer now saw a correct quote on
 * the page and then a confirmation dialog overstating the charge by a full
 * billing period, in the dialog where they commit.
 *
 * The timing was wrong too, and independently. `proration_behavior:
 * create_prorations` charges NOTHING at the moment of the switch — Stripe
 * writes the adjustment onto the upcoming invoice — so "charge today" was
 * false whatever the number beside it.
 *
 * ## Why a missing proration prints no figure at all
 *
 * `?? amountDueCents` would restore exactly the bug being removed. A payload
 * without the field gets a sentence with no number in it: saying less is
 * recoverable, and quoting the wrong number immediately before a customer
 * commits is not.
 */
export interface ProrationPreview {
  /** The proration lines alone, signed. The cost of the change. */
  prorationCents?: number
  /**
   * The WHOLE upcoming invoice, next period's recurring charge included.
   *
   * Named in the type and deliberately never read. It is on the payload, it
   * is the field this quote used to use, and leaving it out of the signature
   * would make its absence look like an oversight rather than the fix.
   */
  amountDueCents?: number
  currency?: unknown
}

export function prorationQuote(
  preview: ProrationPreview,
  effective: string,
): string {
  const currency = String(preview.currency ?? 'usd').toUpperCase()
  const cents = preview.prorationCents
  if (typeof cents !== 'number') {
    return `The change is prorated for the rest of this period and billed on your next invoice on ${effective}.`
  }
  const amount = (Math.abs(cents) / 100).toFixed(2)
  return cents >= 0
    ? `Prorated for the rest of this period: $${amount} ${currency}, billed on your next invoice on ${effective}.`
    : `Unused time credits $${amount} ${currency} back on your next invoice on ${effective}.`
}
