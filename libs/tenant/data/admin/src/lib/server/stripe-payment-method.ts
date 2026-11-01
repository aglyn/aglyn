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

/** A payment method flattened for a billing card: staff's, the workspace's, or a purchase. */
export interface StripePaymentMethodSummary {
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
 *
 * AGL-1715-EXEMPT: a deliberate SUPERSET of `isLiveSubscriptionStatus` — it
 * adds `unpaid`. Different question. That predicate answers "may this org open
 * a subscription", where an unpaid one must not block a new sale; this answers
 * "which subscription is Stripe billing against, so whose payment method is
 * the live one", and an unpaid subscription still has the card that failed on
 * it. Sharing the list would show a stale method on exactly the orgs in
 * dunning — the ones looking at this card. `stripe-payment-method.spec.ts`
 * pins `unpaid` deliberately; do not converge them.
 *
 * EXPORTED because `/api/billing/profile` asks the identical question when it
 * decides whether detaching the last card would break a renewal, and whether a
 * subscription's own default payment method outranks the customer's. A third
 * copy of the same four words is exactly the drift AGL-1715 exists to stop.
 */
export const LIVE_SUBSCRIPTION_STATUSES = [
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
): StripePaymentMethodSummary | null {
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

/** A Stripe expandable reference read as its id, or null when unset. */
function expandableId(value: unknown): string | null {
  if (typeof value === 'string') return value || null
  const id = (value as { id?: unknown } | null | undefined)?.id
  return typeof id === 'string' && id ? id : null
}

/** What a charge against a workspace's billing customer needs to know first. */
export interface BillingDetails {
  /** The method a charge would use, or null when there is none on file. */
  paymentMethodId: string | null
  /** That method, described, when Stripe sent it expanded. */
  method: StripePaymentMethodSummary | null
  /** Whether a billing address names a country: sales tax is computed from it. */
  hasAddress: boolean
}

/**
 * The card on file and the address for one billing customer.
 *
 * The effective default is the one Billing shows: a live subscription's own
 * default outranks the customer's, because Stripe charges that one and
 * Checkout routinely sets it while leaving `invoice_settings` empty (AGL-940).
 * Reading only the customer would tell a workspace paying by that card that
 * it has none.
 *
 * `null` when the customer cannot be read, which is not the same answer as
 * "no card": the caller says "try again", not "add one".
 */
export async function readBillingDetails(
  secretKey: string,
  customerId: string,
): Promise<BillingDetails | null> {
  const read = async (path: string) => {
    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    })
    return { ok: response.ok, payload: (await response.json().catch(() => null)) as any }
  }
  const customerPath = encodeURIComponent(customerId)
  const [customer, subscriptions] = await Promise.all([
    read(`customers/${customerPath}?expand[]=invoice_settings.default_payment_method`),
    read(
      `subscriptions?customer=${customerPath}&status=all&limit=20&expand[]=data.default_payment_method`,
    ),
  ])
  if (!customer.ok) return null
  const billing = (
    Array.isArray(subscriptions.payload?.data) ? subscriptions.payload.data : []
  ).find((subscription: any) =>
    LIVE_SUBSCRIPTION_STATUSES.includes(String(subscription?.status)),
  )
  const chosen =
    billing?.default_payment_method ??
    customer.payload?.invoice_settings?.default_payment_method ??
    null
  return {
    paymentMethodId: expandableId(chosen),
    method: describeStripePaymentMethod(chosen),
    hasAddress: Boolean(customer.payload?.address?.country),
  }
}
