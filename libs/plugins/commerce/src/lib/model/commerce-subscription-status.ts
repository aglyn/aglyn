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
 * The TENANT-side live-subscription list — one copy, for the whole plugin
 * (AGL-1849).
 *
 * ## Why this is not `isLiveSubscriptionStatus`
 *
 * AGL-1715-EXEMPT: this is a decision about the TENANT's own site members'
 * subscriptions to the TENANT's products (`hosts/{hostId}/subscriptions`) — a
 * different Stripe account, a different buyer and a different question from
 * `isLiveSubscriptionStatus` in `@aglyn/aglyn`, which asks whether an Aglyn org
 * is paying US. The words coincide only because both are Stripe subscription
 * statuses. Converging them would tie a shopper's access to a tenant's store to
 * Aglyn's own billing rules, so the two stay apart deliberately.
 *
 * ## Why it is its own file
 *
 * It used to be two private `LIVE_STATUSES` sets, in `server/gate.ts` and
 * `server/member-post.ts`, each carrying its own copy of the marker and its own
 * allowlist entry. Two copies of a list that decides who has already paid is
 * the shape AGL-1715 exists to prevent, and the third caller — the
 * duplicate-subscription guard in `server/checkout.ts` — would have made it
 * three. Hoisting it to the model gives the tenant side the same single source
 * the org side has, rather than a fourth transcription of the same three words.
 *
 * ## Why `past_due` counts as live
 *
 * A subscription in dunning is still a subscription: Stripe is retrying the
 * card, the member has not cancelled, and access has not lapsed. Dropping it
 * would revoke a paying member's content the moment a card expired, and — for
 * the checkout guard — would invite them to buy a SECOND subscription to a
 * product they are already being billed for, which is precisely the duplicate
 * this list is used to refuse.
 *
 * A cancelled or `incomplete_expired` subscription is NOT live, and that is
 * equally load-bearing: a member who cancelled must be able to re-subscribe.
 * A guard built on "has a subscription row" instead of "has a LIVE one" would
 * lock them out forever (the AGL-1715 lesson, restated on the tenant side).
 */
// AGL-1715-EXEMPT: the tenant side's own list, for the reasons set out above —
// a tenant's site member subscribing to a tenant's product, on the tenant's
// Stripe account. Not the Aglyn org's subscription to us, so not
// `isLiveSubscriptionStatus`. (Restated here because the guard wants the marker
// within 25 lines of the literal, and the reasoning above is longer than that.)
export const TENANT_LIVE_SUBSCRIPTION_STATUSES = [
  'active',
  'trialing',
  'past_due',
] as const

export type TenantLiveSubscriptionStatus =
  (typeof TENANT_LIVE_SUBSCRIPTION_STATUSES)[number]

/**
 * Is this tenant-side subscription status one that still grants access / still
 * counts as an existing subscription?
 *
 * Takes `unknown` on purpose: every caller reads it straight off a Firestore
 * snapshot, where the field may be absent, a number, or anything else a bad
 * write left behind. Narrowing here means no caller has to `String(...)` it
 * defensively and get a `'undefined'` that quietly fails the test for the
 * wrong reason.
 */
export function isTenantSubscriptionLive(status: unknown): boolean {
  return (
    typeof status === 'string' &&
    (TENANT_LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status)
  )
}
