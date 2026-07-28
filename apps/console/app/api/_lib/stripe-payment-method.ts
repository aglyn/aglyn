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

/** A payment method flattened for the staff billing card. */
export interface StaffPaymentMethod {
  type: string | null
  brand: string | null
  last4: string | null
  expMonth: number | null
  expYear: number | null
  /** Link and the wallet methods identify by email, not a PAN. */
  email: string | null
}

/**
 * Subscription statuses Stripe will actually bill against. A cancelled
 * subscription's method is stale and must never outrank a live one.
 */
const LIVE_SUBSCRIPTION_STATUSES = [
  'active',
  'trialing',
  'past_due',
  'unpaid',
]

/**
 * Shape an expanded Stripe PaymentMethod (AGL-940).
 *
 * Deliberately not card-only: Checkout offers Link, Amazon Pay, Cash App and
 * Klarna, and those have no `.card` — reading it was why a Link method
 * rendered as "No payment method". `pm[pm.type]` reaches whichever
 * sub-object the type names.
 *
 * Returns null for an UNEXPANDED value too: without `expand[]` Stripe sends
 * the id as a bare string, and treating that truthy string as a method
 * yields an all-null object that renders as a blank chip rather than an
 * honest "none".
 */
export function describeStripePaymentMethod(
  pm: unknown,
): StaffPaymentMethod | null {
  if (!pm || typeof pm !== 'object') return null
  const method = pm as Record<string, any>
  const card = method['card'] ?? null
  const type = method['type']
  const detail = typeof type === 'string' ? method[type] : null
  return {
    type: type ?? (card ? 'card' : null),
    brand: card?.brand ?? null,
    last4: card?.last4 ?? detail?.last4 ?? null,
    expMonth: card?.exp_month ?? null,
    expYear: card?.exp_year ?? null,
    email: detail?.email ?? method['billing_details']?.email ?? null,
  }
}

/**
 * The payment method a customer's subscriptions are billed against.
 *
 * Stripe stores the effective default in more than one place, and Checkout
 * commonly sets it on the SUBSCRIPTION while leaving
 * `customer.invoice_settings` empty — which is why the dashboard and the
 * staff card disagreed (AGL-940).
 *
 * `data` arrives newest-first, so the first LIVE subscription is the one
 * being billed; a cancelled subscription is consulted only when nothing is
 * live, and then only as better-than-nothing.
 */
export function selectSubscriptionPaymentMethod(
  subscriptions: unknown,
): StaffPaymentMethod | null {
  if (!Array.isArray(subscriptions)) return null
  const live = subscriptions.find((subscription: any) =>
    LIVE_SUBSCRIPTION_STATUSES.includes(String(subscription?.status)),
  )
  const chosen = live ?? subscriptions[0]
  return describeStripePaymentMethod(chosen?.default_payment_method)
}
