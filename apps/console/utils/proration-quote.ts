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
  type AglynOrgBilling,
  aiAddonName,
  hasAiAddon,
  PLAN_LABELS,
  PLAN_PRICING,
  type OrgPlan,
} from '@aglyn/aglyn'
import { taxExplanation } from './tax-explanation'

/**
 * What happens to the org's AI add-on on a plan change (AGL-2899), as
 * the sentence the switch confirm appends — or '' for an org that does not
 * carry it.
 *
 * `/api/billing/subscription` re-prices every add-on item to the target plan
 * in the same update and DROPS a kind the target does not sell, reporting it
 * as `droppedAddons`. The proration figure above this sentence already
 * includes that re-pricing, but a figure cannot say that a $19 line became a
 * $39 one, and a customer who reads "switch to Business" as "the plan moves
 * and nothing else does" is about to be surprised on the invoice. So the
 * add-on is named, with the price it will bill at on the target — read from
 * `PLAN_PRICING` rather than from the preview, because the preview carries
 * the change and not the ongoing line.
 *
 * The drop is stated from the server's own list, never inferred from the
 * price table: the server decides what it deleted.
 */
export function carriedAiAddonSentence(
  org: Partial<AglynOrgBilling> | null | undefined,
  targetPlan: OrgPlan,
  droppedAddons: readonly string[] | null | undefined,
): string {
  if (!hasAiAddon(org)) return ''
  const label = PLAN_LABELS[targetPlan] ?? targetPlan
  const price = PLAN_PRICING[targetPlan]?.aiAddonMonthlyUsd ?? null
  const name = aiAddonName()
  if ((droppedAddons ?? []).includes('aiAddon') || price === null) {
    return (
      ` Your ${name} add-on is not sold on ${label}, so it is removed with ` +
      'this change and its AI credits go with it.'
    )
  }
  return (
    ` Your ${name} add-on carries over at $${price}/mo on ${label}, ` +
    'billed with the plan.'
  )
}

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
 * ## When the money moves (AGL-3358)
 *
 * A switch that costs more is invoiced and charged the moment the customer
 * confirms it, and the plan changes only once that payment goes through. So
 * a positive proration is quoted as a charge NOW, with the amount Stripe will
 * take — `chargedNowCents`, the `always_invoice` preview's `amount_due`, tax
 * included. A credit still lands on the next invoice, and says so.
 *
 * ## Why a missing proration prints no figure at all
 *
 * `?? amountDueCents` would restore exactly the bug being removed. A payload
 * without the field gets a sentence with no number in it: saying less is
 * recoverable, and quoting the wrong number immediately before a customer
 * commits is not.
 */
export interface ProrationPreview {
  /** Tax on the proration lines alone, from Stripe. */
  prorationTaxCents?: number
  /** Whether Stripe finished computing that tax. */
  taxComplete?: boolean
  /** Stripe's own `taxability_reason` for the change. */
  taxReason?: string | null
  /** The proration lines alone, signed. The cost of the change. */
  prorationCents?: number
  /** The switch charges the change as soon as it is confirmed. */
  chargesNow?: boolean
  /** What that charge takes from the card, tax included. */
  chargedNowCents?: number
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
    return preview.chargesNow
      ? "You'll be charged the prorated difference for the rest of this period as soon as you confirm, and your plan changes once the payment goes through."
      : `The change is prorated for the rest of this period and billed on your next invoice on ${effective}.`
  }
  const amount = (Math.abs(cents) / 100).toFixed(2)
  // The TAX on the change, said out loud.
  //
  // `automatic_tax` was already enabled on this preview, so Stripe always
  // computed it — the response simply never carried it, and the dialog quoted
  // a bare proration as though a mid-cycle switch were untaxed. Reuses
  // `taxExplanation` rather than growing a second set of tax sentences: a
  // zero has the same four meanings here as it does on a new subscription,
  // and two vocabularies for one fact is how they drift apart.
  const tax = taxExplanation({
    taxComplete: preview.taxComplete !== false,
    taxCents: preview.prorationTaxCents ?? 0,
    taxReason: preview.taxReason,
  })
  const taxAmount = ((preview.prorationTaxCents ?? 0) / 100).toFixed(2)
  const taxClause = !tax.totalIsFinal
    ? ` ${tax.sentence}`
    : (preview.prorationTaxCents ?? 0) > 0
      ? ` Plus $${taxAmount} ${currency} tax.`
      : ` ${tax.sentence}`
  if (cents > 0) {
    // Charged NOW. The figure is what leaves the card — the proration plus
    // its tax, less any account credit — so the tax is said as part of it
    // rather than added on top of it.
    const charged =
      typeof preview.chargedNowCents === 'number'
        ? preview.chargedNowCents
        : cents + (preview.prorationTaxCents ?? 0)
    const chargedAmount = (Math.max(charged, 0) / 100).toFixed(2)
    const chargedTaxClause = !tax.totalIsFinal
      ? ` ${tax.sentence}`
      : (preview.prorationTaxCents ?? 0) > 0
        ? ` That includes $${taxAmount} ${currency} tax.`
        : ` ${tax.sentence}`
    return (
      `You'll be charged $${chargedAmount} ${currency} now for the rest of ` +
      'this period, and your plan changes as soon as the payment goes ' +
      'through.' +
      chargedTaxClause
    )
  }
  return (
    (cents === 0
      ? `Prorated for the rest of this period: $${amount} ${currency}, billed on your next invoice on ${effective}.`
      : `Unused time credits $${amount} ${currency} back on your next invoice on ${effective}.`) + taxClause
  )
}
