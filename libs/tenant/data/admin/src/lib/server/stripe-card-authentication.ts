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

/*==========================================
 * 3-D SECURE, AT ONE SEAM (AGL-3356, AGL-3360).
 *
 * Every card payment and every card saved on Aglyn asks Stripe for 3-D
 * Secure through this one function: the workspace's own SetupIntent, and
 * every Checkout Session a plugin opens for a site's customer (storefront,
 * cart, draft order, POS, reservation, booking deposit, marketplace).
 *
 * TWO ANSWERS, by what the card is for:
 *
 * - `one-time`: `automatic`. Stripe authenticates when the issuer requires
 *   it (SCA) or when Radar asks (a "request 3D Secure" rule). A shopper is
 *   not challenged for a routine purchase, and a merchant's Radar rules can
 *   still raise the bar. This is Stripe's default today; sending it
 *   explicitly keeps the choice ours if the default moves.
 * - `off-session`: `any`. The card is kept and charged later with nobody
 *   present (a membership renewal, the workspace's own plan). Authenticating
 *   once now is what lets the issuer approve the unattended renewals, and it
 *   moves fraud liability to the issuer. A card without 3DS still works.
 *
 * ONE CHALLENGE PER PAYMENT. The parameter is the whole request: Checkout
 * and `confirmSetup` run the challenge themselves when Stripe answers
 * `requires_action`, and a subscription's first invoice is authenticated
 * by the same step that saves the card. Nothing here adds a second prompt.
 *
 * Pure and dependency-free, so every plugin and the console share it
 * without a bundle cost.
 *=========================================*/

/** What the card is being collected for. */
export type CardAuthenticationUse = 'one-time' | 'off-session'

/** The value Stripe's `request_three_d_secure` takes. */
export type RequestThreeDSecure = 'automatic' | 'any'

/** The param name, identical on PaymentIntents, SetupIntents and Checkout Sessions. */
export const REQUEST_THREE_D_SECURE_PARAM =
  'payment_method_options[card][request_three_d_secure]'

/** `automatic` for a one-time payment, `any` for a card kept for later. */
export function requestThreeDSecureFor(
  use: CardAuthenticationUse,
): RequestThreeDSecure {
  return use === 'off-session' ? 'any' : 'automatic'
}

/**
 * The form-encoded params to spread into a Stripe request body, beside the
 * request's own fields in the `URLSearchParams` it builds.
 */
export function cardAuthenticationParams(
  use: CardAuthenticationUse,
): Record<string, string> {
  return { [REQUEST_THREE_D_SECURE_PARAM]: requestThreeDSecureFor(use) }
}

/**
 * The same params for a Checkout Session, chosen by its `mode`: a
 * `subscription` or `setup` session keeps the card for off-session charges,
 * a `payment` session does not.
 */
export function checkoutSessionCardAuthenticationParams(
  mode: 'payment' | 'subscription' | 'setup',
): Record<string, string> {
  return cardAuthenticationParams(mode === 'payment' ? 'one-time' : 'off-session')
}
