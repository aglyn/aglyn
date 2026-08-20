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

import type { TaxSettings } from './commerce-tax'

/**
 * Whether a storefront sale computes tax, and — when it does not — WHY
 * (AGL-1999).
 *
 * ## The defect this exists to remove
 *
 * Nothing seeds `hosts/{hostId}/settings/store`. It is written only when the
 * merchant opens the Taxes card and saves. Until then `tax.mode` is
 * `undefined`, and every server-side branch tested for a specific string:
 *
 *   checkout.ts       `mode === 'stripe'` / `mode === 'manual'`
 *   cart-checkout.ts  `mode === 'stripe'` / `mode === 'manual'`
 *   draft-order.ts    `mode === 'stripe'` / `mode === 'manual'`
 *   pos-order.ts      `mode === 'manual'`
 *
 * `undefined` matched neither. No branch was taken, no tax was computed, and
 * no path refused the sale — so buy-now, cart, draft orders and POS all
 * charged the shopper an untaxed total. The `{ mode: 'manual' }` default that
 * makes this look safe lives ONLY in the console card's local state
 * (`tax-settings-card.component.tsx`) and never reaches Firestore unless the
 * merchant presses Save. A merchant who never visits the card — the default
 * state of every new storefront — sold untaxed, and was never told.
 *
 * The failure is silent in both directions: the shopper is undercharged, and
 * the merchant accrues an unremitted liability nobody mentioned. Undercharging
 * cannot be recovered — by the time anyone notices, the shopper is gone.
 *
 * ## The decision taken (AGL-1999 option 1, with an explicit opt-out)
 *
 * **An unset tax mode REFUSES the sale.** This follows the precedent AGL-1791
 * set for shipping: a destination no zone covers is refused, not silently
 * zero-rated. Refusal is recoverable — the merchant sees it and configures —
 * where undercharging is not.
 *
 * Defaulting to `stripe` instead was rejected, and not on ergonomics: Stripe
 * Tax computes storefront sessions against AGLYN's registrations with
 * `liability: self` (MEASURED — see `storefront-tax.ts`), so defaulting there
 * silently makes Aglyn the collecting party for merchants who never asked.
 * That is a legal position (AGL-1904 / AGL-1956), it belongs to counsel, and a
 * default is the wrong way to take it.
 *
 * **But refusing every unconfigured store would be wrong too**, because plenty
 * of merchants genuinely owe no tax — under a nexus threshold, or selling
 * non-taxable goods. So `mode: 'none'` is a first-class, RECORDED decision
 * meaning "I have decided not to collect", and it is honoured silently. The
 * refusal is reserved for the one state that is not a decision at all: nobody
 * has answered the question yet.
 *
 * A merchant who opens the card and saves `manual` with no rates still
 * collects nothing. That is fine and deliberate — they were asked and they
 * answered. The point is never that tax gets collected; it is that a human
 * decided.
 *
 * Pure and total, so every path can share one answer instead of four
 * hand-rolled string tests that already drifted once (AGL-1953).
 */
export type StorefrontTaxDecision =
  /** Stripe Tax computes it. See the AGL-1904 liability note. */
  | { kind: 'stripe-automatic' }
  /** The merchant's own configured rate for the store origin. */
  | { kind: 'manual' }
  /** This PRODUCT is exempt; the store's mode is irrelevant to it. */
  | { kind: 'exempt'; reason: string }
  /** The merchant decided not to collect. Honoured, and recorded. */
  | { kind: 'none'; reason: string }
  /** Nobody has decided. The sale must be refused, not zero-rated. */
  | { kind: 'undecided'; reason: string }

export interface StorefrontTaxDecisionInput {
  /** `hosts/{hostId}/settings/store.tax`, absent doc included. */
  settings: TaxSettings | undefined | null
  /** The product's own `taxExempt` flag, where the path has one. */
  taxExempt?: boolean
}

/**
 * What every storefront sales-tax path should do about tax, and why.
 *
 * Reservations deliberately do NOT call this: a stay is not goods, lodging is
 * a different regime from the sales rate the AGL-285 editor configures, and
 * that no-tax outcome is its own stated decision in `reserve.ts`.
 */
