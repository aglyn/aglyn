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
 * Whether the org's address and the one Stripe bills from are out of step
 * (AGL-1133).
 *
 * The two can differ for two quite different reasons, and the console used to
 * show neither:
 *
 *  - **the address was cleared here.** Clearing does NOT clear Stripe's copy,
 *    deliberately: that address is what an active subscription's invoices
 *    carry and what `automatic_tax` computes from, so removing it would stop
 *    tax being calculated and put an addressless invoice in front of a tax
 *    authority. Emptying a form field is not a request to do that.
 *  - **the push failed.** The save reported success, Firestore has the new
 *    address, and every invoice still carries the old one. This is the case
 *    nobody would think to look for.
 *
 * Kept as a pure function because it is a truth table, and a truth table
 * buried in a `fetch` callback inside `after()` is one nobody can check.
 */
export type StripeAddressDivergenceReason = 'cleared-here' | 'sync-failed' | null

export interface StripeAddressDivergenceInput {
  /** Did this save have anything to send Stripe? */
  pushed: boolean
  /** Did that push succeed? Meaningless when `pushed` is false. */
  pushOk?: boolean
  /**
   * Does the Stripe customer currently hold an address? MEASURED by reading
   * the customer, never inferred from having skipped a write — the customer
   * may have no address either, and a warning that fires on a consistent
   * pair is one people learn to ignore.
   */
  stripeHasAddress?: boolean
}

export interface StripeAddressDivergence {
  addressDivergedFromStripe: boolean
  addressDivergedReason: StripeAddressDivergenceReason
}

export function stripeAddressDivergence(
  input: StripeAddressDivergenceInput,
): StripeAddressDivergence {
  if (input.pushed) {
    return input.pushOk
      ? { addressDivergedFromStripe: false, addressDivergedReason: null }
      : { addressDivergedFromStripe: true, addressDivergedReason: 'sync-failed' }
  }
  // Nothing to push. Only a divergence if Stripe actually holds something.
  return input.stripeHasAddress
    ? { addressDivergedFromStripe: true, addressDivergedReason: 'cleared-here' }
    : { addressDivergedFromStripe: false, addressDivergedReason: null }
}
