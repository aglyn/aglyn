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
 * Which workspace a Stripe customer belongs to (AGL-941).
 *
 * The Checkout session already puts `orgId` on the **subscription**, but the
 * **Customer** carried nothing but an email — so the Stripe dashboard shows a
 * row reading `owner@example.com` and nothing else. One person owning
 * several orgs makes that list ambiguous, and revenue cannot be grouped by
 * workspace at all.
 *
 * `name` is the load-bearing field: it is the column Stripe's customer list
 * renders. `metadata` is what makes the customer findable and groupable via
 * search and the API.
 *
 * Kept pure because it is the part worth checking. The `fetch` that sends it
 * is best-effort by design (a billing webhook must not fail because a cosmetic
 * PATCH did), and best-effort code is exactly the kind that quietly sends
 * nothing — so what it *would* send is asserted here rather than in a mock.
 */
export interface OrgIdentity {
  orgId: string
  /** The org's display name, if it has one. */
  name?: string | null
  /** The URL slug — how staff actually refer to a workspace. */
  slug?: string | null
}

/**
 * Stripe customer fields identifying the org, as form params.
 *
 * Returns an EMPTY map when there is nothing meaningful to say, so a caller
 * can skip the request entirely rather than PATCH a customer with nothing.
 * That case is real: `orgId` alone is already on the subscription, and a
 * customer named after a raw document id is worse for the dashboard than one
 * named after the email, which at least identifies a human.
 */
export function stripeCustomerIdentityParams(
  org: OrgIdentity,
): Record<string, string> {
  const name = org.name?.trim()
  const slug = org.slug?.trim()
  if (!org.orgId || (!name && !slug)) return {}

  const params: Record<string, string> = {
    // Always both, so a customer found by either route carries the other.
    'metadata[orgId]': org.orgId,
  }
  if (slug) params['metadata[orgSlug]'] = slug
  // Fall back to the slug: an org that never set a display name still gets a
  // scannable row, which is the entire point of the issue.
  params['name'] = name || (slug as string)
  // The dashboard shows `description` under the name. Naming the workspace
  // twice is useless, so this says what the row IS — the distinction that was
  // missing when several customers shared one owner's email.
  params['description'] = slug
    ? `Aglyn workspace: ${slug}`
    : `Aglyn workspace ${org.orgId}`
  return params
}

/**
 * How a Checkout session should address the org's customer (AGL-941).
 *
 * `customer_email` does NOT reuse anything — Stripe mints a **fresh Customer
 * on every checkout**. An org that subscribed, cancelled and resubscribed
 * therefore accumulated duplicates, while `stripeCustomerId` only ever pointed
 * at the most recent, so earlier invoices scattered onto customers the Billing
 * page never queries.
 *
 * The two keys are **mutually exclusive** — a session carrying both is
 * rejected by Stripe — so this is deliberately a single either/or rather than
 * two independent spreads. Getting that wrong breaks every upgrade, which is
 * why it is a function with a test and not an inline ternary.
 */
export function checkoutCustomerParams(
  existingCustomerId?: string | null,
  email?: string | null,
): Record<string, string> {
  const customer = existingCustomerId?.trim()
  if (customer) {
    return {
      customer,
      // Automatic tax with a REUSED customer (AGL-1537). Stripe resolves the
      // tax location of an existing customer from the CUSTOMER record, not
      // from the address typed into this session — so a reused customer with
      // no stored address makes an `automatic_tax` session unresolvable.
      // `auto` saves the billing address collected by this session back onto
      // the customer, which both fixes that session and keeps the stored
      // address current for later subscription updates (which also compute
      // tax). Only valid alongside `customer` — Stripe rejects
      // `customer_update` on a session without one, which is why it lives in
      // this branch and not next to `billing_address_collection`.
      'customer_update[address]': 'auto',
      // REQUIRED by `tax_id_collection` on a reused customer (AGL-1823).
      // Stripe hard-rejects the session otherwise: "Tax ID collection
      // requires updating business name on the customer. To enable tax ID
      // collection for an existing customer, please set
      // `customer_update[name]` to `auto`." — reproduced in test mode
      // 2026-08-15. Without this, EVERY churned org's resubscribe 502s at
      // session creation; a first subscribe is unaffected (no `customer`).
      //
      // The trade-off is deliberate: `auto` lets Checkout overwrite the
      // customer's `name` with whatever business name the buyer types into
      // the tax-id form — the very field AGL-941 stamps with the workspace
      // name. That rename is transient: the webhook re-stamps
      // `stripeCustomerIdentityParams` (name + metadata) on every
      // `customer.subscription.created/updated/deleted`, and a completed
      // resubscribe fires `created` immediately, so the dashboard row
      // self-heals. The typed legal name still reaches the invoice via the
      // session's own `customer_details`/`business_name`.
      'customer_update[name]': 'auto',
    }
  }
  const customerEmail = email?.trim()
  return customerEmail ? { customer_email: customerEmail } : {}
}

export default stripeCustomerIdentityParams
