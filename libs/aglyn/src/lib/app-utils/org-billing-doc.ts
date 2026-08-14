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

import type { OrgSeatAddons, OrgSubscription } from '../foundation/definitions/org-billing.types'

/**
 * Where the commercial keys live now that they are off the org doc (AGL-1028).
 *
 * `orgs/{orgId}` has to stay readable by any member — it carries `plan` and
 * `entitlements`, which every console surface gates features on, so denying it
 * locks a site collaborator out of the site they were invited to. Firestore has
 * no field-level reads, so the only way to narrow "readable" is to move the
 * fields somewhere with its own rule. This subcollection is that somewhere, and
 * it is gated on `canManageOrg()`.
 *
 * What did NOT move, and why. AGL-1028 originally listed `seatAddons` and all
 * of `subscription` as movers; measuring the readers changed that:
 *
 * - `plan` / `entitlements` — the whole reason the org doc stays readable.
 * - `seatAddons` — NOT a commercial secret, an ENTITLEMENT INPUT.
 *   `resolveOrgEntitlements` stacks it on top of the plan: `seatAddons.hosts`
 *   raises `hostLimit`, `posRegisters` raises `posRegisters`, `eventCalendar`
 *   switches a feature on. It resolves at 29 call sites including the tenant
 *   runtime and non-manager console components — none of which can read a
 *   manager-gated doc. Moving it would silently drop every paying org to base
 *   plan limits for exactly the users the org doc stays readable for.
 * - `subscription.status`, as the derived `billingStatus` mirror — same reason.
 *   `resolveEffectivePlan` downgrades a paid plan to free on a dead
 *   subscription, and `resolvePurchasedAddons` stops counting add-ons on one.
 *   Entitlement resolution therefore needs the status word, so the status word
 *   cannot be manager-gated. The rest of `subscription` — price ids, amounts,
 *   interval, period end, custom enterprise pricing — moves.
 * - `suspendedAt` / `suspendedReason` — the tenant runtime reads suspension on
 *   EVERY published page render, off an org doc it already fetches for plan and
 *   branding. Moving it would add a Firestore read to the hot path AGL-1152 is
 *   trying to shrink, and would hide nothing: the org doc stays member-readable
 *   regardless. "Your sites are offline" is also something every member needs
 *   to see, unlike a Stripe customer id.
 *
 * So what a scoped collaborator can still see is their plan, their capacity and
 * a status word — the things they need — and what they lose is the Stripe
 * customer id, price ids, amounts, billing interval, renewal date and any
 * negotiated enterprise rate.
 */
export const ORG_BILLING_SUBCOLLECTION = 'billing'

/**
 * Single document id, not one doc per concern. The reads are always "all of
 * it" (the billing page, the webhook, the staff MRR roll-up), so splitting it
 * would only buy extra round trips.
 */
export const ORG_BILLING_DOC_ID = 'stripe'

/**
 * Reverse index `stripeCustomers/{stripeCustomerId} -> { orgId }`, written by
 * the webhook alongside the billing doc.
 *
 * It exists because the webhook has to answer "which org is this Stripe
 * customer?" on `invoice.payment_failed`, and it did that with
 * `.where('stripeCustomerId', '==', …)` on the orgs collection. Once the field
 * moves into a subcollection that query cannot work: the alternative is a
 * collection-group query, which needs a collection-group index that the
 * emulator will never ask for and production will (AGL-1028). A mapping doc is
 * an O(1) `get`, needs no index, and stops the webhook scanning `orgs` at all.
 *
 * Admin-SDK only — nothing client-side has any business reading it.
 */
export const STRIPE_CUSTOMER_INDEX_COLLECTION = 'stripeCustomers'

/**
 * The keys that moved off `orgs/{orgId}` and into the billing doc.
 *
 * `seatAddons` is deliberately NOT here — see the note above; it is an
 * entitlement input, not a commercial secret.
 */
export const ORG_BILLING_MOVED_KEYS = [
  'stripeCustomerId',
  'subscription',
] as const

export type OrgBillingMovedKey = (typeof ORG_BILLING_MOVED_KEYS)[number]