export function storefrontTaxDecision(
  input: StorefrontTaxDecisionInput,
): StorefrontTaxDecision {
  // The product flag wins over the store mode, exactly as the inline
  // `&& !lifted.taxExempt` tests did — an exempt product is exempt whichever
  // machinery the store uses.
  if (input.taxExempt === true) {
    return {
      kind: 'exempt',
      reason: 'the product is marked tax-exempt',
    }
  }
  const mode = input.settings?.mode
  if (mode === 'stripe') return { kind: 'stripe-automatic' }
  if (mode === 'manual') return { kind: 'manual' }
  if (mode === 'none') {
    return {
      kind: 'none',
      reason: 'the store has decided not to collect sales tax',
    }
  }
  // Anything else — an absent settings document, an absent `mode`, or a value
  // written by a future version this build does not know — is NOT a decision.
  // Refusing an unrecognised string is deliberate: guessing at it is how the
  // original defect behaved.
  return {
    kind: 'undecided',
    reason: 'no one has chosen how this store handles sales tax',
  }
}

/**
 * The message a refused shopper's merchant needs to act on. Kept beside the
 * decision so all four paths refuse in the same words.
 */
export const STOREFRONT_TAX_UNDECIDED_MESSAGE =
  'This store has not set up sales tax yet, so we can’t take the order. ' +
  'The store owner can fix this in Commerce → Settings → Taxes.'

/**
 * A second refusal, for the two states that ARE decisions but that the path
 * about to run cannot honour (AGL-2145).
 *
 * `storefrontTaxDecision` above answers "did a human decide?", and its
 * docblock is careful about the difference between an undecided store and one
 * that decided to collect nothing. Both of the states below sit outside that
 * distinction: the merchant decided to collect tax, and the sale then charged
 * zero anyway, silently, leaving the liability with them.
 *
 *  1. **Manual mode with no store origin.** `resolveTaxRate` opens with
 *     `if (!country) return null`, and every caller reads that null as "no
 *     rate applies" — the same value it returns for a shopper in a
 *     jurisdiction the merchant has no rate for, which is a legitimate zero.
 *     An empty `origin.country` is not a jurisdiction miss, it is an
 *     unfinished settings card: the merchant chose Manual, and *every* order
 *     is then untaxed regardless of who buys. A merchant who saved `manual`
 *     with an origin and no matching rates still collects nothing, and that
 *     stays fine — they answered, and the answer applies per shopper.
 *
 *  2. **Stripe-automatic at the REGISTER.** `pos-order.ts` sends the whole
 *     basket as one opaque `In-store purchase` line at `totals.totalCents` and
 *     sets no `automatic_tax[enabled]` — it cannot, there is no customer
 *     address at a till — and the cash and folio tenders never reach Stripe at
 *     all. So a store that chose "Stripe computes my tax" got **zero** tax on
 *     every in-person sale, on both tenders, with no refusal and no log. This
 *     is the same defect AGL-1999 closed for the three online paths, still
 *     open at the one place a shopper stands in front of you.
 *
 * `inPerson` is what separates them: (2) is a property of the REGISTER, not of
 * the store, and online Stripe-Tax sales are correct and must not be refused.
 *
 * Returns the message to refuse with, or null to proceed. Never a boolean —
 * the four paths must refuse in the merchant's own words, and a boolean is how
 * four hand-rolled strings drift.
 */
export function storefrontTaxMisconfiguration(
  settings: TaxSettings | undefined | null,
  options: { inPerson?: boolean } = {},
): string | null {
  const mode = settings?.mode
  if (mode === 'manual' && !String(settings?.origin?.country ?? '').trim()) {
    return STOREFRONT_TAX_NO_ORIGIN_MESSAGE
  }
  if (mode === 'stripe' && options.inPerson === true) {
    return STOREFRONT_TAX_POS_STRIPE_MESSAGE
  }
  return null
}

/** @see storefrontTaxMisconfiguration — case 1. */
export const STOREFRONT_TAX_NO_ORIGIN_MESSAGE =
  'This store collects sales tax manually but has no store address set, so ' +
  'no rate can be applied. The store owner can add it in Commerce → ' +
  'Settings → Taxes.'

