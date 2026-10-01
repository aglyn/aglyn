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
  BNPL_PROCESSING_PERCENT,
  bindingMarketplaceFeePct,
  PROCESSING_FIXED_CENTS,
} from '@aglyn/aglyn/app-utils/plan-entitlements'

/*
 * WHAT ONE PAID LISTING'S SALE COSTS THE PLATFORM, AND THE FLOOR IT SETS
 * (AGL-2343).
 *
 * Marketplace checkout is a DESTINATION charge with a fixed
 * `transfer_data[amount]` and deliberately no `application_fee_amount`, so
 * that the sales tax stays with the platform that owes it (AGL-1544). On a
 * destination charge Stripe debits its fee from the PLATFORM's balance, and it
 * is charged on `amount_total` — the listing price plus the tax added on top
 * of it.
 *
 * So a $1 listing at a 20% take rate is a loss: the buyer pays $1.08, the
 * seller is transferred $0.80, $0.08 is owed to the state, Aglyn keeps $0.20
 * and pays Stripe about $0.33. Net −$0.13.
 *
 * Break-even is computed from the dearest payment method the platform's
 * configuration enables (`BNPL_PROCESSING_PERCENT`), because a marketplace
 * session pins no `payment_method_types`. IF BNPL IS EVER TURNED OFF FOR
 * MARKETPLACE SESSIONS, the rate these default to is what has to move with it.
 *
 * Nothing is billed from these figures — the charged amounts are the plan's
 * take rate and Stripe's own invoicing — so changing one changes a sentence
 * and the floor, never a bill.
 */

/**
 * The tax rate the break-even figure assumes. Tax is added ON TOP of the
 * listing price and enlarges the base Stripe charges its percentage against,
 * so it makes the platform's cost slightly worse; the real rate is whatever
 * `automatic_tax` computes for the buyer's address, and this is the
 * platform's own Texas rate as a representative figure.
 */
export const MARKETPLACE_ASSUMED_TAX_PERCENT = 8.25

/** Where the money goes on one sale of a paid listing (AGL-2343). */
export interface MarketplaceSaleEconomics {
  /** The listing price. */
  priceCents: number
  /** Added on top, and owed to the state. */
  taxCents: number
  /** What the buyer is charged. */
  buyerPaysCents: number
  /** `transfer_data[amount]` — the seller's share of the pre-tax price. */
  sellerReceivesCents: number
  /** The platform's take. */
  platformFeeCents: number
  /** Stripe's fee, debited from the platform on a destination charge. */
  processingCents: number
  /** `platformFeeCents - processingCents`. Negative is a loss on the sale. */
  platformNetCents: number
}

/**
 * The funds flow for one sale, mirroring what `checkout.ts` actually builds
 * (AGL-2343): tax exclusive and on top, a fixed transfer of the seller's share
 * of the PRE-tax price, and Stripe's fee charged on the buyer's total.
 */
export function marketplaceSaleEconomics(
  priceUsd: number,
  feePercent: number,
  processingPercent: number = BNPL_PROCESSING_PERCENT,
): MarketplaceSaleEconomics {
  const priceCents = Math.max(0, Math.round(priceUsd * 100))
  const taxCents = Math.round(
    (priceCents * MARKETPLACE_ASSUMED_TAX_PERCENT) / 100,
  )
  const buyerPaysCents = priceCents + taxCents
  const platformFeeCents = Math.round((priceCents * feePercent) / 100)
  const sellerReceivesCents = priceCents - platformFeeCents
  // A zero-price listing takes no payment at all, so there is no fee to pay.
  const processingCents =
    priceCents === 0
      ? 0
      : Math.round(
          (buyerPaysCents * processingPercent) / 100 +
            PROCESSING_FIXED_CENTS,
        )
  return {
    priceCents,
    taxCents,
    buyerPaysCents,
    sellerReceivesCents,
    platformFeeCents,
    processingCents,
    platformNetCents: platformFeeCents - processingCents,
  }
}

/**
 * The cheapest WHOLE-DOLLAR price at which the platform does not lose money on
 * a sale (AGL-2343).
 *
 * Whole dollars because every publish route rounds `priceUsd` to one, so a
 * fractional break-even is not a price anyone can actually set. Searched
 * rather than solved algebraically so that it can never disagree with
 * `marketplaceSaleEconomics` — the rounding in there is what decides the
 * answer at these amounts, and a closed form would drift from it silently.
 *
 * THIS IS THE ENFORCED FLOOR: `marketplaceMinPriceUsd` returns this figure
 * and every publish door refuses a paid listing under it. Recorded in the Pricing
 * Decision Log and on AGL-2343.
 */
