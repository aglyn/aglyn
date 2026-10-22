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

import { buildRoute, Route } from '../constants/route-links'

/**
 * THE "UPDATE PAYMENT METHOD" BUTTON, AND EVERY LINK THAT POINTS AT IT
 * (AGL-3442).
 *
 * A failed-payment email and the past-due banner both tell the reader to
 * update the payment method in Billing. The button that does it sits in the
 * Billing landing's Current plan card, and these are the three facts every
 * one of those surfaces must agree on: the element id the button carries,
 * the hash that brings it into view, and the portal flow it opens.
 *
 * Dependency-free beyond the route table, so the webhook's notice copy, the
 * banner and the page all import the same strings.
 */

/** The button's element id, and the hash a link uses to land on it. */
export const UPDATE_PAYMENT_METHOD_ANCHOR = 'update-payment-method'

/**
 * The Stripe Billing Portal flow the button opens: the customer adds a
 * payment method and it becomes the default, with the rest of the portal
 * hidden.
 */
export const PAYMENT_METHOD_UPDATE_FLOW = 'payment_method_update'

/**
 * The Billing landing, scrolled to the Update payment method button.
 *
 * Without a slug this is `/org/billing`, the stored-notification form that
 * the console and the notification email both rewrite onto the reader's
 * workspace; the hash survives that rewrite.
 */
export function updatePaymentMethodHref(orgSlug?: string | null): string {
  const billing = orgSlug
    ? buildRoute(Route.MANAGE_BILLING, { orgSlug })
    : '/org/billing'
  return `${billing}#${UPDATE_PAYMENT_METHOD_ANCHOR}`
}
