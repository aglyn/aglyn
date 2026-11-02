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
  describeStripePaymentMethod,
  LIVE_SUBSCRIPTION_STATUSES,
  type StripePaymentMethodSummary,
} from '@aglyn/tenant-data-admin/server/stripe-payment-method'

export { describeStripePaymentMethod, LIVE_SUBSCRIPTION_STATUSES }

/** A payment method flattened for the staff billing card. */
export type StaffPaymentMethod = StripePaymentMethodSummary

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

/** A Stripe expandable reference read as its id, or null when unset. */
function paymentMethodId(value: unknown): string | null {
  if (typeof value === 'string') return value || null
  const id = (value as { id?: unknown } | null | undefined)?.id
  return typeof id === 'string' && id ? id : null
}

/** A customer's default payment method moving from one method to another. */
export interface DefaultPaymentMethodChange {
  /** The default before the change; null when the customer had none. */
  from: string | null
  to: string
}

/**
 * What a `customer.updated` event says about the customer's default payment
 * method (AGL-3442): the change, or null when the event changed something
 * else or cleared the default.
 *
 * `previous_attributes` names a field only when the update changed it, so an
 * address edit reads as no change here however the default is set.
 */
export function defaultPaymentMethodChange(
  customer: unknown,
  previousAttributes: unknown,
): DefaultPaymentMethodChange | null {
  const previous = (previousAttributes as Record<string, any> | null | undefined)
    ?.invoice_settings
  if (!previous || typeof previous !== 'object') return null
  if (!('default_payment_method' in previous)) return null
  const to = paymentMethodId(
    (customer as Record<string, any> | null | undefined)?.invoice_settings
      ?.default_payment_method,
  )
  if (!to) return null
  const from = paymentMethodId(previous.default_payment_method)
  return from === to ? null : { from, to }
}

/**
 * The live subscriptions still billing the customer's OLD default, which
 * must follow it to the new one (AGL-3442).
 *
 * A subscription that carries its own `default_payment_method` ignores the
 * customer's, and every subscription the console creates carries one:
 * `/api/billing/checkout` copies the customer's default of the day onto it.
 * So a new customer default — from the Billing Portal's payment-method flow,
 * or an edit in the Stripe Dashboard — leaves the subscription charging the
 * card that was replaced, which for a past-due workspace is the card that
 * just failed. The profile route's `set-default-card` moves the
 * subscriptions itself for the same reason.
 *
 * Only a subscription pinned to the previous default moves. One pinned to
 * some other method was set apart deliberately and is left where it is; one
 * with no override already bills the customer's default. When the customer
 * had no default before, every live subscription carrying an override moves:
 * the customer has just chosen what they pay with, and an override the
 * customer level never named was left by an older checkout, from before
 * `/api/billing/checkout` required a customer default.
 */
export function subscriptionsToMoveOntoDefault(
  subscriptions: unknown,
  change: DefaultPaymentMethodChange,
): string[] {
  if (!Array.isArray(subscriptions)) return []
  const ids: string[] = []
  for (const subscription of subscriptions as Array<Record<string, any>>) {
    if (!LIVE_SUBSCRIPTION_STATUSES.includes(String(subscription?.status))) {
      continue
    }
    const own = paymentMethodId(subscription?.default_payment_method)
    if (!own || own === change.to) continue
    if (change.from !== null && own !== change.from) continue
    if (typeof subscription?.id === 'string' && subscription.id) {
      ids.push(subscription.id)
    }
  }
  return ids
}

/**
 * Move the customer's live subscriptions onto their new default payment
 * method (AGL-3442), per {@link subscriptionsToMoveOntoDefault}.
 *
 * Never throws: the caller is the billing webhook, which must not answer a
 * 500 for this. `undefined` means the subscriptions could not be read; a
 * subscription Stripe refused to update is named in `failed`.
 */
export async function moveSubscriptionsOntoDefault(
  secretKey: string,
  customerId: string,
  change: DefaultPaymentMethodChange,
): Promise<{ moved: string[]; failed: string[] } | undefined> {
  const headers = { Authorization: `Bearer ${secretKey}` }
  let subscriptions: unknown
  try {
    const response = await fetch(
      'https://api.stripe.com/v1/subscriptions' +
        `?customer=${encodeURIComponent(customerId)}&status=all&limit=20`,
      { headers },
    )
    if (!response.ok) return undefined
    subscriptions = ((await response.json()) as { data?: unknown })?.data
  } catch {
    return undefined
  }
  const moved: string[] = []
  const failed: string[] = []
  for (const id of subscriptionsToMoveOntoDefault(subscriptions, change)) {
    try {
      const response = await fetch(
        `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(id)}`,
        {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            default_payment_method: change.to,
          }).toString(),
        },
      )
      if (response.ok) moved.push(id)
      else failed.push(id)
    } catch {
      failed.push(id)
    }
  }
  return { moved, failed }
}
