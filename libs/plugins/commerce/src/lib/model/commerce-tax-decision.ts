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
