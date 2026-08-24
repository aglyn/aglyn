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
 * How a storefront destination charge splits between Aglyn and the merchant —
 * and, when Stripe Tax is on, why the split cannot be expressed as a fee
 * (AGL-1956).
 *
 * ## The defect this module exists to close
 *
 * Every storefront checkout is a DESTINATION charge created on AGLYN's
 * platform account: platform secret key, no `Stripe-Account` header, no
 * `on_behalf_of`, with `payment_intent_data[transfer_data][destination]`
 * naming the merchant's connected account. On a `mode: 'stripe'` store the
 * session also carries `automatic_tax[enabled]`, and AGL-1904 MEASURED what
 * that means: the tax is computed against **Aglyn's** registrations, reported
 * as `automatic_tax.liability: { type: "self" }`, and is **Aglyn's to remit**.
 * See `../server/storefront-tax.ts` for the two-arm experiment.
 *
 * The sessions then set `payment_intent_data[application_fee_amount]`. On a
 * destination charge that form means Stripe transfers the **whole charge** to
 * the connected account and debits the fee at the destination — measured, and
 * recorded at `billing-webhook.ts` (the AGL-1794 note: "`transfer.amount`
 * equals `charge.amount`"). `amount_total` INCLUDES the Stripe Tax.
 *
 * So on every taxed storefront sale the sales tax Aglyn owes the state was
 * transferred to the merchant, and only the commission came back. Aglyn was
 * left holding the liability and none of the money. This is the same trap the
 * marketplace plugin found and closed in AGL-1544, and the fix here is the
 * same one: **a fixed `transfer_data[amount]`, and no `application_fee_amount`
 * at all** — because the fee form makes Stripe do the arithmetic on a total
 * that has the tax inside it.
 *
 * ## Only ONE of the two knobs may do the arithmetic
 *
 * `application_fee_amount` says "give the merchant everything except this".
 * `transfer_data[amount]` says "give the merchant exactly this". They are two
 * spellings of the same split and Stripe rejects a PaymentIntent carrying
 * both, so the emitter below is written as a single choice with no path that
 * can emit the pair. Which one is correct depends entirely on WHICH SIDE of
 * the split holds the unknown:
 *
 *   - **Merchant owes the tax** (`manual` mode, or no tax at all). The
 *     variable part — the merchant's tax line — is the merchant's own money.
 *     Fixing the FEE is exact: Aglyn keeps its commission and every cent of
 *     variance stays where it belongs.
 *   - **Aglyn owes the tax** (`stripe` mode). The variable part is now
 *     AGLYN's money, and a fixed fee hands all of it to the merchant. Fixing
 *     the TRANSFER is what keeps it.
 *
 * ## The residual, stated out loud: shopper-chosen shipping
 *
 * Neither knob can be exact on a Stripe Tax sale that also offers a CHOICE of
 * shipping rates, because at session-creation time two numbers are unknown —
 * the tax (Aglyn's) and which shipping option the shopper will pick (the
 * merchant's) — and there is only one knob left to fix. Whichever is fixed,
 * the other side's variance lands on the wrong party:
 *
 *   - Fixing the FEE misallocates the ENTIRE tax, on EVERY taxed sale,
 *     unbounded. That is the defect above.
 *   - Fixing the TRANSFER misallocates at most `dearest − cheapest` shipping,
 *     and only on a store that offers more than one rate.
 *
 * The transfer is therefore fixed at the CHEAPEST option, never the dearest.
 * Not a preference — the dearest is unsafe: a transfer of
 * `goods + dearest − fee` can EXCEED a charge where the shopper picked the
 * cheapest, and Stripe rejects a transfer larger than its charge, which would
 * fail the payment outright rather than mis-split it. The cheapest is always
 * payable, because the shopper's actual shipping can only be higher.
 *
 * The bounded remainder — a shopper who upgraded shipping on a Stripe Tax
 * store — is money owed to the MERCHANT that Aglyn is holding. It is recorded
 * on the session as `metadata[transferCents]` and
 * `metadata[transferShippingCents]` so it is derivable per order rather than
 * lost, and closing it needs a top-up transfer at
 * `checkout.session.completed`, which is a new outbound money path and is
 * deliberately NOT bundled with this fix. Tracked on AGL-1956.
 *
 * Pure and total: integer cents in, integer cents out, no clamping surprises
 * except the documented floor at zero.
 */

/** Which party's registrations the tax on this sale was computed against. */
export type StorefrontTaxOwner = 'platform' | 'merchant'

export interface DestinationChargeSplit {
  /** The merchant's connected account id. */
  accountId: string
  /**
   * Aglyn's take in cents — the advertised platform fee plus the passed-through
   * card cost (`resolveTransactionFeeCents`). Never negative.
   */
  feeCents: number
  /**
   * `platform` when the session carries `automatic_tax[enabled]` and Stripe
   * Tax computes against Aglyn's registrations (AGL-1904). `merchant` for a
   * `manual` rate the merchant set and owes, and for an untaxed sale.
   */
  taxOwner: StorefrontTaxOwner
  /**
   * What Stripe will charge for the GOODS — after any coupon is priced in, and
   * excluding shipping and every tax line. The merchant's money.
   */
  merchantGoodsCents: number
  /**
   * The CHEAPEST shipping option offered on this session, or 0 when the
   * merchant offers none. See the module note on why this is the cheapest and
   * not the dearest.
   */
  shippingFloorCents?: number
}

/**
 * What the merchant is paid, in cents, when AGLYN owes the tax.
 *
 * `goods + cheapest shipping − fee`, floored at zero. The floor is a real
 * case, not defensive padding: `resolveTransactionFeeCents` adds Stripe's
 * fixed 30¢ card cost, so a sub-dollar order can carry a fee worth more than
 * the goods. The merchant is paid nothing on such an order, which is the
 * honest outcome — Aglyn is out of pocket on it either way — and it must
 * never be expressed as a NEGATIVE transfer, which Stripe rejects.
 */
export function platformLiableTransferCents(
  split: Pick<
    DestinationChargeSplit,
    'feeCents' | 'merchantGoodsCents' | 'shippingFloorCents'
  >,
): number {
  const goods = Math.max(0, Math.round(Number(split.merchantGoodsCents ?? 0)))
  const shipping = Math.max(0, Math.round(Number(split.shippingFloorCents ?? 0)))
  const fee = Math.max(0, Math.round(Number(split.feeCents ?? 0)))
  return Math.max(0, goods + shipping - fee)
}

/**
 * What a paid SUBSCRIPTION invoice says about the tax on it, and therefore
 * whether the platform has to pull that tax back out of the transfer
 * (AGL-1956).
 *
 * ## Why the recurring path needs a different instrument entirely
 *
 * Everything above is about a knob set when the charge is CREATED. A Stripe
 * Subscription has neither knob: it accepts no `transfer_data[amount]`, only
 * `application_fee_percent`. On a destination charge that means Stripe
 * transfers the WHOLE charge to the connected account and debits the fee at
 * the destination, and the charge has the Stripe Tax inside it — so the
 * merchant is handed the state's money on every taxed cycle. `checkout.ts`
 * therefore excludes subscriptions from `destinationChargeParams` and leaves
 * them on the fee form.
 *
 * AGL-2317 makes that strictly worse, not better. It refunds the part of the
 * application fee that was taken on tax and shipping BACK to the connected
 * account, which is right on its own terms (Aglyn's advertised cut is a cut of
 * sales) but means the merchant ends the cycle holding **one hundred percent**
 * of a tax Aglyn is the one registered to remit.
 *
 * ## The money is already at the merchant, so the correction is a REVERSAL
 *
 * Worth stating explicitly, because the sign is easy to get backwards and this
 * module documents a residual that runs the OTHER way. The shipping residual
 * above is a case where the transfer was FIXED too low and the merchant is
 * owed more — that one needs a top-up. This is the opposite: the fee form
 * OVER-transfers, the tax is physically sitting in the connected account's
 * balance, and the only instrument that moves it back to the platform is a
 * transfer reversal. A top-up here would pay the merchant the tax twice.
 *
 * ## Three answers, never two
 *
 * The whole point of the three-state is that **a missing tax field must not
 * read as "no tax"**. Stripe removed the scalar `invoice.tax` in favour of
 * `total_taxes[]`, and which spelling an endpoint receives is dashboard
 * configuration this repo cannot see. A reader that reached for one field and
 * defaulted the miss to `0` would answer "no reversal" on every invoice after
 * a Stripe version bump nobody here can observe — a swallowed read rendering
 * as a measured zero, with the money going the wrong way and nothing looking
 * wrong. So an invoice that claims automatic tax while stating NO tax field at
 * all is `unreadable`, and the caller is required to make noise about it.
 *
 * A `tax: 0`, or a present-but-empty `total_taxes: []`, is a real answer and
 * is `skip`. That is also what a $0 or fully-discounted invoice produces, which
 * is why the no-op costs nothing.
 *
 * Pure and total: no throw, no clamping beyond the documented floor at zero.
 */
export type SubscriptionTaxReversalDecision =
  /** Aglyn owes this tax and the merchant is holding it. Pull back exactly this. */
  | { kind: 'reverse'; taxCents: number }
  /** Nothing to do, and nothing wrong. No network call is warranted. */
  | { kind: 'skip'; reason: 'merchant-tax' | 'no-tax' }
  /** The invoice claims tax it will not state. LOUD, never silent. */
  | { kind: 'unreadable'; reason: string }

/**
 * Which party's registrations a subscription invoice's tax was computed
 * against — the same `taxOwner` distinction `destinationChargeParams` makes,
 * read off the invoice instead of off the store's settings.
 *
 * `automatic_tax.enabled` is THE discriminator and the tax lines are never it,
 * for the reason `storefront-tax.ts` states at length: a MANUAL-rate
 * subscription carries a real Stripe Tax Rate on its line (AGL-1751), so every
 * cycle it bills arrives with a populated `total_taxes[]` that is
 * indistinguishable from a Stripe Tax one by shape. Reading the lines would
 * reverse the merchant's OWN tax out of their payout on every cycle — the
 * failure that steals from the merchant rather than from the state.
 *
 * `liability.type === 'account'` means Stripe computed against the CONNECTED
 * account's registrations, so the tax is theirs and stays with them. `self`,
 * and an absent liability (older API versions omit the field, where the only
 * account a platform-created invoice could be liable under is the platform),
 * mean Aglyn. This mirrors `storefrontTaxRow` exactly, deliberately: the filed
 * tax record and the reversal must not be able to disagree about who owed it.
 */
export function subscriptionInvoiceTaxOwner(
  invoice: unknown,
): StorefrontTaxOwner {
  const source = invoice as any
  if (source?.automatic_tax?.enabled !== true) return 'merchant'
  return source?.automatic_tax?.liability?.type === 'account'
    ? 'merchant'
    : 'platform'
}

/** See `SubscriptionTaxReversalDecision`. */
export function subscriptionInvoiceTaxReversal(
  invoice: unknown,
): SubscriptionTaxReversalDecision {
  const source = invoice as any
  if (subscriptionInvoiceTaxOwner(source) === 'merchant') {
    return { kind: 'skip', reason: 'merchant-tax' }
  }
  const settle = (cents: number): SubscriptionTaxReversalDecision =>
    cents > 0
      ? { kind: 'reverse', taxCents: cents }
      : { kind: 'skip', reason: 'no-tax' }

  // `typeof === 'number'` and NOT `Number(…)`, because `Number(null)` is a
  // finite 0 and `null` is how an absent field arrives over JSON. Treating it
  // as a stated zero is precisely the swallow this type exists to prevent.
  const scalar = source?.tax
  if (typeof scalar === 'number' && Number.isFinite(scalar)) {
    return settle(Math.round(scalar))
  }
  // `total_taxes` replaced `total_tax_amounts`, which replaced the scalar; they
  // do not coexist, so this cannot double-count.
  const lines = Array.isArray(source?.total_taxes)
    ? source.total_taxes
    : Array.isArray(source?.total_tax_amounts)
      ? source.total_tax_amounts
      : null
  if (lines) {
    let sum = 0
    for (const line of lines) {
      const amount = Number((line as any)?.amount ?? NaN)
      // One unreadable line poisons the sum: a partial total would reverse
      // LESS than the state is owed and look like a successful correction.
      if (!Number.isFinite(amount)) {
        return {
          kind: 'unreadable',
          reason: 'a tax line on the invoice states no readable `amount`',
        }
      }
      sum += amount
    }
    return settle(Math.round(sum))
  }
  return {
    kind: 'unreadable',
    reason:
      'the invoice enables automatic tax but states no `tax`, `total_taxes` ' +
      'or `total_tax_amounts` — the Stripe API version may have moved the field',
  }
}

/**
 * The cheapest rate on a resolved shipping plan, in cents. `0` for a plan with
 * no options, which is also the right transfer contribution for a store that
 * charges no shipping.
 */
export function shippingFloorCents(
  options: readonly { amountCents?: unknown }[] = [],
): number {
  if (options.length === 0) return 0
  return options.reduce(
    (least, option) =>
      Math.min(
        least,
        Math.max(0, Math.round(Number(option?.amountCents ?? 0))),
      ),
    Number.POSITIVE_INFINITY,
  )
}

/**
 * The Connect keys for a storefront destination charge — the destination, and
 * EXACTLY ONE of `application_fee_amount` / `transfer_data[amount]`.
 *
 * Emitted from one place so no checkout path can pick the wrong knob on its
 * own, and so the pair can never both appear (Stripe rejects that, and the two
 * would be contradicting each other about the same split).
 *
 * The `metadata[transferCents]` companion is deliberately NOT emitted here —
 * each caller owns its own metadata block, and the value is
 * `platformLiableTransferCents(split)`.
 */
export function destinationChargeParams(
  split: DestinationChargeSplit,
): Record<string, string> {
  const destination = {
    'payment_intent_data[transfer_data][destination]': String(split.accountId),
  }
  const fee = Math.max(0, Math.round(Number(split.feeCents ?? 0)))
  if (split.taxOwner === 'platform') {
    // AGLYN OWES THE TAX, SO AGLYN MUST KEEP IT (AGL-1956). A fixed transfer
    // is the only form that expresses that: `application_fee_amount` would
    // make Stripe compute `amount_total − fee`, and `amount_total` has the
    // Stripe Tax inside it. Emitted even when it is zero — a zero transfer is
    // a real, correct answer for a sub-dollar order (see
    // `platformLiableTransferCents`), and OMITTING the key would silently
    // restore the full-charge transfer this whole module exists to prevent.
    return {
      ...destination,
      'payment_intent_data[transfer_data][amount]': String(
        platformLiableTransferCents(split),
      ),
    }
  }
  // The merchant owns the tax on this sale, so the merchant may hold it: the
  // fee form is exact here and is left byte-identical to what these paths
  // sent before AGL-1956. Stripe rejects a zero application fee, so a fee that
  // rounded to nothing sends no key at all.
  return {
    ...destination,
    ...(fee > 0
      ? { 'payment_intent_data[application_fee_amount]': String(fee) }
      : {}),
  }
}