/** The manager-gated document's shape. */
export interface OrgBillingDoc {
  stripeCustomerId?: string | null
  subscription?: OrgSubscription | null
}

/**
 * `seatAddons` stays on the org doc, so this is the shape of what the org doc
 * still carries commercially. Named for clarity at the call sites that have to
 * keep the two apart.
 */
export interface OrgInlineBilling {
  seatAddons?: OrgSeatAddons | null
  billingStatus?: string | null
}

/**
 * The non-sensitive mirror that STAYS on the org doc.
 *
 * The AGL-275 dunning banner keys on `subscription.status === 'past_due'` and
 * is shown to every member on purpose — a contractor who cannot see the invoice
 * still benefits from knowing the workspace is about to lapse. Putting
 * `subscription` behind `canManageOrg()` would have silently switched that
 * banner off for non-managers, so the webhook mirrors the status string (and
 * nothing else: no amounts, no price ids, no customer id) back onto the org doc
 * for the banner to read.
 */
export type OrgBillingStatus = string

/**
 * Picks the moved keys off an org-shaped object, dropping `undefined` so a
 * partial update never writes holes over good data.
 *
 * `null` is preserved deliberately — the webhook uses it to mean "Stripe says
 * this is gone", which is a real value and not an absence.
 */
export function pickOrgBillingFields(
  source: Partial<Record<OrgBillingMovedKey, unknown>> | null | undefined,
): Partial<OrgBillingDoc> {
  const out: Record<string, unknown> = {}
  if (!source) return out
  for (const key of ORG_BILLING_MOVED_KEYS) {
    if (source[key] !== undefined) out[key] = source[key]
  }
  return out as Partial<OrgBillingDoc>
}

/**
 * The status string to mirror onto the org doc for the dunning banner.
 *
 * Returns `null` when there is no subscription at all, which the banner treats
 * the same as a healthy one — a pre-billing workspace is not in dunning.
 */
export function orgBillingStatusFrom(
  billing: Partial<OrgBillingDoc> | null | undefined,
): OrgBillingStatus | null {
  const status = (billing?.subscription as { status?: unknown } | null | undefined)?.status
  return typeof status === 'string' && status ? status : null
}

/**
 * Subscription statuses that mean "this org is already subscribed" (AGL-1715).
 *
 * A STATUS test rather than a "has a subscription record" test, and that is the
 * part worth preserving: the record — and the `stripeCustomerId` beside it —
 * both survive cancellation, so the naive form would lock every churned
 * workspace out of ever paying us again. `incomplete`, `incomplete_expired` and
 * `unpaid` are out from the other side: there is no live subscription to
 * protect and a new one is the buyer's only way forward.
 *
 * `past_due` IS live. A second subscription does not settle the first one's
 * unpaid invoice; it adds a charge beside it. Dunning is paid through the
 * invoices and portal routes.
 */
const LIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due']

/**
 * True when this org already has a live subscription and must not be sold or
 * provisioned a second one (AGL-1697, AGL-1714).
 *
 * Lives here rather than at the call site because the failure mode of the
 * copies is asymmetric in the expensive direction: if one call site's list ever
 * narrows relative to another's, a subscribed org gets sold a second
 * subscription and both bill. AGL-1715 tracks repointing the three older inline
 * copies (`billing/page.tsx`, `billing/subscription/route.ts`,
 * `billing/checkout/route.ts`) at this predicate; they are unchanged for now
 * only because each one forces a mock update in console specs that concurrent
 * work is sitting on.
 */
export function isOrgSubscriptionLive(
  billing: Partial<OrgBillingDoc> | null | undefined,
): boolean {
  const status = orgBillingStatusFrom(billing)
  return !!status && LIVE_SUBSCRIPTION_STATUSES.includes(status)
}

/**
 * True when an org record still carries the moved keys inline — i.e. it has not
 * been through the backfill yet. Used by the read path to decide whether the
 * org doc is a trustworthy fallback, and by the backfill to skip work it has
 * already done.
 */
export function hasInlineOrgBilling(
  source: Partial<Record<OrgBillingMovedKey, unknown>> | null | undefined,
): boolean {
  if (!source) return false
  return ORG_BILLING_MOVED_KEYS.some((key) => source[key] !== undefined)
}
