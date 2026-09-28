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
 * A subscription change that adds value is PAID FOR before it is granted
 * (AGL-3358).
 *
 * Shared by the two routes that sell more on an existing subscription — a plan
 * upgrade (`/api/billing/subscription`) and an add-on increase
 * (`/api/billing/addons`) — so the rule is written once.
 *
 * ## Why both parameters
 *
 * `proration_behavior: always_invoice` raises the proration as an invoice now
 * and charges the default payment method, instead of filing it as a pending
 * invoice item that waits for the renewal. On its own that still APPLIES the
 * change whatever happens to the charge: a declined card or an issuer asking
 * for 3DS leaves the customer on the bigger plan with an unpaid invoice.
 *
 * `payment_behavior: pending_if_incomplete` makes the change conditional on
 * that invoice being paid. Until it is, Stripe holds the new items (and the
 * new `metadata`, verified in test mode) in `subscription.pending_update` and
 * leaves the live subscription exactly as it was — so the webhook, which
 * projects `plan` from `metadata.plan` and the plan item's price, keeps
 * projecting the plan that was paid for. Paying the invoice later (3DS in the
 * browser, or the hosted invoice page) applies the update; leaving it unpaid
 * lets it expire after about 23 hours with nothing granted.
 */
export function immediateChargeParams(subscription: {
  collection_method?: string | null
}): Record<string, string> {
  // An invoiced (net-terms) subscription is the exception. Stripe offers
  // pending updates only on `charge_automatically`, and a send-invoice
  // subscription is an enterprise agreement staff provisioned on terms
  // (`/api/admin/enterprise-billing`): capability applies when the invoice is
  // SENT, by design. It still gets the invoice now rather than at renewal.
  if (subscription?.collection_method === 'send_invoice') {
    return { proration_behavior: 'always_invoice' }
  }
  return {
    proration_behavior: 'always_invoice',
    payment_behavior: 'pending_if_incomplete',
  }
}

/** The route's own Stripe caller, so this module holds no key and no fetch. */
export type StripeCall = (
  method: 'GET' | 'POST',
  path: string,
  body?: URLSearchParams,
) => Promise<any>

/**
 * Turn Stripe Tax on for a subscription that predates it (AGL-1537), as a
 * change of its own.
 *
 * Every update used to carry `automatic_tax[enabled]=true` so that old
 * subscriptions picked it up on their next change. Stripe refuses that
 * parameter alongside `pending_if_incomplete` ("`automatic_tax` is not
 * supported", measured in test mode), so the immediate-charge update cannot
 * carry it. Sent first instead, with nothing to prorate, and only when Stripe
 * reports it OFF — every subscription made since AGL-1133 has it on, so this
 * is almost always no call at all. Stripe always serializes `automatic_tax`,
 * so reading "off" as `enabled === false` misses nothing real, and a payload
 * without the field is not grounds for a write.
 *
 * Returns whether it made the call.
 */
export async function ensureAutomaticTax(
  stripe: StripeCall,
  subscription: { id?: string; automatic_tax?: { enabled?: boolean } | null },
): Promise<boolean> {
  if (subscription?.automatic_tax?.enabled !== false) return false
  await stripe(
    'POST',
    `subscriptions/${subscription.id}`,
    new URLSearchParams({
      'automatic_tax[enabled]': 'true',
      proration_behavior: 'none',
    }),
  )
  return true
}

/** What an immediate-charge update did, read off Stripe's answer. */
export interface ImmediateChargeOutcome {
  /**
   * The change is live on the subscription. False means Stripe is holding it
   * in `pending_update` until the invoice is paid, and nothing may be granted.
   */
  applied: boolean
  /** The invoice the update raised was paid (or there was nothing to pay). */
  paid: boolean
  /** The issuer wants the customer to authenticate (SCA / 3DS). */
  requiresAction: boolean
  /** The PaymentIntent's client secret, for `stripe.handleNextAction`. */
  paymentClientSecret: string | null
  /** The card was refused outright; a different payment method is needed. */
  declined: boolean
  /** Stripe's hosted page for the same invoice, the fallback way to pay it. */
  hostedInvoiceUrl: string | null
  /** What the invoice asked for, tax included. */
  amountDueCents: number
  currency: string
}