export function marketplaceBreakEvenUsd(
  feePercent: number = bindingMarketplaceFeePct(),
  processingPercent: number = BNPL_PROCESSING_PERCENT,
): number {
  // The listing price ceiling is `MARKETPLACE_MAX_PRICE_USD` in the model,
  // which takes its floor from this module, so reading it here would be a
  // cycle. The loop only needs SOME bound, and the answer is single digits at
  // every rate the table holds, so a generous local one costs nothing and
  // cannot drift into a wrong figure.
  const searchCeilingUsd = 1000
  for (let priceUsd = 1; priceUsd <= searchCeilingUsd; priceUsd += 1) {
    if (
      marketplaceSaleEconomics(priceUsd, feePercent, processingPercent)
        .platformNetCents >= 0
    ) {
      return priceUsd
    }
  }
  return searchCeilingUsd
}

/**
 * THE MINIMUM PRICE a paid marketplace listing may carry (AGL-2343).
 *
 * The floor is not a chosen round number — it is the break-even price itself,
 * the
 * cheapest whole dollar at which `marketplaceSaleEconomics` stops returning a
 * negative platform net, computed at the take rate that breaks even LATEST and
 * the dearest payment method the live configuration enables. Today that is $3.
 *
 * DERIVED, NEVER RESTATED. A second hand-written copy of this number in a
 * publish route or a form is the artifact that decays into a route refusing a
 * price a form invited, so both the server-side validator
 * (`MARKETPLACE_MIN_PRICE_USD` in the marketplace model) and every price field
 * read this. If the payment method set changes, or the plan table's lowest
 * take rate moves, the floor moves with them on the next call.
 *
 * ZERO IS NOT BELOW THE FLOOR. A free listing takes no payment at all, so it
 * costs nothing to process; the floor is a minimum on PAID listings only.
 */
export function marketplaceMinPriceUsd(): number {
  return marketplaceBreakEvenUsd()
}

/**
 * Whether a price is a PAID price that the floor refuses (AGL-2343) — the one
 * predicate a form uses to mark its price field in error and hold its publish
 * button, so that the button and the server agree about what is publishable.
 *
 * Rounds first because every publish route does, and a form's value is a
 * string mid-type: `'2.6'` is stored as $3 and must read as allowed here, or
 * the button would refuse a price the route accepts.
 */
export function isBelowMarketplacePriceFloor(priceUsd: unknown): boolean {
  const price = Math.round(Number(priceUsd) || 0)
  return price > 0 && price < marketplaceMinPriceUsd()
}

/**
 * The sentence a publish form shows under its price field when the price is
 * below the floor (AGL-2343), or `undefined` when there is nothing to say.
 *
 * NOT ADVISORY ANY MORE. The same figure is enforced by every publish route
 * through `publishPreconditionRefusal`, so this text has to read as a
 * requirement rather than a warning — a publisher who is told "consider
 * raising it" and then refused has been lied to by the form. It still explains
 * WHY, because a bare minimum with no arithmetic behind it reads as an
 * arbitrary tax on cheap listings.
 *
 * Shared by every publish form rather than written into each, because the
 * figure has to be the same one in all of them and the wording is the only
 * place a publisher ever sees it.
 *
 * Quoted at the take rate that breaks even LATEST, so the sentence holds for a
 * free-plan publisher too.
 */
export function marketplacePriceCostNote(
  priceUsd: unknown,
): string | undefined {
  const price = Math.round(Number(priceUsd) || 0)
  const minimum = marketplaceMinPriceUsd()
  // A free listing takes no payment, so it costs nothing to process and has
  // nothing to warn about — silence there is the point, not an oversight.
  if (!isBelowMarketplacePriceFloor(price)) return undefined
  const { processingCents, platformFeeCents } = marketplaceSaleEconomics(
    price,
    bindingMarketplaceFeePct(),
  )
  const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`
  return (
    `Too low to publish. Processing a $${price} payment costs about ` +
    `${usd(processingCents)}, more than the ${usd(platformFeeCents)} platform ` +
    `fee — the sale would lose money. The minimum paid price is ` +
    `$${minimum}, and a free listing ($0) takes no payment at all.`
  )
}

/**
 * The standing helper sentence a price field shows when there is nothing wrong
 * (AGL-2343): the minimum stated up front, so a publisher meets it while
 * typing instead of discovering it as a refusal.
 *
 * A capability that is not surfaced in the console does not count as shipped,
 * and that applies to a REFUSAL as much as to a feature: a floor only a route
 * knows about is a trap.
 *
 * @param suffix whatever else that particular form needs to say, appended.
 */
export function marketplacePriceFloorHint(suffix?: string): string {
  return (
    `0 for free, or $${marketplaceMinPriceUsd()} and up for a paid listing.` +
    (suffix ? ` ${suffix}` : '')
  )
}
