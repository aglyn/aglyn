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
 * What a payout card is allowed to say (AGL-1997).
 *
 * The seller panel decided this inline, from ONE flag:
 *
 *   payoutsEnabled = loaded && Boolean(profile.stripeChargesEnabled)
 *
 * and rendered "Payouts are enabled" from it. `stripeChargesEnabled` answers
 * whether Stripe will let the account take MONEY; whether the money can LEAVE
 * is `stripePayoutsEnabled`, added by AGL-1547 for this exact panel and never
 * read by any UI. Charges-yes/payouts-no is an ordinary Stripe state —
 * verification pending or lapsed, no payout method — and it is precisely
 * where the old sentence was false, in the direction that costs the seller:
 * they sell believing they are paid, and the funds sit.
 *
 * Extracted as a pure function so every state can be asserted without
 * mounting the card. The card's job is wording; this one's is the decision.
 */
export type PayoutReadiness =
  /** Still reading the profile. Say nothing about payouts. */
  | 'pending'
  /** The read failed. Say nothing about payouts — this is not "off". */
  | 'error'
  /** No Stripe account can take charges yet: the onboarding call to action. */
  | 'disconnected'
  /**
   * Charges on, payout readiness never recorded. NOT a problem report: the
   * field postdates AGL-1547 and is written only by the connect route and the
   * `account.updated` sync, so an absent value means unasked, not off.
   */
  | 'unknown'
  /** Charges on, payouts explicitly NOT enabled — the stranded-funds state. */
  | 'blocked'
  /**
   * Charges on, but which Stripe world the account belongs to was never
   * recorded (AGL-2471) — so no money door will actually charge against it.
   * Ranked ABOVE the payout question because it is the more fundamental
   * failure: an unverified linkage cannot take a payment at all, and saying
   * "payouts are enabled" about it is the sentence that shipped three
   * storefronts presenting as ready and unable to sell.
   */
  | 'unverified'
  /** Charges on and payouts on. The only state that may claim success. */
  | 'ready'

export interface PayoutReadinessInput {
  /** Profile load state, as the card already computes it. */
  state: 'pending' | 'error' | 'loaded'
  /** `profile.stripeChargesEnabled`, whatever shape it is on the document. */
  chargesEnabled?: unknown
  /** `profile.stripePayoutsEnabled` — absent on pre-AGL-1547 profiles. */
  payoutsEnabled?: unknown
  /**
   * `profile.stripeAccountLivemode` (AGL-2471) — absent on every linkage
   * written before it, including all three that existed in production.
   */
  accountLivemode?: unknown
}

/**
 * Decides which of the six statements a payout card may make.
 *
 * `payoutsEnabled` is read three-valued on purpose: only a literal `false`
 * from Stripe produces `'blocked'`. Any other absent-or-odd value produces
 * `'unknown'`, which reports uncertainty instead of inventing either answer.
 */
export function payoutReadiness(input: PayoutReadinessInput): PayoutReadiness {
  if (input.state !== 'loaded') return input.state
  if (input.chargesEnabled !== true) return 'disconnected'
  // AGL-2471, asked before the payout question: `stripeChargesEnabled` alone
  // is what made a test-mode account read as a working merchant. Only a
  // literal boolean counts as recorded — the same three-valued reading the
  // server gate uses, so the card and the checkout agree.
  if (typeof input.accountLivemode !== 'boolean') return 'unverified'
  if (input.payoutsEnabled === true) return 'ready'
  if (input.payoutsEnabled === false) return 'blocked'
  return 'unknown'
}