/**
 * Read an update sent with `immediateChargeParams` and
 * `expand[]=latest_invoice.payment_intent`.
 *
 * `pending_update` is the only thing that decides `applied`. A paid invoice
 * with no pending update is the normal success; an open invoice with a pending
 * update is a charge that has not gone through. The two failure shapes are
 * named apart because only one of them is recoverable from the browser.
 */
export function readImmediateCharge(updated: any): ImmediateChargeOutcome {
  const invoice =
    updated?.latest_invoice && typeof updated.latest_invoice === 'object'
      ? updated.latest_invoice
      : null
  const intent =
    invoice?.payment_intent && typeof invoice.payment_intent === 'object'
      ? invoice.payment_intent
      : null
  const applied = !updated?.pending_update
  const requiresAction = !applied && intent?.status === 'requires_action'
  return {
    applied,
    paid:
      applied &&
      (!invoice ||
        invoice.status === 'paid' ||
        Number(invoice.amount_due ?? 0) <= 0),
    requiresAction,
    paymentClientSecret:
      requiresAction && intent?.client_secret
        ? String(intent.client_secret)
        : null,
    declined: !applied && !requiresAction,
    hostedInvoiceUrl: invoice?.hosted_invoice_url
      ? String(invoice.hosted_invoice_url)
      : null,
    amountDueCents: Number(invoice?.amount_due ?? 0),
    currency: String(invoice?.currency ?? 'usd'),
  }
}

/**
 * The response fields a pending charge hands the page, identical on both
 * routes so one browser helper can finish either.
 */
export function pendingChargeResponse(outcome: ImmediateChargeOutcome) {
  return {
    paymentPending: true as const,
    chargedNowCents: outcome.amountDueCents,
    chargeCurrency: outcome.currency,
    ...(outcome.requiresAction && outcome.paymentClientSecret
      ? { requiresAction: true, paymentClientSecret: outcome.paymentClientSecret }
      : {}),
    ...(outcome.declined ? { declined: true } : {}),
    ...(outcome.hostedInvoiceUrl
      ? { hostedInvoiceUrl: outcome.hostedInvoiceUrl }
      : {}),
  }
}

/**
 * Did THIS subscription event carry a held update being applied?
 *
 * A change sent with `pending_if_incomplete` that was not paid on the spot is
 * applied later — when the customer passes their bank's check, or pays the
 * hosted invoice — and nobody is in the request that asked for it any more.
 * Stripe reports the moment as a `customer.subscription.updated` whose object
 * has no `pending_update` and whose `previous_attributes` names one (measured
 * in test mode: `previous_attributes` keys `items, pending_update`, preceded
 * by `customer.subscription.pending_update_applied`, which this platform does
 * not subscribe to).
 *
 * Keyed on that positive pair rather than on "an update with items changed",
 * so a renewal, a phase flip or a dashboard edit never reads as one.
 */
export function heldUpdateApplied(
  subscription: { pending_update?: unknown } | null | undefined,
  previousAttributes: { pending_update?: unknown } | null | undefined,
): boolean {
  return (
    !subscription?.pending_update &&
    Boolean(previousAttributes?.pending_update)
  )
}

/** A `StripeCall` bound to a secret key, for callers with no route helper. */
export function stripeCallWithKey(secretKey: string): StripeCall {
  return async (method, path, body) => {
    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        ...(body
          ? { 'Content-Type': 'application/x-www-form-urlencoded' }
          : {}),
      },
      ...(body ? { body: body.toString() } : {}),
    })
    const payload = await response.json()
    if (!response.ok) {
      throw new Error(payload?.error?.message ?? `Stripe ${path} failed`)
    }
    return payload
  }
}
