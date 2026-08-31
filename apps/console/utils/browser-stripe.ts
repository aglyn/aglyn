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

import { loadStripe, type Stripe } from '@stripe/stripe-js'

/**
 * ONE browser Stripe instance for the whole console.
 *
 * `loadStripe` injects a script tag, so a per-component singleton means a tag
 * per component that ever mounts. There were two; the SCA step on the billing
 * page would have made a third.
 *
 * Null when `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is unset, which every caller
 * must handle: it is the state a self-hosted deployment with no Stripe keys is
 * in, and rendering a payment surface against it produces an empty white box
 * that looks like a broken form.
 */
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
let stripePromise: Promise<Stripe | null> | null = null

export function getBrowserStripe(): Promise<Stripe | null> | null {
  if (!publishableKey) return null
  if (!stripePromise) stripePromise = loadStripe(publishableKey)
  return stripePromise
}

/** Whether this browser bundle can render a Stripe payment surface at all. */
export function browserStripeConfigured(): boolean {
  return Boolean(publishableKey)
}
