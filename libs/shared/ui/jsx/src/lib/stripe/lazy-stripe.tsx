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

'use client'

import { lazy } from 'react'

/**
 * STRIPE, ONLY ONCE SOMEONE IS PAYING (AGL-4049).
 *
 * Importing `@stripe/stripe-js` injects the Stripe script by itself, so a
 * surface that might take a payment must not import it until it does: on a
 * page nobody is buying from, it is the largest thing on the page
 * (`stripe-stays-lazy.spec.ts`).
 *
 * The boundary lives HERE, inside this library, rather than at each caller.
 * A `lazy(() => import('@aglyn/shared-ui-jsx/…'))` in a plugin is a dynamic
 * edge between two projects, and one such edge makes every ordinary import of
 * this library across the console a lint error. This file is the static import
 * they take instead, and it imports nothing of Stripe's.
 */

/** The billing card form, loaded when it is first shown. */
export const LazyBillingCardForm = lazy(() => import('./billing-card-form.component'))

/** The billing address form, loaded when it is first shown. */
export const LazyBillingAddressForm = lazy(() => import('./billing-address-form.component'))

/**
 * Runs the bank's own step for a payment sitting at `requires_action`.
 *
 * Resolves to Stripe's refusal, or `null` once the bank is satisfied. Never
 * throws: a library that will not load is a refusal like any other, and the
 * payment it stopped has not been charged.
 */
export async function handleStripeNextAction(clientSecret: string): Promise<string | null> {
  try {
    const { getBrowserStripe } = await import('./browser-stripe')
    const stripe = await getBrowserStripe()
    if (!stripe) {
      return 'Your bank needs to confirm this payment, but the payment library could not load.'
    }
    const result = await stripe.handleNextAction({ clientSecret })
    return result.error
      ? (result.error.message ?? 'Your bank did not confirm the payment.')
      : null
  } catch {
    return 'Your bank needs to confirm this payment, but the payment library could not load.'
  }
}