/** @see storefrontTaxMisconfiguration — case 2. */
export const STOREFRONT_TAX_POS_STRIPE_MESSAGE =
  'This store uses automatic tax, which the register can’t calculate for an ' +
  'in-person sale. The store owner can switch Taxes to Manual and add a rate ' +
  'for the store address in Commerce → Settings → Taxes.'

/**
 * WHICH MACHINERY produced the tax on a storefront sale (AGL-1904).
 *
 * The canonical home for the union, because two different things need it:
 * the `storefrontTaxCollected` record that Aglyn's own return reads
 * (`server/storefront-tax.ts`, which re-exports this) and the `taxMode` field
 * stamped on the merchant's ORDER (AGL-2451). One union, so the two can never
 * disagree about what a value means.
 *
 *   - **`stripe-automatic`** — Stripe Tax computed it, against whichever
 *     account `automatic_tax.liability` names. On a storefront session that is
 *     AGLYN's platform account (MEASURED — see `server/storefront-tax.ts`).
 *   - **`manual`** — the merchant's own configured rate, applied to their own
 *     declared origin. Aglyn's registrations never enter into it.
 *   - **`none`** — no tax was charged on this sale.
 *
 * ABSENT is a fourth state and is NOT `none`: it means "not recorded", which
 * is what every order written before AGL-2451 genuinely is. Nothing may
 * default it — see `describeOrderTaxMode` and the warning on `liftLegacyOrder`.
 */
export type StorefrontTaxMode = 'stripe-automatic' | 'manual' | 'none'

/**
 * THE derivation, in one place, for every path that resolves a tax mode.
 *
 * `automatic` is `automatic_tax.enabled` on the Stripe object, or
 * `decision.kind === 'stripe-automatic'` where the sale never reaches Stripe
 * at all (the register's cash and folio tenders). It is **never** "were there
 * tax lines": a manual-mode subscription renewal carries a real Stripe Tax
 * Rate (AGL-1751) and a manual cart or draft order has since AGL-1953, so
 * their invoices and sessions arrive with populated tax breakdowns that are
 * byte-indistinguishable from a Stripe Tax one. Summing lines would silently
 * book merchant-configured tax as Aglyn-collected. **Read the flag.**
 *
 * `taxCents` only ever separates `manual` from `none`, and only when the flag
 * is off: a `stripe-automatic` sale stays `stripe-automatic` at zero tax,
 * because "Stripe Tax answered not-collecting" is itself the audit answer to
 * why a jurisdiction is absent from a return.
 */
export function storefrontTaxMode(input: {
  automatic: boolean
  taxCents: number
}): StorefrontTaxMode {
  if (input.automatic) return 'stripe-automatic'
  return Number(input.taxCents ?? 0) > 0 ? 'manual' : 'none'
}

/**
 * The same derivation, from a `StorefrontTaxDecision` — for the paths that
 * resolve tax before any Stripe object exists (`pos-order.ts`,
 * `draft-order.ts`). `exempt` and `none` both charge nothing and land on
 * `none`; `undecided` never reaches a write, because every caller refuses it.
 */
export function storefrontTaxModeForDecision(
  decision: StorefrontTaxDecision,
  taxCents: number,
): StorefrontTaxMode {
  return storefrontTaxMode({
    automatic: decision.kind === 'stripe-automatic',
    taxCents,
  })
}

/**
 * How the tax on ONE order was computed, in the merchant's words (AGL-2451).
 *
 * Describes the MECHANISM and makes **no remittance determination** — the same
 * constraint AGL-2440's report ships under. Who owes which authority what is a
 * legal conclusion that attaches by operation of law (AGL-1904/AGL-1956); it
 * belongs to counsel, and a sentence in an order dialog is the wrong place to
 * take it.
 *
 * An absent mode answers "not recorded", never "no tax" — every order written
 * before this shipped has no stamp, and rendering that as `none` would state a
 * tax fact nobody recorded.
 */
export function describeOrderTaxMode(
  mode: StorefrontTaxMode | undefined | null,
): string {
  if (mode === 'stripe-automatic') {
    return 'Calculated automatically by Stripe Tax at checkout, from the shopper’s address.'
  }
  if (mode === 'manual') {
    return 'Calculated from this store’s own configured tax rate.'
  }
  if (mode === 'none') {
    return 'No sales tax was calculated on this order.'
  }
  return 'How this tax was calculated was not recorded on this order.'
}
